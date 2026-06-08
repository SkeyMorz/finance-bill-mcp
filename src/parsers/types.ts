export interface BillRecord {
  date: string;
  description: string;
  amount: number;
  currency: string;
  direction: "income" | "expense";
  category: string;
}

export interface ParseResult {
  platform: string;
  records: BillRecord[];
  parse_warnings: string[];
}
