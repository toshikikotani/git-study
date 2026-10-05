/**
 * 予測の読み込み(サーバー)。レポート・目標の着地・目標の分析は、ここ1か所から
 * 同じ確率エンジンの予測を受け取る(画面ごとに予測の仕組みを持たない)。
 *
 * 学習には過去2年ぶんの軽い読み方(history.ts)、予測の対象の期間は家計簿と同じ
 * 読み方(entries.ts)を使う。給料日・確認済みの固定費・検知したサブスク・記録開始日も渡す。
 */

import { unstable_cache } from 'next/cache';

import { buildForecast } from '@/domain/forecast/engine';
import type { ForecastScope } from '@/domain/forecast/pipeline';
import type { CategoryTarget } from '@/domain/forecast/simulate';
import type { Forecast } from '@/domain/forecast/types';
import { listGenres } from '@/features/genre/store';
import { getAppSettings } from '@/features/settings/store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { addDays, daysBetween, todayJst, type DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import { bootstrapWeightFor, verifyForecast, type Verification } from './calibration';
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
};

export async function loadForecast(args: {
  period: { from: DateOnly; to: DateOnly };
  budgetYen?: number | null;
  scope?: ForecastScope;
  categoryTargets?: readonly CategoryTarget[];
  now?: Date;
}): Promise<ForecastView> {
  const today = todayJst(args.now ?? new Date());
  const supabase = await createClient();
  const [{ data: auth }, settings, fixedKeys, subscriptions, genres] = await Promise.all([
    supabase.auth.getUser(),
    getAppSettings().catch(() => null),
    listConfirmedFixedCostKeys().catch(() => new Set<string>()),
    loadDetectedSubscriptions(args.now).catch(() => []),
    listGenres().catch(() => []),
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

  const recordStart =
    transactions.reduce<DateOnly | null>(
      (min, t) => (t.amountYen < 0 && (min === null || t.occurredOn < min) ? t.occurredOn : min),
      null,
    ) ?? null;
  const dataVersion = `${transactions.length}:${transactions.at(-1)?.occurredOn ?? ''}:${Math.round(
    transactions.reduce((sum, t) => sum + t.amountYen, 0),
  )}`;
  const dataDays = recordStart === null ? 0 : Math.max(0, daysBetween(recordStart, today) + 1);
  const bootstrapWeight = bootstrapWeightFor(dataDays);

  // 検証は重い(数秒)ので、明細が変わらない間は結果を使い回す。サーバーのデータキャッシュに
  // 置くので、サーバーが入れ替わっても残る。鍵に本人のIDと明細の版を含める(他人の結果を返さない)。
  const cacheKey = `${userId}:${dataVersion}:${today}:${payday ?? 'x'}:${bootstrapWeight}:${[...noForecast].sort().join(',')}`;
  const verification = await unstable_cache(
    async () =>
      verifyForecast({
        cacheKey,
        transactions,
        today,
        recordStart,
        payday,
        bootstrapWeight,
        noForecastGenreIds: noForecast,
      }),
    ['forecast-verification', cacheKey],
    { revalidate: 60 * 60 * 24 },
  )();

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
    bootstrapWeight,
    noForecastGenreIds: noForecast,
    calibration: verification?.calibration ?? null,
    ...(verification ? { halfLifeDays: verification.halfLifeDays } : {}),
    ...(args.scope ? { scope: args.scope } : {}),
    ...(args.categoryTargets ? { categoryTargets: args.categoryTargets } : {}),
  });
  return { forecast, period: args.period, verification, today };
}
