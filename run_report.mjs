import * as fs from "fs/promises";
import { identifyPlatform } from "./dist/parsers/platform.js";
import { isMarkdownTable, parseMarkdownTable } from "./dist/parsers/markdown.js";
import { isCsvFormat, parseCsv } from "./dist/parsers/csv.js";
import { isKeyValueFormat, parseKeyValue } from "./dist/parsers/keyvalue.js";
import { normalizeRecords } from "./dist/parsers/normalize.js";
import { computeSummary } from "./dist/report/calculator.js";
import { generateMarkdownReport } from "./dist/report/markdown.js";

const DATA_DIR = "C:/mianshi/finance-bill-mcp-master/finance-bill-mcp-master/sample_data";
const FEISHU_WEBHOOK = "https://open.feishu.cn/open-apis/bot/v2/hook/9ed3760f-78a1-49ba-96e2-53dffb777851";

// 1. List all .md files
const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
const mdFiles = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith(".md"));

if (mdFiles.length === 0) {
  console.error("No .md files found in", DATA_DIR);
  process.exit(1);
}

console.error(`Found ${mdFiles.length} bill file(s):`, mdFiles.map(e => e.name).join(", "));

// 2. Parse each file
const billData = [];
for (const entry of mdFiles) {
  const filePath = `${DATA_DIR}/${entry.name}`;
  const content = await fs.readFile(filePath, "utf-8");
  const platform = identifyPlatform(entry.name);
  const warnings = [];
  let records = [];

  if (isMarkdownTable(content)) {
    const r = parseMarkdownTable(content);
    records = r.records; warnings.push(...r.warnings);
  } else if (isCsvFormat(content)) {
    const r = parseCsv(content);
    records = r.records; warnings.push(...r.warnings);
  } else if (isKeyValueFormat(content)) {
    const r = parseKeyValue(content);
    records = r.records; warnings.push(...r.warnings);
  } else {
    const results = [parseMarkdownTable(content), parseCsv(content), parseKeyValue(content)];
    const best = results.sort((a, b) => b.records.length - a.records.length)[0];
    records = best.records; warnings.push(...best.warnings);
  }

  const normalized = normalizeRecords(records);
  billData.push({ platform, records: normalized, parse_warnings: warnings.filter(Boolean) });
  console.error(`  Parsed ${entry.name}: ${normalized.length} records [${platform}]`);
}

// 3. Generate report
const summary = computeSummary(billData);
const report = generateMarkdownReport("财务账单汇总报告", "2026-03", summary);
console.log(report);

// 4. Send to Feishu
console.error("\nSending to Feishu...");
const payload = {
  msg_type: "text",
  content: { text: `财务账单汇总报告 — 2026年3月\n\n${report}` },
};

try {
  const resp = await fetch(FEISHU_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const respBody = await resp.text();
  if (resp.ok) {
    console.error("Feishu: sent successfully!");
  } else {
    console.error(`Feishu: HTTP ${resp.status} — ${respBody}`);
  }
} catch (err) {
  console.error(`Feishu: request failed — ${err.message}`);
}
