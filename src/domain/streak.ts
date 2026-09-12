/**
 * 連続確認日数の表示判断(FR-62)。
 *
 * 「途切れても責めず、再開だけを提示する」(設計原則3)。3日未満の
 * 継続はまだ祝うほどではないため出さず、かつては続いていた(3日以上の
 * 実績がある)のに今は途切れているときだけ、責めずに再開を促す。
 */

export type StreakBadge = { kind: 'none' } | { kind: 'active'; days: number } | { kind: 'restart' };

const CELEBRATE_FROM_DAYS = 3;

export function streakBadgeFor(streak: {
  currentStreakDays: number;
  longestStreakDays: number;
}): StreakBadge {
  if (streak.currentStreakDays >= CELEBRATE_FROM_DAYS) {
    return { kind: 'active', days: streak.currentStreakDays };
  }
  if (streak.longestStreakDays >= CELEBRATE_FROM_DAYS) {
    return { kind: 'restart' };
  }
  return { kind: 'none' };
}
