import { remainingOfTotal } from '@/domain/forecast/remaining';
import { loadForecast } from '@/features/forecast/load';
import { OverviewChart, type OverviewChartProps } from './overview-chart';

/**
 * 家計簿の全体の累計に、確率予測(レポートと同じ予測)の線と帯を足す。予測は重いので、
 * 明細の表示を待たせないよう Suspense の中で後から読み込む。目標があるときは、目標のジャンルだけ・
 * 特別費を除いて数える(総予算と同じ範囲)。
 */
export async function OverviewChartSection({
  scopeGenreIds,
  ...props
}: OverviewChartProps & { scopeGenreIds: readonly string[] | null }) {
  const remaining = await loadForecast({
    period: { from: props.monthStart, to: props.monthEnd },
    ...(scopeGenreIds ? { scope: { genreIds: new Set(scopeGenreIds), excludeSpecial: true } } : {}),
  }).then(
    (view) => remainingOfTotal(view.forecast),
    (error: unknown) => {
      console.error('[spending] 全体の予測を読み込めませんでした', error);
      return null;
    },
  );
  return <OverviewChart {...props} remaining={remaining} />;
}
