/**
 * カテゴリ詳細のグラフ用の系列(純粋関数)。
 *
 * 数字は model.ts の行(CategoryLine)から出す。日・週・月の3つの単位で、
 * 実績(返品・返金は差し引く)・予定(未来日)・前期間の実績を返す。
 */

import { addDays, addMonths, daysBetween, nthDayOfMonth, type DateOnly } from '@/lib/date';
import type { CategoryLine } from './model';

export type ChartUnit = 'day' | 'week' | 'month';

export const CHART_UNITS: readonly { value: ChartUnit; label: string }[] = [
  { value: 'day', label: '日' },
  { value: 'week', label: '週' },
  { value: 'month', label: '月' },
];

/** 棒の最大本数(日表示の最大=31日)。棒の部品を使い回して、単位を切り替えるとき滑らかに変形させる。 */
export const MAX_BARS = 31;

export type Bucket = {
  index: number;
  from: DateOnly;
  to: DateOnly;
  /** 軸・読み上げ用のラベル(例:「9/27」「9/22〜」「9月」)。 */
  label: string;
  /** 実績の使った額(返品・返金を差し引いた純額。マイナスになりうる)。 */
  actualYen: number;
  /** 予定(未来日)の支出。 */
  scheduledYen: number;
  /** 実績の取引の件数(返品・返金は数えない)。 */
  count: number;
  /** 前期間の同じ位置の実績。前期間が無ければ null。 */
  previousYen: number | null;
  /** この区間が今日より先だけか(実績がまだ無い)。 */
  future: boolean;
  /** 今日を含むか。 */
  today: boolean;
};

export type Series = {
  unit: ChartUnit;
  buckets: Bucket[];
  /**
   * 記録開始日。グラフの横軸はここから始まり、これより前の日は描かない(月をまたぐ履歴が
   * あるときは月の初日)。記録がまったく無いときは月の初日。
   */
  recordStart: DateOnly;
  /** 記録開始日が月の途中か(「9/21 記録開始」と添えるか)。月の初日から数えるときは false。 */
  recordStartInMonth: boolean;
  /**
   * 1日平均。「記録開始日 〜 今日(過去の月は月末)」の日数で割る(月の日数では割らない)。
   * 対象の日が無ければ null。
   */
  averageYen: number | null;
  /** 1日平均の対象期間(「9/21〜」と添える)。 */
  averageFrom: DateOnly | null;
  /** 平均の線(日=1日平均、週=×7、月は出さない)。無ければ null。 */
  averageLineYen: number | null;
  /** 目標期間中の、このカテゴリの1日の目安に相当する線(日=1日、週=×7)。無ければ null。 */
  allowanceYen: number | null;
  /** 前期間のデータがあるか(無いときは「前期間と比べる」を無効にする)。 */
  hasPrevious: boolean;
  /**
   * 縦軸の上限。表示するすべての値(棒・予定・前期間・平均・目安)を含み、切りのよい数に丸める。
   * どの要素も描画領域からはみ出さない。
   */
  maxYen: number;
  /** 横の補助線の位置(金額)。2本(半分と上限)。 */
  ticks: number[];
  /** 実績の合計(バケットの合計。カテゴリの使った額と一致する)。 */
  totalYen: number;
};

function fmtMd(d: DateOnly): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

function sumRange(
  lines: readonly CategoryLine[],
  from: DateOnly,
  to: DateOnly,
): { actualYen: number; scheduledYen: number; count: number } {
  let actualYen = 0;
  let scheduledYen = 0;
  let count = 0;
  for (const l of lines) {
    if (l.occurredOn < from || l.occurredOn > to) continue;
    if (l.status === 'scheduled') {
      if (l.amountYen < 0) scheduledYen += -l.amountYen;
      continue;
    }
    actualYen += -l.amountYen;
    if (l.amountYen < 0) count += 1;
  }
  return { actualYen, scheduledYen, count };
}

