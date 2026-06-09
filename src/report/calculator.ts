import type { BillRecord } from "../parsers/types.js";

interface PlatformInput {
  platform: string;
  records: BillRecord[];
  parse_warnings?: string[];
}

interface PlatformSummary {
  income: number;
  expense: number;
}

interface CategorySummary {
  income: number;
  expense: number;
}

export interface ReportSummary {
  total_income: number;
  total_expense: number;
  net: number;
  by_platform: Record<string, PlatformSummary>;
  by_category: Record<string, CategorySummary>;
  record_count: number;
}

export function computeSummary(billData: PlatformInput[]): ReportSummary {
  let total_income = 0;
  let total_expense = 0;
  let record_count = 0;
  const by_platform: Record<string, PlatformSummary> = {};
  const by_category: Record<string, CategorySummary> = {};

  for (const platform of billData) {
    const pName = platform.platform;
    if (!by_platform[pName]) {
      by_platform[pName] = { income: 0, expense: 0 };
    }

    for (const record of platform.records) {
      const amount = record.amount;
      const cat = record.category || "未分类";

      if (!by_category[cat]) {
        by_category[cat] = { income: 0, expense: 0 };
      }

      if (record.direction === "income") {
        total_income += amount;
        by_platform[pName].income += amount;
        by_category[cat].income += amount;
      } else {
        total_expense += amount;
        by_platform[pName].expense += amount;
        by_category[cat].expense += amount;
      }
      record_count++;
    }
  }

  return {
    total_income: round(total_income),
    total_expense: round(total_expense),
    net: round(total_income - total_expense),
    by_platform,
    by_category,
    record_count,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
