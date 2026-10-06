/**
 * 予測の対象期間の支出を「実績・確定・変動・請求・来店・特別」に分ける。
 *
 * データは家計簿と同じ明細を使う。振替・対象外は数えない。返品・返金(kind='refund')は
 * 家計簿と同じく、その日・そのジャンルの実績から差し引く(着地の数字を家計簿と合わせる)。
 */

import { addDays, addMonths, daysBetween, weekdayOf, type DateOnly } from '@/lib/date';
import { eachDay } from '@/domain/period';
import { comparableKey } from '@/domain/store-name';
import { subscriptionKeyOf, type DetectedSubscription } from '@/domain/subscriptions';
import { detectMonthlyBills, projectBills } from './bills';
import { entryLagProfile } from './lag';
import { classifySpending } from './spending-type';
import { detectRegularMerchants, projectVisits, type VisitSourceTransaction } from './visits';
import type {
  CategoryBase,
  CategoryDayRecord,
  DatedEvent,
  DecomposedSpending,
  MissingRecordDay,
  OutlierExclusion,
  PeriodObservation,
  SpendingType,
  VariableTrainingData,
} from './types';

export type ForecastSourceTransaction = {
  occurredOn: DateOnly;
  /** 家計簿に記録した日(JST)。入力の遅れと、検証で「その時点で知り得たか」に使う。 */
  createdOn?: DateOnly | undefined;
  genreId: string | null;
  genreName: string | null;
  amountYen: number;
  status: 'actual' | 'scheduled';
  kind: 'normal' | 'special' | 'refund';
  isTransfer: boolean;
  reviewStatus: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
  /** 入力待ち。金額が分かっていれば実績として数える(金額0は数えない)。 */
  needsInput: boolean;
  merchantName: string | null;
  description: string;
};

export const UNCATEGORIZED_ID = 'none';
/** 外れ値判定に最低限必要な、そのカテゴリの明細件数(少なすぎると誤検出しやすい)。 */
const MIN_SAMPLES_FOR_OUTLIER = 20;
const OUTLIER_PERCENTILE = 0.99;
/** この割合以上の週で支出があるなら「普段は支出がある曜日」とみなす。 */
const USUAL_WEEKDAY_RATIO = 0.6;
const MIN_WEEKS_FOR_MISSING_CHECK = 4;
/** 直近のペースを見る日数。 */
const RECENT_PACE_DAYS = 14;
/**
 * 期間の前の記録がこの日数以上あれば、変動費の率と金額は期間の前の記録だけで学び、期間に
 * 入ってからの記録は「今月の水準」の更新にだけ使う。短ければ期間の記録も学習に入れる。
 */
export const MIN_PRE_PERIOD_DAYS = 14;

function isCountable(t: ForecastSourceTransaction): boolean {
  return !t.isTransfer && t.reviewStatus !== 'ignored' && t.amountYen !== 0;
}

/** 支出として数える額(返金は負)。支出でも返金でもなければ null。 */
function spendOf(t: ForecastSourceTransaction): number | null {
  if (t.amountYen < 0) return -t.amountYen;
  if (t.kind === 'refund') return -t.amountYen;
  return null;
}

/** 線形補間の分位点。全部同じ値なら、その値をそのまま返す。 */
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

export function merchantKeyOf(t: Pick<ForecastSourceTransaction, 'merchantName' | 'description'>) {
  return comparableKey(t.merchantName ?? t.description);
}

