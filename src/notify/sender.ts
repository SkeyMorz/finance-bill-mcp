export interface NotifyResult {
  success: boolean;
  message: string;
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

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const respBody = await resp.text();
  if (resp.ok) {
    return { success: true, message: "飞书消息发送成功" };
  }
  return { success: false, message: `飞书发送失败 HTTP ${resp.status}: ${respBody}` };
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

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const respBody = await resp.text();
  if (resp.ok) {
    return { success: true, message: "企业微信消息发送成功" };
  }
  return { success: false, message: `企业微信发送失败 HTTP ${resp.status}: ${respBody}` };
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
