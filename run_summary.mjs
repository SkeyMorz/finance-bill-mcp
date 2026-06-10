// ============================================================
// 财务账单智能汇总 — 端到端处理脚本
// 遵循 SKILL.md 5 步流程: list → read → parse → report → notify
// ============================================================

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = path.join(__dirname, "sample_data");

// ---- Step 1: list_directory ----
async function listDirectory(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
      .map(async (e) => {
        const fullPath = path.join(dirPath, e.name);
        const stat = await fs.stat(fullPath);
        return { name: e.name, path: fullPath, size_bytes: stat.size };
      })
  );
  return files;
}

// ---- Step 2: read_bill_file ----
async function readBillFile(filePath) {
  if (!filePath.toLowerCase().endsWith(".md")) {
    throw new Error(`仅支持读取 .md 文件: ${filePath}`);
  }
  const content = await fs.readFile(filePath, "utf-8");
  return { content, file_name: path.basename(filePath) };
}

// ---- Step 3: parse_and_clean_bills ----
// 内联所有解析逻辑（与 src/parsers/* 等价）

function identifyPlatform(sourceFile) {
  const rules = [
    [/alipay|支付宝/i, "alipay"],
    [/wechat|wxpay|微信/i, "wechat_pay"],
    [/bank|银行|对公|流水/i, "bank_statement"],
    [/stripe/i, "stripe"],
    [/invoice|发票/i, "invoice"],
    [/quickbook/i, "quickbooks"],
    [/paypal/i, "paypal"],
  ];
  for (const [pattern, name] of rules) {
    if (pattern.test(sourceFile)) return name;
  }
  return "unknown";
}

// Markdown table parser
const DATE_KEYS = /日期|交易日期|date|time/i;
const DESC_KEYS = /描述|交易说明|备注|摘要|description|memo|用途|说明/i;
const AMOUNT_KEYS = /金额|交易金额|amount|收入|支出/i;
const DIR_KEYS = /方向|类型|收支|type/i;

function buildColumnMap(headers) {
  const map = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim();
    if (DATE_KEYS.test(h)) map.date = i;
    else if (DESC_KEYS.test(h)) map.description = i;
    else if (AMOUNT_KEYS.test(h)) map.amount = i;
    else if (DIR_KEYS.test(h)) map.direction = i;
  }
  if (map.date == null || map.amount == null) return null;
  return {
    date: map.date,
    description: map.description ?? -1,
    amount: map.amount,
    direction: map.direction ?? -1,
  };
}

function isSeparatorRow(cells) {
  return cells.every((c) => /^[-: ]+$/.test(c.trim()));
}

function isMarkdownTable(content) {
  const lines = content.split("\n").filter((l) => l.trim());
  const pipeLines = lines.filter((l) => l.includes("|"));
  return pipeLines.length >= 3;
}

function parseMarkdownTable(content) {
  const records = [];
  const warnings = [];
  const lines = content.split("\n");
  const rows = lines
    .map((l) =>
      l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
    )
    .filter((cells) => cells.length >= 2);

  if (rows.length < 2) {
    warnings.push("Markdown 表格行数不足");
    return { records, warnings };
  }

  const colMap = buildColumnMap(rows[0]);
  if (!colMap) {
    // Try skipping title lines (non-pipe lines before the table)
    warnings.push("无法识别 Markdown 表格列头");
    return { records, warnings };
  }

  let dataStart = 1;
  if (isSeparatorRow(rows[1])) dataStart = 2;

  for (let i = dataStart; i < rows.length; i++) {
    const cells = rows[i];
    const rawDate = cells[colMap.date]?.trim();
    if (!rawDate || rawDate === "") continue;

    const rawAmount = cells[colMap.amount]?.trim() || "0";
    const desc =
      colMap.description >= 0 ? cells[colMap.description]?.trim() || "" : "";
    const dirCell =
      colMap.direction >= 0 ? cells[colMap.direction]?.trim() || "" : "";

    const amount = Math.abs(parseFloat(rawAmount.replace(/[¥￥,]/g, "")));
    if (isNaN(amount)) {
      warnings.push(`行 ${i + 1}: 金额解析失败 "${rawAmount}"`);
      continue;
    }

    let direction;
    if (dirCell && /收入|入账|收款|credit|in|收/i.test(dirCell)) {
      direction = "income";
    } else if (dirCell && /支出|出账|付款|debit|out|支|退/i.test(dirCell)) {
      direction = "expense";
    } else {
      const num = parseFloat(rawAmount.replace(/[¥￥,]/g, ""));
      direction = num < 0 ? "expense" : "income";
    }

    records.push({
      date: rawDate,
      description: desc,
      amount,
      currency: "CNY",
      direction,
      category: "",
    });
  }

  return { records, warnings };
}