export function decomposeSpending(input: {
  transactions: readonly ForecastSourceTransaction[];
  period: { from: DateOnly; to: DateOnly };
  today: DateOnly;
  trainingFrom: DateOnly;
  /** 本人の記録が続いている最初の日。null なら記録がまだ無い。 */
  recordStart: DateOnly | null;
  /** 固定費として確認済みの subscription_key。 */
  confirmedFixedKeys: ReadonlySet<string>;
  /** 「予測を止める」にしたジャンル。残りの期間の変動費を予測しない(実績・予定は数える)。 */
  noForecastGenreIds?: ReadonlySet<string> | undefined;
  /** detectSubscriptions() の検知結果(全期間)。確定分の見込み計算に使う。 */
  detectedSubscriptions: readonly DetectedSubscription[];
  /**
   * 期間に入ってからの記録を、学習から分けて「今月の水準」の更新に回すか。既定は true。
   * 期間の前の記録が MIN_PRE_PERIOD_DAYS 日に満たなければ、指定によらず分けない。
   */
  separatePeriod?: boolean | undefined;
}): DecomposedSpending {
  const { period, today, trainingFrom, recordStart } = input;
  const windowFrom =
    recordStart !== null && recordStart > trainingFrom ? recordStart : trainingFrom;
  const prePeriodDays = Math.max(0, daysBetween(windowFrom, period.from));
  const separatedPeriod =
    (input.separatePeriod ?? true) && today >= period.from && prePeriodDays >= MIN_PRE_PERIOD_DAYS;
  const trainingWindow = {
    from: windowFrom,
    to: separatedPeriod ? addDays(period.from, -1) : today,
  };
  const dataDays = Math.max(0, daysBetween(trainingWindow.from, trainingWindow.to) + 1);

  const countable = input.transactions.filter(isCountable);
  const inPeriod = (t: ForecastSourceTransaction) =>
    t.occurredOn >= period.from && t.occurredOn <= period.to;

  // 実績:期間内・今日までの支出(特別費を含み、返金は差し引く)。家計簿の「使った額」と同じ。
  // 確定:残り期間の予定支出(特別費も含む。日付が決まっているので変動しない)。
  const events: DatedEvent[] = [];
  let actualYen = 0;
  let scheduledYen = 0;
  let specialActualYen = 0;
  let specialScheduledYen = 0;
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
    if (!inPeriod(t)) continue;
    const yen = spendOf(t);
    if (yen === null) continue;
    const categoryId = t.genreId ?? UNCATEGORIZED_ID;
    const base = baseOf(categoryId, t.genreName ?? '未分類');
    if (t.status === 'actual' && t.occurredOn <= today) {
      actualYen += yen;
      base.actualYen += yen;
      if (t.kind === 'special') specialActualYen += yen;
    } else if (t.occurredOn > today && yen > 0) {
      scheduledYen += yen;
      base.scheduledYen += yen;
      if (t.kind === 'special') specialScheduledYen += yen;
      events.push({ date: t.occurredOn, categoryId, amountYen: yen });
    }
  }

  // 確定:残り期間に見込まれる固定費(確認済みのものだけ。~1ヶ月周期で見込む)。
  const fixedItems: { key: string; label: string; amountYen: number; occurrences: number }[] = [];
  let fixedYen = 0;
  for (const sub of input.detectedSubscriptions) {
    if (!input.confirmedFixedKeys.has(sub.key)) continue;
    const match = countable.find(
      (t) => subscriptionKeyOf(t.merchantName, t.description, t.amountYen) === sub.key,
    );
    const categoryId = match?.genreId ?? UNCATEGORIZED_ID;
    let occurrences = 0;
    let expected = sub.nextExpectedOn;
    for (let i = 0; i < 24 && expected <= period.to; i += 1) {
      if (expected > today && expected >= period.from) {
        occurrences += 1;
        events.push({ date: expected, categoryId, amountYen: sub.amountYen });
      }
      expected = addMonths(expected, 1);
    }
    if (occurrences > 0) {
      fixedYen += sub.amountYen * occurrences;
      fixedItems.push({ key: sub.key, label: sub.label, amountYen: sub.amountYen, occurrences });
      baseOf(categoryId, match?.genreName ?? '未分類').fixedYen += sub.amountYen * occurrences;
    }
  }
  const fixedKeySet = new Set(fixedItems.map((f) => f.key));

  // 変動費の学習対象の候補:通常・実績・確定済み固定費でないもの。
  const learnableAll = countable.filter((t) => {
    if (t.kind !== 'normal' || t.status !== 'actual' || t.amountYen >= 0) return false;
    if (t.occurredOn < trainingWindow.from || t.occurredOn > today) return false;
    if (t.genreId !== null && input.noForecastGenreIds?.has(t.genreId)) return false;
    return !fixedKeySet.has(subscriptionKeyOf(t.merchantName, t.description, t.amountYen));
  });

  // 直近の1日あたりの支出(見込みと比べて確かめるための数字)。
  const recordDays = recordStart === null ? 0 : daysBetween(windowFrom, today) + 1;
  const recentDays = Math.min(RECENT_PACE_DAYS, Math.max(1, recordDays));
  const recentFrom = addDays(today, -(recentDays - 1));
  const recentPerDayYen =
    recordDays > 0 && recordStart !== null
      ? learnableAll
          .filter((t) => t.occurredOn >= recentFrom)
          .reduce((sum, t) => sum + -t.amountYen, 0) / recentDays
      : null;

  const asVisitSource = (t: ForecastSourceTransaction): VisitSourceTransaction => ({
    key: merchantKeyOf(t),
    label: (t.merchantName ?? t.description).trim(),
    categoryId: t.genreId ?? UNCATEGORIZED_ID,
    categoryName: t.genreName ?? '未分類',
    occurredOn: t.occurredOn,
    amountYen: -t.amountYen,
  });
  const scheduledKeys = countable
    .filter((t) => t.status === 'scheduled' || t.occurredOn > today)
    .map((t) => ({ key: merchantKeyOf(t), date: t.occurredOn }));

  // 月払いの請求を先に取り出し(1か月おきの支払い)、残りから規則的に通う店を探す。
  const billCandidates = detectMonthlyBills(learnableAll.map(asVisitSource), today);
  const billKeys = new Set(billCandidates.map((b) => b.key));
  const isBill = (t: ForecastSourceTransaction) =>
    billKeys.has(`${merchantKeyOf(t)}|${t.genreId ?? UNCATEGORIZED_ID}`);
  const billEvents = projectBills({
    bills: billCandidates,
    today,
    periodTo: period.to,
    scheduled: scheduledKeys,
  }).filter((e) => e.date >= period.from);

  const regularMerchants = detectRegularMerchants(
    learnableAll.filter((t) => !isBill(t)).map(asVisitSource),
  );
  const regularKeys = new Set(regularMerchants.map((m) => m.key));
  const visits = projectVisits({
    merchants: regularMerchants,
    today,
    periodTo: period.to,
    scheduled: scheduledKeys,
  }).filter((v) => v.date >= period.from);

  const variableAll = learnableAll.filter((t) => !isBill(t) && !regularKeys.has(merchantKeyOf(t)));
  const variableSource = variableAll.filter((t) => t.occurredOn <= trainingWindow.to);
  const periodSource = separatedPeriod
    ? variableAll.filter((t) => t.occurredOn >= period.from && t.occurredOn <= today)
    : [];

  const byCategory = new Map<string, { name: string; txs: ForecastSourceTransaction[] }>();
  for (const t of [...variableSource, ...periodSource]) {
    const id = t.genreId ?? UNCATEGORIZED_ID;
    const bucket = byCategory.get(id) ?? { name: t.genreName ?? '未分類', txs: [] };
    if (t.occurredOn <= trainingWindow.to) bucket.txs.push(t);
    byCategory.set(id, bucket);
  }

  const allDays = dataDays > 0 ? eachDay(trainingWindow.from, trainingWindow.to) : [];
  const specialExcluded: OutlierExclusion[] = [];
  const variable: VariableTrainingData[] = [];
  const missingRecordDays: MissingRecordDay[] = [];
  const thresholdById = new Map<string, number>();

  for (const [categoryId, { name, txs }] of byCategory) {
    const amounts = txs.map((t) => -t.amountYen).sort((a, b) => a - b);
    const threshold =
      amounts.length >= MIN_SAMPLES_FOR_OUTLIER
        ? percentile(amounts, OUTLIER_PERCENTILE)
        : Infinity;
    thresholdById.set(categoryId, threshold);

    const byDate = new Map<DateOnly, CategoryDayRecord>();
    for (const day of allDays) {
      byDate.set(day, { date: day, count: 0, amountYen: 0, logSum: 0, logSqSum: 0 });
    }

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
      const log = Math.log(Math.max(1, amountYen));
      rec.count += 1;
      rec.amountYen += amountYen;
      rec.logSum = (rec.logSum ?? 0) + log;
      rec.logSqSum = (rec.logSqSum ?? 0) + log * log;
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

  // 期間に入ってからの変動費(学習から分けたとき)。外れ値は特別費として扱い、水準には入れない。
  const observations = new Map<string, { count: number; logAmounts: number[] }>();
  for (const t of periodSource) {
    const id = t.genreId ?? UNCATEGORIZED_ID;
    const amountYen = -t.amountYen;
    if (amountYen > (thresholdById.get(id) ?? Infinity)) continue;
    const obs = observations.get(id) ?? { count: 0, logAmounts: [] };
    obs.count += 1;
    obs.logAmounts.push(Math.log(Math.max(1, amountYen)));
    observations.set(id, obs);
  }
  const periodObservations: PeriodObservation[] = [...observations.entries()].map(
    ([categoryId, o]) => ({ categoryId, count: o.count, logAmounts: o.logAmounts }),
  );

  const elapsedFrom = period.from > windowFrom ? period.from : windowFrom;
  const elapsedTo = today < period.to ? today : period.to;
  const elapsedDates = elapsedFrom <= elapsedTo ? eachDay(elapsedFrom, elapsedTo) : [];

  // 特別費の再標本化の母集団:学習窓内の special kind 実績 + 外れ値として除外した候補。
  const specialFromKind = countable
    .filter(
      (t) =>
        t.kind === 'special' &&
        t.status === 'actual' &&
        t.amountYen < 0 &&
        t.occurredOn >= trainingWindow.from &&
        t.occurredOn <= trainingWindow.to,
    )
    .map((t) => -t.amountYen);
  const specialHistoricalAmounts = [...specialFromKind, ...specialExcluded.map((e) => e.amountYen)];
  const specialOccurrencesPerDay = dataDays > 0 ? specialHistoricalAmounts.length / dataDays : 0;

  for (const e of [...visits, ...billEvents]) {
    if (!baseMap.has(e.categoryId)) {
      const name =
        regularMerchants.find((m) => m.categoryId === e.categoryId)?.categoryName ??
        billCandidates.find((b) => b.categoryId === e.categoryId)?.categoryName ??
        '未分類';
      baseOf(e.categoryId, name);
    }
  }

  // 支出の型(定常・まとまり・決まった)。変動費の明細の日付と、来店・請求の有無から決める。
  const eventDatesById = new Map<string, DateOnly[]>();
  for (const t of variableAll) {
    const id = t.genreId ?? UNCATEGORIZED_ID;
    const list = eventDatesById.get(id) ?? [];
    list.push(t.occurredOn);
    eventDatesById.set(id, list);
  }
  const categoryTypes: Record<string, SpendingType> = {};
  const typeIds = new Set([
    ...baseMap.keys(),
    ...eventDatesById.keys(),
    ...regularMerchants.map((m) => m.categoryId),
    ...billCandidates.map((b) => b.categoryId),
  ]);
  for (const id of typeIds) {
    const name =
      baseMap.get(id)?.categoryName ??
      byCategory.get(id)?.name ??
      regularMerchants.find((m) => m.categoryId === id)?.categoryName ??
      billCandidates.find((b) => b.categoryId === id)?.categoryName ??
      '';
    categoryTypes[id] = classifySpending({
      name,
      eventDates: eventDatesById.get(id) ?? [],
      recordDays: recordDays,
      hasRegularMerchant: regularMerchants.some((m) => m.categoryId === id),
      hasBills:
        billCandidates.some((b) => b.categoryId === id) || (baseMap.get(id)?.fixedYen ?? 0) > 0,
      closed: input.noForecastGenreIds?.has(id) ?? false,
    });
  }

  return {
    trainingWindow,
    period,
    today,
    actualYen,
    categoryTypes,
    committed: { scheduledYen, fixedYen, fixedItems, events },
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
    bills: billCandidates,
    billEvents,
    separatedPeriod,
    periodObservations,
    elapsedDates,
    entryLag: entryLagProfile(
      learnableAll.map((t) => ({ occurredOn: t.occurredOn, createdOn: t.createdOn })),
      today,
    ),
    recentPerDayYen,
    missingRecordDays,
    dataDays,
  };
}
