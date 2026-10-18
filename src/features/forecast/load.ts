/**
 * 予測の読み込み(サーバー)。レポート・目標の着地・目標の分析は、ここ1か所から
 * 同じ確率エンジンの予測を受け取る(画面ごとに予測の仕組みを持たない)。
 *
 * 学習には過去2年ぶんの軽い読み方(history.ts)、予測の対象の期間は家計簿と同じ
 * 読み方(entries.ts)を使う。給料日・確認済みの固定費・検知したサブスク・記録開始日・収入も渡す。
 */

import { unstable_cache } from 'next/cache';
import { createHash } from 'node:crypto';

import type { CautionPrecision } from '@/domain/forecast/caution';
import { buildForecast } from '@/domain/forecast/engine';
import type { ForecastScope } from '@/domain/forecast/pipeline';
import type { CategoryTarget } from '@/domain/forecast/simulate';
import type { Forecast } from '@/domain/forecast/types';
import { listGenres } from '@/features/genre/store';
import { getAppSettings } from '@/features/settings/store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { addDays, addMonths, monthStartJst, todayJst, type DateOnly } from '@/lib/date';
import { periodDays } from '@/domain/period';
import { createClient } from '@/lib/supabase/server';
import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { continuousRecordStart, periodIncome } from '@/domain/forecast/record';
import { forecastScopeKey, verifyCautions, verifyForecast, type Verification } from './calibration';
import { loadForecastHistory } from './history';
import { listPromises } from './promise-store';
import { genreSpentYen, promiseKeepRate, promiseKept } from '@/domain/forecast/promise';
import { toForecastSource } from './source';
import { computeDailyLimit, type DailyLimitResult } from './daily-limit';
import { calendarContext } from '@/domain/forecast/calendar';
import { isDayOff } from '@/domain/forecast/holidays';
import { computeDayOffWeekdayAverages } from './dayoff-avg';

/** 約束の守れ具合を数える、過去の月数。 */
const PROMISE_HISTORY_MONTHS = 6;
/** 学習に使う過去の長さ(日)。2年ぶんあれば、同じ月を2回見られる。 */
const HISTORY_DAYS = 730;
export type ForecastView = {
  forecast: Forecast;
  period: { from: DateOnly; to: DateOnly };
  /** 過去の月での検証(記録が短くて検証できなければ null)。 */
  verification: Verification | null;
  today: DateOnly;
  /**
   * 範囲(scope)から外した、範囲内のジャンルの支出(特別費)。ジャンルごと、期間内の実績と予定。
   * 画面で「うち ○円は目標の対象外」と出し、ジャンルの着地が使った額を下回って見えないようにする。
   */
  excludedByCategory: ReadonlyMap<string, number>;
  /** 目標があるとき:過去の月で測った、時点帯ごとの注意の精度(設計書 v3 3.2)。 */
  cautionPrecision: CautionPrecision | null;
  /** 「予測を止める」にしたカテゴリ(固定費として扱う)。 */
  closedGenreIds: ReadonlySet<string>;
  /** 範囲の、今日の支出(今日あと使える額に使う。設計書 v3 3.1)。 */
  todaySpentYen: number;
  /** 直近の実績から計算した、休日(土日祝)と平日の1日あたり平均。 */
  dayOffPerDayYen: number | null;
  weekdayPerDayYen: number | null;
  /** 今日の上限の計算結果(休日軸・確率込み)。 */
  dailyLimit: DailyLimitResult | null;
  /**
   * 明日からの1日の目安(今日の分を使ったあとの残りを、明日から期間の終わりまでに配る、ADR-108)。
   * 今日が期間の最終日・目標が無いときは null。
   */
  tomorrowLimit: DailyLimitResult | null;
  /** 範囲の、今日の支出の大きいもの(名前と額、大きい順に2つまで)。今日の目安の説明に使う。 */
  todayTopSpends: readonly { name: string; amountYen: number }[];
};

/** 範囲の、ある日の支出(実績。返金は差し引く。特別費を外す範囲なら外す)。 */
export function spentOn(
  transactions: readonly ForecastSourceTransaction[],
  date: DateOnly,
  scope: ForecastScope | undefined,
): number {
  let yen = 0;
  for (const t of transactions) {
    if (t.occurredOn !== date || t.status !== 'actual') continue;
    if (t.isTransfer || t.reviewStatus === 'ignored') continue;
    if (scope?.excludeSpecial && t.kind === 'special') continue;
    if (scope?.genreIds !== undefined && (t.genreId === null || !scope.genreIds.has(t.genreId)))
      continue;
    if (t.amountYen < 0) yen -= t.amountYen;
    else if (t.kind === 'refund') yen -= t.amountYen;
  }
  return Math.max(0, yen);
}

