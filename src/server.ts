import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { identifyPlatform } from "./parsers/platform.js";
import { isMarkdownTable, parseMarkdownTable } from "./parsers/markdown.js";
import { isCsvFormat, parseCsv } from "./parsers/csv.js";
import { isKeyValueFormat, parseKeyValue } from "./parsers/keyvalue.js";
import { normalizeRecords } from "./parsers/normalize.js";
import type { ParseResult } from "./parsers/types.js";
import { computeSummary } from "./report/calculator.js";
import { generateMarkdownReport } from "./report/markdown.js";
import { sendNotification } from "./notify/sender.js";

const BASE_DIR = process.cwd();

function safeResolve(inputPath: string): string {
  const resolved = path.resolve(BASE_DIR, inputPath);
  if (!resolved.startsWith(BASE_DIR + path.sep) && resolved !== BASE_DIR) {
    throw new Error(`路径越界: ${inputPath}`);
  }
  return resolved;
}

async function safeRealpath(inputPath: string): Promise<string> {
  const real = await fs.realpath(path.resolve(BASE_DIR, inputPath));
  if (!real.startsWith(BASE_DIR + path.sep) && real !== BASE_DIR) {
    throw new Error(`路径越界(符号链接): ${inputPath}`);
  }
  return real;
}

const server = new McpServer({
  name: "finance-bill-mcp",
  version: "1.0.0",
});

// Tool 1: list_directory
server.tool(
  "list_directory",
  "列出指定目录下所有 .md 文件",
  {
    directory: z.string().describe("要扫描的目录路径"),
  },
  async ({ directory }) => {
    const dirPath = await safeRealpath(directory);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter(
          (e) => e.isFile() && e.name.toLowerCase().endsWith(".md")
        )
        .map(async (e) => {
          const fullPath = path.join(dirPath, e.name);
          const stat = await fs.stat(fullPath);
          return {
            name: e.name,
            path: fullPath,
            size_bytes: stat.size,
          };
        })
    );
    return {
      content: [{ type: "text", text: JSON.stringify({ files }) }],
    };
  }
);

// Tool 2: read_bill_file
server.tool(
  "read_bill_file",
  "读取单个 .md 文件的原始内容",
  {
    file_path: z.string().describe("账单文件的完整路径"),
  },
  async ({ file_path }) => {
    const resolved = await safeRealpath(file_path);
    if (!resolved.toLowerCase().endsWith(".md")) {
      throw new Error(`仅支持读取 .md 文件: ${file_path}`);
    }
    const content = await fs.readFile(resolved, "utf-8");
    const fileName = path.basename(resolved);
    return {
      content: [
        { type: "text", text: JSON.stringify({ content, file_name: fileName }) },
      ],
    };
  }
);

