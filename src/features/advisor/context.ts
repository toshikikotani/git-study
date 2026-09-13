/**
 * AI相談へ渡す「今の状況」のコンテキスト文(本人発案)。
 *
 * ここで組み立てる数字は既存のドメイン計算(features/home/summary.ts の
 * loadHomeSummary、domain/goals.ts の goalProgressRatio)そのものであり、
 * AI に新しく計算させない。AI はこの文章を読んで会話するだけ(chat.ts の
 * システムプロンプト参照)。
 */

import { goalProgressRatio } from '@/domain/goals';
import { formatYen } from '@/domain/money';
import { listActiveGoals } from '@/features/goals/store';
import { loadHomeSummary } from '@/features/home/summary';
import { todayJst } from '@/lib/date';

export async function buildAdvisorContextText(now: Date = new Date()): Promise<string> {
  const [summary, goals] = await Promise.all([loadHomeSummary(now), listActiveGoals()]);

  const lines: string[] = [`今日の日付: ${todayJst(now)}`, ''];

  lines.push('完済状況:');
  if (summary.payoff.daysRemaining === null) {
    lines.push('- 負債は完済済み');
  } else {
    lines.push(`- 残債務: ${formatYen(summary.payoff.remainingYen)}`);
    lines.push(`- 完済まで: ${summary.payoff.daysRemaining}日`);
    if (summary.payoff.reducedThisMonthYen > 0) {
      lines.push(`- 今月すでに${formatYen(summary.payoff.reducedThisMonthYen)}減らした`);
    }
    if (summary.payoff.isEstimated) {
      lines.push('- (残高・金利の一部が未確定の推定値のため、この日数は確定ではない)');
    }
  }

  lines.push('', 'ホームに出ている予算枠(今月分、ここに無い枠は分からない):');
  if (summary.tiles.length === 0) {
    lines.push('- 設定なし');
  } else {
    for (const tile of summary.tiles) {
      const budgetPart =
        tile.budgetYen === null ? '予算上限なし' : `予算${formatYen(tile.budgetYen)}`;
      const remainingPart =
        tile.remainingYen === null ? '' : `、残り${formatYen(tile.remainingYen)}`;
      lines.push(
        `- ${tile.label}: 今月${formatYen(tile.spentYen)}使った(${budgetPart}${remainingPart})`,
      );
    }
  }

  lines.push('', '進行中の目標:');
  if (goals.length === 0) {
    lines.push('- まだ無い');
  } else {
    for (const goal of goals) {
      const ratio = goalProgressRatio(goal);
      const targetPart =
        goal.targetAmountYen === null ? '' : `/目標${formatYen(goal.targetAmountYen)}`;
      const ratioPart = ratio === null ? '' : `(${Math.round(ratio * 100)}%)`;
      const datePart = goal.targetDate === null ? '' : `、期限${goal.targetDate}`;
      lines.push(
        `- ${goal.title}: 現在${formatYen(goal.currentAmountYen)}${targetPart}${ratioPart}${datePart}`,
      );
    }
  }

  return lines.join('\n');
}
