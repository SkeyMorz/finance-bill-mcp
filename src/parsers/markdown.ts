import { BillRecord } from "./types.js";
import { detectCurrency } from "./normalize.js";

interface ColumnMap {
  date: number;
  description: number;
  amount: number;
  direction: number;
}

const DATE_KEYS = /日期|交易日期|date|time/i;
const DESC_KEYS = /描述|交易说明|备注|摘要|description|memo|用途|说明/i;
const AMOUNT_KEYS = /金额|交易金额|amount|收入|支出/i;
const DIR_KEYS = /方向|类型|收支|type/i;

function buildColumnMap(headers: string[]): ColumnMap | null {
  const map: Partial<ColumnMap> = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim();
    if (DATE_KEYS.test(h)) map.date = i;
    else if (DESC_KEYS.test(h)) map.description = i;
    else if (AMOUNT_KEYS.test(h)) map.amount = i;
    else if (DIR_KEYS.test(h)) map.direction = i;
  }
  if (map.date == null || map.amount == null) return null;
  return {
    date: map.date,
    description: map.description ?? -1,
    amount: map.amount,
    direction: map.direction ?? -1,
  };
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^[-: ]+$/.test(c.trim()));
}

function guessDirection(
  desc: string,
  rawAmount: string
): "income" | "expense" {
  const num = parseFloat(rawAmount.replace(/[¥￥,]/g, ""));
  if (num < 0) return "expense";
  const incomeKw = /收入|入账|收款|credit|in/i;
  const expenseKw = /支出|出账|付款|debit|out|退/;
  if (incomeKw.test(desc)) return "income";
  if (expenseKw.test(desc)) return "expense";
  return num >= 0 ? "income" : "expense";
}

export function isMarkdownTable(content: string): boolean {
  const lines = content.split("\n").filter((l) => l.trim());
  const pipeLines = lines.filter((l) => l.includes("|"));
  return pipeLines.length >= 3;
}

export function parseMarkdownTable(
  content: string
): { records: BillRecord[]; warnings: string[] } {
  const records: BillRecord[] = [];
  const warnings: string[] = [];
  const lines = content.split("\n");
  const rows = lines
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
    )
    .filter((cells) => cells.length >= 2);

  if (rows.length < 2) {
    warnings.push("Markdown 表格行数不足");
    return { records, warnings };
  }

  const colMap = buildColumnMap(rows[0]);
  if (!colMap) {
    warnings.push("无法识别 Markdown 表格列头");
    return { records, warnings };
  }

  let dataStart = 1;
  if (isSeparatorRow(rows[1])) dataStart = 2;

  for (let i = dataStart; i < rows.length; i++) {
    const cells = rows[i];
    const rawDate = cells[colMap.date]?.trim();
    if (!rawDate || rawDate === "") continue;

    const rawAmount = cells[colMap.amount]?.trim() || "0";
    const desc =
      colMap.description >= 0
        ? cells[colMap.description]?.trim() || ""
        : "";
    const dirCell =
      colMap.direction >= 0
        ? cells[colMap.direction]?.trim() || ""
        : "";

    const amount = Math.abs(parseFloat(rawAmount.replace(/[¥￥,]/g, "")));
    if (isNaN(amount)) {
      warnings.push(`行 ${i + 1}: 金额解析失败 "${rawAmount}"`);
      continue;
    }

    let direction: "income" | "expense";
    if (dirCell && /收入|入账|收款|credit|in/i.test(dirCell)) {
      direction = "income";
    } else if (dirCell && /支出|出账|付款|debit|out|退/i.test(dirCell)) {
      direction = "expense";
    } else {
      direction = guessDirection(desc, rawAmount);
    }

    records.push({
      date: rawDate,
      description: desc,
      amount,
      currency: detectCurrency(rawAmount, desc),
      direction,
      category: "",
    });
  }

  return { records, warnings };
}
