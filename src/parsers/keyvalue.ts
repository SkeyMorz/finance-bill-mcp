import { BillRecord } from "./types.js";

interface KvMapping {
  dateKey: RegExp;
  descKey: RegExp;
  amountKey: RegExp;
  dirKey: RegExp;
}

const KV_PATTERNS: KvMapping[] = [
  {
    dateKey: /日期|交易日期|date|time/i,
    descKey: /描述|交易说明|备注|摘要|说明|desc|memo|用途/i,
    amountKey: /金额|交易金额|amount/i,
    dirKey: /方向|类型|收支|type|direction/i,
  },
];

function parseKvLine(line: string): { key: string; value: string } | null {
  const m = line.match(/^[\s]*([^：:\s]+)[：:]\s*(.+)/);
  if (!m) return null;
  return { key: m[1].trim(), value: m[2].trim() };
}

function splitBlocks(content: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length > 0) {
        blocks.push(current.join("\n"));
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

function blockToRecord(
  block: string,
  mapping: KvMapping,
  blockIdx: number
): { record: BillRecord | null; warnings: string[] } {
  const warnings: string[] = [];
  const fields: { date?: string; desc?: string; amount?: string; dir?: string } = {};

  for (const line of block.split("\n")) {
    const parsed = parseKvLine(line);
    if (!parsed) {
      warnings.push(`块 ${blockIdx + 1}: 无法解析行 "${line.trim()}"`);
      continue;
    }
    const { key, value } = parsed;
    if (mapping.dateKey.test(key)) fields.date = value;
    else if (mapping.descKey.test(key)) fields.desc = value;
    else if (mapping.amountKey.test(key)) fields.amount = value;
    else if (mapping.dirKey.test(key)) fields.dir = value;
  }

  if (!fields.date || !fields.amount) {
    warnings.push(
      `块 ${blockIdx + 1}: 缺少日期或金额 (date="${fields.date}", amount="${fields.amount}")`
    );
    return { record: null, warnings };
  }

  const rawAmount = fields.amount.replace(/[¥￥,\s]/g, "");
  const amount = Math.abs(parseFloat(rawAmount));
  if (isNaN(amount)) {
    warnings.push(`块 ${blockIdx + 1}: 金额解析失败 "${fields.amount}"`);
    return { record: null, warnings };
  }

  const desc = fields.desc || "";
  let direction: "income" | "expense";
  if (fields.dir) {
    if (/收入|入账|收款|credit|in|收/i.test(fields.dir))
      direction = "income";
    else if (/支出|出账|付款|debit|out|支|退/i.test(fields.dir))
      direction = "expense";
    else direction = parseFloat(rawAmount) < 0 ? "expense" : "income";
  } else {
    direction = parseFloat(rawAmount) < 0 ? "expense" : "income";
  }

  return {
    record: {
      date: fields.date,
      description: desc,
      amount,
      currency: "CNY",
      direction,
      category: "",
    },
    warnings,
  };
}

export function isKeyValueFormat(content: string): boolean {
  const lines = content.split("\n").filter((l) => l.trim());
  const kvLines = lines.filter((l) => parseKvLine(l) !== null);
  return kvLines.length >= lines.length * 0.5 && kvLines.length >= 3;
}

export function parseKeyValue(
  content: string
): { records: BillRecord[]; warnings: string[] } {
  const records: BillRecord[] = [];
  const warnings: string[] = [];
  const blocks = splitBlocks(content);
  const mapping = KV_PATTERNS[0];

  for (let i = 0; i < blocks.length; i++) {
    const { record, warnings: blockWarnings } = blockToRecord(
      blocks[i],
      mapping,
      i
    );
    warnings.push(...blockWarnings);
    if (record) records.push(record);
  }

  return { records, warnings };
}
