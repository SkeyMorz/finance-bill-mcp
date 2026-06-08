const PLATFORM_RULES: [RegExp, string][] = [
  [/alipay|支付宝/i, "alipay"],
  [/wechat|wxpay|微信/i, "wechat_pay"],
  [/bank|银行|对公|流水/i, "bank_statement"],
  [/stripe/i, "stripe"],
  [/invoice|发票/i, "invoice"],
  [/quickbook/i, "quickbooks"],
  [/paypal/i, "paypal"],
];

export function identifyPlatform(sourceFile: string): string {
  for (const [pattern, name] of PLATFORM_RULES) {
    if (pattern.test(sourceFile)) {
      return name;
    }
  }
  return "unknown";
}
