/**
 * 今日の上限を、休日を軸に残りの数字と確率から計算する。
 *
 * 手順:
 * 1. 過去の休日/平日の中央値から比率を出す
 * 2. 残り日数を比率で重み付けし、残り予算を配分する
 * 3. 確率が低いほど配分を絞る（安全側に倒す）
 * 4. 今日が休日なら休日の配分、平日なら平日の配分を今日の上限にする
 */

export type DailyLimitInput = {
  leftBudgetYen: number;
  remainingDayOffs: number;
  remainingWeekdays: number;
  dayOffMedianYen: number | null;
  weekdayMedianYen: number | null;
  /** 予算内に収まる確率(0〜1)。無ければ 1 として扱う。 */
  probWithinBudget: number | null;
  /** 今日が休日か */
  todayIsDayOff: boolean;
};

export type DailyLimitResult = {
  /** 今日の上限 */
  todayLimitYen: number;
  /** 平日の配分 */
  weekdayAllocYen: number;
  /** 休日の配分 */
  dayOffAllocYen: number;
  /** 休日/平日の比率 */
  ratio: number;
  /** 確率による絞り係数(0.5〜1) */
  safetyFactor: number;
  /** 今日が休日か */
  todayIsDayOff: boolean;
  /** 計算の各段階(表示用) */
  steps: string[];
};

export function computeDailyLimit(input: DailyLimitInput): DailyLimitResult {
  const {
    leftBudgetYen,
    remainingDayOffs,
    remainingWeekdays,
    dayOffMedianYen,
    weekdayMedianYen,
    probWithinBudget,
    todayIsDayOff,
  } = input;

  const steps: string[] = [];

  // 1. 比率
  const ratio =
    dayOffMedianYen != null && weekdayMedianYen != null && weekdayMedianYen > 0
      ? dayOffMedianYen / weekdayMedianYen
      : 1;
  steps.push(
    `休日/平日の比率 = ${dayOffMedianYen ?? '—'} ÷ ${weekdayMedianYen ?? '—'} = ${ratio.toFixed(2)}`,
  );

  // 2. 重み付き日数で残り予算を配分
  const weighted = remainingDayOffs * ratio + remainingWeekdays;
  const baseWeekday = weighted > 0 ? leftBudgetYen / weighted : 0;
  const baseDayOff = baseWeekday * ratio;
  steps.push(
    `重み付き日数 = 休日${remainingDayOffs} × ${ratio.toFixed(2)} + 平日${remainingWeekdays} = ${weighted.toFixed(1)}`,
  );
  steps.push(
    `配分 = 残り予算${leftBudgetYen.toLocaleString()} ÷ ${weighted.toFixed(1)} → 平日${Math.round(baseWeekday).toLocaleString()}円、休日${Math.round(baseDayOff).toLocaleString()}円`,
  );

  // 3. 確率で絞る。確率が低いほど係数を下げる(最低0.5)
  const prob = probWithinBudget ?? 1;
  const safetyFactor = 0.5 + prob * 0.5;
  steps.push(
    `確率による絞り = 0.5 + ${(prob * 100).toFixed(0)}% × 0.5 = ${safetyFactor.toFixed(2)}(普段の${Math.round(safetyFactor * 100)}%)`,
  );

  const weekdayAlloc = Math.round(baseWeekday * safetyFactor);
  const dayOffAlloc = Math.round(baseDayOff * safetyFactor);
  steps.push(
    `絞り後 = 平日${weekdayAlloc.toLocaleString()}円、休日${dayOffAlloc.toLocaleString()}円`,
  );

  // 4. 今日の上限
  const todayLimit = todayIsDayOff ? dayOffAlloc : weekdayAlloc;
  steps.push(
    `今日は${todayIsDayOff ? '休日' : '平日'}なので、上限 = ${todayLimit.toLocaleString()}円`,
  );

  return {
    todayLimitYen: todayLimit,
    weekdayAllocYen: weekdayAlloc,
    dayOffAllocYen: dayOffAlloc,
    ratio,
    safetyFactor,
    todayIsDayOff,
    steps,
  };
}