/** 選んだ月を単位で区切った区間(from〜to)の一覧。 */
export function bucketRanges(
  unit: ChartUnit,
  monthStart: DateOnly,
  monthEnd: DateOnly,
  historyMonths = 6,
): { from: DateOnly; to: DateOnly; label: string }[] {
  if (unit === 'day') {
    const days = daysBetween(monthStart, monthEnd) + 1;
    return Array.from({ length: days }, (_, i) => {
      const d = addDays(monthStart, i);
      return { from: d, to: d, label: fmtMd(d) };
    });
  }
  if (unit === 'week') {
    const out: { from: DateOnly; to: DateOnly; label: string }[] = [];
    let from = monthStart;
    while (from <= monthEnd) {
      const to = addDays(from, 6) > monthEnd ? monthEnd : addDays(from, 6);
      out.push({ from, to, label: `${fmtMd(from)}〜` });
      from = addDays(from, 7);
    }
    return out;
  }
  return Array.from({ length: historyMonths }, (_, k) => {
    const start = nthDayOfMonth(addMonths(monthStart, -(historyMonths - 1 - k)), 1);
    const end = addDays(nthDayOfMonth(addMonths(start, 1), 1), -1);
    return { from: start, to: end, label: `${Number(start.slice(5, 7))}月` };
  });
}

export function buildSeries(input: {
  /** 履歴を含む全部の行。 */
  lines: readonly CategoryLine[];
  unit: ChartUnit;
  monthStart: DateOnly;
  monthEnd: DateOnly;
  today: DateOnly;
  /** 目標期間中の1日の目安。 */
  dailyAllowanceYen: number | null;
  historyMonths?: number;
}): Series {
  const { unit, monthStart, monthEnd, today } = input;
  const ranges = bucketRanges(unit, monthStart, monthEnd, input.historyMonths);
  const prevMonthStart = nthDayOfMonth(addMonths(monthStart, -1), 1);
  const prevMonthEnd = addDays(monthStart, -1);
  const prevRanges =
    unit === 'month'
      ? ranges.map((r) => {
          const start = nthDayOfMonth(addMonths(r.from, -1), 1);
          return { from: start, to: addDays(r.from, -1) };
        })
      : bucketRanges(unit, prevMonthStart, prevMonthEnd).map((r) => ({ from: r.from, to: r.to }));

  const firstRecord = input.lines.reduce<DateOnly | null>(
    (min, l) =>
      l.status === 'actual' && (min === null || l.occurredOn < min) ? l.occurredOn : min,
    null,
  );
  const recordStart: DateOnly =
    firstRecord !== null && firstRecord > monthStart && firstRecord <= monthEnd
      ? firstRecord
      : monthStart;
  // 週・月の区間も、記録開始日より前の区間は描かない(月表示は履歴の最初の記録から)。
  const axisStart = unit === 'month' ? (firstRecord ?? monthStart) : recordStart;

  const hasPrevData = input.lines.some(
    (l) => l.occurredOn >= prevRanges[0]!.from && l.occurredOn <= prevRanges.at(-1)!.to,
  );

  const buckets: Bucket[] = ranges
    .map((r, originalIndex) => ({ r, originalIndex }))
    .filter(({ r }) => r.to >= axisStart)
    .map(({ r, originalIndex }, index) => {
      const cur = sumRange(input.lines, r.from, r.to);
      const p = prevRanges[originalIndex];
      return {
        index,
        from: r.from,
        to: r.to,
        label: r.label,
        actualYen: cur.actualYen,
        scheduledYen: cur.scheduledYen,
        count: cur.count,
        previousYen: p && hasPrevData ? sumRange(input.lines, p.from, p.to).actualYen : null,
        future: r.from > today,
        today: r.from <= today && today <= r.to,
      };
    });

  const totalYen = buckets.reduce((a, b) => a + b.actualYen, 0);
  const avgEnd = today < monthEnd ? today : monthEnd;
  const averageDays = avgEnd < recordStart ? 0 : daysBetween(recordStart, avgEnd) + 1;
  const averageYen =
    averageDays === 0
      ? null
      : Math.round(sumRange(input.lines, recordStart, avgEnd).actualYen / averageDays);
  const averageLineYen =
    averageYen === null || averageYen <= 0
      ? null
      : unit === 'day'
        ? averageYen
        : unit === 'week'
          ? averageYen * 7
          : null;
  const allowanceYen =
    input.dailyAllowanceYen === null || input.dailyAllowanceYen <= 0
      ? null
      : unit === 'day'
        ? input.dailyAllowanceYen
        : unit === 'week'
          ? input.dailyAllowanceYen * 7
          : null;
  const rawMax = Math.max(
    ...buckets.map((b) => Math.max(b.actualYen, 0) + b.scheduledYen),
    ...buckets.map((b) => b.previousYen ?? 0),
    averageLineYen ?? 0,
    allowanceYen ?? 0,
  );
  const maxYen = niceCeil(rawMax);
  return {
    unit,
    buckets,
    recordStart,
    recordStartInMonth: recordStart > monthStart,
    averageYen,
    averageFrom: averageYen === null ? null : recordStart,
    averageLineYen,
    allowanceYen,
    hasPrevious: hasPrevData,
    maxYen,
    ticks: [maxYen / 2, maxYen],
    totalYen,
  };
}