// CSV parser
function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

const DATE_PATTERN = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;

function isCsvFormat(content) {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const csvLines = lines.filter((l) => l.includes(",") && !l.includes("|"));
  return csvLines.length >= lines.length * 0.7;
}

function parseCsv(content) {
  const records = [];
  const warnings = [];
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return { records, warnings };

  const firstCells = parseCsvLine(lines[0]);
  let colMap = null;
  let dataStart = 0;

  // Check if first row looks like data (starts with date) or header
  if (firstCells.length > 0 && DATE_PATTERN.test(firstCells[0].trim())) {
    colMap = { date: 0, description: 1, amount: 2, direction: 3 };
    dataStart = 0;
  } else {
    // Header row - detect columns
    const map = {};
    for (let i = 0; i < firstCells.length; i++) {
      const cell = firstCells[i].trim().toLowerCase();
      if (/日期|date|time|交易时间/i.test(cell)) map.date = i;
      else if (/描述|说明|备注|desc|memo|摘要|用途/i.test(cell)) map.description = i;
      else if (/金额|amount/i.test(cell)) map.amount = i;
      else if (/方向|类型|收支|type|direction/i.test(cell)) map.direction = i;
    }
    if (map.date != null && map.amount != null) {
      colMap = { date: map.date, description: map.description ?? 1, amount: map.amount, direction: map.direction ?? 3 };
    }
    dataStart = 1;
  }

  if (!colMap) {
    warnings.push("无法检测 CSV 列映射，使用默认(date,desc,amount,direction)");
    colMap = { date: 0, description: 1, amount: 2, direction: 3 };
    dataStart = 0;
  }

  for (let i = dataStart; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const rawDate = cells[colMap.date]?.trim();
    if (!rawDate) continue;

    const looksLikeDate = DATE_PATTERN.test(rawDate);
    if (!looksLikeDate) {
      warnings.push(`行 ${i + 1}: 日期格式无法识别 "${rawDate}"`);
      continue;
    }

    const rawAmount = cells[colMap.amount]?.trim() || "0";
    const desc = colMap.description >= 0 ? cells[colMap.description]?.trim() || "" : "";
    const dirCell = colMap.direction >= 0 ? cells[colMap.direction]?.trim() || "" : "";

    const amount = Math.abs(parseFloat(rawAmount.replace(/[¥￥,\s]/g, "")));
    if (isNaN(amount)) {
      warnings.push(`行 ${i + 1}: 金额解析失败 "${rawAmount}"`);
      continue;
    }

    let direction;
    if (dirCell && /收入|入账|收款|credit|in|收/i.test(dirCell)) direction = "income";
    else if (dirCell && /支出|出账|付款|debit|out|支|退/i.test(dirCell)) direction = "expense";
    else {
      const num = parseFloat(rawAmount.replace(/[¥￥,]/g, ""));
      direction = num < 0 ? "expense" : "income";
    }

    records.push({ date: rawDate, description: desc, amount, currency: "CNY", direction, category: "" });
  }

  return { records, warnings };
}

// Key-Value parser
function parseKvLine(line) {
  const m = line.match(/^[\s]*([^：:\s]+)[：:]\s*(.+)/);
  if (!m) return null;
  return { key: m[1].trim(), value: m[2].trim() };
}

function isKeyValueFormat(content) {
  const lines = content.split("\n").filter((l) => l.trim());
  const kvLines = lines.filter((l) => parseKvLine(l) !== null);
  return kvLines.length >= lines.length * 0.5 && kvLines.length >= 3;
}

