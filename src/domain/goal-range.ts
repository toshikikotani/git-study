/**
 * 目標と照らした着地範囲。
 * 点予測は今日までのペース。範囲は完了月のばらつきを残り日数に広げた90%区間。
 * 軸の上限は目標の予算。予算を超える側だけを「超える範囲」とする。
 */

export type GoalRange = {
  targetYen: number;
  spentYen: number;
  idealYen: number;
  pointYen: number;
  lowYen: number;
  highYen: number;
  saveYen: number;
  overHigh: boolean;
};

export function goalLanding(input: {
  targetYen: number;
  spentYen: number;
  scheduledYen: number;
  elapsedDays: number;
  totalDays: number;
  history: readonly number[];
}): GoalRange | null {
  if (input.targetYen <= 0 || input.totalDays <= 0) return null;
  const elapsed = Math.max(1, Math.min(input.elapsedDays, input.totalDays));
  const idealYen = Math.round((input.targetYen * elapsed) / input.totalDays);
  const pace = input.elapsedDays >= 7 ? input.spentYen / elapsed : median(input.history) / 30;
  const pointYen = Math.round(pace * input.totalDays + input.scheduledYen);
  const sd = Math.max(sampleSd(input.history), pointYen * 0.1, 1);
  const remaining = Math.max(1, input.totalDays - elapsed);
  const margin = 1.645 * sd * Math.sqrt(remaining / 30);
  const lowYen = Math.max(0, Math.round(pointYen - margin));
  const highYen = Math.round(pointYen + margin);
  return {
    targetYen: input.targetYen,
    spentYen: input.spentYen,
    idealYen,
    pointYen,
    lowYen,
    highYen,
    saveYen: Math.max(0, pointYen - input.targetYen),
    overHigh: highYen > input.targetYen,
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
function sampleSd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, yen) => sum + yen, 0) / values.length;
  return Math.sqrt(values.reduce((sum, yen) => sum + (yen - mean) ** 2, 0) / (values.length - 1));
}
