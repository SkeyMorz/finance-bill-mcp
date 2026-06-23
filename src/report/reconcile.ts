import type { BillRecord } from "../parsers/types.js";

// ---------------------------------------------------------------------------
// 跨平台对账 — 模糊匹配算法
// 解决同一笔交易在不同平台（支付宝 vs 银行）中出现时的对账问题
// ---------------------------------------------------------------------------

export interface ReconciledPair {
  a: BillRecord;
  b: BillRecord;
  date_diff_days: number;
  amount_diff: number;
  amount_diff_ratio: number;
  desc_similarity: number;
  total_score: number;
}

export interface ReconcileSummary {
  platform_a_name: string;
  platform_b_name: string;
  total_a: number;
  total_b: number;
  matched_count: number;
  unmatched_a_count: number;
  unmatched_b_count: number;
  duplicate_a_count: number;
  duplicate_b_count: number;
  match_rate: number;
  total_amount_diff: number;
}

export interface ReconcileResult {
  matched: ReconciledPair[];
  unmatched_a: BillRecord[];
  unmatched_b: BillRecord[];
  duplicates_a: BillRecord[];
  duplicates_b: BillRecord[];
  summary: ReconcileSummary;
}

interface MatchCandidate {
  indexA: number;
  indexB: number;
  score: number;
  dateDiff: number;
  amountDiff: number;
  amountRatio: number;
  descSim: number;
}

// ─── 参数默认值 ───
const DEFAULT_DATE_TOLERANCE_DAYS = 2;
const DEFAULT_AMOUNT_TOLERANCE_RATIO = 0.05;   // ±5%
const DEFAULT_DESC_SIMILARITY_THRESHOLD = 0.0; // 描述不作为硬过滤（仅影响得分）
const MATCH_SCORE_THRESHOLD = 0.55;             // 总分 ≥ 0.55 才视为匹配

// ─── 日期工具 ───
function parseDateStr(raw: string): number {
  // 兼容多种输入格式，返回距 epoch 的天数
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 86400000);
  // 中文格式
  const m = raw.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (m) return Math.floor(new Date(+m[1], +m[2] - 1, +m[3]).getTime() / 86400000);
  return 0;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(parseDateStr(a) - parseDateStr(b));
}

