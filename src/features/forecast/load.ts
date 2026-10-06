/**
 * 予測の読み込み(サーバー)。レポート・目標の着地・目標の分析は、ここ1か所から
 * 同じ確率エンジンの予測を受け取る(画面ごとに予測の仕組みを持たない)。
 *
 * 学習には過去2年ぶんの軽い読み方(history.ts)、予測の対象の期間は家計簿と同じ
 * 読み方(entries.ts)を使う。給料日・確認済みの固定費・検知したサブスク・記録開始日・収入も渡す。
 */

import { unstable_cache } from 'next/cache';

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
import { addDays, monthStartJst, todayJst, type DateOnly } from '@/lib/date';
import { periodDays } from '@/domain/period';
import { createClient } from '@/lib/supabase/server';
import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { continuousRecordStart, periodIncome } from '@/domain/forecast/record';
import { verifyCautions, verifyForecast, type Verification } from './calibration';
import { loadForecastHistory } from './history';
import { toForecastSource } from './source';

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
  /** 範囲の、今日の支出(今日あと使える額に使う。設計書 v3 3.1)。 */
  todaySpentYen: number;
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

export async function loadForecast(args: {
  period: { from: DateOnly; to: DateOnly };
  budgetYen?: number | null;
  scope?: ForecastScope;
  categoryTargets?: readonly CategoryTarget[];
  now?: Date;
}): Promise<ForecastView> {
  const today = todayJst(args.now ?? new Date());
  const supabase = await createClient();
  const [{ data: auth }, settings, fixedKeys, subscriptions, genres, takeHomeYen] =
    await Promise.all([
      supabase.auth.getUser(),
      getAppSettings().catch(() => null),
      listConfirmedFixedCostKeys().catch(() => new Set<string>()),
      loadDetectedSubscriptions(args.now).catch(() => []),
      listGenres().catch(() => []),
      args.scope ? Promise.resolve(null) : loadTakeHomeYen().catch(() => null),
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
  // よらない(レポート・目標・カテゴリ画面のどこから呼んでも同じ検証結果を使う)。
  // 鍵に本人のIDと明細の版を含める(他人の結果を返さない)。
  const completed = transactions.filter(
    (t) => t.occurredOn < monthStartJst(0, args.now ?? new Date()),
  );
  const completedVersion = `${completed.length}:${completed.at(-1)?.occurredOn ?? ''}:${Math.round(
    completed.reduce((sum, t) => sum + t.amountYen, 0),
  )}`;
  const cacheKey = `v2:${userId}:${completedVersion}:${today}:${payday ?? 'x'}:${recordStart ?? ''}:${[...noForecast].sort().join(',')}`;
  const verification = await unstable_cache(
    async () =>
      verifyForecast({
        cacheKey,
        transactions: completed,
        today,
        recordStart,
        payday,
        noForecastGenreIds: noForecast,
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
              verification,
              targets: cautionTargets,
            }),
          ['forecast-cautions', cautionKey],
          { revalidate: 60 * 60 * 24 },
        )()
      : null;

  const forecast = buildForecast({
    transactions,
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
    calibration: verification?.calibration ?? null,
    ...(verification
      ? {
          halfLifeDays: verification.halfLifeDays,
          monthLevelK: verification.monthLevelK ?? Infinity,
        }
      : {}),
    ...(args.scope ? { scope: args.scope } : {}),
    ...(args.categoryTargets ? { categoryTargets: args.categoryTargets } : {}),
    income: args.scope ? null : periodIncome({ transactions, period: args.period, takeHomeYen }),
  });
  return {
    forecast,
    period: args.period,
    verification,
    today,
    excludedByCategory: excludedSpend(transactions, args.period, args.scope),
    cautionPrecision,
    todaySpentYen: spentOn(periodRows, today, args.scope),
  };
}
