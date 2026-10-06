/**
 * カテゴリのペース(目安・理想)の計算(純粋関数)。全カテゴリ合計の目安ではなく、
 * そのカテゴリの予算から出す。
 */

import { addDays, addMonths, daysBetween, nthDayOfMonth, type DateOnly } from '@/lib/date';
import type { CategoryLine } from './model';
import { niceCeil } from './series';

/**
 * 目標期間中の、このカテゴリの1日の目安。
 *   (カテゴリの予算 − カテゴリの予定支出 − 昨日までのカテゴリの実績)÷ 残り日数(今日を含む)
 * 例:予算 5,300円、予定・実績なし、残り8日 → 約663円。
 * 使い切っている・超えているときは 0円(負にしない)。目標が始まる前は期間全体で割る。
 * 目標期間が終わっている・予算が無いときは null。
 */
export function categoryAllowanceYen(input: {
  budgetYen: number | null;
  /** カテゴリの予定の支出(今日より先)。 */
  scheduledYen: number;
  lines: readonly CategoryLine[];
  goalRange: { from: DateOnly; to: DateOnly };
  today: DateOnly;
}): number | null {
  if (input.budgetYen === null) return null;
  const { goalRange, today } = input;
  if (today > goalRange.to) return null;
  const start = today < goalRange.from ? goalRange.from : today;
  const remaining = daysBetween(start, goalRange.to) + 1;
  let actualBeforeToday = 0;
  for (const l of input.lines) {
    if (l.status !== 'actual') continue;
    if (l.occurredOn < goalRange.from || l.occurredOn >= today) continue;
    actualBeforeToday += -l.amountYen;
  }
  const left = input.budgetYen - input.scheduledYen - actualBeforeToday;
  return Math.max(0, Math.round(left / remaining));
}

/**
 * 目標と照らすときの行。予定(今日より先)は目標の期間内のものだけ残す。
 * 期間の外の予定は、目標の予算から引かず、累計・予測の段差にも載せない。
 * 実績は日付に関わらず残す(目標が始まる前の実績は、累計の起点に使う)。
 */
export function linesForGoal(
  lines: readonly CategoryLine[],
  goalRange: { from: DateOnly; to: DateOnly },
): CategoryLine[] {
  return lines.filter(
    (l) =>
      l.status !== 'scheduled' || (l.occurredOn >= goalRange.from && l.occurredOn <= goalRange.to),
  );
}

/** 表示中の期間(from〜to)が目標期間と重なるか。 */
export function goalOverlaps(
  goalRange: { from: DateOnly; to: DateOnly },
  from: DateOnly,
  to: DateOnly,
): boolean {
  return goalRange.from <= to && goalRange.to >= from;
}

// ---- 累計の線(累計モード)---------------------------------------------------------------

/** 予測の帯の幅(確率予測が無いときの近似。直近の日平均の ±20%)。 */
export const FORECAST_BAND = 0.2;

export type CumulativeDay = {
  date: DateOnly;
  /** 横軸の位置(0が記録開始日)。 */
  index: number;
  /** 実際の累計。今日より先は null。 */
  actualYen: number | null;
  /** 理想ペースの累計。無ければ null。 */
  idealYen: number | null;
  /** この日の予定の支出(白抜きの段差)。 */
  scheduledYen: number;
  /** 予測(今日より先)。日平均の延長+予定。 */
  forecastYen: number | null;
  forecastLowYen: number | null;
  forecastHighYen: number | null;
  /** 予測の濃い帯(10回中5回。日ごとの分位があるときだけ)。 */
  forecastInnerLowYen: number | null;
  forecastInnerHighYen: number | null;
};

export type CumulativeChart = {
  days: CumulativeDay[];
  /** 理想ペースの出どころ。'budget'=目標期間中のカテゴリの予算、'previous'=前月の累計。 */
  idealKind: 'budget' | 'previous' | null;
  /** 線の先端の日(今日。過去の月は月末)の番号。無ければ null(未来の月)。 */
  endIndex: number | null;
  /** 実際の累計 − 理想(先端の日)。正=理想より多い。理想が無ければ null。 */
  deltaYen: number | null;
  /** 予測の帯を出すか(今月だけ)。 */
  hasForecast: boolean;
  /** 縦軸の上限(すべての線・帯を含む切りのよい数)と補助線。 */
  maxYen: number;
  ticks: number[];
  recordStart: DateOnly;
  recordStartInMonth: boolean;
};

