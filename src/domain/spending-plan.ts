/**
 * 期間つきの支出目標(本人発案、ADR-058)の純粋な判断。DBにもネットワークにも
 * 触れない。AIには「どのジャンルを、なぜ、どれだけ削るか」の判断だけを任せ、
 * 削る幅の上限(徐々に改善する歯止め)・必須支出は削らない・目標を
 * 過去実績より増やさない、はここで機械的に守る。
 */

import { daysBetween, type DateOnly } from '@/lib/date';
import {
  elapsedDays as elapsedDaysOf,
  periodDays,
  remainingDays as remainingDaysOf,
} from '@/domain/period';

/** 提案・丸めの単位(円)。目標は100円単位にそろえる。 */
export const PLAN_ROUNDING_YEN = 100;

/** 改善の強さの選択肢(%)。1回の目標で、削れる部分をどこまで削るかの上限。 */
export const PLAN_STEP_OPTIONS = [5, 10, 20] as const;

/** 期間の日数(開始日・終了日を含む)。 */
export function planPeriodDays(start: DateOnly, end: DateOnly): number {
  return periodDays(start, end);
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

/** 線形の外挿(このペースが続くと…)を出すのに必要な経過日数。これ未満は理想ペースとの差だけを見せる。 */
export const MIN_DAYS_FOR_PROJECTION = 3;

/** 予定の支出がジャンルの目標のこの割合以上なら、そのジャンルは「予定で確保済み」。 */
export const RESERVED_RATIO = 0.8;

export type GuidanceStatus =
  | 'not_started'
  | 'on_track'
  | 'watch'
  | 'over_pace'
  | 'over'
  | 'ended'
  /** 目標が0円・未設定のジャンル。状態も一言も出さない(「順調です」「1日0円まで」を出さない)。 */
  | 'no_budget'
  /** 予定の支出で、目標のほぼ全額が確保済み。「余裕」とは扱わない。 */
  | 'reserved';

export type GenreGuidance = {
  genreId: string;
  genreName: string;
  targetYen: number;
  spentYen: number;
  /** 目標 − 実績(予定は引かない)。 */
  remainingYen: number;
  /** このジャンルの予定の支出(今日より先)。 */
  scheduledYen: number;
  /** 自由に使える残り = 目標 − 予定 − 実績(マイナスは 0 として見せる側で丸める)。 */
  freeYen: number;
  /** 今日時点の理想ライン((目標 − 予定)を期間で均等に使った額)。 */
  idealYen: number;
  /** このペースが続いた場合の期間末の支出見込み。経過が短いとき・予算なしは null。 */
  projectedYen: number | null;
  /** 見込み(+予定)が目標を超える額(超えなければ0)。 */
  projectedOverYen: number;
  /** 残りの日数(今日を含む)で使えるのは1日あたりこの額まで(残りが無い・予算なしは null)。 */
  dailyAllowanceYen: number | null;
  /** ここまでの1日あたりの支出。 */
  dailyPaceYen: number;
  status: GuidanceStatus;
  /** 数字だけで作った、次の行動の一言。予算なしは空文字。 */
  message: string;
};

export type PlanGuidance = {
  status: GuidanceStatus;
  elapsedDays: number;
  totalDays: number;
  /** 残り日数(今日を含む、domain/period.ts)。 */
  remainingDays: number;
  /** 目標のあるジャンルの合計(総予算)。 */
  targetYen: number;
  /** 総額の実績:目標のあるジャンルの実績 + 未分類の実績(特別費・予定を除く)。 */
  spentYen: number;
  /** 期間内の予定の支出(今日より先)。総予算から差し引く。 */
  scheduledYen: number;
  /** 総予算 − 予定 − 実績(マイナスなら予算超過の見込み)。 */
  freeYen: number;
  /** 今日時点の理想ライン((総予算 − 予定)を期間で均等に使った額)。 */
  expectedByTodayYen: number;
  /** 理想ペースとの差(実績 − 理想。正なら使いすぎ)。 */
  paceDiffYen: number;
  /** 線形の見込みを出してよいか(経過3日以上)。 */
  showProjection: boolean;
  /**
   * 1日の目安 = (総予算 − 予定 − 昨日までの実績)÷ 残り日数(今日を含む)。
   * 残り日数が無ければ null。
   */
  dailyAllowanceYen: number | null;
  /** 今日あと使える額 = 1日の目安 − 今日の実績(下限0)。 */
  todayAllowanceYen: number | null;
  /** 今日すでに使った額(未分類を含む)。 */
  todaySpentYen: number;
  projectedYen: number | null;
  /** 特別費(目標のペースに含めない)の実績。 */
  specialYen: number;
  /** 未分類の実績(総額に含めるが、ジャンル別には含めない)。 */
  uncategorizedYen: number;
  headline: string;
  genres: GenreGuidance[];
  /** 要対応のジャンルの一言。上位2件だけ(下の一覧との重複を避ける)。 */
  actions: string[];
};

const yen = (value: number) => `${Math.round(value).toLocaleString('ja-JP')}円`;

/**
 * 目標に向けて行動できているかの行動指針(本人発案)。AIは使わず、期間・目標・
 * 実績の数字だけから、ペース・期間末の見込み・1日あたりの使える額を出す。
 * 超過は叱らず、数字と次の一手だけを示す。
 *
 * 計算式(全画面で同じ):
 *   1日の目安     = (総予算 − 予定支出 − 昨日までの実績)÷ 残り日数(今日を含む)
 *   今日あと使える額 = 1日の目安 − 今日の実績
 * 予定の支出(今日より先の日付)は、まだ使っていなくても予算から差し引く。
 * 未分類の支出は総額の実績に含める(ジャンル別には含めない)。
 *
 *   - 目標が0円のジャンルは「予算なし」:状態も一言も出さず、合計にも入れない
 *   - 予定でジャンルの目標のほぼ全額が確保されていれば「予定で確保済み」(余裕にしない)
 *   - 経過が3日未満なら線形の見込みは出さず、理想ペースとの差を見せる
 *   - 特別費の実績はペースの実績から外し、specialYen として別に渡す
 */
export function planGuidance(input: {
  periodStart: DateOnly;
  periodEnd: DateOnly;
  today: DateOnly;
  items: readonly {
    genreId: string;
    genreName: string;
    targetYen: number;
    spentYen: number;
    /** 今日すでに使った額。 */
    todaySpentYen?: number;
    /** このジャンルの予定の支出。 */
    scheduledYen?: number;
  }[];
  /** 期間内の予定の支出の合計(ジャンルを問わない)。 */
  scheduledYen?: number;
  specialYen?: number;
  /** 未分類の実績と、うち今日の分。 */
  uncategorizedYen?: number;
  uncategorizedTodayYen?: number;
}): PlanGuidance {
  const { periodStart, periodEnd, today } = input;
  const totalDays = planPeriodDays(periodStart, periodEnd);
  const started = today >= periodStart;
  const ended = today > periodEnd;
  // 日数の数え方は domain/period.ts に統一(今日を含む。「残りN日」が画面で食い違わない)。
  const elapsedDays = elapsedDaysOf(periodStart, periodEnd, today);
  const remainingDays = remainingDaysOf(periodStart, periodEnd, today);
  const showProjection = !ended && elapsedDays >= MIN_DAYS_FOR_PROJECTION;

  const genres: GenreGuidance[] = input.items.map((item) => {
    const hasBudget = item.targetYen > 0;
    const scheduledYen = item.scheduledYen ?? 0;
    const remainingYen = item.targetYen - item.spentYen;
    const freeYen = item.targetYen - scheduledYen - item.spentYen;
    const dailyPaceYen = elapsedDays > 0 ? item.spentYen / elapsedDays : 0;
    const idealYen = Math.round(
      (Math.max(item.targetYen - scheduledYen, 0) * elapsedDays) / totalDays,
    );
    const projectedYen = !hasBudget
      ? null
      : ended
        ? item.spentYen
        : showProjection
          ? Math.round(dailyPaceYen * totalDays)
          : null;
    const projectedOverYen =
      projectedYen === null ? 0 : Math.max(projectedYen + scheduledYen - item.targetYen, 0);
    const dailyAllowanceYen =
      hasBudget && remainingDays > 0 && !ended
        ? Math.max(Math.floor(freeYen / remainingDays), 0)
        : null;

    let status: GuidanceStatus;
    if (!hasBudget) status = 'no_budget';
    else if (!started) status = 'not_started';
    else if (ended) status = item.spentYen > item.targetYen ? 'over' : 'ended';
    else if (remainingYen < 0) status = 'over';
    else if (freeYen < 0) status = 'over_pace';
    else if (scheduledYen > 0 && scheduledYen >= item.targetYen * RESERVED_RATIO)
      status = 'reserved';
    else if (!showProjection) status = item.spentYen > idealYen ? 'watch' : 'on_track';
    else if (projectedOverYen > 0) status = 'over_pace';
    else if ((projectedYen! + scheduledYen) / item.targetYen >= 0.9) status = 'watch';
    else status = 'on_track';

    return {
      genreId: item.genreId,
      genreName: item.genreName,
      targetYen: item.targetYen,
      spentYen: item.spentYen,
      remainingYen,
      scheduledYen,
      freeYen,
      idealYen,
      projectedYen,
      projectedOverYen,
      dailyAllowanceYen,
      dailyPaceYen: Math.round(dailyPaceYen),
      status,
      message:
        status === 'no_budget'
          ? ''
          : genreMessage(item.genreName, {
              status,
              remainingYen,
              freeYen,
              scheduledYen,
              remainingDays,
              dailyAllowanceYen,
              dailyPaceYen: Math.round(dailyPaceYen),
              projectedOverYen,
              paceDiffYen: item.spentYen - idealYen,
              showProjection,
            }),
    };
  });

  const budgeted = genres.filter((g) => g.status !== 'no_budget');
  const targetYen = budgeted.reduce((acc, g) => acc + g.targetYen, 0);
  const uncategorizedYen = input.uncategorizedYen ?? 0;
  // 総額の実績:目標のあるジャンル + 未分類(ジャンル別の行には未分類を入れない)。
  const spentYen = budgeted.reduce((acc, g) => acc + g.spentYen, 0) + uncategorizedYen;
  const todaySpentYen =
    input.items.filter((i) => i.targetYen > 0).reduce((acc, i) => acc + (i.todaySpentYen ?? 0), 0) +
    (input.uncategorizedTodayYen ?? 0);
  const scheduledYen = input.scheduledYen ?? 0;
  const freeYen = targetYen - scheduledYen - spentYen;
  const expectedByTodayYen = Math.round(
    (Math.max(targetYen - scheduledYen, 0) * elapsedDays) / totalDays,
  );
  const paceDiffYen = spentYen - expectedByTodayYen;
  const projectedYen = showProjection
    ? Math.round((spentYen / elapsedDays) * totalDays) + scheduledYen
    : ended
      ? spentYen
      : null;
  const canAllow = targetYen > 0 && remainingDays > 0 && !ended && started;
  const spentBeforeTodayYen = spentYen - todaySpentYen;
  const dailyAllowanceYen = canAllow
    ? Math.max(Math.floor((targetYen - scheduledYen - spentBeforeTodayYen) / remainingDays), 0)
    : null;
  const todayAllowanceYen =
    dailyAllowanceYen === null ? null : Math.max(dailyAllowanceYen - todaySpentYen, 0);

  let status: GuidanceStatus;
  if (targetYen <= 0) status = 'no_budget';
  else if (!started) status = 'not_started';
  else if (ended) status = spentYen > targetYen ? 'over' : 'ended';
  else if (targetYen - spentYen < 0) status = 'over';
  else if (freeYen < 0) status = 'over_pace';
  else if (!showProjection) status = paceDiffYen > 0 ? 'watch' : 'on_track';
  else if (projectedYen! > targetYen) status = 'over_pace';
  else if (projectedYen! / targetYen >= 0.9) status = 'watch';
  else status = 'on_track';

  const actions = budgeted
    .filter((g) => g.status === 'over' || g.status === 'over_pace')
    .sort((a, b) => b.projectedOverYen - a.projectedOverYen || a.freeYen - b.freeYen)
    .slice(0, 2)
    .map((g) => g.message);

  return {
    status,
    elapsedDays,
    totalDays,
    remainingDays,
    targetYen,
    spentYen,
    scheduledYen,
    freeYen,
    expectedByTodayYen,
    paceDiffYen,
    showProjection,
    dailyAllowanceYen,
    todayAllowanceYen,
    todaySpentYen,
    projectedYen,
    specialYen: input.specialYen ?? 0,
    uncategorizedYen,
    headline: headlineMessage({
      status,
      spentYen,
      expectedByTodayYen,
      paceDiffYen,
      showProjection,
      freeYen,
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

export type ForecastTone = 'ok' | 'caution' | 'over';

export type Forecast = {
  /** 事実 + 次にできること1つだけの一文(docs/WRITING.md)。数字には必ず単位・期間を添える。 */
  text: string;
  tone: ForecastTone;
  /** 文中で使った、内訳(details)と重複しうる金額。無ければ null(重複判定用)。 */
  amountYen: number | null;
};

/**
 * 「今日あと使える額」の下に出す、結果予想の一言(N5)。状態(余裕/注意/超過)に応じて
 * トーンを変え、必ず具体的な次の一手を1つ添える(叱らない)。予算なし・未開始は
 * 出す数字が無いため null。headlineMessage() は要約(SUMMARY)と同じ言葉で始まり画面の
 * 要約行と重なるため未使用のまま残し、これはこのカード専用に新設した(ADR-065 N5)。
 */
export function forecastLine(g: PlanGuidance): Forecast | null {
  const remaining = g.remainingDays;
  const daily = g.dailyAllowanceYen;
  switch (g.status) {
    case 'no_budget':
    case 'not_started':
      return null;
    case 'reserved':
      return {
        text: `予定${yen(g.scheduledYen)}で確保済みです。自由に使えるのは${yen(Math.max(g.freeYen, 0))}です`,
        tone: 'caution',
        amountYen: g.scheduledYen,
      };
    case 'ended':
      return g.spentYen > g.targetYen
        ? {
            text: `目標を${yen(g.spentYen - g.targetYen)}超えて終えました。次の目標では配分を見直しましょう`,
            tone: 'over',
            amountYen: null,
          }
        : null;
    case 'over': {
      const overYen = g.spentYen - g.targetYen;
      return remaining > 0
        ? {
            text: `目標を${yen(overYen)}超えています。残り${remaining}日はこれ以上増やさないのが目安です`,
            tone: 'over',
            amountYen: null,
          }
        : {
            text: `目標を${yen(overYen)}超えて終える見込みです。次の目標では配分を見直しましょう`,
            tone: 'over',
            amountYen: null,
          };
    }
    case 'over_pace': {
      if (g.freeYen < 0) {
        return {
          text: `予定を含めると目標を${yen(-g.freeYen)}超える見込みです。残り${remaining}日は新たな支出を控えめにしましょう`,
          tone: 'over',
          amountYen: null,
        };
      }
      const action =
        daily !== null
          ? `1日${yen(daily)}までに抑えると間に合います`
          : '新たな支出を控えめにしましょう';
      return g.projectedYen !== null
        ? {
            text: `このペースだと期間末に目標より${yen(g.projectedYen - g.targetYen)}多くなる見込みです。残り${remaining}日は${action}`,
            tone: 'caution',
            amountYen: daily,
          }
        : {
            text: `このペースだと目標を超えそうです。残り${remaining}日は${action}`,
            tone: 'caution',
            amountYen: daily,
          };
    }
    case 'watch': {
      const action =
        daily !== null ? `1日${yen(daily)}を目安に抑えましょう` : '新たな支出を控えめにしましょう';
      return {
        text: `目標に近づいています。残り${remaining}日は${action}`,
        tone: 'caution',
        amountYen: daily,
      };
    }
    case 'on_track': {
      const action = daily !== null ? `1日${yen(daily)}まで使えます` : '';
      return {
        text: `このペースなら目標内に収まりそうです。残り${remaining}日は${action}`,
        tone: 'ok',
        amountYen: daily,
      };
    }
  }
}

/** 理想ペースとの差を、符号ではなく言葉で表す。 */
export function paceDiffWords(paceDiffYen: number): string {
  if (paceDiffYen === 0) return '理想ペースどおりです';
  return paceDiffYen < 0 ? `理想より${yen(-paceDiffYen)}少ない` : `理想より${yen(paceDiffYen)}多い`;
}

function genreMessage(
  name: string,
  x: {
    status: GuidanceStatus;
    remainingYen: number;
    freeYen: number;
    scheduledYen: number;
    remainingDays: number;
    dailyAllowanceYen: number | null;
    dailyPaceYen: number;
    projectedOverYen: number;
    paceDiffYen: number;
    showProjection: boolean;
  },
): string {
  const allowance =
    x.dailyAllowanceYen === null
      ? ''
      : `残り${x.remainingDays}日は1日${yen(x.dailyAllowanceYen)}まで`;
  switch (x.status) {
    case 'no_budget':
      return '';
    case 'not_started':
      return `${name}: まだ始まっていません`;
    case 'ended':
      return `${name}: 目標内で終えました`;
    case 'reserved':
      return `${name}: 予定${yen(x.scheduledYen)}で確保済みです。自由に使える残りは${yen(Math.max(x.freeYen, 0))}`;
    case 'over':
      return x.remainingDays > 0
        ? `${name}: 目標を${yen(-x.remainingYen)}超えています。残り${x.remainingDays}日は、これ以上増やさない目安です`
        : `${name}: 目標を${yen(-x.remainingYen)}超えて終えました。次の目標で見直しましょう`;
    case 'over_pace':
      return x.freeYen < 0 && x.projectedOverYen === 0
        ? `${name}: 予定${yen(x.scheduledYen)}を含めると目標を${yen(-x.freeYen)}超える見込みです`
        : `${name}: このペースだと期間末に${yen(x.projectedOverYen)}超える見込みです。${allowance}(今は1日${yen(x.dailyPaceYen)})`;
    case 'watch':
      return x.showProjection
        ? `${name}: 目標に近づいています。${allowance}`
        : `${name}: ${paceDiffWords(x.paceDiffYen)}(今日時点)。${allowance}`;
    case 'on_track':
      return x.showProjection
        ? `${name}: 順調です。${allowance}使えます`
        : `${name}: 順調です。${paceDiffWords(x.paceDiffYen)}(今日時点)。${allowance}使えます`;
  }
}

function headlineMessage(x: {
  status: GuidanceStatus;
  spentYen: number;
  expectedByTodayYen: number;
  paceDiffYen: number;
  showProjection: boolean;
  freeYen: number;
  remainingDays: number;
  dailyAllowanceYen: number | null;
  projectedYen: number | null;
  targetYen: number;
  today: DateOnly;
  periodStart: DateOnly;
}): string {
  const allowance =
    x.dailyAllowanceYen === null
      ? ''
      : `残り${x.remainingDays}日は1日${yen(x.dailyAllowanceYen)}まで`;
  switch (x.status) {
    case 'no_budget':
      return '目標額が決まっているジャンルがありません';
    case 'reserved':
      return '予定で確保済みです';
    case 'not_started':
      return `${daysBetween(x.today, x.periodStart)}日後に始まります。全体で${yen(x.targetYen)}が目標です`;
    case 'ended':
      return `目標内(${yen(x.spentYen)} / ${yen(x.targetYen)})で終えました`;
    case 'over':
      return x.remainingDays > 0
        ? `全体で目標を${yen(x.spentYen - x.targetYen)}超えています。残り${x.remainingDays}日は支出を抑えたい状況です`
        : `全体で目標を${yen(x.spentYen - x.targetYen)}超えて終えました`;
    case 'over_pace':
      return x.freeYen < 0
        ? `予定を含めると、目標より${yen(-x.freeYen)}多くなる見込みです。${allowance}`
        : `今のペースだと期間末に${yen(x.projectedYen ?? 0)}(目標より${yen((x.projectedYen ?? 0) - x.targetYen)}多い)の見込みです。${allowance}`;
    case 'watch':
      return x.showProjection
        ? `目標に近づいています(見込み${yen(x.projectedYen ?? 0)})。${allowance}`
        : `${paceDiffWords(x.paceDiffYen)}(今日時点)。${allowance}`;
    case 'on_track':
      return x.showProjection
        ? `順調です。今日までの目安${yen(x.expectedByTodayYen)}に対して${yen(x.spentYen)}。${allowance}使えます`
        : `順調です。${paceDiffWords(x.paceDiffYen)}(今日時点)。${allowance}使えます`;
  }
}
