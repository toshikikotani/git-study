/**
 * M1:予測の対象期間の支出を「実績・確定・変動・特別」に分ける。
 *
 * データは既存の統一集計と同じ明細(LedgerTransaction、loadLedgerTransactions()
 * で読む)をそのまま使う。振替・ignored・入力待ち・収入は対象外
 * (domain/budget.ts の isCountable() と同じ考え方)。
 */

import { addMonths, daysBetween, weekdayOf, type DateOnly } from '@/lib/date';
import { eachDay } from '@/domain/period';
import { comparableKey } from '@/domain/store-name';
import { subscriptionKeyOf, type DetectedSubscription } from '@/domain/subscriptions';
import { detectRegularMerchants, projectVisits, type VisitSourceTransaction } from './visits';
import type {
  CategoryBase,
  CategoryDayRecord,
  DecomposedSpending,
  MissingRecordDay,
  OutlierExclusion,
  VariableTrainingData,
} from './types';

export type ForecastSourceTransaction = {
  occurredOn: DateOnly;
  genreId: string | null;
  genreName: string | null;
  amountYen: number;
  status: 'actual' | 'scheduled';
  kind: 'normal' | 'special' | 'refund';
  isTransfer: boolean;
  reviewStatus: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
  needsInput: boolean;
  merchantName: string | null;
  description: string;
};

const UNCATEGORIZED_ID = 'none';
/** 外れ値判定に最低限必要な、そのカテゴリの明細件数(少なすぎると誤検出しやすい)。 */
const MIN_SAMPLES_FOR_OUTLIER = 20;
const OUTLIER_PERCENTILE = 0.99;
/** この割合以上の週で支出があるなら「普段は支出がある曜日」とみなす。 */
const USUAL_WEEKDAY_RATIO = 0.6;
const MIN_WEEKS_FOR_MISSING_CHECK = 4;

function isCountable(t: ForecastSourceTransaction): boolean {
  return (
    !t.isTransfer && t.reviewStatus !== 'ignored' && !t.needsInput && t.amountYen < 0 // 支出のみ(収入は対象外)
  );
}

/** 線形補間の分位点。全部同じ値(実質バラつき無し)なら、その値をそのまま返す
 *  ——外れ値の閾値が実際の最大値と一致してしまい、上位1%を「超える」ものが
 *  1件も無くなるはずの状況(タイの多いデータ)を正しく扱うため。 */