export type RemainingForecast = {
  /** 残りの期間の支出(予定を除く)の、下振れ・中央・上振れ(10%・50%・90%)。 */
  lowYen: number;
  medianYen: number;
  highYen: number;
  /**
   * 今日より先の各日までに、今日の実績へ足される額(予定・固定費・請求を含む)の分位。
   * あれば、線と帯はこの値で描く(日数に比例させる近似をしない)。
   */
  path?: readonly {
    date: DateOnly;
    lowYen: number;
    medianYen: number;
    highYen: number;
    /** 濃い帯(25%・75%)。 */
    innerLowYen?: number;
    innerHighYen?: number;
  }[];
  /**
   * 理想の線の形(各日までに決まっている支払いの累計と、いつもの使い方での変動費の累計の割合)。
   * あれば、目標の理想の線を「決まっている支払い + 残りの予算 × いつもの割合」で引く。
   */
  profile?: readonly { date: DateOnly; committedYen: number; share: number }[];
};

/**
 * 「変えられる支出だけ」のグラフ(設計書 v3 3.4)のために、決まった支出のジャンルの予定を、
 * 予測の日ごとの分位から引く(決まった支出のジャンルは、予定のほかに見込みを持たない)。
 * 理想の形(profile)は全部の予定で作っているので外す(均等に配る理想になる)。
 */
export function withoutScheduled(
  remaining: RemainingForecast,
  scheduled: readonly CategoryLine[],
): RemainingForecast {
  const byDate = new Map<DateOnly, number>();
  for (const l of scheduled) {
    if (l.status !== 'scheduled' || l.amountYen >= 0) continue;
    byDate.set(l.occurredOn, (byDate.get(l.occurredOn) ?? 0) - l.amountYen);
  }
  let cum = 0;
  const minus = (v: number | undefined) => (v === undefined ? undefined : Math.max(0, v - cum));
  const path = remaining.path?.map((p) => {
    cum += byDate.get(p.date) ?? 0;
    const out = {
      date: p.date,
      lowYen: Math.max(0, p.lowYen - cum),
      medianYen: Math.max(0, p.medianYen - cum),
      highYen: Math.max(0, p.highYen - cum),
    };
    const innerLowYen = minus(p.innerLowYen);
    const innerHighYen = minus(p.innerHighYen);
    return {
      ...out,
      ...(innerLowYen !== undefined ? { innerLowYen } : {}),
      ...(innerHighYen !== undefined ? { innerHighYen } : {}),
    };
  });
  // 合計の low・median・high はもともと予定を含まないので、そのまま使う。
  return {
    lowYen: remaining.lowYen,
    medianYen: remaining.medianYen,
    highYen: remaining.highYen,
    ...(path ? { path } : {}),
  };
}

/** 「理想より○円少ない / 多い」。 */
export function idealDeltaLabel(deltaYen: number): string {
  if (deltaYen === 0) return '理想どおり';
  const yen = `${Math.abs(deltaYen).toLocaleString('ja-JP')}円`;
  return deltaYen < 0 ? `理想より${yen}少ない` : `理想より${yen}多い`;
}

function sumActual(lines: readonly CategoryLine[], from: DateOnly, to: DateOnly): number {
  let yen = 0;
  for (const l of lines) {
    if (l.status !== 'actual' || l.occurredOn < from || l.occurredOn > to) continue;
    yen += -l.amountYen;
  }
  return yen;
}

/**
 * 累計の線の系列。
 *  - 実線:月の初めからの支出の累計(返品・返金は差し引く)。横軸は記録開始日から。
 *  - 理想:目標期間中は、目標が始まる前日までの実績を起点に、カテゴリの予算を目標の日数で
 *    均等に割った線。目標がなければ、前月の同カテゴリの合計を月の日数で均等に割った線。
 *    前月もなければ無し。
 *  - 予測(今月だけ):今日の累計から、記録開始日以降の日平均で延ばし、±20%の帯を付ける。
 *    予定の支出はその日に上乗せする(白抜きの段差)。
 */
