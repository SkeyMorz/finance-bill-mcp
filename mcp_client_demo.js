/**
 * MCP Stdio 客户端 — 财务账单智能汇总 端到端演示
 *
 * 本脚本严格遵循面试作业规范：
 *   1. 所有 I/O 操作通过 MCP Server 暴露的 Tool 完成（不直接调用 read/write/bash）
 *   2. 遵循 MCP 协议（JSON-RPC 2.0 over stdio）
 *   3. 按 SKILL.md 编排 5 个 Tool 的调用顺序
 *   4. 完善的错误处理（解析失败不中断、通知失败不阻断报告展示）
 */

import { spawn } from "child_process";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ─── 配置 ───────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = __dirname;
const SERVER_ENTRY = resolve(PROJECT_DIR, "dist/server.js");
const FEISHU_WEBHOOK =
  "https://open.feishu.cn/open-apis/bot/v2/hook/9ed3760f-78a1-49ba-96e2-53dffb777851";

// ─── MCP 客户端 ──────────────────────────────────────────
class McpClient {
  constructor() {
    this.requestId = 0;
    this.pending = new Map();  // id → { resolve, reject }
    this.rl = null;
  }

  /**
   * 启动 MCP Server 子进程，建立 stdio 管线
   */
  async start() {
    this.proc = spawn("node", [SERVER_ENTRY], {
      cwd: PROJECT_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FEISHU_WEBHOOK_URL: FEISHU_WEBHOOK },
    });

    // stderr 透传（Server 日志输出到 stderr）
    this.proc.stderr.on("data", (d) => process.stderr.write(`[mcp-server] ${d}`));

    // 逐行读取 stdout（MCP 协议：每行一个 JSON-RPC 消息）
    this.rl = createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(`MCP Error: ${JSON.stringify(msg.error)}`));
          else resolve(msg.result);
        }
      } catch (e) {
        // 非 JSON 行忽略（日志等）
      }
    });

    // 进程退出处理
    this.proc.on("exit", (code) => {
      if (code !== 0) console.error(`⚠ MCP Server 退出码: ${code}`);
    });
  }

  /**
   * 发送 JSON-RPC 请求并等待响应
   */
  async request(method, params) {
    const id = ++this.requestId;
    const req = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(req + "\n");
    });
  }

  /**
   * 发送 JSON-RPC 通知（无 id，无响应）
   */
  notify(method, params) {
    const req = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.proc.stdin.write(req + "\n");
  }

  /**
   * MCP 握手：initialize → initialized
   */
  async handshake() {
    console.log("🤝 MCP 握手: initialize...");
    const initResult = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "finance-bill-demo", version: "1.0.0" },
    });
    console.log(`   Server: ${initResult.serverInfo?.name} v${initResult.serverInfo?.version}`);
    console.log(`   Protocol: ${initResult.protocolVersion}`);

    this.notify("notifications/initialized", {});
    console.log("   ✅ initialized 完成\n");
    return initResult;
  }

  /**
   * 调用 MCP Tool
   */
  async callTool(name, args) {
    console.log(`🔧 调用 Tool: ${name}(${JSON.stringify(args).slice(0, 80)}...)`);
    const result = await this.request("tools/call", { name, arguments: args });
    // MCP Tool 返回 content 数组，每个元素有 type 和 text
    const text = result.content?.map((c) => c.text).join("\n") ?? "";
    return { raw: result, text };
  }

  async stop() {
    this.rl?.close();
    this.proc?.stdin?.end();
    this.proc?.kill();
  }
}

// ─── 按 SKILL.md 编排的端到端流程 ─────────────────────────

