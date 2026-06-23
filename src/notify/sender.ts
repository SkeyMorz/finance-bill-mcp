import nodemailer from "nodemailer";

export interface NotifyResult {
  success: boolean;
  message: string;
}

const FETCH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// 简易 Markdown → HTML 转换器（仅处理报告中出现的元素，零外部依赖）
// ---------------------------------------------------------------------------
function markdownToHtml(md: string): string {
  let html = md;

  // 转义 HTML 特殊字符（先转义，避免与后续规则冲突）
  html = html.replace(/&/g, "&amp;");
  html = html.replace(/</g, "&lt;");
  html = html.replace(/>/g, "&gt;");

  // 代码块 ```...```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<pre><code>${escaped}</code></pre>`;
  });

  // 行内代码 `...`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 水平线 --- 或 ***
  html = html.replace(/^(?:---|\*\*\*)\s*$/gm, "<hr>");

  // 标题（从高到低，避免 # 互相干扰）
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // 粗体 + 斜体
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // 图片
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');

  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Markdown 表格 → HTML 表格
  html = html.replace(
    /((?:^\|.+\|\s*$[\n\r]){2,}(?:^\|.+\|\s*$[\n\r])*)/gm,
    (tableBlock: string) => {
      const lines = tableBlock
        .trim()
        .split(/\n\r?/)
        .filter((l) => l.includes("|"));
      if (lines.length < 2) return tableBlock;

      const parseRow = (line: string) =>
        line
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());

      // 跳过仅由 - : 空格组成的分隔行
      const isSep = (cells: string[]) =>
        cells.every((c) => /^[-:\s]+$/.test(c));

      const headerCells = parseRow(lines[0]);
      let dataStart = 1;
      if (isSep(parseRow(lines[1]))) dataStart = 2;

      const headerHtml =
        "<tr>" +
        headerCells.map((c) => `<th>${c}</th>`).join("") +
        "</tr>";

      const bodyHtml = lines
        .slice(dataStart)
        .map((l) => {
          const cells = parseRow(l);
          return (
            "<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>"
          );
        })
        .join("");

      return `<table>${headerHtml}${bodyHtml}</table>`;
    }
  );

  // 无序列表
  html = html.replace(/^[\s]*[-*+] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // 有序列表
  html = html.replace(/^[\s]*\d+\. (.+)$/gm, "<li>$1</li>");

  // 引用块
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // 段落：连续的非空非标签行
  const paragraphs = html.split(/\n{2,}/);
  html = paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      if (
        trimmed.startsWith("<h") ||
        trimmed.startsWith("<table") ||
        trimmed.startsWith("<ul") ||
        trimmed.startsWith("<ol") ||
        trimmed.startsWith("<pre") ||
        trimmed.startsWith("<blockquote") ||
        trimmed.startsWith("<hr")
      ) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return html;
}

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`请求超时 (${timeoutMs}ms): ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function sendFeishu(
  target: string,
  subject: string,
  body: string
): Promise<NotifyResult> {
  const url = target || process.env.FEISHU_WEBHOOK_URL || "";
  if (!url) {
    return { success: false, message: "缺少飞书 Webhook URL（target 为空且未设置 FEISHU_WEBHOOK_URL）" };
  }

  const payload = {
    msg_type: "text",
    content: {
      text: `${subject}\n\n${body}`,
    },
  };

  try {
    const resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      FETCH_TIMEOUT_MS
    );

    const respBody = await resp.text();
    if (resp.ok) {
      return { success: true, message: "飞书消息发送成功" };
    }
    return { success: false, message: `飞书发送失败 HTTP ${resp.status}: ${respBody}` };
  } catch (err) {
    return { success: false, message: `飞书请求异常: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function sendWecom(
  target: string,
  subject: string,
  body: string
): Promise<NotifyResult> {
  const url = target;
  if (!url) {
    return { success: false, message: "缺少企业微信 Webhook URL" };
  }

  const payload = {
    msgtype: "markdown",
    markdown: {
      content: `## ${subject}\n${body}`,
    },
  };

  try {
    const resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      FETCH_TIMEOUT_MS
    );

    const respBody = await resp.text();
    if (resp.ok) {
      return { success: true, message: "企业微信消息发送成功" };
    }
    return { success: false, message: `企业微信发送失败 HTTP ${resp.status}: ${respBody}` };
  } catch (err) {
    return { success: false, message: `企业微信请求异常: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function sendEmail(
  target: string,
  subject: string,
  body: string
): Promise<NotifyResult> {
  // ---- 0. 读取 SMTP 配置（全部从环境变量注入，不硬编码） ----
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user || "";

  if (!host || !user || !pass) {
    return {
      success: false,
      message: "缺少 SMTP 配置：请设置 SMTP_HOST / SMTP_USER / SMTP_PASS 环境变量",
    };
  }

  if (!target || !target.includes("@")) {
    return { success: false, message: `无效的收件人邮箱地址: "${target}"` };
  }

  // ---- 1. 创建 transporter ----
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,           // 465 = SMTPS; 587/25 = STARTTLS
    auth: { user, pass },
  });

  // ---- 2. 发送 ----
  try {
    const info = await transporter.sendMail({
      from,
      to: target,
      subject,
      text: body,                        // 纯文本回退（邮件客户端不支持 HTML 时使用）
      html: markdownToHtml(body),        // HTML 正文（表格、加粗等）
    });

    return {
      success: true,
      message: `邮件发送成功 (messageId: ${info.messageId})`,
    };
  } catch (err) {
    return {
      success: false,
      message: `邮件发送失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function sendNotification(
  channel: "email" | "feishu" | "wecom",
  target: string,
  subject: string,
  body: string
): Promise<NotifyResult> {
  switch (channel) {
    case "feishu":
      return sendFeishu(target, subject, body);
    case "wecom":
      return sendWecom(target, subject, body);
    case "email":
      return sendEmail(target, subject, body);
  }
}