function parseKeyValue(content) {
  const records = [];
  const warnings = [];
  const lines = content.split("\n");

  const mapping = {
    dateKey: /日期|交易日期|date|time/i,
    descKey: /描述|交易说明|备注|摘要|说明|desc|memo|用途/i,
    amountKey: /金额|交易金额|amount/i,
    dirKey: /方向|类型|收支|type|direction/i,
  };

  let current = {};
  let blockIdx = 0;

  function flush() {
    if (!current.date || !current.amount) {
      if (current.date || current.amount) {
        warnings.push(`记录 ${blockIdx + 1}: 缺少日期或金额`);
      }
      current = {};
      return;
    }
    const rawAmount = current.amount.replace(/[¥￥,\s]/g, "");
    const amount = Math.abs(parseFloat(rawAmount));
    if (isNaN(amount)) {
      warnings.push(`记录 ${blockIdx + 1}: 金额解析失败 "${current.amount}"`);
      current = {};
      return;
    }

    let direction;
    if (current.dir) {
      if (/收入|入账|收款|credit|in|收/i.test(current.dir)) direction = "income";
      else if (/支出|出账|付款|debit|out|支|退/i.test(current.dir)) direction = "expense";
      else direction = parseFloat(rawAmount) < 0 ? "expense" : "income";
    } else {
      direction = parseFloat(rawAmount) < 0 ? "expense" : "income";
    }

    records.push({
      date: current.date,
      description: current.desc || "",
      amount,
      currency: "CNY",
      direction,
      category: "",
    });
    blockIdx++;
    current = {};
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") { flush(); continue; }
    const parsed = parseKvLine(trimmed);
    if (!parsed) { warnings.push(`无法解析行 "${trimmed}"`); continue; }
    const { key, value } = parsed;

    if (mapping.dateKey.test(key)) {
      if (current.date) flush();
      current.date = value;
    } else if (mapping.descKey.test(key)) {
      current.desc = value;
    } else if (mapping.amountKey.test(key)) {
      if (current.amount) flush();
      current.amount = value;
    } else if (mapping.dirKey.test(key)) {
      if (current.dir) flush();
      current.dir = value;
    }
  }
  flush();

  return { records, warnings };
}

// ---- Normalize ----
const CATEGORY_RULES = [
  [/工资|薪资|salary|payroll/i, "人力成本"],
  [/房租|租金|rent|lease/i, "房租"],
  [/办公|文具|office|supplies/i, "办公用品"],
  [/水电|电费|水费|utility|电|水/i, "水电费"],
  [/差旅|交通|打车|机票|酒店|travel|flight|hotel/i, "差旅交通"],
  [/餐饮|餐费|吃饭|外卖|food|meal|restaurant/i, "餐饮"],
  [/广告|推广|营销|market|ad|广告费/i, "营销推广"],
  [/服务器|云服务|aws|阿里云|server|hosting|saas/i, "技术服务"],
  [/税费|税金|tax|增值税/i, "税费"],
  [/服务费|咨询|顾问|consult/i, "咨询服务"],
  [/退款|refund/i, "退款"],
  [/销售|营收|revenue|sales|收入/i, "销售收入"],
  [/投资|理财|invest|dividend/i, "投资收益"],
  [/利息|interest/i, "利息"],
  [/手续费|fee|commission/i, "手续费"],
  [/快递|物流|shipping|delivery/i, "物流快递"],
  [/保险|insur/i, "保险"],
];

function classify(record) {
  const text = record.description;
  for (const [pattern, cat] of CATEGORY_RULES) {
    if (pattern.test(text)) return cat;
  }
  return record.direction === "income" ? "其他收入" : "其他支出";
}

