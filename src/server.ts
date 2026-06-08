import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";

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
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            platform: "",
            records: [],
            parse_warnings: [],
          }),
        },
      ],
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
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            report_markdown: "",
            summary: {
              total_income: 0,
              total_expense: 0,
              net: 0,
              by_platform: {},
              by_category: {},
              record_count: 0,
            },
          }),
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
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: false, message: "未实现" }),
        },
      ],
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
