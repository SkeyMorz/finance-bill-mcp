import { BillRecord } from "./types.js";

interface CsvColumnMap {
  date: number;
  description: number;
  amount: number;
  direction: number;
}

const DATE_PATTERN = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;

function detectColumns(firstRow: string[]): CsvColumnMap | null {
  const map: Partial<CsvColumnMap> = {};
  for (let i = 0; i < firstRow.length; i++) {
    const cell = firstRow[i].trim().toLowerCase();
    if (/日期|date|time|交易时间/i.test(cell)) map.date = i;
    else if (/描述|说明|备注|desc|memo|摘要|用途/i.test(cell))
      map.description = i;
    else if (/金额|amount|收入|支出/i.test(cell)) map.amount = i;
    else if (/方向|类型|收支|type|direction/i.test(cell))
      map.direction = i;
  }

  if (map.date == null || map.amount == null) return null;
  return {
    date: map.date,
    description: map.description ?? 1,
    amount: map.amount,
    direction: map.direction ?? -1,
  };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function hasCsvDateFirst(cells: string[]): boolean {
  return cells.length > 0 && DATE_PATTERN.test(cells[0].trim());
}

function guessDirectionCsv(
  desc: string,
  rawAmount: string,
  dirCell: string
): "income" | "expense" {
  if (dirCell) {
    if (/收入|入账|收款|credit|in|收/i.test(dirCell)) return "income";
    if (/支出|出账|付款|debit|out|支|退/i.test(dirCell)) return "expense";
  }
  const num = parseFloat(rawAmount.replace(/[¥￥,]/g, ""));
  if (isNaN(num)) return "expense";
  if (num < 0) return "expense";
  const kw = desc;
  if (/退款|退|refund/i.test(kw)) return "expense";
  return "income";
}

export function isCsvFormat(content: string): boolean {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const csvLines = lines.filter((l) => l.includes(",") && !l.includes("|"));
  return csvLines.length >= lines.length * 0.7;
}

export function parseCsv(
  content: string
): { records: BillRecord[]; warnings: string[] } {
  const records: BillRecord[] = [];
  const warnings: string[] = [];
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return { records, warnings };

  const firstCells = parseCsvLine(lines[0]);
  let colMap: CsvColumnMap | null = null;
  let dataStart = 0;

  if (hasCsvDateFirst(firstCells)) {
    colMap = { date: 0, description: 1, amount: 2, direction: -1 };
    dataStart = 0;
  } else {
    colMap = detectColumns(firstCells);
    dataStart = 1;
  }

  if (!colMap) {
    warnings.push("无法检测 CSV 列映射，尝试默认(date,desc,amount)");
    colMap = { date: 0, description: 1, amount: 2, direction: -1 };
    dataStart = 0;
  }

  for (let i = dataStart; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const rawDate = cells[colMap.date]?.trim();
    if (!rawDate) continue;

    const rawAmount =
      cells[colMap.amount]?.trim() || "0";
    const desc =
      colMap.description >= 0
        ? cells[colMap.description]?.trim() || ""
        : "";
    const dirCell =
      colMap.direction >= 0
        ? cells[colMap.direction]?.trim() || ""
        : "";

    const amount = Math.abs(
      parseFloat(rawAmount.replace(/[¥￥,\s]/g, ""))
    );
    if (isNaN(amount)) {
      warnings.push(`行 ${i + 1}: 金额解析失败 "${rawAmount}"`);
      continue;
    }

    records.push({
      date: rawDate,
      description: desc,
      amount,
      currency: "CNY",
      direction: guessDirectionCsv(desc, rawAmount, dirCell),
      category: "",
    });
  }

  return { records, warnings };
}
