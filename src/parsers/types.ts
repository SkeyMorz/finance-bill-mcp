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

/** 单个 parser 的内部返回，含置信度（0~1，越高越可信） */
export interface ParserRawResult {
  records: BillRecord[];
  warnings: string[];
  confidence: number;
}
