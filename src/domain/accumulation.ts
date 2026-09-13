/**
 * 「ちりつも」の集計(本人発案)。
 *
 * 既存の家計簿は「あと◯円使える」という **引き算** の見せ方をしている
 * (domain/budget.ts)。この機能はその逆で、1回では気にならない小さな支出が
 * どれだけの山になっているかを **掛け算**(回数・年換算)で見せるための集計。
 *
 * 何を支出として数えるかは domain/budget.ts の isCountable() に合わせる
 * (同じ「支出」の定義を2箇所で別々に決めない。domain/spending.ts と同じ方針)。
 *
 * 注意:分割(transaction_splits)は展開しない。ここでの集計軸は
 * 「どの店でいくら使ったか」であり、1回の買い物を複数カテゴリへ按分しても
 * 店から見た支払いは1回・1金額のままだから(カテゴリ軸の集計である
 * domain/spending.ts とは前提が違う)。
 */

import { isCountable, type BudgetTransaction } from '@/domain/budget';
import { addMonths, daysBetween, nthDayOfMonth, splitDateOnly, type DateOnly } from '@/lib/date';

export type AccumulationTransaction = BudgetTransaction & {
  occurredOn: DateOnly;
  /** 店名(無ければ摘要)。同じ店をまとめる単位。 */
  label: string;
};

/** これ未満を「小口」とみなす既定値。1回では気にならないが、回数で積もる額。 */
export const SMALL_SPEND_THRESHOLD_YEN = 1_000;

/** 1年の日数。年換算(annualizedPaceYen)の分子。うるう年は区別しない。 */
const DAYS_PER_YEAR = 365;

export type SmallSpendGroup = {
  label: string;
  count: number;
  /** 期間中の合計(正の数)。 */
  totalYen: number;
  /** 1回あたり(正の数、四捨五入)。 */
  averageYen: number;
};

/**
 * 小口支出を店ごとにまとめ、合計の大きい順に返す。
 *
 * 金額より **回数** が効く(「コンビニ37回」は「18,400円」より刺さる)ため、
 * count を必ず持たせる。店名の表記ゆれは空白除去 + 小文字化で吸収する
 * (domain/subscriptions.ts と同じ程度の正規化。表示は元の表記のまま)。
 */
export function summarizeSmallSpends(
  transactions: readonly AccumulationTransaction[],
  options: { thresholdYen?: number; limit?: number } = {},
): SmallSpendGroup[] {
  const threshold = options.thresholdYen ?? SMALL_SPEND_THRESHOLD_YEN;
  const groups = new Map<string, { label: string; count: number; totalYen: number }>();

  for (const tx of transactions) {
    if (!isCountable(tx) || tx.amountYen >= 0) continue;

    const spentYen = -tx.amountYen;
    if (spentYen >= threshold) continue;

    const label = tx.label.trim();
    if (label === '') continue;

    const key = normalizeLabel(label);
    const current = groups.get(key);
    groups.set(key, {
      label: current?.label ?? label,
      count: (current?.count ?? 0) + 1,
      totalYen: (current?.totalYen ?? 0) + spentYen,
    });
  }

  const result = [...groups.values()]
    .map((group) => ({ ...group, averageYen: Math.round(group.totalYen / group.count) }))
    .sort((a, b) => b.totalYen - a.totalYen);

  return options.limit === undefined ? result : result.slice(0, options.limit);
}

export type NoSpendSummary = {
  /** 期間の日数(両端を含む)。 */
  elapsedDays: number;
  spentDays: number;
  noSpendDays: number;
  /** 支出があった日の平均支出額(正の数)。使わなかった日は分母に入れない。 */
  averageSpendPerSpentDayYen: number;
  /** 無支出日数 × 平均。「使わなかったことで温存できた額」の目安。 */
  preservedYen: number;
};

/**
 * 使わなかった日の積み上げ(FR-62 のストリークと対になる「貯まる側」の見せ方)。
 *
 * 平均を「支出があった日」だけで割るのが肝。全日数で割ると無支出日が
 * 平均を押し下げ、「使わなかった価値」が自分で自分を小さく見せてしまう。
 */
export function summarizeNoSpendDays(
  transactions: readonly AccumulationTransaction[],
  period: { from: DateOnly; to: DateOnly },
): NoSpendSummary {
  const spentByDate = new Map<DateOnly, number>();

  for (const tx of transactions) {
    if (!isCountable(tx) || tx.amountYen >= 0) continue;
    if (tx.occurredOn < period.from || tx.occurredOn > period.to) continue;
    spentByDate.set(tx.occurredOn, (spentByDate.get(tx.occurredOn) ?? 0) - tx.amountYen);
  }

  const elapsedDays = Math.max(daysBetween(period.from, period.to) + 1, 0);
  const spentDays = spentByDate.size;
  const noSpendDays = Math.max(elapsedDays - spentDays, 0);
  const totalYen = [...spentByDate.values()].reduce((acc, yen) => acc + yen, 0);
  const averageSpendPerSpentDayYen = spentDays === 0 ? 0 : Math.round(totalYen / spentDays);

  return {
    elapsedDays,
    spentDays,
    noSpendDays,
    averageSpendPerSpentDayYen,
    preservedYen: noSpendDays * averageSpendPerSpentDayYen,
  };
}

export type PaceComparison = {
  /** 今日が月の何日目か。先月も同じ日数分だけを比べる。 */
  dayOfMonth: number;
  thisMonthToDateYen: number;
  lastMonthSameDayYen: number;
  /** 正なら今月の方が多い。 */
  differenceYen: number;
};

/**
 * 前月同日比(月末を待たずに差が見える)。
 *
 * 月初からの累計どうしを、同じ日数分だけ比べる。先月に同じ日が無い場合
 * (3/31 に対する2月)は月末に丸める(lib/date の nthDayOfMonth と同じ規約)。
 */
export function compareToPreviousMonthPace(
  transactions: readonly AccumulationTransaction[],
  today: DateOnly,
): PaceComparison {
  const [, , dayOfMonth] = splitDateOnly(today);
  const lastMonthSameDay = addMonths(today, -1);

  const thisMonthToDateYen = sumSpendWithin(transactions, nthDayOfMonth(today, 1), today);
  const lastMonthSameDayYen = sumSpendWithin(
    transactions,
    nthDayOfMonth(lastMonthSameDay, 1),
    lastMonthSameDay,
  );

  return {
    dayOfMonth,
    thisMonthToDateYen,
    lastMonthSameDayYen,
    differenceYen: thisMonthToDateYen - lastMonthSameDayYen,
  };
}

/**
 * 経過日数あたりのペースから年額を見積もる。
 *
 * 「今月の合計 × 12」にしないのは、月初にまだ数日しか経っていない時期に
 * 大きく過小評価してしまうため。1日あたりに均してから年換算する。
 */
export function annualizedPaceYen(spentYen: number, elapsedDays: number): number {
  if (elapsedDays <= 0) return 0;
  return Math.round((spentYen / elapsedDays) * DAYS_PER_YEAR);
}

function sumSpendWithin(
  transactions: readonly AccumulationTransaction[],
  from: DateOnly,
  to: DateOnly,
): number {
  let total = 0;
  for (const tx of transactions) {
    if (!isCountable(tx) || tx.amountYen >= 0) continue;
    if (tx.occurredOn < from || tx.occurredOn > to) continue;
    total -= tx.amountYen;
  }
  return total;
}

function normalizeLabel(label: string): string {
  return label.replace(/[\s　]/g, '').toLowerCase();
}
