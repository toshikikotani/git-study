/**
 * カテゴリ詳細のサマリーと「気づき」(純粋関数)。
 *
 * 数字はすべて model.ts の行(CategoryLine)から出す。台帳(明細)にない数字は作らない。
 * 気づきは根拠の取引(evidenceTxIds)を必ず持ち、そこから同じ数字を再計算できる。
 * 言葉は「事実 + 次にできること」だけ。「浪費」「無駄」などの評価語は使わない。
 */

import { comparableKey } from '@/domain/store-name';
import { daysBetween, type DateOnly } from '@/lib/date';
import {
  actualSpentYen,
  collectItemOccurrences,
  scheduledYen,
  type CategoryLine,
  type ItemOccurrence,
} from './model';

// ---- サマリー -------------------------------------------------------------------------

export type CategorySummary = {
  /** 実績の使った額(返品・返金を差し引いた額)。 */
  totalYen: number;
  /** 件数(実績の取引。返品・返金は数えない)。 */
  count: number;
  /** 1回あたりの平均(合計 ÷ 件数)。件数が0なら null。 */
  averageYen: number | null;
  /** 予定(未来日)の支出。 */
  scheduledYen: number;
  scheduledLines: CategoryLine[];
  /** 前月(今月なら前月の同じ日まで)との比較。前月のデータが無ければ null。 */
  vsPrevious: null | {
    previousYen: number;
    diffYen: number;
    /** 前月が0円のときは null。 */
    percent: number | null;
    /** 'same_day'=前月の同じ日まで、'full_month'=前月の1か月ぶん。 */
    basis: 'same_day' | 'full_month';
  };
};

