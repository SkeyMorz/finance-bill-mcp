// Pipeline driver: summarize sample_data/ → generate report → send to Feishu
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = path.join(__dirname, "sample_data");

// Import compiled modules
import { identifyPlatform } from "./dist/parsers/platform.js";
import { isMarkdownTable, parseMarkdownTable } from "./dist/parsers/markdown.js";
import { isCsvFormat, parseCsv } from "./dist/parsers/csv.js";
import { isKeyValueFormat, parseKeyValue } from "./dist/parsers/keyvalue.js";
import { normalizeRecords } from "./dist/parsers/normalize.js";
import { computeSummary } from "./dist/report/calculator.js";
import { generateMarkdownReport } from "./dist/report/markdown.js";
import { sendNotification } from "./dist/notify/sender.js";

// Step 1: list .md files
console.log("=".repeat(60));
console.log("📂 Step 1: Scanning sample_data/ for .md files...");
const entries = await fs.readdir(SAMPLE_DIR, { withFileTypes: true });
const mdFiles = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith(".md"));
console.log(`Found ${mdFiles.length} .md file(s):`);
mdFiles.forEach(f => console.log(`  - ${f.name}`));

if (mdFiles.length === 0) {
  console.error("❌ No .md files found. Terminating.");
  process.exit(1);
}

// Step 2 & 3: Read and parse each file
console.log("\n📄 Step 2-3: Reading and parsing each file...");
const billData = [];
const failedFiles = [];

for (const file of mdFiles) {
  const filePath = path.join(SAMPLE_DIR, file.name);
  console.log(`\n  Processing: ${file.name}`);

  try {
    // Step 2: Read
    const rawContent = await fs.readFile(filePath, "utf-8");
    console.log(`    ✅ Read (${rawContent.length} chars)`);

    // Step 3: Parse
    const platform = identifyPlatform(file.name);
    console.log(`    🏷️  Platform: ${platform}`);

    const warnings = [];
    let records = [];

    if (isMarkdownTable(rawContent)) {
      const result = parseMarkdownTable(rawContent);
      records = result.records;
      warnings.push(...result.warnings);
      console.log(`    📊 Format: Markdown Table`);
    } else if (isCsvFormat(rawContent)) {
      const result = parseCsv(rawContent);
      records = result.records;
      warnings.push(...result.warnings);
      console.log(`    📊 Format: CSV`);
    } else if (isKeyValueFormat(rawContent)) {
      const result = parseKeyValue(rawContent);
      records = result.records;
      warnings.push(...result.warnings);
      console.log(`    📊 Format: Key-Value`);
    } else {
      warnings.push("无法识别账单格式，尝试全部解析器...");
      const mdResult = parseMarkdownTable(rawContent);
      const csvResult = parseCsv(rawContent);
      const kvResult = parseKeyValue(rawContent);
      const best = [mdResult, csvResult, kvResult].sort((a, b) => b.records.length - a.records.length)[0];
      records = best.records;
      warnings.push(...best.warnings);
      console.log(`    📊 Format: Fallback (best parser gave ${records.length} records)`);
    }

    const normalized = normalizeRecords(records);
    console.log(`    📝 Records parsed: ${normalized.length}`);

    if (warnings.length > 0) {
      console.log(`    ⚠️  Warnings: ${warnings.join(", ")}`);
    }

    billData.push({
      platform,
      records: normalized,
      parse_warnings: warnings.filter(Boolean),
    });
  } catch (err) {
    console.error(`    ❌ Failed: ${err.message}`);
    failedFiles.push({ file: file.name, error: err.message });
  }
}

console.log(`\n📊 Summary: ${billData.length} platform(s) parsed, ${failedFiles.length} file(s) failed`);
const totalRecords = billData.reduce((sum, p) => sum + p.records.length, 0);
console.log(`   Total records: ${totalRecords}`);

// Step 4: Generate report
console.log("\n📋 Step 4: Generating report...");
const reportTitle = "2026年3月财务汇总报告";
const period = "2026-03";

const summary = computeSummary(billData);
const reportMarkdown = generateMarkdownReport(reportTitle, period, summary);

console.log("\n" + "=".repeat(60));
console.log(reportMarkdown);
console.log("=".repeat(60));

// Step 5: Send to Feishu
console.log("\n📤 Step 5: Sending to Feishu...");
const feishuWebhook = process.env.FEISHU_WEBHOOK_URL ||
  "https://open.feishu.cn/open-apis/bot/v2/hook/9ed3760f-78a1-49ba-96e2-53dffb777851";

console.log(`   Channel: feishu`);
console.log(`   Target: ${feishuWebhook.substring(0, 50)}...`);

const notifyResult = await sendNotification("feishu", feishuWebhook, reportTitle, reportMarkdown);

console.log(`\n📢 Notification result:`);
console.log(`   Success: ${notifyResult.success}`);
console.log(`   Message: ${notifyResult.message}`);

// Step 6: Final summary
console.log("\n" + "=".repeat(60));
console.log("📊 FINAL SUMMARY");
console.log("=".repeat(60));
console.log(`Files processed: ${mdFiles.length}`);
console.log(`Total records:  ${summary.record_count}`);
console.log(`Total income:   ¥${summary.total_income.toLocaleString("zh-CN", {minimumFractionDigits: 2})}`);
console.log(`Total expense:  ¥${summary.total_expense.toLocaleString("zh-CN", {minimumFractionDigits: 2})}`);
console.log(`Net profit:     ¥${summary.net.toLocaleString("zh-CN", {minimumFractionDigits: 2})}`);
console.log(`Feishu status:  ${notifyResult.success ? "✅ Sent" : "❌ " + notifyResult.message}`);

if (failedFiles.length > 0) {
  console.log(`\n⚠️  Failed files:`);
  failedFiles.forEach(f => console.log(`   - ${f.file}: ${f.error}`));
}