function percentile(sortedAbs: readonly number[], p: number): number {
  if (sortedAbs.length === 0) return Infinity;
  if (sortedAbs.length === 1) return sortedAbs[0]!;
  const idx = p * (sortedAbs.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAbs[lo]!;
  const frac = idx - lo;
  return sortedAbs[lo]! + frac * (sortedAbs[hi]! - sortedAbs[lo]!);
}

export function decomposeSpending(input: {
  transactions: readonly ForecastSourceTransaction[];
  period: { from: DateOnly; to: DateOnly };
  today: DateOnly;
  trainingFrom: DateOnly;
  /** 本人の最初の記録の日。null なら記録がまだ無い。 */
  recordStart: DateOnly | null;
  /** 固定費として確認済みの subscription_key(features/subscriptions/fixed-cost-store.ts)。 */
  confirmedFixedKeys: ReadonlySet<string>;
  /** detectSubscriptions() の検知結果(全期間)。確定分の見込み計算に使う。 */
  detectedSubscriptions: readonly DetectedSubscription[];
}): DecomposedSpending {
  const { period, today, trainingFrom, recordStart } = input;
  const trainingWindow = {
    from: recordStart !== null && recordStart > trainingFrom ? recordStart : trainingFrom,
    to: today,
  };
  const dataDays = Math.max(0, daysBetween(trainingWindow.from, trainingWindow.to) + 1);

  const countable = input.transactions.filter(isCountable);

  // 実績:期間内・今日までの通常支出。
  const actualYen = countable
    .filter(
      (t) =>
        t.kind === 'normal' &&
        t.status === 'actual' &&
        t.occurredOn >= period.from &&
        t.occurredOn <= period.to,
    )
    .reduce((sum, t) => sum + -t.amountYen, 0);

  // 確定:残り期間の予定支出(通常のみ。特別扱いの予定は special へ)。
  const scheduledYen = countable
    .filter(
      (t) =>
        t.kind === 'normal' &&
        t.status === 'scheduled' &&
        t.occurredOn > today &&
        t.occurredOn <= period.to,
    )
    .reduce((sum, t) => sum + -t.amountYen, 0);

  // 確定:残り期間に見込まれる固定費(確認済みのものだけ。~1ヶ月周期で見込む)。
  const fixedItems: { key: string; label: string; amountYen: number; occurrences: number }[] = [];
  let fixedYen = 0;
  for (const sub of input.detectedSubscriptions) {
    if (!input.confirmedFixedKeys.has(sub.key)) continue;
    let occurrences = 0;
    let expected = sub.nextExpectedOn;
    // 安全弁:無限ループを避けるため最大24回(2年分)で打ち切る。
    for (let i = 0; i < 24 && expected <= period.to; i += 1) {
      if (expected > today) occurrences += 1;
      expected = addMonths(expected, 1);
    }
    if (occurrences > 0) {
      fixedYen += sub.amountYen * occurrences;
      fixedItems.push({ key: sub.key, label: sub.label, amountYen: sub.amountYen, occurrences });
    }
  }
  const fixedKeySet = new Set(fixedItems.map((f) => f.key));
  const merchantKey = (t: ForecastSourceTransaction) =>
    comparableKey(t.merchantName ?? t.description);

  // 特別:special kind の実績・予定(期間内のみ)。
  const specialActualYen = countable
    .filter(
      (t) =>
        t.kind === 'special' &&
        t.status === 'actual' &&
        t.occurredOn >= period.from &&
        t.occurredOn <= period.to,
    )
    .reduce((sum, t) => sum + -t.amountYen, 0);
  const specialScheduledYen = countable
    .filter(
      (t) =>
        t.kind === 'special' &&
        t.status === 'scheduled' &&
        t.occurredOn >= period.from &&
        t.occurredOn <= period.to,
    )
    .reduce((sum, t) => sum + -t.amountYen, 0);

  // 変動費の学習対象の候補:通常・実績・確定済み固定費でないもの。学習窓全体から取る。
  const learnable = countable.filter((t) => {
    if (t.kind !== 'normal' || t.status !== 'actual') return false;
    if (t.occurredOn < trainingWindow.from || t.occurredOn > trainingWindow.to) return false;
    const key = subscriptionKeyOf(t.merchantName, t.description, t.amountYen);
    return !fixedKeySet.has(key);
  });

  // 規則的に通う店は、日ごとの確率で均さず、来店の日付と確率で別に扱う(R3)。
  const regularMerchants = detectRegularMerchants(
    learnable.map((t): VisitSourceTransaction => ({
      key: merchantKey(t),
      label: (t.merchantName ?? t.description).trim(),
      categoryId: t.genreId ?? UNCATEGORIZED_ID,
      categoryName: t.genreName ?? '未分類',
      occurredOn: t.occurredOn,
      amountYen: -t.amountYen,
    })),
  );
  const regularKeys = new Set(regularMerchants.map((m) => m.key));
  const visits = projectVisits({
    merchants: regularMerchants,
    today,
    periodTo: period.to,
    scheduled: countable
      .filter((t) => t.status === 'scheduled')
      .map((t) => ({ key: merchantKey(t), date: t.occurredOn })),
  }).filter((v) => v.date >= period.from);
  const variableSource = learnable.filter((t) => !regularKeys.has(merchantKey(t)));

  const byCategory = new Map<string, { name: string; txs: ForecastSourceTransaction[] }>();
  for (const t of variableSource) {
    const id = t.genreId ?? UNCATEGORIZED_ID;
    const name = t.genreName ?? '未分類';
    const bucket = byCategory.get(id) ?? { name, txs: [] };
    bucket.txs.push(t);
    byCategory.set(id, bucket);
  }

  const allDays = eachDay(trainingWindow.from, trainingWindow.to);
  const specialExcluded: OutlierExclusion[] = [];
  const variable: VariableTrainingData[] = [];
  const missingRecordDays: MissingRecordDay[] = [];

  for (const [categoryId, { name, txs }] of byCategory) {
    const amounts = txs.map((t) => -t.amountYen).sort((a, b) => a - b);
    const threshold =
      amounts.length >= MIN_SAMPLES_FOR_OUTLIER
        ? percentile(amounts, OUTLIER_PERCENTILE)
        : Infinity;

    const byDate = new Map<DateOnly, CategoryDayRecord>();
    for (const day of allDays) byDate.set(day, { date: day, count: 0, amountYen: 0 });

    for (const t of txs) {
      const amountYen = -t.amountYen;
      if (amountYen > threshold) {
        specialExcluded.push({
          categoryId,
          categoryName: name,
          occurredOn: t.occurredOn,
          amountYen,
        });
        continue;
      }
      const rec = byDate.get(t.occurredOn);
      if (rec === undefined) continue;
      rec.count += 1;
      rec.amountYen += amountYen;
    }

    variable.push({ categoryId, categoryName: name, days: [...byDate.values()] });

    // 記録漏れの可能性:直近のその曜日に、普段はあるはずの支出が無い。
    if (dataDays >= MIN_WEEKS_FOR_MISSING_CHECK * 7) {
      const byWeekday = new Map<number, CategoryDayRecord[]>();
      for (const rec of byDate.values()) {
        const wd = weekdayOf(rec.date);
        const list = byWeekday.get(wd) ?? [];
        list.push(rec);
        byWeekday.set(wd, list);
      }
      for (const [wd, recs] of byWeekday) {
        if (recs.length < MIN_WEEKS_FOR_MISSING_CHECK) continue;
        const activeRatio = recs.filter((r) => r.count > 0).length / recs.length;
        if (activeRatio < USUAL_WEEKDAY_RATIO) continue;
        const mostRecent = [...recs].sort((a, b) => b.date.localeCompare(a.date))[0]!;
        if (mostRecent.count === 0 && mostRecent.date <= today) {
          missingRecordDays.push({
            date: mostRecent.date,
            weekday: wd,
            categoryId,
            categoryName: name,
          });
        }
      }
    }
  }

  // 特別費の再標本化の母集団:学習窓内の special kind 実績 + 外れ値として除外した候補。
  const specialFromKind = countable
    .filter(
      (t) => t.kind === 'special' && t.status === 'actual' && t.occurredOn >= trainingWindow.from,
    )
    .map((t) => -t.amountYen);
  const specialHistoricalAmounts = [...specialFromKind, ...specialExcluded.map((e) => e.amountYen)];
  const specialOccurrencesPerDay = dataDays > 0 ? specialHistoricalAmounts.length / dataDays : 0;

  // カテゴリごとの、すでに決まっている額。固定費は、同じ店の明細のジャンルに寄せる。
  const baseMap = new Map<string, CategoryBase>();
  const baseOf = (id: string, name: string): CategoryBase => {
    const found = baseMap.get(id) ?? {
      categoryId: id,
      categoryName: name,
      actualYen: 0,
      scheduledYen: 0,
      fixedYen: 0,
    };
    baseMap.set(id, found);
    return found;
  };
  for (const t of countable) {
    if (t.kind !== 'normal' || t.occurredOn < period.from || t.occurredOn > period.to) continue;
    const base = baseOf(t.genreId ?? UNCATEGORIZED_ID, t.genreName ?? '未分類');
    if (t.status === 'actual') base.actualYen += -t.amountYen;
    else if (t.occurredOn > today) base.scheduledYen += -t.amountYen;
  }
  for (const item of fixedItems) {
    const match = countable.find(
      (t) => subscriptionKeyOf(t.merchantName, t.description, t.amountYen) === item.key,
    );
    const base = baseOf(match?.genreId ?? UNCATEGORIZED_ID, match?.genreName ?? '未分類');
    base.fixedYen += item.amountYen * item.occurrences;
  }

  return {
    trainingWindow,
    period,
    today,
    actualYen,
    committed: { scheduledYen, fixedYen, fixedItems },
    special: {
      actualYen: specialActualYen,
      scheduledYen: specialScheduledYen,
      excluded: specialExcluded,
      historicalAmounts: specialHistoricalAmounts,
      occurrencesPerDay: specialOccurrencesPerDay,
    },
    variable,
    baseByCategory: [...baseMap.values()],
    regularMerchants,
    visits,
    missingRecordDays,
    dataDays,
  };
}