/** 前期間の範囲。今月なら前月の同じ日まで、過去の月なら前月の全体。 */
export function previousRange(
  monthStart: DateOnly,
  today: DateOnly,
  isCurrentMonth: boolean,
): { from: DateOnly; to: DateOnly; basis: 'same_day' | 'full_month' } {
  const [y, m] = monthStart.split('-').map(Number) as [number, number];
  const prevYear = m === 1 ? y - 1 : y;
  const prevMonth = m === 1 ? 12 : m - 1;
  const from = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01` as DateOnly;
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  if (!isCurrentMonth) {
    return {
      from,
      to: `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` as DateOnly,
      basis: 'full_month',
    };
  }
  const day = Math.min(Number(today.slice(8, 10)), lastDay);
  return {
    from,
    to: `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}` as DateOnly,
    basis: 'same_day',
  };
}

function within(lines: readonly CategoryLine[], from: DateOnly, to: DateOnly): CategoryLine[] {
  return lines.filter((l) => l.occurredOn >= from && l.occurredOn <= to);
}

export function buildCategorySummary(input: {
  /** 選んだ月の行(実績・予定)。 */
  lines: readonly CategoryLine[];
  /** 履歴を含む全部の行(前月の比較に使う)。 */
  historyLines: readonly CategoryLine[];
  monthStart: DateOnly;
  today: DateOnly;
  isCurrentMonth: boolean;
}): CategorySummary {
  const actual = input.lines.filter((l) => l.status === 'actual');
  const totalYen = actualSpentYen(actual);
  const count = actual.filter((l) => l.amountYen < 0).length;
  const prev = previousRange(input.monthStart, input.today, input.isCurrentMonth);
  const prevActual = within(input.historyLines, prev.from, prev.to).filter(
    (l) => l.status === 'actual',
  );
  const scheduledLines = input.lines
    .filter((l) => l.status === 'scheduled' && l.amountYen < 0)
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));

  let vsPrevious: CategorySummary['vsPrevious'] = null;
  if (prevActual.length > 0) {
    const previousYen = actualSpentYen(prevActual);
    vsPrevious = {
      previousYen,
      diffYen: totalYen - previousYen,
      percent: previousYen > 0 ? Math.round(((totalYen - previousYen) / previousYen) * 100) : null,
      basis: prev.basis,
    };
  }
  return {
    totalYen,
    count,
    averageYen: count === 0 ? null : Math.round(totalYen / count),
    scheduledYen: scheduledYen(input.lines),
    scheduledLines,
    vsPrevious,
  };
}

/** 前月との差を、符号ではなく言葉で(「前月同日より 1,200円 多い」)。 */
export function previousComparisonWords(v: NonNullable<CategorySummary['vsPrevious']>): string {
  const base = v.basis === 'same_day' ? '前月の同じ日まで' : '前月';
  if (v.diffYen === 0) return `${base}と同じ額です`;
  const yen = `${Math.abs(v.diffYen).toLocaleString('ja-JP')}円`;
  return `${base}より ${yen} ${v.diffYen > 0 ? '多い' : '少ない'}`;
}

// ---- 気づき ---------------------------------------------------------------------------

export type InsightKind = 'change' | 'price' | 'frequency';

export type Insight = {
  id: string;
  kind: InsightKind;
  /** 事実 + 次にできること。 */
  message: string;
  /** 根拠の取引(タップするとこれらに絞り込む)。 */
  evidenceTxIds: string[];
  /** 文言に使った数字(根拠の取引から再計算できる)。 */
  numbers: Record<string, number>;
  /** 絞り込みチップの表示名。 */
  focusLabel: string;
};

const CHANGE_THRESHOLD = 0.2;
const FREQUENT_MIN_PER_WEEK = 3;
const PRICE_RISE_THRESHOLD = 0.1;
export const MAX_INSIGHTS = 3;

function yen(n: number): string {
  return `${Math.round(n).toLocaleString('ja-JP')}円`;
}

/** 店ごとの実績の合計(表記ゆれをまとめる)。 */
function storeTotals(
  lines: readonly CategoryLine[],
): Map<string, { label: string; yen: number; txIds: string[] }> {
  const map = new Map<string, { label: string; yen: number; txIds: string[] }>();
  for (const l of lines) {
    if (l.status !== 'actual') continue;
    const key = comparableKey(l.label) || l.label;
    const e = map.get(key) ?? { label: l.label, yen: 0, txIds: [] };
    e.yen += -l.amountYen;
    e.txIds.push(l.txId);
    map.set(key, e);
  }
  return map;
}

/** 前期間比の大きな変化(±20%以上)と、増減への寄与が最も大きい店。 */
function changeInsight(input: {
  lines: readonly CategoryLine[];
  historyLines: readonly CategoryLine[];
  monthStart: DateOnly;
  today: DateOnly;
  isCurrentMonth: boolean;
}): Insight | null {
  const prev = previousRange(input.monthStart, input.today, input.isCurrentMonth);
  const cur = input.lines.filter((l) => l.status === 'actual');
  const before = within(input.historyLines, prev.from, prev.to).filter(
    (l) => l.status === 'actual',
  );
  if (before.length === 0) return null;
  const curYen = actualSpentYen(cur);
  const prevYen = actualSpentYen(before);
  if (prevYen <= 0) return null;
  const diff = curYen - prevYen;
  if (Math.abs(diff) / prevYen < CHANGE_THRESHOLD) return null;

  // 寄与:店ごとの(今期 − 前期)のうち、全体の増減と同じ向きで最も大きい店。
  const curStores = storeTotals(cur);
  const prevStores = storeTotals(before);
  let top: {
    key: string;
    label: string;
    delta: number;
    cur: number;
    prev: number;
    txIds: string[];
  } | null = null;
  for (const key of new Set([...curStores.keys(), ...prevStores.keys()])) {
    const c = curStores.get(key);
    const p = prevStores.get(key);
    const delta = (c?.yen ?? 0) - (p?.yen ?? 0);
    if (Math.sign(delta) !== Math.sign(diff) || delta === 0) continue;
    if (top === null || Math.abs(delta) > Math.abs(top.delta)) {
      top = {
        key,
        label: c?.label ?? p!.label,
        delta,
        cur: c?.yen ?? 0,
        prev: p?.yen ?? 0,
        txIds: c?.txIds ?? [],
      };
    }
  }
  const percent = Math.round((Math.abs(diff) / prevYen) * 100);
  const basis = prev.basis === 'same_day' ? '前月の同じ日まで' : '前月';
  const direction = diff > 0 ? '多く' : '少なく';
  const cause = top
    ? diff > 0
      ? `増えたのは主に${top.label}(前月 ${yen(top.prev)} → 今月 ${yen(top.cur)})です。`
      : `減ったのは主に${top.label}(前月 ${yen(top.prev)} → 今月 ${yen(top.cur)})です。`
    : '';
  const next =
    top && top.txIds.length > 0 ? `${top.label}の明細だけを表示して確かめられます。` : '';
  return {
    id: 'change',
    kind: 'change',
    message: `${basis}より ${yen(Math.abs(diff))}(${percent}%)${direction}なっています。${cause}${next}`,
    evidenceTxIds: top && top.txIds.length > 0 ? top.txIds : cur.map((l) => l.txId),
    numbers: {
      currentYen: curYen,
      previousYen: prevYen,
      diffYen: diff,
      percent,
      ...(top
        ? { storeCurrentYen: top.cur, storePreviousYen: top.prev, storeDeltaYen: top.delta }
        : {}),
    },
    focusLabel: top ? `${top.label}の明細` : 'このカテゴリの明細',
  };
}

function cheapest(occ: readonly ItemOccurrence[]): ItemOccurrence | null {
  let best: ItemOccurrence | null = null;
  for (const o of occ) if (o.unitYen > 0 && (best === null || o.unitYen < best.unitYen)) best = o;
  return best;
}

/** どの連続7日間でも最多で何回か(同じ品目)。 */
export function maxPerWeek(dates: readonly DateOnly[]): number {
  const sorted = [...dates].sort();
  let best = 0;
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    while (daysBetween(sorted[j]!, sorted[i]!) > 6) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

/** よく買う品目(同じ品目を週3回以上)。最安の店があれば添える。 */
function frequencyInsight(lines: readonly CategoryLine[], genreKey: string): Insight | null {
  const { byKey } = collectItemOccurrences(lines, genreKey);
  let top: { name: string; occ: ItemOccurrence[]; perWeek: number } | null = null;
  for (const e of byKey.values()) {
    const perWeek = maxPerWeek(e.occurrences.map((o) => o.occurredOn));
    if (perWeek < FREQUENT_MIN_PER_WEEK) continue;
    if (top === null || e.occurrences.length > top.occ.length) {
      top = { name: e.name, occ: e.occurrences, perWeek };
    }
  }
  if (top === null) return null;
  const best = cheapest(top.occ);
  const stores = new Set(top.occ.map((o) => o.storeKey));
  const cheapText =
    best && stores.size >= 2
      ? `最安は${best.storeLabel}の${yen(best.unitYen)}です。`
      : `${top.occ.length > 0 ? '同じ店での買い方を' : ''}明細で確かめられます。`;
  return {
    id: `frequency:${top.name}`,
    kind: 'frequency',
    message: `${top.name}を今月${top.occ.length}回(1週間で最多${top.perWeek}回)。${cheapText}`,
    evidenceTxIds: [...new Set(top.occ.map((o) => o.txId))],
    numbers: {
      count: top.occ.length,
      maxPerWeek: top.perWeek,
      totalYen: top.occ.reduce((a, o) => a + o.unitYen, 0),
      ...(best && stores.size >= 2 ? { cheapestYen: best.unitYen } : {}),
    },
    focusLabel: `${top.name}の明細`,
  };
}

/** 品目の単価の上昇(直近の単価が、それ以前の平均より10%以上高い)。 */
function priceInsight(input: {
  lines: readonly CategoryLine[];
  historyLines: readonly CategoryLine[];
  genreKey: string;
}): Insight | null {
  const current = collectItemOccurrences(input.lines, input.genreKey).byKey;
  const history = collectItemOccurrences(input.historyLines, input.genreKey).byKey;
  let top: {
    name: string;
    latest: ItemOccurrence;
    average: number;
    rise: number;
    past: ItemOccurrence[];
    all: ItemOccurrence[];
  } | null = null;
  for (const [key, cur] of current) {
    const all = [...(history.get(key)?.occurrences ?? [])].sort((a, b) =>
      a.occurredOn.localeCompare(b.occurredOn),
    );
    const curSorted = [...cur.occurrences].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
    const latest = curSorted[curSorted.length - 1]!;
    if (latest.unitYen <= 0) continue;
    const past = all
      .filter(
        (o) =>
          o.occurredOn < latest.occurredOn ||
          (o.occurredOn === latest.occurredOn && o.txId !== latest.txId),
      )
      .filter((o) => o.unitYen > 0);
    if (past.length === 0) continue;
    const average = past.reduce((a, o) => a + o.unitYen, 0) / past.length;
    const rise = (latest.unitYen - average) / average;
    if (rise < PRICE_RISE_THRESHOLD) continue;
    if (top === null || rise > top.rise) {
      top = { name: cur.name, latest, average, rise, past, all };
    }
  }
  if (top === null) return null;
  const best = cheapest(top.all);
  const pct = Math.round(top.rise * 100);
  const stores = new Set(top.all.map((o) => o.storeKey));
  const next =
    best && stores.size >= 2 && best.unitYen < top.latest.unitYen
      ? `最安は${best.storeLabel}の${yen(best.unitYen)}です。`
      : '価格の推移を品目の詳細で確かめられます。';
  return {
    id: `price:${top.name}`,
    kind: 'price',
    message: `${top.name}の直近の単価は${yen(top.latest.unitYen)}で、これまでの平均${yen(top.average)}より${pct}%高くなっています。${next}`,
    evidenceTxIds: [...new Set([top.latest.txId, ...top.past.map((o) => o.txId)])],
    numbers: {
      latestYen: top.latest.unitYen,
      averageYen: Math.round(top.average),
      pastCount: top.past.length,
      percent: pct,
      ...(best && stores.size >= 2 ? { cheapestYen: best.unitYen } : {}),
    },
    focusLabel: `${top.name}の明細`,
  };
}

/** 気づき(最大3つ、該当が無ければ空)。前期間比 → 単価の上昇 → よく買う品目 の順。 */
export function buildInsights(input: {
  lines: readonly CategoryLine[];
  historyLines: readonly CategoryLine[];
  genreKey: string;
  monthStart: DateOnly;
  today: DateOnly;
  isCurrentMonth: boolean;
}): Insight[] {
  const out: Insight[] = [];
  const change = changeInsight(input);
  if (change) out.push(change);
  const price = priceInsight(input);
  if (price) out.push(price);
  const frequency = frequencyInsight(input.lines, input.genreKey);
  if (frequency) out.push(frequency);
  return out.slice(0, MAX_INSIGHTS);
}
