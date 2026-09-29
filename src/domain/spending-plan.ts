/**
 * 期間つきの支出目標(本人発案、ADR-058)の純粋な判断。DBにもネットワークにも
 * 触れない。AIには「どのジャンルを、なぜ、どれだけ削るか」の判断だけを任せ、
 * 削る幅の上限(徐々に改善する歯止め)・必須支出は削らない・目標を
 * 過去実績より増やさない、はここで機械的に守る。
 */

import { daysBetween, type DateOnly } from '@/lib/date';

/** 提案・丸めの単位(円)。目標は100円単位にそろえる。 */
export const PLAN_ROUNDING_YEN = 100;

/** 改善の強さの選択肢(%)。1回の目標で、削れる部分をどこまで削るかの上限。 */
export const PLAN_STEP_OPTIONS = [5, 10, 20] as const;

/** 期間の日数(開始日・終了日を含む)。 */
export function planPeriodDays(start: DateOnly, end: DateOnly): number {
  return daysBetween(start, end) + 1;
}

/** 過去の実績から期間ぶんの目安額を出す(1日あたりの平均 × 期間の日数)。 */
export function baselineForPeriod(
  spentYen: number,
  lookbackDays: number,
  periodDays: number,
): number {
  if (lookbackDays <= 0 || spentYen <= 0) return 0;
  return Math.round((spentYen / lookbackDays) * periodDays);
}

export type PlanGenreFacts = {
  /** 過去実績から出した、この期間の目安額(削る前の水準)。 */
  baselineYen: number;
  /** 過去実績のうち「絶対払わざるを得ない」ラベルの割合(0〜1)。 */
  mustPayShare: number;
  /** 課題のあるジャンルか(予算超過・増加傾向・浪費判定が多い等)。 */
  isIssue: boolean;
};

function roundToUnit(yen: number, direction: 'nearest' | 'up' = 'nearest'): number {
  const q = yen / PLAN_ROUNDING_YEN;
  return (direction === 'up' ? Math.ceil(q) : Math.round(q)) * PLAN_ROUNDING_YEN;
}

/** 削れる額の上限。必須ラベルの部分は削らない。 */
function maxCutYen(facts: PlanGenreFacts, stepPercent: number): number {
  const discretionary = facts.baselineYen * (1 - clamp01(facts.mustPayShare));
  return Math.floor((discretionary * stepPercent) / 100);
}

/**
 * AIを使えないとき(APIキー無し・失敗)の決め打ち提案。課題のあるジャンルだけ
 * 削れる部分を stepPercent だけ削り、他は現状維持にする。
 */
export function fallbackTarget(facts: PlanGenreFacts, stepPercent: number): number {
  if (facts.baselineYen <= 0) return 0;
  const cut = facts.isIssue ? maxCutYen(facts, stepPercent) : 0;
  return clampAiTarget(facts.baselineYen - cut, facts, stepPercent);
}

/**
 * AIが返した目標額を範囲に収める。
 *   上限: 過去実績(目標を実績より増やさない)
 *   下限: 実績から「削れる部分 × stepPercent」まで(いきなり大きく削らない)
 */
