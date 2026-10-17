/**
 * AIの窓口の simulate_spend(「飲み会で5,000円、やばい？」に、アプリの見通しの数字で答える、ADR-108)。
 * ホームの「もし使ったら」と同じ計算(features/forecast/what-if-spend.ts)。読むだけで何も記録しない。
 */

import { whatIfRows, whatIfVerdict, type WhatIfCard } from '@/domain/forecast/what-if-spend';
import { MAX_WHAT_IF_YEN, simulateTodaySpends } from '@/features/forecast/what-if-spend';
import { resolveGenreByName } from '@/features/genre/chat-tools';
import { ChatToolError } from '@/lib/chat-tools';
import type { PlanContext } from './plan';

export type { WhatIfCard };

export async function simulateSpendCard(
  input: unknown,
  ctx: Pick<PlanContext, 'genres'>,
): Promise<WhatIfCard> {
  const args =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const amount = typeof args.amount_yen === 'number' ? args.amount_yen : Number.NaN;
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_WHAT_IF_YEN) {
    throw new ChatToolError('amount_yen は1円から100万円までの整数で指定してください。');
  }
  const genre =
    typeof args.genre_name === 'string' && args.genre_name.trim() !== ''
      ? resolveGenreByName(args.genre_name, ctx.genres)
      : null;
  const result = await simulateTodaySpends(
    [amount],
    genre ? { id: genre.id, name: genre.name } : null,
  );
  const option = result.options[0]!;
  return {
    amountYen: amount,
    genreName: genre?.name ?? null,
    rows: whatIfRows(result.base, option),
    verdict: whatIfVerdict(result, option),
    computedAt: result.computedAt,
  };
}

/** モデルに返す文(数字はこのまま使ってもらう)。 */
export function whatIfToolText(card: WhatIfCard): string {
  const lines = [
    `今日あと${card.amountYen.toLocaleString('ja-JP')}円使ったら(アプリの見通し、${card.computedAt}時点):`,
    ...card.rows.map((r) => `- ${r.label}: ${r.before} → ${r.after}`),
    `ひとこと: ${card.verdict}`,
    '本人の画面に、この前→後のカードと「予定に入れる」「金額を変えて試す」のボタンを出した。',
    '返事では、いちばん大事な変化を1〜2文で伝える(表の数字をすべて繰り返さなくてよい)。',
  ];
  return lines.join('\n');
}