async function main() {
  const client = new McpClient();
  const errors = [];        // 失败文件列表
  const warnings = [];      // 解析警告汇总

  try {
    // ── 启动 + 握手 ──
    await client.start();
    await client.handshake();

    // ──────────────────────────────────────────────────────
    // Step 1: list_directory
    // ──────────────────────────────────────────────────────
    console.log("━━━ Step 1: list_directory ━━━");
    const { text: dirJson } = await client.callTool("list_directory", {
      directory: "./sample_data",
    });
    const { files } = JSON.parse(dirJson);
    console.log(`   找到 ${files.length} 个 .md 文件:`);
    files.forEach((f) => console.log(`     • ${f.name} (${f.size_bytes} bytes)`));

    if (files.length === 0) {
      console.log("❌ 目录中无 .md 文件，流程终止。");
      await client.stop();
      return;
    }

    // ──────────────────────────────────────────────────────
    // Step 2: read_bill_file × N（逐个读取）
    // ──────────────────────────────────────────────────────
    console.log("\n━━━ Step 2: read_bill_file ━━━");
    const rawBills = [];
    for (const file of files) {
      const { text: readJson } = await client.callTool("read_bill_file", {
        file_path: file.path,
      });
      const parsed = JSON.parse(readJson);
      if (parsed.isError) {
        console.log(`   ❌ 读取失败: ${file.name}`);
        errors.push({ file: file.name, reason: parsed.content || "未知错误" });
        continue;
      }
      console.log(`   ✅ 读取成功: ${file.name} (${parsed.content.length} chars)`);
      rawBills.push({ fileName: file.name, content: parsed.content });
    }

    if (rawBills.length === 0) {
      console.log("❌ 所有文件读取失败，流程终止。");
      await client.stop();
      return;
    }

    // ──────────────────────────────────────────────────────
    // Step 3: parse_and_clean_bills × N
    // ──────────────────────────────────────────────────────
    console.log("\n━━━ Step 3: parse_and_clean_bills ━━━");
    const billData = [];
    for (const { fileName, content } of rawBills) {
      const { text: parseJson } = await client.callTool("parse_and_clean_bills", {
        raw_content: content,
        source_file: fileName,
      });
      const result = JSON.parse(parseJson);
      console.log(
        `   ✅ ${fileName} → 平台: ${result.platform}, 记录: ${result.records.length} 条` +
          (result.parse_warnings?.length ? ` ⚠ ${result.parse_warnings.length} 个警告` : "")
      );

      if (result.parse_warnings?.length) {
        warnings.push({ file: fileName, warnings: result.parse_warnings });
      }
      billData.push({
        platform: result.platform,
        records: result.records,
        parse_warnings: result.parse_warnings || [],
      });
    }

    if (billData.every((b) => b.records.length === 0)) {
      console.log("⚠ 所有文件均无可解析记录，生成空报告。");
    }

    // ──────────────────────────────────────────────────────
    // Step 4: generate_report
    // ──────────────────────────────────────────────────────
    console.log("\n━━━ Step 4: generate_report ━━━");
    const reportTitle = "2026年3月财务账单月度报告";
    const period = "2026-03";
    const { text: reportJson } = await client.callTool("generate_report", {
      bill_data: billData,
      report_title: reportTitle,
      period: period,
    });
    const { report_markdown, summary } = JSON.parse(reportJson);
    console.log("   ✅ 报告生成成功");

    // ── 展示报告 ──
    console.log("\n" + "═".repeat(60));
    console.log(report_markdown);
    console.log("═".repeat(60));

    // ──────────────────────────────────────────────────────
    // Step 5: send_notification
    // ──────────────────────────────────────────────────────
    console.log("\n━━━ Step 5: send_notification ━━━");
    const { text: notifyJson } = await client.callTool("send_notification", {
      channel: "feishu",
      target: FEISHU_WEBHOOK,
      subject: reportTitle,
      body: report_markdown,
    });
    const notifyResult = JSON.parse(notifyJson);
    if (notifyResult.success) {
      console.log("   ✅ 飞书消息发送成功！");
    } else {
      console.log(`   ❌ 飞书发送失败: ${notifyResult.message}`);
    }

    // ──────────────────────────────────────────────────────
    // Step 6: 向用户汇报处理概况
    // ──────────────────────────────────────────────────────
    console.log("\n" + "━".repeat(60));
    console.log("📋 处理概况");
    console.log("━".repeat(60));
    console.log(`   处理文件数:   ${files.length} 个 (成功 ${rawBills.length}, 失败 ${errors.length})`);
    console.log(`   总记录数:     ${summary.record_count} 条`);
    console.log(`   总收入:       ¥${summary.total_income.toLocaleString()}`);
    console.log(`   总支出:       ¥${summary.total_expense.toLocaleString()}`);
    console.log(`   净利润:       ¥${summary.net.toLocaleString()}`);
    console.log(`   通知状态:     ${notifyResult.success ? "✅ 已发送" : "❌ 发送失败"}`);

    if (errors.length > 0) {
      console.log("\n⚠ 失败文件:");
      errors.forEach((e) => console.log(`   • ${e.file}: ${e.reason}`));
    }
    if (warnings.length > 0) {
      console.log("\n⚠ 解析警告:");
      warnings.forEach((w) => {
        console.log(`   • ${w.file}:`);
        w.warnings.forEach((ww) => console.log(`     - ${ww}`));
      });
    }

  } catch (err) {
    console.error("💥 流程异常:", err.message);
    console.error(err.stack);
  } finally {
    await client.stop();
    console.log("\n🛑 MCP Client 已关闭。");
  }
}

main();