export function clampAiTarget(
  aiTargetYen: number,
  facts: PlanGenreFacts,
  stepPercent: number,
): number {
  if (facts.baselineYen <= 0) return 0;
  const floor = facts.baselineYen - maxCutYen(facts, stepPercent);
  const clamped = Math.min(Math.max(aiTargetYen, floor), facts.baselineYen);
  // 100円単位に丸めても範囲を出ないようにする(上限・下限はそのまま採る)。
  const rounded = roundToUnit(clamped);
  return Math.min(Math.max(rounded, roundToUnit(floor, 'up')), roundToUnit(facts.baselineYen));
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export type PlanProgressTone = 'normal' | 'attention' | 'over';

export type PlanProgress = {
  spentYen: number;
  targetYen: number;
  remainingYen: number;
  /** 使用率。目標が0円なら null。 */
  ratio: number | null;
  tone: PlanProgressTone;
};

/** 目標に対する進み具合。超過は常に見せる(叱らず見せる)。 */
export function planProgress(spentYen: number, targetYen: number): PlanProgress {
  const remainingYen = targetYen - spentYen;
  const ratio = targetYen > 0 ? spentYen / targetYen : null;
  const tone: PlanProgressTone =
    remainingYen < 0 ? 'over' : ratio !== null && ratio >= 0.7 ? 'attention' : 'normal';
  return { spentYen, targetYen, remainingYen, ratio, tone };
}

/**
 * 期間選択カレンダーのタップで、選択範囲がどう変わるか。
 * 1回目=開始日、2回目=終了日。開始日より前をタップしたら開始日を選び直す。
 * 選び終わった後のタップは、その日から選び直す。
 */
export function nextPlanRange(
  current: { start: DateOnly | null; end: DateOnly | null },
  tapped: DateOnly,
): { start: DateOnly | null; end: DateOnly | null } {
  const { start, end } = current;
  if (start === null || end !== null || tapped < start) return { start: tapped, end: null };
  return { start, end: tapped };
}

/**
 * 配分の合計を、指定した総額にそろえる(本人発案「目標の金額は固定の上、
 * カテゴリごとの金額を調整したい」、ADR-058)。差額を weights の比率で
 * 100円単位に配り、100円未満の端数は weights が最大のジャンルに載せる。
 * 減らす場合は各ジャンルを0円未満にしない(足りなければ残りのジャンルへ回す)。
 * weights を省くと現在の金額の比率。すべて0なら均等に配る。
 */
export function rebalanceToTotal(
  amounts: readonly number[],
  totalYen: number,
  weights?: readonly number[],
): number[] {
  const result = [...amounts];
  if (result.length === 0) return result;

  let diff = totalYen - result.reduce((acc, yen) => acc + yen, 0);
  if (diff === 0) return result;

  const base = weights ?? amounts;
  const w = base.some((x) => x > 0) ? base.map((x) => Math.max(x, 0)) : base.map(() => 1);
  const direction = diff > 0 ? 1 : -1;

  // 100円単位の塊を、重みの比率が大きい順(最大剰余法)に1つずつ配る。
  // 減らす側は、そのジャンルの残高(0円まで)を超えて引かない。
  let units = Math.floor(Math.abs(diff) / PLAN_ROUNDING_YEN);
  const totalWeight = w.reduce((acc, x) => acc + x, 0);
  const capacity = (i: number) =>
    direction > 0 ? Number.POSITIVE_INFINITY : Math.floor(result[i]! / PLAN_ROUNDING_YEN);
  // 小数部分(最大剰余法)が大きい順、同じなら重みが大きい順、それも同じなら先頭側。
  const order = w
    .map((weight, i) => ({ i, weight, share: (weight / totalWeight) * units }))
    .sort(
      (a, b) =>
        b.share - Math.floor(b.share) - (a.share - Math.floor(a.share)) ||
        b.weight - a.weight ||
        a.i - b.i,
    );

  // まず整数部分を配る。
  for (const { i, share } of order) {
    const give = Math.min(Math.floor(share), capacity(i), units);
    result[i]! += direction * give * PLAN_ROUNDING_YEN;
    units -= give;
  }
  // 余りの塊を、まだ余裕のあるジャンルへ重みの大きい順に1つずつ。
  while (units > 0) {
    let progressed = false;
    for (const { i } of order) {
      if (units === 0) break;
      const room = direction > 0 ? 1 : Math.floor(result[i]! / PLAN_ROUNDING_YEN);
      if (room > 0) {
        result[i]! += direction * PLAN_ROUNDING_YEN;
        units -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  // 100円未満の端数(や、100円単位で引ききれなかった分)。増やす側は重みが最大の
  // ジャンルへ、減らす側は0円を割らないよう、重みの大きい順に引けるだけ引く。
  diff = totalYen - result.reduce((acc, yen) => acc + yen, 0);
  if (diff > 0) {
    result[order[0]!.i]! += diff;
  } else {
    for (const { i } of order) {
      if (diff === 0) break;
      const take = Math.min(result[i]!, -diff);
      result[i]! -= take;
      diff += take;
    }
  }
  return result;
}

export type GuidanceStatus = 'not_started' | 'on_track' | 'watch' | 'over_pace' | 'over' | 'ended';

export type GenreGuidance = {
  genreId: string;
  genreName: string;
  targetYen: number;
  spentYen: number;
  remainingYen: number;
  /** このペースが続いた場合の期間末の支出見込み。 */
  projectedYen: number;
  /** 見込みが目標を超える額(超えなければ0)。 */
  projectedOverYen: number;
  /** 残りの日数で使えるのは1日あたりこの額まで(残りが無ければ null)。 */
  dailyAllowanceYen: number | null;
  /** ここまでの1日あたりの支出。 */
  dailyPaceYen: number;
  status: GuidanceStatus;
  /** 数字だけで作った、次の行動の一言。 */
  message: string;
};

export type PlanGuidance = {
  status: GuidanceStatus;
  elapsedDays: number;
  totalDays: number;
  remainingDays: number;
  targetYen: number;
  spentYen: number;
  /** 今日までの目安額(目標を期間で均等に使った場合)。 */
  expectedByTodayYen: number;
  dailyAllowanceYen: number | null;
  projectedYen: number;
  headline: string;
  genres: GenreGuidance[];
  /** 見込み超過の大きい順に、行動が要るジャンルの一言(最大3件)。 */
  actions: string[];
};

const yen = (value: number) => `${Math.round(value).toLocaleString('ja-JP')}円`;

/**
 * 目標に向けて行動できているかの行動指針(本人発案)。AIは使わず、期間・目標・
 * 実績の数字だけから、ペース・期間末の見込み・1日あたりの使える額を出す。
 * 超過は叱らず、数字と次の一手だけを示す。
 */
export function planGuidance(input: {
  periodStart: DateOnly;
  periodEnd: DateOnly;
  today: DateOnly;
  items: readonly { genreId: string; genreName: string; targetYen: number; spentYen: number }[];
}): PlanGuidance {
  const { periodStart, periodEnd, today } = input;
  const totalDays = planPeriodDays(periodStart, periodEnd);
  const started = today >= periodStart;
  const ended = today > periodEnd;
  const elapsedDays = !started ? 0 : ended ? totalDays : planPeriodDays(periodStart, today);
  const remainingDays = totalDays - elapsedDays;

  const genres: GenreGuidance[] = input.items.map((item) => {
    const remainingYen = item.targetYen - item.spentYen;
    const dailyPaceYen = elapsedDays > 0 ? item.spentYen / elapsedDays : 0;
    const projectedYen = ended
      ? item.spentYen
      : elapsedDays > 0
        ? Math.round(dailyPaceYen * totalDays)
        : item.spentYen;
    const projectedOverYen = Math.max(projectedYen - item.targetYen, 0);
    const dailyAllowanceYen =
      remainingDays > 0 ? Math.max(Math.floor(remainingYen / remainingDays), 0) : null;

    let status: GuidanceStatus;
    if (!started) status = 'not_started';
    else if (ended) status = item.spentYen > item.targetYen ? 'over' : 'ended';
    else if (remainingYen < 0) status = 'over';
    else if (projectedOverYen > 0) status = 'over_pace';
    else if (item.targetYen > 0 && projectedYen / item.targetYen >= 0.9) status = 'watch';
    else status = 'on_track';

    return {
      genreId: item.genreId,
      genreName: item.genreName,
      targetYen: item.targetYen,
      spentYen: item.spentYen,
      remainingYen,
      projectedYen,
      projectedOverYen,
      dailyAllowanceYen,
      dailyPaceYen: Math.round(dailyPaceYen),
      status,
      message: genreMessage(item.genreName, {
        status,
        remainingYen,
        remainingDays,
        dailyAllowanceYen,
        dailyPaceYen: Math.round(dailyPaceYen),
        projectedOverYen,
      }),
    };
  });

  const targetYen = genres.reduce((acc, g) => acc + g.targetYen, 0);
  const spentYen = genres.reduce((acc, g) => acc + g.spentYen, 0);
  const projectedYen = genres.reduce((acc, g) => acc + g.projectedYen, 0);
  const remainingYen = targetYen - spentYen;
  const expectedByTodayYen = Math.round((targetYen * elapsedDays) / totalDays);
  const dailyAllowanceYen =
    remainingDays > 0 ? Math.max(Math.floor(remainingYen / remainingDays), 0) : null;

  let status: GuidanceStatus;
  if (!started) status = 'not_started';
  else if (ended) status = spentYen > targetYen ? 'over' : 'ended';
  else if (remainingYen < 0) status = 'over';
  else if (projectedYen > targetYen) status = 'over_pace';
  else if (targetYen > 0 && projectedYen / targetYen >= 0.9) status = 'watch';
  else status = 'on_track';

  const actions = genres
    .filter((g) => g.status === 'over' || g.status === 'over_pace')
    .sort((a, b) => b.projectedOverYen - a.projectedOverYen || a.remainingYen - b.remainingYen)
    .slice(0, 3)
    .map((g) => g.message);

  return {
    status,
    elapsedDays,
    totalDays,
    remainingDays,
    targetYen,
    spentYen,
    expectedByTodayYen,
    dailyAllowanceYen,
    projectedYen,
    headline: headlineMessage({
      status,
      spentYen,
      expectedByTodayYen,
      remainingYen,
      remainingDays,
      dailyAllowanceYen,
      projectedYen,
      targetYen,
      today,
      periodStart,
    }),
    genres,
    actions,
  };
}

function genreMessage(
  name: string,
  x: {
    status: GuidanceStatus;
    remainingYen: number;
    remainingDays: number;
    dailyAllowanceYen: number | null;
    dailyPaceYen: number;
    projectedOverYen: number;
  },
): string {
  switch (x.status) {
    case 'not_started':
      return `${name}: まだ始まっていません`;
    case 'ended':
      return `${name}: 目標内で終えました`;
    case 'over':
      return x.remainingDays > 0
        ? `${name}: 目標を${yen(-x.remainingYen)}超えています。残り${x.remainingDays}日は、これ以上増やさない目安です`
        : `${name}: 目標を${yen(-x.remainingYen)}超えて終えました。次の目標で見直しましょう`;
    case 'over_pace':
      return `${name}: このペースだと期間末に${yen(x.projectedOverYen)}超える見込みです。残り${x.remainingDays}日は1日${yen(x.dailyAllowanceYen ?? 0)}まで(今は1日${yen(x.dailyPaceYen)})`;
    case 'watch':
      return `${name}: 目標に近づいています。残り${x.remainingDays}日は1日${yen(x.dailyAllowanceYen ?? 0)}まで`;
    case 'on_track':
      return `${name}: 順調です。残り${x.remainingDays}日は1日${yen(x.dailyAllowanceYen ?? 0)}まで使えます`;
  }
}

function headlineMessage(x: {
  status: GuidanceStatus;
  spentYen: number;
  expectedByTodayYen: number;
  remainingYen: number;
  remainingDays: number;
  dailyAllowanceYen: number | null;
  projectedYen: number;
  targetYen: number;
  today: DateOnly;
  periodStart: DateOnly;
}): string {
  switch (x.status) {
    case 'not_started':
      return `${daysBetween(x.today, x.periodStart)}日後に始まります。全体で${yen(x.targetYen)}が目標です`;
    case 'ended':
      return `目標内(${yen(x.spentYen)} / ${yen(x.targetYen)})で終えました`;
    case 'over':
      return x.remainingDays > 0
        ? `全体で目標を${yen(-x.remainingYen)}超えています。残り${x.remainingDays}日は支出を抑えたい状況です`
        : `全体で目標を${yen(-x.remainingYen)}超えて終えました`;
    case 'over_pace':
      return `今のペースだと期間末に${yen(x.projectedYen)}(目標より${yen(x.projectedYen - x.targetYen)}多い)の見込みです。残り${x.remainingDays}日は1日${yen(x.dailyAllowanceYen ?? 0)}まで`;
    case 'watch':
      return `目標に近づいています(見込み${yen(x.projectedYen)})。残り${x.remainingDays}日は1日${yen(x.dailyAllowanceYen ?? 0)}まで`;
    case 'on_track':
      return `順調です。今日までの目安${yen(x.expectedByTodayYen)}に対して${yen(x.spentYen)}。残り${x.remainingDays}日は1日${yen(x.dailyAllowanceYen ?? 0)}まで使えます`;
  }
}