/**
 * 縦軸の上限:値を含む、切りのよい数(1・2・2.5・5 ×10のべき乗)。値が0でも 1,000 は確保する
 * (目盛りが「0」だけの軸にしない)。
 */
export function niceCeil(value: number): number {
  const v = Math.max(value, 1000);
  const scale = Math.pow(10, Math.floor(Math.log10(v)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * scale >= v) return step * scale;
  }
  return 10 * scale;
}

/** 棒の高さの割合(0〜1)。 */
export function barRatio(yen: number, maxYen: number): number {
  if (maxYen <= 0 || yen <= 0) return 0;
  return Math.min(yen / maxYen, 1);
}

/** 指の位置(x、0〜width)から、なぞっている区間の番号。範囲外は端に丸める。 */
export function indexAtX(x: number, width: number, bucketCount: number): number {
  if (bucketCount <= 0 || width <= 0) return 0;
  const i = Math.floor((x / width) * bucketCount);
  return Math.min(Math.max(i, 0), bucketCount - 1);
}

/** 吹き出し(なぞっている区間の日付・金額・件数)。 */
export function bucketTooltip(b: Bucket, unit: ChartUnit): string {
  const yen = `${Math.abs(b.actualYen).toLocaleString('ja-JP')}円`;
  const range =
    unit === 'day'
      ? `${fmtMd(b.from)}(${'日月火水木金土'[new Date(`${b.from}T00:00:00Z`).getUTCDay()]})`
      : unit === 'week'
        ? `${fmtMd(b.from)}〜${fmtMd(b.to)}`
        : b.label;
  const sched = b.scheduledYen > 0 ? `・予定 ${b.scheduledYen.toLocaleString('ja-JP')}円` : '';
  return `${range} ${b.actualYen < 0 ? '返金 ' : ''}${yen} ${b.count}件${sched}`;
}

/**
 * グラフの要約(VoiceOver 向け)。例:「9月の外食、日別。最大は9月27日の2,830円。合計12,279円、平均534円」
 */
export function summarizeSeries(series: Series, genreName: string, monthLabel: string): string {
  const unitLabel = { day: '日別', week: '週別', month: '月別' }[series.unit];
  const actual = series.buckets.filter((b) => !b.future && b.actualYen > 0);
  if (actual.length === 0) return `${monthLabel}の${genreName}、${unitLabel}。支出はありません。`;
  const top = actual.reduce((a, b) => (b.actualYen > a.actualYen ? b : a));
  const where =
    series.unit === 'day'
      ? `${Number(top.from.slice(5, 7))}月${Number(top.from.slice(8, 10))}日`
      : series.unit === 'week'
        ? `${fmtMd(top.from)}からの週`
        : top.label;
  const avg =
    series.averageYen === null
      ? ''
      : `、1日平均${series.averageYen.toLocaleString('ja-JP')}円(${fmtMd(series.averageFrom ?? series.recordStart)}から)`;
  const sched = series.buckets.reduce((a, b) => a + b.scheduledYen, 0);
  return `${monthLabel}の${genreName}、${unitLabel}。最大は${where}の${top.actualYen.toLocaleString('ja-JP')}円。合計${series.totalYen.toLocaleString('ja-JP')}円${avg}${sched > 0 ? `。予定${sched.toLocaleString('ja-JP')}円` : ''}`;
}

// ---- 音でグラフの形を聞く(Web Audio) --------------------------------------------------

export type AudioNote = { startMs: number; durationMs: number; frequencyHz: number };

const AUDIO_LOW_HZ = 220;
const AUDIO_HIGH_HZ = 880;
export const AUDIO_NOTE_MS = 140;

/** 値が大きいほど高い音(220〜880Hz、対数)で、区間を順に鳴らす計画。0以下は最低音。 */
export function audioGraphPlan(values: readonly number[]): AudioNote[] {
  const max = Math.max(...values, 1);
  return values.map((v, i) => {
    const t = Math.min(Math.max(v, 0) / max, 1);
    return {
      startMs: i * AUDIO_NOTE_MS,
      durationMs: AUDIO_NOTE_MS - 20,
      frequencyHz: Math.round(AUDIO_LOW_HZ * Math.pow(AUDIO_HIGH_HZ / AUDIO_LOW_HZ, t)),
    };
  });
}