// Tool 3: parse_and_clean_bills
server.tool(
  "parse_and_clean_bills",
  "接收原始账单文本，识别格式并清洗为结构化数据",
  {
    raw_content: z.string().describe("账单文件的原始文本内容"),
    source_file: z.string().describe("来源文件名，用于辅助识别平台"),
  },
  async ({ raw_content, source_file }) => {
    const platform = identifyPlatform(source_file);
    const warnings: string[] = [];
    let records: import("./parsers/types.js").BillRecord[] = [];
    let confidence = 1; // 格式已识别时默认高置信度

    if (isMarkdownTable(raw_content)) {
      const result = parseMarkdownTable(raw_content);
      records = result.records;
      warnings.push(...result.warnings);
      confidence = result.confidence;
    } else if (isCsvFormat(raw_content)) {
      const result = parseCsv(raw_content);
      records = result.records;
      warnings.push(...result.warnings);
      confidence = result.confidence;
    } else if (isKeyValueFormat(raw_content)) {
      const result = parseKeyValue(raw_content);
      records = result.records;
      warnings.push(...result.warnings);
      confidence = result.confidence;
    } else {
      // ─── 兜底策略：格式检测失败，基于置信度选择最优解析器 ───
      const CONFIDENCE_THRESHOLD = 0.5;
      const mdResult = parseMarkdownTable(raw_content);
      const csvResult = parseCsv(raw_content);
      const kvResult = parseKeyValue(raw_content);

      const allResults = [
        { label: "Markdown", r: mdResult },
        { label: "CSV", r: csvResult },
        { label: "KeyValue", r: kvResult },
      ];

      // 按置信度排序
      const qualified = allResults.filter(({ r }) => r.confidence >= CONFIDENCE_THRESHOLD);

      if (qualified.length === 1) {
        // 只有一种解析器可信 → 直接采用
        const { label, r } = qualified[0];
        records = r.records;
        warnings.push(...r.warnings);
        confidence = r.confidence;
        warnings.push(`格式自动识别为: ${label}（置信度 ${(r.confidence * 100).toFixed(0)}%）`);
      } else if (qualified.length >= 2) {
        // 多种解析器都可信 → 选置信度最高的
        qualified.sort((a, b) => b.r.confidence - a.r.confidence);
        const { label, r } = qualified[0];
        records = r.records;
        warnings.push(...r.warnings);
        confidence = r.confidence;
        warnings.push(
          `多个解析器均达到置信度阈值: ${qualified.map(q => `${q.label}(${(q.r.confidence * 100).toFixed(0)}%)`).join(", ")} → 选用 ${label}`
        );
      } else {
        // 无解析器达到置信度阈值 → 空结果 + 完整诊断信息
        const best = allResults.sort((a, b) => b.r.confidence - a.r.confidence)[0];
        records = [];
        confidence = 0;
        warnings.push(
          `⛔ 所有解析器置信度均低于阈值 ${CONFIDENCE_THRESHOLD * 100}% — 文件可能不是账单或格式不受支持。`,
          `各解析器得分: Markdown=${(mdResult.confidence * 100).toFixed(0)}% CSV=${(csvResult.confidence * 100).toFixed(0)}% KeyValue=${(kvResult.confidence * 100).toFixed(0)}%`,
          `建议: 人工检查文件内容，确认是否为有效账单数据。`,
          ...best.r.warnings
        );
      }
    }

    const normalized = normalizeRecords(records);
    const result: ParseResult = {
      platform,
      records: normalized,
      parse_warnings: warnings.filter(Boolean),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
);

// Tool 4: generate_report
server.tool(
  "generate_report",
  "接收多个平台的结构化账单数据，生成汇总报告",
  {
    bill_data: z
      .array(
        z.object({
          platform: z.string(),
          records: z.array(
            z.object({
              date: z.string(),
              description: z.string(),
              amount: z.number(),
              currency: z.string(),
              direction: z.enum(["income", "expense"]),
              category: z.string(),
            })
          ),
          parse_warnings: z.array(z.string()).optional(),
        })
      )
      .describe("parse_and_clean_bills 输出的数组"),
    report_title: z.string().describe("报告标题"),
    period: z.string().describe("账期，如 2026-03"),
  },
  async ({ bill_data, report_title, period }) => {
    const summary = computeSummary(bill_data);
    const report_markdown = generateMarkdownReport(report_title, period, summary);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ report_markdown, summary }),
        },
      ],
    };
  }
);

// Tool 5: send_notification
server.tool(
  "send_notification",
  "将报告通过指定渠道发送（Email / 飞书 Webhook / 企业微信 Webhook）",
  {
    channel: z
      .enum(["email", "feishu", "wecom"])
      .describe("通知渠道"),
    target: z.string().describe("邮箱地址或 Webhook URL"),
    subject: z.string().describe("通知标题"),
    body: z.string().describe("Markdown 格式的报告正文"),
  },
  async ({ channel, target, subject, body }) => {
    const result = await sendNotification(channel, target, subject, body);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("finance-bill-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
