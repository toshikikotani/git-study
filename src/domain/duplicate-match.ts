/**
 * 複数経路から入った同じ買い物の検知(本人発案)。
 *
 * ── 何が問題か ──────────────────────────────────────────────
 * 取り込み経路は CSV(FR-10)・メール通知(ADR-018)・レシート撮影(ADR-021)
 * の3つあるが、重複排除は `transactions.fingerprint`
 * (口座|日付|金額|摘要を正規化)一本しかない。同じ1回の買い物でも
 *
 *   レシート: 「セブン-イレブン渋谷1丁目店」(画像から読んだ店名)
 *   メール  : 「ｾﾌﾞﾝｲﾚﾌﾞﾝ」(カード利用通知の表記)
 *
 * のように摘要が一致しないため fingerprint が別物になり、二重計上される。
 * 口座も別になりうる(レシートは本人が画面で選ぶ / メールは
 * GMAIL_IMPORT_ACCOUNT_ID 固定)ため、fingerprint では原理的に拾えない。
 *
 * ── どう見つけるか ──────────────────────────────────────────
 * 摘要と口座は当てにできないので、**金額の一致**と**日付の近さ**、そして
 * **取り込み経路が違うこと**の3つで候補を出す。同じ経路どうしの同額は
 * 「同じ店で2回買った」の方が起こりやすいため候補にしない——これが
 * 誤検知を抑える一番効く条件。
 *
 * 判定するのはここまでで、どちらを残すかは決めない(同じ買い物かどうかの
 * 最終判断は本人にしかできない)。呼び出し側は候補を見せて、本人が選んだ
 * 片方を review_status='ignored' にする。
 */

import { isCountable, type BudgetTransaction } from '@/domain/budget';
import { daysBetween, type DateOnly } from '@/lib/date';

export type TransactionSource = 'csv' | 'gmail' | 'manual' | 'api';

export type MatchableTransaction = BudgetTransaction & {
  id: string;
  occurredOn: DateOnly;
  source: TransactionSource;
};

/** これ以上日付が離れていたら別の買い物とみなす既定値。 */
export const MAX_DAY_GAP = 3;

export type DuplicateCandidate<T extends MatchableTransaction> = {
  /** 日付が早い方(同日なら id の小さい方)。 */
  earlier: T;
  later: T;
  /** 2件の日付の差(日)。 */
  dayGap: number;
};

/**
 * 同じ買い物の可能性があるペアを返す(新しい順)。
 *
 * 1件が複数の候補に現れると本人が判断しにくいため、1件につき1ペアまでに
 * 絞る(日付の早い方から順に、まだペアになっていない相手を1つだけ選ぶ)。
 */
export function findDuplicateCandidates<T extends MatchableTransaction>(
  transactions: readonly T[],
  options: { maxDayGap?: number } = {},
): DuplicateCandidate<T>[] {
  const maxDayGap = options.maxDayGap ?? MAX_DAY_GAP;

  const targets = transactions
    .filter((tx) => isCountable(tx) && tx.amountYen < 0)
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id));

  const paired = new Set<string>();
  const candidates: DuplicateCandidate<T>[] = [];

  for (let i = 0; i < targets.length; i += 1) {
    const earlier = targets[i]!;
    if (paired.has(earlier.id)) continue;

    for (let j = i + 1; j < targets.length; j += 1) {
      const later = targets[j]!;

      // 日付順に並んでいるので、ここを超えたら以降も離れる一方。
      const dayGap = daysBetween(earlier.occurredOn, later.occurredOn);
      if (dayGap > maxDayGap) break;

      if (paired.has(later.id)) continue;
      if (later.amountYen !== earlier.amountYen) continue;
      // 取り込み経路が同じなら「同じ店で2回買った」の方が起こりやすい。
      if (later.source === earlier.source) continue;

      paired.add(earlier.id);
      paired.add(later.id);
      candidates.push({ earlier, later, dayGap });
      break;
    }
  }

  return candidates.reverse();
}
