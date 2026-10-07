/**
 * 約束(ADR-075・ADR-078)の判定。どの画面・どの予測でも同じ数え方にするため、ここ1か所に置く。
 */

import type { DateOnly } from '@/lib/date';
import type { ForecastSourceTransaction } from './decompose';

/** その期間にそのジャンルで使った額(家計簿の「使った額」と同じ:実績、特別費を含み、返金を引く)。 */
export function genreSpentYen(
  rows: readonly ForecastSourceTransaction[],
  genreId: string,
  period: { from: DateOnly; to: DateOnly },
): number {
  let yen = 0;
  for (const t of rows) {
    if (t.genreId !== genreId || t.status !== 'actual') continue;
    if (t.isTransfer || t.reviewStatus === 'ignored') continue;
    if (t.occurredOn < period.from || t.occurredOn > period.to) continue;
    if (t.amountYen < 0) yen -= t.amountYen;
    else if (t.kind === 'refund') yen -= t.amountYen;
  }
  return Math.max(0, yen);
}

/** 約束が守れたか:その月に使った額が、決めた時点の約束どおりの見込み(中央)以下。 */
export function promiseKept(spentYen: number, limitYen: number): boolean {
  return spentYen <= limitYen;
}

/**
 * これまでの約束の守れ具合 =(守れた月 + 1)÷(約束した月 + 2)。約束が無ければ半分。
 * 1回守れなかっただけで 0 にならないよう、半分へ寄せる(AIの読みの当たり具合と同じ考え方)。
 */
export function promiseKeepRate(results: readonly { kept: boolean }[]): number {
  const kept = results.filter((r) => r.kept).length;
  return (kept + 1) / (results.length + 2);
}
