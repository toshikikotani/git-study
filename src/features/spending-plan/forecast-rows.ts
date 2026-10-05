/**
 * 目標の着地予測(プラン画面の分析・レポートの着地)に渡す、ジャンルごとの入力を集める。
 * 実績は期間の始めから今日まで、予定は期間内の今日より先だけ(月ではなく目標の期間で数える)。
 * 「予測を止める」にしたジャンルは、日々のペースを0として予測に足さない。
 */

import type { GenreForecastInput } from '@/domain/plan-forecast';
import { listGenres } from '@/features/genre/store';
import { daysBetween, type DateOnly } from '@/lib/date';
import { loadPlanContext } from './context';
import { loadScheduledByGenre } from './scheduled';
import { loadGenreSpend } from './store';

export type ForecastRow = {
  genreId: string;
  genreName: string;
  spentYen: number;
  scheduledYen: number;
  input: GenreForecastInput;
};

export async function loadForecastRows(args: {
  start: DateOnly;
  end: DateOnly;
  items: readonly { genreId: string; targetYen: number }[];
  today: DateOnly;
}): Promise<{ remainingDays: number; rows: ForecastRow[] }> {
  const { start, end, today } = args;
  const spentTo = today < end ? today : end;
  const [context, spent, scheduled, genres] = await Promise.all([
    loadPlanContext(start, end),
    loadGenreSpend(start, spentTo),
    loadScheduledByGenre(start, end),
    listGenres().catch(() => []),
  ]);
  const closedIds = new Set(
    genres.filter((genre) => genre.forecastClosed).map((genre) => genre.id),
  );
  const byId = new Map(context.genres.map((genre) => [genre.genreId, genre]));
  const rows = args.items.flatMap((item): ForecastRow[] => {
    const genre = byId.get(item.genreId);
    if (genre === undefined) return [];
    const closed = closedIds.has(item.genreId);
    const spentYen = spent.byGenre.get(item.genreId) ?? 0;
    const scheduledYen = scheduled.get(item.genreId) ?? 0;
    return [
      {
        genreId: item.genreId,
        genreName: genre.genreName,
        spentYen,
        scheduledYen,
        input: {
          spentYen,
          scheduledYen,
          meanDailyYen: closed ? 0 : genre.dailyYen,
          medianDailyYen: closed ? 0 : genre.medianDailyYen,
          observedDays: context.lookbackDays,
          targetYen: item.targetYen,
        },
      },
    ];
  });
  return { remainingDays: today >= end ? 0 : daysBetween(today, end), rows };
}
