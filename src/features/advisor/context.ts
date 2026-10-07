/**
 * AIの窓口(/assistant)へ渡す「今の状況」のコンテキスト文(本人発案)。
 *
 * ここで組み立てる数字は既存のドメイン計算(features/home/summary.ts の
 * loadHomeSummary と、その中の貯金 features/savings)そのものであり、
 * AI に新しく計算させない。AI はこの文章を読んで会話するだけ
 * (features/assistant/chat-tools.ts のシステムプロンプト参照)。
 */

import { formatYen } from '@/domain/money';
import { goalOutlook } from '@/domain/savings';
import { loadHomeSummary } from '@/features/home/summary';
import { todayJst } from '@/lib/date';

export async function buildAdvisorContextText(now: Date = new Date()): Promise<string> {
  const summary = await loadHomeSummary(now);
  const { savings } = summary;
  const today = todayJst(now);

  const lines: string[] = [`今日の日付: ${today}`, ''];

  lines.push('貯金(収入 − 支出で自動で数える):');
  lines.push(`- 今月: ${formatYen(savings.thisMonthYen)}`);
  if (savings.paceYen !== null)
    lines.push(`- いつもの月(直近3か月の平均): ${formatYen(savings.paceYen)}`);
  if (savings.startOn !== null) {
    lines.push(`- ${savings.startOn}から貯まった合計: ${formatYen(savings.totalYen)}`);
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

  lines.push('', '貯金目標(期限の近い順。貯まった合計を順に割り当てる):');
  if (savings.goals.length === 0) {
    lines.push('- まだ無い');
  } else {
    for (const progress of savings.goals) {
      const { goal } = progress;
      const targetPart =
        goal.targetAmountYen === null ? '' : `/目標${formatYen(goal.targetAmountYen)}`;
      const datePart = goal.targetDate === null ? '' : `、期限${goal.targetDate}`;
      lines.push(
        `- ${goal.title}: ${formatYen(progress.savedYen)}${targetPart}${datePart}(${goalOutlook(progress, today)})`,
      );
    }
  }

  return lines.join('\n');
}
