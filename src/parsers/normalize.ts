import { BillRecord } from "./types.js";

const CATEGORY_RULES: [RegExp, string][] = [
  [/工资|薪资|salary|payroll/i, "人力成本"],
  [/房租|租金|rent|lease/i, "房租"],
  [/办公|文具|office|supplies/i, "办公用品"],
  [/水电|电费|水费|utility|电|水/i, "水电费"],
  [/差旅|交通|打车|机票|酒店|travel|flight|hotel/i, "差旅交通"],
  [/餐饮|餐费|吃饭|外卖|food|meal|restaurant/i, "餐饮"],
  [/广告|推广|营销|market|ad|广告费/i, "营销推广"],
  [/服务器|云服务|aws|阿里云|server|hosting|saas/i, "技术服务"],
  [/税费|税金|tax|增值税/i, "税费"],
  [/服务费|咨询|顾问|consult/i, "咨询服务"],
  [/退款|refund/i, "退款"],
  [/销售|营收|revenue|sales|收入/i, "销售收入"],
  [/投资|理财|invest|dividend/i, "投资收益"],
  [/利息|interest/i, "利息"],
  [/手续费|fee|commission/i, "手续费"],
  [/快递|物流|shipping|delivery/i, "物流快递"],
  [/保险|insur/i, "保险"],
];

export function classify(record: BillRecord): string {
  const text = record.description;
  for (const [pattern, cat] of CATEGORY_RULES) {
    if (pattern.test(text)) return cat;
  }
  return record.direction === "income" ? "其他收入" : "其他支出";
}

export function normalizeDate(raw: string): string {
  const trimmed = raw.trim();

  // 2026-03-01 or 2026/03/01
  let m = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  // 2026年3月1日 or 2026年03月01日
  m = trimmed.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  // 03/01/2026
  m = trimmed.match(/^(\d{1,2})[/](\d{1,2})[/](\d{4})/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }

  // 1 Mar 2026 or 01 Mar 2026
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04",
    may: "05", jun: "06", jul: "07", aug: "08",
    sep: "09", oct: "10", nov: "11", dec: "12",
  };
  m = trimmed.match(/^(\d{1,2})\s+([a-zA-Z]{3})\s+(\d{4})/i);
  if (m && months[m[2].toLowerCase()]) {
    return `${m[3]}-${months[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  }

  return trimmed;
}

export function normalizeRecords(
  records: BillRecord[]
): BillRecord[] {
  return records.map((r) => ({
    ...r,
    date: normalizeDate(r.date),
    amount: Math.round(r.amount * 100) / 100,
    category: r.category || classify(r),
  }));
}