function normalizeDate(raw) {
  const trimmed = raw.trim();
  let m = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = trimmed.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = trimmed.match(/^(\d{1,2})[/](\d{1,2})[/](\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return trimmed;
}

function normalizeRecords(records) {
  return records.map((r) => ({
    ...r,
    date: normalizeDate(r.date),
    amount: Math.round(r.amount * 100) / 100,
    category: r.category || classify(r),
  }));
}

function parseAndClean(rawContent, sourceFile) {
  const platform = identifyPlatform(sourceFile);
  const warnings = [];
  let records = [];

  if (isMarkdownTable(rawContent)) {
    const result = parseMarkdownTable(rawContent);
    records = result.records;
    warnings.push(...result.warnings);
  } else if (isCsvFormat(rawContent)) {
    const result = parseCsv(rawContent);
    records = result.records;
    warnings.push(...result.warnings);
  } else if (isKeyValueFormat(rawContent)) {
    const result = parseKeyValue(rawContent);
    records = result.records;
    warnings.push(...result.warnings);
  } else {
    warnings.push("无法识别账单格式，尝试全部解析器...");
    const mdResult = parseMarkdownTable(rawContent);
    const csvResult = parseCsv(rawContent);
    const kvResult = parseKeyValue(rawContent);
    const best = [mdResult, csvResult, kvResult].sort((a, b) => b.records.length - a.records.length)[0];
    records = best.records;
    warnings.push(...best.warnings);
  }

  const normalized = normalizeRecords(records);
  return { platform, records: normalized, parse_warnings: warnings.filter(Boolean) };
}

// ---- Step 4: generate_report ----
function computeSummary(billData) {
  let totalIncome = 0;
  let totalExpense = 0;
  let recordCount = 0;
  const byPlatform = {};
  const byCategory = {};

  for (const platform of billData) {
    const pName = platform.platform;
    if (!byPlatform[pName]) byPlatform[pName] = { income: 0, expense: 0 };

    for (const record of platform.records) {
      const amount = record.amount;
      const cat = record.category || "未分类";

      if (!byCategory[cat]) byCategory[cat] = { income: 0, expense: 0 };

      if (record.direction === "income") {
        totalIncome += amount;
        byPlatform[pName].income += amount;
        byCategory[cat].income += amount;
      } else {
        totalExpense += amount;
        byPlatform[pName].expense += amount;
        byCategory[cat].expense += amount;
      }
      recordCount++;
    }
  }

  return {
    total_income: Math.round(totalIncome * 100) / 100,
    total_expense: Math.round(totalExpense * 100) / 100,
    net: Math.round((totalIncome - totalExpense) * 100) / 100,
    by_platform: byPlatform,
    by_category: byCategory,
    record_count: recordCount,
  };
}

function fmt(n) {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sign(n) {
  return n >= 0 ? `+¥${fmt(n)}` : `-¥${fmt(Math.abs(n))}`;
}

function platformLabel(name) {
  const labels = { alipay: "支付宝", wechat_pay: "微信支付", bank_statement: "银行对公", stripe: "Stripe", invoice: "发票系统", quickbooks: "QuickBooks", paypal: "PayPal" };
  return labels[name] || name;
}

function platformIcon(name) {
  const icons = { alipay: "🔵", wechat_pay: "🟢", bank_statement: "🏦", stripe: "🟣", paypal: "🔷" };
  return icons[name] || "📊";
}

function generateMarkdownReport(title, period, summary) {
  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`> 账期：**${period}** | 记录总数：**${summary.record_count}** 条 | 平台数：**${Object.keys(summary.by_platform).length}** 个`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 一、财务汇总");
  lines.push("");
  lines.push("| 指标 | 金额 |");
  lines.push("|------|------|");
  lines.push(`| 总收入 | ¥${fmt(summary.total_income)} |`);
  lines.push(`| 总支出 | ¥${fmt(summary.total_expense)} |`);
  const netLabel = summary.net >= 0 ? "净利润" : "净亏损";
  lines.push(`| **${netLabel}** | **¥${fmt(Math.abs(summary.net))}** |`);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## 二、平台分析");
  lines.push("");
  lines.push("| 平台 | 收入 | 支出 | 净额 |");
  lines.push("|------|------|------|------|");

  const platforms = Object.entries(summary.by_platform).sort(
    (a, b) => b[1].income + b[1].expense - (a[1].income + a[1].expense)
  );
  for (const [name, data] of platforms) {
    const net = data.income - data.expense;
    lines.push(`| ${platformIcon(name)} ${platformLabel(name)} | ¥${fmt(data.income)} | ¥${fmt(data.expense)} | ${sign(net)} |`);
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## 三、分类统计");
  lines.push("");
  lines.push("| 分类 | 收入 | 支出 | 净额 |");
  lines.push("|------|------|------|------|");

  const categories = Object.entries(summary.by_category).sort(
    (a, b) => b[1].income + b[1].expense - (a[1].income + a[1].expense)
  );
  for (const [name, data] of categories) {
    const net = data.income - data.expense;
    lines.push(`| ${name} | ¥${fmt(data.income)} | ¥${fmt(data.expense)} | ${sign(net)} |`);
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(`*报告由 AI Agent 自动生成 · ${new Date().toISOString().slice(0, 10)}*`);

  return lines.join("\n");
}

// ---- Step 5: send_notification ----
const FEISHU_WEBHOOK_URL = process.env.FEISHU_WEBHOOK_URL || "https://open.feishu.cn/open-apis/bot/v2/hook/9ed3760f-78a1-49ba-96e2-53dffb777851";

async function sendFeishu(subject, body) {
  const url = FEISHU_WEBHOOK_URL;
  if (!url) return { success: false, message: "缺少飞书 Webhook URL" };

  const payload = {
    msg_type: "text",
    content: { text: `${subject}\n\n${body}` },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const respBody = await resp.text();
    if (resp.ok) return { success: true, message: "飞书消息发送成功" };
    return { success: false, message: `飞书发送失败 HTTP ${resp.status}: ${respBody}` };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, message: `飞书请求异常: ${err.message}` };
  }
}

// ===================== MAIN =====================

async function main() {
  console.log("=".repeat(60));
  console.log("  财务账单智能汇总 — sample_data/ 月度报告");
  console.log("=".repeat(60));
  console.log("");

  // Step 1: List files
  console.log("[Step 1/5] 扫描 sample_data/ 目录...");
  const files = await listDirectory(SAMPLE_DIR);
  console.log(`  → 发现 ${files.length} 个 .md 文件:`);
  files.forEach((f) => console.log(`    - ${f.name} (${f.size_bytes} bytes)`));
  console.log("");

  if (files.length === 0) {
    console.log("❌ 目录为空，流程终止");
    return;
  }

  // Step 2 & 3: Read and parse each file
  console.log("[Step 2/5] 读取文件 → [Step 3/5] 解析清洗...");
  const billData = [];
  const failedFiles = [];

  for (const file of files) {
    console.log(`  → 处理: ${file.name}`);
    try {
      const { content, file_name } = await readBillFile(file.path);
      const parsed = parseAndClean(content, file_name);
      billData.push(parsed);
      console.log(`    ✓ 平台: ${parsed.platform} | 记录数: ${parsed.records.length} | 警告: ${parsed.parse_warnings.length}`);
      if (parsed.parse_warnings.length > 0) {
        parsed.parse_warnings.forEach((w) => console.log(`      ⚠ ${w}`));
      }
    } catch (err) {
      console.log(`    ✗ 失败: ${err.message}`);
      failedFiles.push({ file: file.name, error: err.message });
    }
  }
  console.log("");

  // Step 4: Generate report
  console.log("[Step 4/5] 生成汇总报告...");
  if (billData.length === 0) {
    console.log("  → 所有文件解析后无有效记录，生成空报告");
  }

  const reportTitle = "2026年3月财务汇总报告";
  const period = "2026-03";
  const summary = computeSummary(billData);
  const report = generateMarkdownReport(reportTitle, period, summary);
  console.log(`  → 报告已生成: ${summary.record_count} 条记录`);
  console.log("");

  // Step 5: Send notification
  console.log("[Step 5/5] 发送飞书通知...");
  const notifyResult = await sendFeishu(reportTitle, report);
  const icon = notifyResult.success ? "✓" : "✗";
  console.log(`  ${icon} ${notifyResult.message}`);
  console.log("");

  // ===================== OUTPUT =====================
  console.log("=".repeat(60));
  console.log("  处理概况");
  console.log("=".repeat(60));
  console.log(`  文件数: ${files.length} | 成功: ${billData.length} | 失败: ${failedFiles.length}`);
  console.log(`  总记录: ${summary.record_count} 条`);
  console.log(`  总收入: ¥${fmt(summary.total_income)}`);
  console.log(`  总支出: ¥${fmt(summary.total_expense)}`);
  console.log(`  净利润: ¥${fmt(summary.net)}`);
  console.log(`  飞书通知: ${notifyResult.success ? "✅ 已发送" : "❌ " + notifyResult.message}`);
  console.log("");

  if (failedFiles.length > 0) {
    console.log("⚠ 失败文件:");
    failedFiles.forEach((f) => console.log(`  - ${f.file}: ${f.error}`));
    console.log("");
  }

  // Print the full report
  console.log("=".repeat(60));
  console.log("  月度报告全文");
  console.log("=".repeat(60));
  console.log("");
  console.log(report);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
