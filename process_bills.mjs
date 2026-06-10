import * as fs from "fs/promises";
import { identifyPlatform } from "./dist/parsers/platform.js";
import { isMarkdownTable, parseMarkdownTable } from "./dist/parsers/markdown.js";
import { isCsvFormat, parseCsv } from "./dist/parsers/csv.js";
import { isKeyValueFormat, parseKeyValue } from "./dist/parsers/keyvalue.js";
import { normalizeRecords } from "./dist/parsers/normalize.js";
import { computeSummary } from "./dist/report/calculator.js";
import { generateMarkdownReport } from "./dist/report/markdown.js";

const files = [
  "sample_data/alipay_202603.md",
  "sample_data/wechat_pay_202603.md",
  "sample_data/bank_statement_202603.md",
];

const billData = [];

for (const filePath of files) {
  const content = await fs.readFile(filePath, "utf-8");
  const sourceFile = filePath.split("/").pop();
  const platform = identifyPlatform(sourceFile);
  const warnings = [];
  let records = [];

  if (isMarkdownTable(content)) {
    const result = parseMarkdownTable(content);
    records = result.records;
    warnings.push(...result.warnings);
  } else if (isCsvFormat(content)) {
    const result = parseCsv(content);
    records = result.records;
    warnings.push(...result.warnings);
  } else if (isKeyValueFormat(content)) {
    const result = parseKeyValue(content);
    records = result.records;
    warnings.push(...result.warnings);
  } else {
    const mdResult = parseMarkdownTable(content);
    const csvResult = parseCsv(content);
    const kvResult = parseKeyValue(content);
    const best = [mdResult, csvResult, kvResult].sort(
      (a, b) => b.records.length - a.records.length
    )[0];
    records = best.records;
    warnings.push(...best.warnings);
  }

  const normalized = normalizeRecords(records);
  billData.push({ platform, records: normalized, parse_warnings: warnings.filter(Boolean) });
}

const summary = computeSummary(billData);
const report = generateMarkdownReport("财务账单汇总报告", "2026-03", summary);

console.log(report);