// ─── 文本相似度（Jaccard，基于 2-gram 字符级） ───
function tokenize(text: string): Set<string> {
  const cleaned = text
    .replace(/[，,。、：:；;\s]+/g, " ")
    .replace(/[#\-_*()（）【】\[\]{}]/g, " ")
    .trim()
    .toLowerCase();
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);

  // 也做 2-gram 字符级特征，提升中英混合匹配效果
  const bigrams = new Set<string>();
  for (const w of words) {
    bigrams.add(w);                     // 整词
    for (let i = 0; i < w.length - 1; i++) {
      bigrams.add(w.slice(i, i + 2));   // 字符 2-gram
    }
  }
  return bigrams;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ─── 重复检测（同一平台内部） ───
function findInternalDuplicates(records: BillRecord[]): BillRecord[] {
  const dupes: BillRecord[] = [];
  const used = new Set<number>();
  for (let i = 0; i < records.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < records.length; j++) {
      if (used.has(j)) continue;
      const sameDay = daysBetween(records[i].date, records[j].date) === 0;
      const sameAmount = records[i].amount === records[j].amount;
      const sim = jaccardSimilarity(records[i].description, records[j].description);
      if (sameDay && sameAmount && sim >= 0.6) {
        dupes.push(records[j]);
        used.add(j);
      }
    }
  }
  return dupes;
}

// ─── 主对账函数 ───
export function reconcile(
  platformA: { platform: string; records: BillRecord[] },
  platformB: { platform: string; records: BillRecord[] },
  opts?: {
    date_tolerance_days?: number;
    amount_tolerance_ratio?: number;
    desc_similarity_threshold?: number;
  }
): ReconcileResult {
  const dateTol = opts?.date_tolerance_days ?? DEFAULT_DATE_TOLERANCE_DAYS;
  const amtTol = opts?.amount_tolerance_ratio ?? DEFAULT_AMOUNT_TOLERANCE_RATIO;

  const a = platformA.records;
  const b = platformB.records;

  // ── 1. 计算所有候选对的匹配得分 ──
  const candidates: MatchCandidate[] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const dayDiff = daysBetween(a[i].date, b[j].date);

      // 日期超出容忍度 → 硬过滤
      if (dayDiff > dateTol) continue;

      // 方向必须一致
      if (a[i].direction !== b[j].direction) continue;

      // 金额分
      const maxAmt = Math.max(a[i].amount, b[j].amount);
      const amtDiff = Math.abs(a[i].amount - b[j].amount);
      const amtRatio = maxAmt > 0 ? amtDiff / maxAmt : 0;

      // 金额超出容忍度 → 硬过滤
      if (amtRatio > amtTol && amtDiff > 10) continue;

      const amtScore = 1 - Math.min(amtRatio / (amtTol * 2), 1);

      // 日期分
      const dateScore = 1 - Math.min(dayDiff / (dateTol + 1), 1);

      // 描述分（软指标——日期+金额强匹配时，描述相似度低也不影响匹配）
      const descSim = jaccardSimilarity(a[i].description, b[j].description);

      // 加权总分：日期和金额是硬指标（各占40%），描述是软加分（20%）
      const totalScore = dateScore * 0.4 + amtScore * 0.4 + descSim * 0.2;

      if (totalScore >= MATCH_SCORE_THRESHOLD) {
        candidates.push({
          indexA: i,
          indexB: j,
          score: totalScore,
          dateDiff: dayDiff,
          amountDiff: amtDiff,
          amountRatio: amtRatio,
          descSim,
        });
      }
    }
  }

  // ── 2. 贪心匹配（按得分降序，每个记录最多匹配一次） ──
  candidates.sort((x, y) => y.score - x.score);

  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const matched: ReconciledPair[] = [];

  for (const c of candidates) {
    if (usedA.has(c.indexA) || usedB.has(c.indexB)) continue;
    usedA.add(c.indexA);
    usedB.add(c.indexB);
    matched.push({
      a: a[c.indexA],
      b: b[c.indexB],
      date_diff_days: c.dateDiff,
      amount_diff: round(c.amountDiff),
      amount_diff_ratio: round(c.amountRatio),
      desc_similarity: round(c.descSim),
      total_score: round(c.score),
    });
  }

  // ── 3. 未匹配记录 ──
  const unmatched_a: BillRecord[] = [];
  const unmatched_b: BillRecord[] = [];
  for (let i = 0; i < a.length; i++) {
    if (!usedA.has(i)) unmatched_a.push(a[i]);
  }
  for (let j = 0; j < b.length; j++) {
    if (!usedB.has(j)) unmatched_b.push(b[j]);
  }

  // ── 4. 内部重复检测 ──
  const duplicates_a = findInternalDuplicates(a);
  const duplicates_b = findInternalDuplicates(b);

  // ── 5. 汇总 ──
  const summary: ReconcileSummary = {
    platform_a_name: platformA.platform,
    platform_b_name: platformB.platform,
    total_a: a.length,
    total_b: b.length,
    matched_count: matched.length,
    unmatched_a_count: unmatched_a.length,
    unmatched_b_count: unmatched_b.length,
    duplicate_a_count: duplicates_a.length,
    duplicate_b_count: duplicates_b.length,
    match_rate:
      a.length + b.length > 0
        ? round((matched.length * 2) / (a.length + b.length))
        : 0,
    total_amount_diff: round(
      matched.reduce((sum, m) => sum + Math.abs(m.amount_diff), 0)
    ),
  };

  return { matched, unmatched_a, unmatched_b, duplicates_a, duplicates_b, summary };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
