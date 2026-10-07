/**
 * はじめての設定(新しく登録した人の最初の画面、ADR-084)。
 *
 * 新しい人には明細も過去の目標も無いので、目標の画面(/plan)の「AIの案」は根拠が無い。
 * そこで最初だけ、手取りから目安の額を出して、よく使うジャンルの目標を今日から立てる。
 * 目安は手取りに対する割合(本人がその場で直す前提の、たたき台)。
 */

/** 最初に目標を立てるジャンルと、手取り(月)に対する目安の割合。 */
export const STARTER_GENRES: readonly { name: string; shareOfTakeHome: number }[] = [
  { name: '食料品', shareOfTakeHome: 0.12 },
  { name: '外食', shareOfTakeHome: 0.05 },
  { name: '日用品', shareOfTakeHome: 0.03 },
  { name: '娯楽・趣味', shareOfTakeHome: 0.05 },
];

/** 目安の額の丸め(500円単位)。 */
const ROUND_YEN = 500;

/** 1か月を何日とみなすか(期間の長さに合わせて目安を割り戻す)。 */
const DAYS_PER_MONTH = 30;

/** 手取り(月)と期間の日数から、ジャンルの目安の額を出す(500円単位、0円以上)。 */
export function starterTargetYen(
  takeHomeYen: number,
  shareOfTakeHome: number,
  periodDays: number,
): number {
  if (takeHomeYen <= 0 || periodDays <= 0) return 0;
  const raw = (takeHomeYen * shareOfTakeHome * periodDays) / DAYS_PER_MONTH;
  return Math.max(0, Math.round(raw / ROUND_YEN) * ROUND_YEN);
}

/**
 * はじめての設定を出すか。目標を一度も立てておらず、「あとで」を選んでいない人だけ
 * (目標を立てて使っている人には出さない)。明細があっても出す:登録してすぐ明細を入れた人も、
 * 目標が無いままでは何を基準に使えばいいかわからないため。
 */
export function needsOnboarding(state: { hasPlan: boolean; skipped: boolean }): boolean {
  return !state.hasPlan && !state.skipped;
}
