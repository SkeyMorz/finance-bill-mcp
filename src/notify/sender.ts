export interface NotifyResult {
  success: boolean;
  message: string;
}

const FETCH_TIMEOUT_MS = 10_000;

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
  _target: string,
  _subject: string,
  _body: string
): Promise<NotifyResult> {
  return { success: false, message: "Email 渠道暂未实现" };
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