/** 「もし使ったら」の、今日の支出1件(実績として数える)。 */
function extraSpendRow(extra: ExtraSpend, today: DateOnly): ForecastSourceTransaction {
  return {
    occurredOn: today,
    createdOn: today,
    genreId: extra.genreId,
    genreName: extra.genreName,
    amountYen: -Math.abs(extra.amountYen),
    status: 'actual',
    kind: 'normal',
    isTransfer: false,
    reviewStatus: 'auto_ok',
    needsInput: false,
    merchantName: null,
    description: 'もし使ったら',
  };
}

/** 範囲の、その日の支出の大きいもの(名前と額)。返金・振替・対象外は入れない。 */
export function topSpendsOn(
  transactions: readonly ForecastSourceTransaction[],
  date: DateOnly,
  scope: ForecastScope | undefined,
  limit = 2,
): { name: string; amountYen: number }[] {
  return transactions
    .filter(
      (t) =>
        t.occurredOn === date &&
        t.status === 'actual' &&
        t.amountYen < 0 &&
        !t.isTransfer &&
        t.reviewStatus !== 'ignored' &&
        !(scope?.excludeSpecial && t.kind === 'special') &&
        !(scope?.genreIds !== undefined && (t.genreId === null || !scope.genreIds.has(t.genreId))),
    )
    .sort((a, b) => a.amountYen - b.amountYen)
    .slice(0, limit)
    .map((t) => ({ name: (t.merchantName ?? t.description).trim(), amountYen: -t.amountYen }));
}

/** 範囲から外した特別費(範囲のジャンルの、期間内の実績と予定)。 */
export function excludedSpend(
  transactions: readonly ForecastSourceTransaction[],
  period: { from: DateOnly; to: DateOnly },
  scope: ForecastScope | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!scope?.excludeSpecial) return out;
  for (const t of transactions) {
    if (t.kind !== 'special' || t.isTransfer || t.reviewStatus === 'ignored') continue;
    if (t.amountYen >= 0 || t.genreId === null) continue;
    if (t.occurredOn < period.from || t.occurredOn > period.to) continue;
    if (scope.genreIds !== undefined && !scope.genreIds.has(t.genreId)) continue;
    out.set(t.genreId, (out.get(t.genreId) ?? 0) - t.amountYen);
  }
  return out;
}

async function loadTakeHomeYen(): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('monthly_take_home_yen')
    .maybeSingle();
  if (error || !data) return null;
  return (data as { monthly_take_home_yen: number | null }).monthly_take_home_yen ?? null;
}

export type ForecastArgs = {
  period: { from: DateOnly; to: DateOnly };
  budgetYen?: number | null;
  scope?: ForecastScope;
  categoryTargets?: readonly CategoryTarget[];
  now?: Date;
};

/** 「もし使ったら」の、今日これから使う額(ADR-108)。 */
export type ExtraSpend = { amountYen: number; genreId: string | null; genreName: string | null };

export async function loadForecast(args: ForecastArgs): Promise<ForecastView> {
  return (await prepareForecast(args))();
}

/**
 * 予測に使う明細・設定・検証を読み、予測を出す関数を返す(ADR-108)。
 * 「もし使ったら」は、同じ読み込みで「いつも通り」と「今日これだけ使ったら」を何度か出し比べる
 * (読み込みは1回。乱数の種も同じなので、差は使った額の分だけになる)。
 */
