/**
 * 入力の遅れ。使った日と、家計簿に記録した日(created_at)の差から、「使った日から j 日後までに
 * 記録される割合」D(j) を求める。月の途中の予測では、直近の日ほどまだ記録されていない支出が
 * 残っているので、その分を足す(D(0)=0.6 なら、今日使った分の4割はまだ入っていない)。
 *
 * 45日より遅い記録は、あとからまとめて入れた過去の記録(取り込み直しなど)とみなして数えない。
 * 遅れを観測しきれるよう、使った日が今日の45日以上前の明細だけで数える。
 */

import { daysBetween, type DateOnly } from '@/lib/date';

export const MAX_LAG_DAYS = 45;
const MIN_RECORDS = 20;

export function entryLagProfile(
  records: readonly { occurredOn: DateOnly; createdOn?: DateOnly | undefined }[],
  today: DateOnly,
): readonly number[] | null {
  const counts = new Array<number>(MAX_LAG_DAYS + 1).fill(0);
  let total = 0;
  for (const r of records) {
    if (r.createdOn === undefined || r.createdOn > today) continue;
    if (daysBetween(r.occurredOn, today) < MAX_LAG_DAYS) continue;
    const lag = daysBetween(r.occurredOn, r.createdOn);
    if (lag < 0 || lag > MAX_LAG_DAYS) continue;
    counts[lag]! += 1;
    total += 1;
  }
  if (total < MIN_RECORDS) return null;
  const profile: number[] = [];
  let running = 0;
  for (const c of counts) {
    running += c;
    profile.push(running / total);
  }
  return profile;
}

/** j 日前に使った支出が、今日までに記録されている割合。遅れのデータが無ければ1。 */
export function recordedShare(profile: readonly number[] | null, lagDays: number): number {
  if (profile === null || lagDays >= MAX_LAG_DAYS) return 1;
  return profile[Math.max(0, lagDays)] ?? 1;
}

/**
 * 検証で「その時点で知り得た明細」か。記録した日が asOf 以前なら知っていた。ただし45日より
 * 遅い記録は、あとからまとめて入れた過去の記録とみなし、使った日が asOf 以前なら知っていた扱い
 * (取り込み直す前の時点を再現できないため)。記録日時が無ければ使った日で判断する。
 */
export function knownAt(
  t: { occurredOn: DateOnly; createdOn?: DateOnly | undefined },
  asOf: DateOnly,
): boolean {
  if (t.createdOn === undefined) return t.occurredOn <= asOf;
  const lag = daysBetween(t.occurredOn, t.createdOn);
  if (lag > MAX_LAG_DAYS) return t.occurredOn <= asOf;
  return t.createdOn <= asOf;
}