export function buildCumulative(input: {
  lines: readonly CategoryLine[];
  monthStart: DateOnly;
  monthEnd: DateOnly;
  today: DateOnly;
  recordStart: DateOnly;
  goal: { range: { from: DateOnly; to: DateOnly }; budgetYen: number } | null;
  holdForecast?: boolean;
  /**
   * 確率予測(domain/forecast)が出した、残りの期間の支出(予定を除く)。10回中8回の下限・中央・上限。
   * 渡すと、予測の線と帯はこの値で描く(日平均の延長はしない)。渡さなければ、これまでどおり
   * 記録開始日以降の日平均で延ばす(確率予測を作れない画面・未分類だけ)。
   */
  remaining?: RemainingForecast | null;
}): CumulativeChart {
  const { lines, monthStart, monthEnd, today, recordStart } = input;
  const dayCount = daysBetween(recordStart, monthEnd) + 1;
  const monthDays = daysBetween(monthStart, monthEnd) + 1;
  const isThisMonth = today >= monthStart && today <= monthEnd;
  const lastActual = today < monthEnd ? today : monthEnd; // 線の先端の日
  const started = lastActual >= recordStart;

  // 日ごとの実績・予定
  const actualByDay = new Map<DateOnly, number>();
  const scheduledByDay = new Map<DateOnly, number>();
  for (const l of lines) {
    if (l.occurredOn < monthStart || l.occurredOn > monthEnd) continue;
    if (l.status === 'scheduled') {
      if (l.amountYen < 0)
        scheduledByDay.set(l.occurredOn, (scheduledByDay.get(l.occurredOn) ?? 0) - l.amountYen);
      continue;
    }
    actualByDay.set(l.occurredOn, (actualByDay.get(l.occurredOn) ?? 0) - l.amountYen);
  }

  // 理想ペース
  const prevStart = addDays(monthStart, -1);
  const prevMonthFrom = nthDayOfMonth(addMonths(monthStart, -1), 1);
  const prevTotal = sumActual(lines, prevMonthFrom, prevStart);
  const prevHasData = lines.some(
    (l) => l.status === 'actual' && l.occurredOn >= prevMonthFrom && l.occurredOn <= prevStart,
  );
  const goal =
    input.goal && goalOverlaps(input.goal.range, monthStart, monthEnd) ? input.goal : null;
  const idealKind: CumulativeChart['idealKind'] = goal
    ? 'budget'
    : prevHasData && prevTotal > 0
      ? 'previous'
      : null;

  let running = 0;
  const cumAt = new Map<DateOnly, number>();
  for (let i = 0; i < monthDays; i += 1) {
    const d = addDays(monthStart, i);
    running += actualByDay.get(d) ?? 0;
    cumAt.set(d, running);
  }
  const cumBefore = (d: DateOnly): number => {
    // d の前日までの累計(月初より前は0、今日より先は今日の累計)
    const prev = addDays(d, -1);
    if (prev < monthStart) return 0;
    const capped = prev > lastActual ? lastActual : prev;
    return cumAt.get(capped) ?? 0;
  };

  const perDay =
    input.holdForecast || !started || !isThisMonth
      ? 0
      : (cumAt.get(lastActual) ?? 0) / (daysBetween(recordStart, lastActual) + 1);
  const hasForecast = isThisMonth && started && today < monthEnd;
  // 確率予測が渡されたら、残りの期間にその額を、日数に比例して足していく(帯は日数の平方根で広げる)。
  const futureDayCount = hasForecast ? daysBetween(lastActual, monthEnd) : 0;
  const rem = input.remaining ?? null;

  // 日ごとの分位があれば、それで描く(予定・固定費の段差も入っている)。
  const pathByDate =
    rem?.path && rem.path.length > 0 ? new Map(rem.path.map((p) => [p.date, p])) : null;
  let lastPath: NonNullable<RemainingForecast['path']>[number] | undefined;
  // 理想の形は、予測の期間が目標の期間と同じときだけ使う(形は予測の期間で割合を出しているため)。
  const profile =
    rem?.profile &&
    input.goal &&
    rem.profile[0]?.date === input.goal.range.from &&
    rem.profile.at(-1)?.date === input.goal.range.to
      ? rem.profile
      : null;
  const profileByDate = profile ? new Map(profile.map((p) => [p.date, p])) : null;
  const profileEnd = profile?.at(-1);

  let scheduledCum = 0;
  const days: CumulativeDay[] = [];
  for (let i = 0; i < dayCount; i += 1) {
    const date = addDays(recordStart, i);
    const future = date > lastActual;
    scheduledCum += scheduledByDay.get(date) ?? 0;
    const k = hasForecast && future ? daysBetween(lastActual, date) : 0;
    const base = cumAt.get(lastActual) ?? 0;
    const frac = futureDayCount > 0 ? k / futureDayCount : 0;
    const spread = Math.sqrt(frac);
    const point = pathByDate?.get(date);
    if (point) lastPath = point;
    const innerAt = (band: 'innerLowYen' | 'innerHighYen') => {
      const v = pathByDate !== null ? lastPath?.[band] : undefined;
      return hasForecast && future && v !== undefined ? Math.round(base + v) : null;
    };
    const forecastAt = (band: 'lowYen' | 'medianYen' | 'highYen') =>
      rem === null
        ? null
        : pathByDate !== null
          ? Math.round(base + (lastPath?.[band] ?? 0))
          : Math.round(
              base + rem.medianYen * frac + (rem[band] - rem.medianYen) * spread + scheduledCum,
            );
    let ideal: number | null = null;
    if (idealKind === 'budget' && goal) {
      if (date >= goal.range.from && date <= goal.range.to) {
        const startBase = cumBefore(goal.range.from);
        const goalDays = daysBetween(goal.range.from, goal.range.to) + 1;
        const shape = profileByDate?.get(date);
        // いつもの使い方の形があれば、決まっている支払いの日に段差を付け、残りの予算をいつもの
        // 割合で配る(休日や給料日のあとに多い人は、その日に理想の線も上がる)。無ければ均等に配る。
        ideal =
          shape && profileEnd
            ? startBase +
              shape.committedYen +
              Math.max(0, goal.budgetYen - profileEnd.committedYen) * shape.share
            : startBase + (goal.budgetYen * (daysBetween(goal.range.from, date) + 1)) / goalDays;
      }
    } else if (idealKind === 'previous') {
      ideal = (prevTotal * (daysBetween(monthStart, date) + 1)) / monthDays;
    }
    days.push({
      date,
      index: i,
      actualYen: future ? null : (cumAt.get(date) ?? 0),
      idealYen: ideal === null ? null : Math.round(ideal),
      scheduledYen: scheduledByDay.get(date) ?? 0,
      forecastYen:
        hasForecast && future
          ? rem !== null
            ? forecastAt('medianYen')
            : Math.round(base + perDay * k + scheduledCum)
          : null,
      forecastLowYen:
        hasForecast && future
          ? rem !== null
            ? forecastAt('lowYen')
            : Math.round(base + perDay * (1 - FORECAST_BAND) * k + scheduledCum)
          : null,
      forecastHighYen:
        hasForecast && future
          ? rem !== null
            ? forecastAt('highYen')
            : Math.round(base + perDay * (1 + FORECAST_BAND) * k + scheduledCum)
          : null,
      forecastInnerLowYen: innerAt('innerLowYen'),
      forecastInnerHighYen: innerAt('innerHighYen'),
    });
  }

  const end = started ? days.find((d) => d.date === lastActual) : undefined;
  const endIndex = end ? end.index : null;
  const deltaYen =
    end && end.idealYen !== null && end.actualYen !== null ? end.actualYen - end.idealYen : null;
  const rawMax = Math.max(
    0,
    ...days.map((d) => Math.max(d.actualYen ?? 0, d.idealYen ?? 0, d.forecastHighYen ?? 0)),
  );
  const cap = goal?.budgetYen && goal.budgetYen > 0 ? goal.budgetYen : null;
  const maxYen = cap !== null ? cap : niceCeil(rawMax);
  return {
    days,
    idealKind,
    endIndex,
    deltaYen,
    hasForecast,
    maxYen,
    ticks: [maxYen / 2, maxYen],
    recordStart,
    recordStartInMonth: recordStart > monthStart,
  };
}

/** 累計モードの吹き出し(なぞっている日の日付・その日の金額・累計)。 */
export function cumulativeTooltip(
  chart: CumulativeChart,
  index: number,
  dayYen: number,
): string | null {
  const d = chart.days[index];
  if (!d || d.actualYen === null) return null;
  const md = `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`;
  const wd = '日月火水木金土'[new Date(`${d.date}T00:00:00Z`).getUTCDay()];
  return `${md}(${wd}) ${dayYen < 0 ? '返金 ' : ''}${Math.abs(dayYen).toLocaleString('ja-JP')}円 ・ 累計 ${d.actualYen.toLocaleString('ja-JP')}円`;
}