export async function prepareForecast(
  args: ForecastArgs,
): Promise<(extra?: ExtraSpend) => ForecastView> {
  const today = todayJst(args.now ?? new Date());
  const supabase = await createClient();
  // 約束(ADR-075)は今日の月のものだけを、今日を含む期間の予測に入れる。これまでの月の約束は、
  // 守れ具合(「これ以上は使わない」のいつもの守り方、ADR-078)を数えるのに使う。
  const thisMonth = monthStartJst(0, args.now ?? new Date());
  const promiseMonths = Array.from({ length: PROMISE_HISTORY_MONTHS + 1 }, (_, i) =>
    monthStartJst(-i, args.now ?? new Date()),
  );
  const includesToday = args.period.from <= today && today <= args.period.to;
  const [{ data: auth }, settings, fixedKeys, subscriptions, genres, takeHomeYen, promises] =
    await Promise.all([
      supabase.auth.getUser(),
      getAppSettings().catch(() => null),
      listConfirmedFixedCostKeys().catch(() => new Set<string>()),
      loadDetectedSubscriptions(args.now).catch(() => []),
      listGenres().catch(() => []),
      args.scope ? Promise.resolve(null) : loadTakeHomeYen().catch(() => null),
      includesToday ? listPromises(promiseMonths).catch(() => []) : Promise.resolve([]),
    ]);
  // 「予測を止める」にしたジャンルは、残りの変動費を予測しない(実績と日付入りの予定は数える)。
  const noForecast = new Set(genres.filter((g) => g.forecastClosed).map((g) => g.id));
  const userId = auth.user?.id ?? 'anonymous';
  const payday = settings?.payday ?? null;

  const historyFrom = addDays(today, -HISTORY_DAYS);
  const historyTo = addDays(args.period.from, -1);
  const [history, periodLoaded] = await Promise.all([
    loadForecastHistory({ from: historyFrom, to: historyTo }),
    loadLedgerTransactions(args.period, today),
  ]);
  const periodRows = toForecastSource(periodLoaded.transactions);
  // 期間の前の履歴は軽い読み方、期間の中は家計簿と同じ読み方。重なる日は期間側だけを使う。
  const transactions = [...history.filter((t) => t.occurredOn < args.period.from), ...periodRows];

  const recordStart = continuousRecordStart(transactions, today);
  const dataVersion = `${transactions.length}:${transactions.at(-1)?.occurredOn ?? ''}:${Math.round(
    transactions.reduce((sum, t) => sum + t.amountYen, 0),
  )}`;

  // 検証は重い(数秒)ので、明細が変わらない間は結果を使い回す。サーバーのデータキャッシュに
  // 置くので、サーバーが入れ替わっても残る。検証に使うのは完了した月だけなので、鍵も予測の期間に
  // よらない。同じ範囲なら再利用し、目標のカテゴリ・特別費の扱いが違えば別に求める。
  // 鍵に本人のIDと明細の内容を含める(カテゴリの変更や同額の訂正でも古い補正を返さない)。
  const completed = transactions.filter(
    (t) => t.occurredOn < monthStartJst(0, args.now ?? new Date()),
  );
  const completedVersion = createHash('sha256')
    .update(
      completed
        .map((t) =>
          JSON.stringify([
            t.occurredOn,
            t.createdOn ?? null,
            t.genreId,
            t.genreName,
            t.amountYen,
            t.kind,
            t.status,
            t.isTransfer,
            t.mustPay ?? false,
            t.reviewStatus,
            t.needsInput,
            t.merchantName,
            t.description,
          ]),
        )
        .sort()
        .join('\n'),
    )
    .digest('hex');
  const cacheKey = `v4:${userId}:${completedVersion}:${today}:${payday ?? 'x'}:${recordStart ?? ''}:${[...noForecast].sort().join(',')}:${forecastScopeKey(args.scope)}`;
  const verification = await unstable_cache(
    async () =>
      verifyForecast({
        cacheKey,
        transactions: completed,
        today,
        recordStart,
        payday,
        noForecastGenreIds: noForecast,
        ...(args.scope ? { scope: args.scope } : {}),
      }),
    ['forecast-verification', cacheKey],
    { revalidate: 60 * 60 * 24 },
  )();

  // 注意の精度は目標のジャンルごとに測る(目標は30日あたりに直して、過去の月の長さに合わせる)。
  const cautionTargets = (args.categoryTargets ?? [])
    .filter((t) => t.targetYen > 0)
    .map((t) => ({
      categoryId: t.categoryId,
      targetYen: Math.round((t.targetYen * 30) / periodDays(args.period.from, args.period.to)),
    }));
  const cautionKey = `${cacheKey}:${verification?.halfLifeDays ?? ''}:${verification?.monthLevelK ?? ''}:${cautionTargets
    .map((t) => `${t.categoryId}=${t.targetYen}`)
    .sort()
    .join(',')}`;
  const cautionPrecision =
    cautionTargets.length > 0
      ? await unstable_cache(
          async () =>
            verifyCautions({
              cacheKey: cautionKey,
              transactions: completed,
              today,
              recordStart,
              payday,
              noForecastGenreIds: noForecast,
              ...(args.scope ? { scope: args.scope } : {}),
              verification,
              targets: cautionTargets,
            }),
          ['forecast-cautions', cautionKey],
          { revalidate: 60 * 60 * 24 },
        )()
      : null;

  return (extra) => {
    const rows = extra ? [...periodRows, extraSpendRow(extra, today)] : periodRows;
    const txs = extra ? [...transactions, extraSpendRow(extra, today)] : transactions;
    const forecast = buildForecast({
      now: args.now ?? new Date(),
      transactions: txs,
      period: args.period,
      today,
      trainingFrom: historyFrom,
      recordStart,
      confirmedFixedKeys: fixedKeys,
      detectedSubscriptions: subscriptions,
      budgetYen: args.budgetYen ?? null,
      payday,
      dataVersion,
      noForecastGenreIds: noForecast,
      promises: promises
        .filter((p) => p.month === thisMonth && !noForecast.has(p.genreId))
        .map((p) => ({ categoryId: p.genreId, perWeek: p.perWeek })),
      promiseKeepRate: promiseKeepRate(
        promises
          .filter((p) => p.month < thisMonth)
          .map((p) => ({
            kept: promiseKept(
              genreSpentYen(txs, p.genreId, {
                from: p.month,
                to: addDays(addMonths(p.month, 1), -1),
              }),
              p.limitYen,
            ),
          })),
      ),
      calibration: verification?.calibration ?? null,
      // 合成の母集団補正は全カテゴリ・特別費込みで作られている。限定した範囲へは流用しない。
      usePopulationPrior: !(args.scope?.genreIds !== undefined || args.scope?.excludeSpecial),
      ...(verification
        ? {
            halfLifeDays: verification.halfLifeDays,
            monthLevelK: verification.monthLevelK ?? Infinity,
            genreLevelK: verification.genreLevelK ?? Infinity,
          }
        : {}),
      ...(args.scope ? { scope: args.scope } : {}),
      ...(args.categoryTargets ? { categoryTargets: args.categoryTargets } : {}),
      income: args.scope
        ? null
        : periodIncome({ transactions: txs, period: args.period, takeHomeYen }),
    });
    // 直近90日の実績から、休日と平日の1日あたり平均を計算する(残りの日の内訳表示用)。
    const recentFrom = addDays(today, -90);
    const recentTo = addDays(today, -1);
    const averages = computeDayOffWeekdayAverages(txs, recentFrom, recentTo);

    // 今日の上限を、休日軸・確率込みで計算して保存する
    const cal = calendarContext(today, args.period.to, null);
    const totalDays = periodDays(args.period.from, args.period.to);
    const elapsed = periodDays(args.period.from, today);
    const remainingDays = Math.max(0, totalDays - elapsed + 1);
    const dayOffs = cal.dayOffs;
    const weekdays = Math.max(0, remainingDays - dayOffs);
    // 今日の目安は、昨日までに使った額から決める(今日使った額は、目安から引いて「あと・こえ」を出す。
    // 残りの予算からも引くと二重に数えていた、デザイン v3-9、ADR-109)。明日からの目安は、今日の分を
    // 使ったあとの残りから。
    const todaySpentYen = spentOn(rows, today, args.scope);
    const committedYen =
      (forecast.committed?.scheduledYen ?? 0) + (forecast.committed?.fixedYen ?? 0);
    const leftBudgetYen = Math.max(
      0,
      (args.budgetYen ?? 0) - (forecast.actualYen - todaySpentYen) - committedYen,
    );
    const leftAfterTodayYen = Math.max(
      0,
      (args.budgetYen ?? 0) - forecast.actualYen - committedYen,
    );
    const dailyLimit =
      args.budgetYen != null && averages.weekdayPerDayYen != null
        ? computeDailyLimit({
            leftBudgetYen,
            remainingDayOffs: dayOffs,
            remainingWeekdays: weekdays,
            dayOffMedianYen: averages.dayOffPerDayYen,
            weekdayMedianYen: averages.weekdayPerDayYen,
            probWithinBudget: forecast.probWithinBudget,
            todayIsDayOff: isDayOff(today),
          })
        : null;
    // 明日からの目安:今日の分を使ったあとの残り(今日使った額は使った額に入っている)を、明日からの日に配る。
    const tomorrow = addDays(today, 1);
    const todayOff = isDayOff(today) ? 1 : 0;
    const tomorrowLimit =
      dailyLimit !== null && remainingDays > 1
        ? computeDailyLimit({
            leftBudgetYen: leftAfterTodayYen,
            remainingDayOffs: Math.max(0, dayOffs - todayOff),
            remainingWeekdays: Math.max(0, weekdays - (1 - todayOff)),
            dayOffMedianYen: averages.dayOffPerDayYen,
            weekdayMedianYen: averages.weekdayPerDayYen,
            probWithinBudget: forecast.probWithinBudget,
            todayIsDayOff: isDayOff(tomorrow),
          })
        : null;

    return {
      forecast,
      period: args.period,
      verification,
      today,
      excludedByCategory: excludedSpend(txs, args.period, args.scope),
      closedGenreIds: noForecast,
      cautionPrecision,
      todaySpentYen,
      dayOffPerDayYen: averages.dayOffPerDayYen,
      weekdayPerDayYen: averages.weekdayPerDayYen,
      dailyLimit,
      tomorrowLimit,
      todayTopSpends: topSpendsOn(rows, today, args.scope),
    };
  };
}
