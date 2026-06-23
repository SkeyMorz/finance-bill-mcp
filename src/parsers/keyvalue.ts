import { BillRecord, ParserRawResult } from "./types.js";
import { detectCurrency } from "./normalize.js";

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

/** 检测分隔符行（Markdown 水平线，用于分隔不同记录块） */
function isSeparatorLine(line: string): boolean {
  return /^[-*=_]{3,}\s*$/.test(line.trim());
}

function buildRecord(
  fields: { date?: string; desc?: string; amount?: string; dir?: string },
  mapping: KvMapping,
  blockIdx: number,
  warnings: string[]
): BillRecord | null {
  if (!fields.date || !fields.amount) {
    if (fields.date || fields.amount) {
      warnings.push(
        `记录 ${blockIdx + 1}: 缺少日期或金额 (date="${fields.date}", amount="${fields.amount}")`
      );
    }
    return null;
  }
  const rawAmount = fields.amount.replace(/[¥￥,\s]/g, "");
  const amount = Math.abs(parseFloat(rawAmount));
  if (isNaN(amount)) {
    warnings.push(`记录 ${blockIdx + 1}: 金额解析失败 "${fields.amount}"`);
    return null;
  }

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
    date: fields.date,
    description: fields.desc || "",
    amount,
    currency: detectCurrency(rawAmount, fields.desc || ""),
    direction,
    category: "",
  };
}

function extractRecords(
  lines: string[],
  mapping: KvMapping
): ParserRawResult {
  const records: BillRecord[] = [];
  const warnings: string[] = [];
  let current: { date?: string; desc?: string; amount?: string; dir?: string } = {};
  let blockIdx = 0;
  let flushAttempts = 0;   // 有数据可 flush 的次数
  let successfulFlushes = 0;

  function hasData() {
    return !!(current.date || current.desc || current.amount || current.dir);
  }

  function flush() {
    if (hasData()) {
      flushAttempts++;
      const record = buildRecord(current, mapping, blockIdx, warnings);
      if (record) {
        records.push(record);
        blockIdx++;
        successfulFlushes++;
      }
    }
    current = {};
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || isSeparatorLine(trimmed)) {
      flush();
      continue;
    }
    const parsed = parseKvLine(trimmed);
    if (!parsed) {
      warnings.push(`无法解析行: "${trimmed}"`);
      continue;
    }
    const { key, value } = parsed;

    if (mapping.dateKey.test(key)) {
      if (current.date) flush();
      current.date = value;
    } else if (mapping.descKey.test(key)) {
      current.desc = value;
    } else if (mapping.amountKey.test(key)) {
      if (current.amount) flush();
      current.amount = value;
    } else if (mapping.dirKey.test(key)) {
      if (current.dir) flush();
      current.dir = value;
    }
  }
  flush();

  // 置信度 = 成功构建记录数 / 尝试 flush 次数
  const confidence = flushAttempts > 0 ? successfulFlushes / flushAttempts : 0;
  return { records, warnings, confidence };
}

export function isKeyValueFormat(content: string): boolean {
  const lines = content.split("\n").filter((l) => {
    const t = l.trim();
    return t !== "" && !isSeparatorLine(t);
  });
  const kvLines = lines.filter((l) => parseKvLine(l) !== null);
  return kvLines.length >= lines.length * 0.5 && kvLines.length >= 3;
}

export function parseKeyValue(
  content: string
): ParserRawResult {
  const lines = content.split("\n");
  return extractRecords(lines, KV_PATTERNS[0]);
}
