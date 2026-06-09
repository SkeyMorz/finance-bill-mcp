import type { ReportSummary } from "./calculator.js";

function fmt(n: number): string {
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sign(n: number): string {
  return n >= 0 ? `+¥${fmt(n)}` : `-¥${fmt(Math.abs(n))}`;
}

export function generateMarkdownReport(
  title: string,
  period: string,
  summary: ReportSummary
): string {
  const lines: string[] = [];

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
  const netSign = summary.net >= 0 ? "净利润" : "净亏损";
  lines.push(`| **${netSign}** | **¥${fmt(Math.abs(summary.net))}** |`);
  lines.push("");

  // Platform analysis
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
    const icon = platformIcon(name);
    lines.push(
      `| ${icon} ${platformLabel(name)} | ¥${fmt(data.income)} | ¥${fmt(data.expense)} | ${sign(net)} |`
    );
  }
  lines.push("");

  // Category breakdown
  lines.push("---");
  lines.push("");
  lines.push("## 三、分类统计");
  lines.push("");
  lines.push("| 分类 | 收入 | 支出 | 净额 |");
  lines.push("|------|------|------|------|");

  const categories = Object.entries(summary.by_category).sort(
    (a, b) =>
      b[1].income + b[1].expense - (a[1].income + a[1].expense)
  );
  for (const [name, data] of categories) {
    const net = data.income - data.expense;
    lines.push(
      `| ${name} | ¥${fmt(data.income)} | ¥${fmt(data.expense)} | ${sign(net)} |`
    );
  }
  lines.push("");

  // Footer
  lines.push("---");
  lines.push("");
  lines.push(
    `*报告由 AI Agent 自动生成 · ${new Date().toISOString().slice(0, 10)}*`
  );

  return lines.join("\n");
}

function platformLabel(name: string): string {
  const labels: Record<string, string> = {
    alipay: "支付宝",
    wechat_pay: "微信支付",
    bank_statement: "银行对公",
    stripe: "Stripe",
    invoice: "发票系统",
    quickbooks: "QuickBooks",
    paypal: "PayPal",
  };
  return labels[name] || name;
}

function platformIcon(name: string): string {
  const icons: Record<string, string> = {
    alipay: "🔵",
    wechat_pay: "🟢",
    bank_statement: "🏦",
    stripe: "🟣",
    paypal: "🔷",
  };
  return icons[name] || "📊";
}
