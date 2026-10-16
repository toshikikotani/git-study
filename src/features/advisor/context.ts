/**
 * AIの窓口(/assistant)へ渡す「今の状況」のコンテキスト文(本人発案)。
 *
 * ここで組み立てる数字は既存のドメイン計算そのものであり、AI に新しく計算させない。
 * AI はこの文章を読んで会話するだけ(features/assistant/chat-tools.ts のシステムプロンプト参照)。
 *
 * ── ホームと同じ数字を、毎回読み直して渡す(ADR-106) ──────────────
 * 以前は旧ホームの集計(今月これまでの収入 − 支出と、カテゴリの予算枠)だけを渡していたため、
 * いまのホームの「今日使える目安」「今期の見通し」「月末に残る見込み」とAIの答えが食い違った
 * (今期は予算を超えそうなのに「大丈夫そう」と答える、着地見込みは「分からない」と答える)。
 * いまはホームと同じ予測(features/home/today-forecasts.ts)を、発言を受け取るたびに明細から
 * 計算し直して渡す。作り置き(キャッシュ)はしない。
 */

import { formatEstimate, formatProbability, formatSignedEstimate } from '@/domain/forecast/format';
import { todayAllowance, type TodayAllowance } from '@/domain/forecast/today';
import { formatYen } from '@/domain/money';
import { goalOutlook } from '@/domain/savings';
import { loadHomeSummary, type HomeSummary } from '@/features/home/summary';
import {
  loadTodayForecasts,
  todayCapYen,
  type TodayForecasts,
} from '@/features/home/today-forecasts';
import { daysBetween, todayJst, type DateOnly } from '@/lib/date';

/** ホームの「今日」と同じ数字(AIに渡す形)。 */
export type TodayNumbers = {
  /** 計算した時刻(日本時間、「2026-10-17 08:22」)。 */
  computedAt: string;
  /** 今日使える目安(今期の目標が無ければ null)。 */
  allowance: TodayAllowance | null;
  /** 記録が少なく、目安が仮か。 */
  provisional: boolean;
  /** 今期の見通し(今期の目標が無ければ null)。 */
  outlook: {
    from: DateOnly;
    to: DateOnly;
    remainingDays: number;
    budgetYen: number;
    spentYen: number;
    p10: number;
    p50: number;
    p90: number;
    probWithinBudget: number;
    scheduledYen: number;
    fixedYen: number;
  } | null;
  /** 次の一手(へらすと効くカテゴリ)。 */
  suggestion: {
    categoryName: string;
    perWeek: number;
    savedYen: number;
    probBefore: number;
    probAfter: number;
  } | null;
  /** 月末に残る見込み(収入が無ければ null)。 */
  monthEnd: { to: DateOnly; incomeYen: number; p50: number } | null;
};

/** 日本時間の「2026-10-17 08:22」。 */
function jstStamp(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** ホームの「今日」(TodaySection)と同じ式で、AIに渡す数字を取り出す。 */
export function todayNumbersOf(f: TodayForecasts, now: Date): TodayNumbers {
  const view = f.goal ? f.goalView : null;
  const forecast = view?.forecast ?? null;
  const balance = f.monthView?.forecast.balance ?? null;
  return {
    computedAt: jstStamp(now),
    allowance:
      view && forecast
        ? todayAllowance({ capYen: todayCapYen(view), spentTodayYen: view.todaySpentYen })
        : null,
    provisional: forecast?.provisional ?? false,
    outlook:
      f.goal && forecast && forecast.probWithinBudget !== null
        ? {
            from: f.goal.period.from,
            to: f.goal.period.to,
            remainingDays: Math.max(0, daysBetween(f.today, f.goal.period.to) + 1),
            budgetYen: f.goal.budgetYen,
            spentYen: forecast.breakdown.actualYen,
            p10: forecast.total.p10,
            p50: forecast.total.p50,
            p90: forecast.total.p90,
            probWithinBudget: forecast.probWithinBudget,
            scheduledYen: forecast.committed?.scheduledYen ?? 0,
            fixedYen: forecast.committed?.fixedYen ?? 0,
          }
        : null,
    suggestion: forecast?.suggestion
      ? {
          categoryName: forecast.suggestion.categoryName,
          perWeek: forecast.suggestion.perWeek,
          savedYen: forecast.suggestion.savedYen,
          probBefore: forecast.suggestion.probBefore,
          probAfter: forecast.suggestion.probAfter,
        }
      : null,
    monthEnd: balance
      ? { to: f.monthPeriod.to, incomeYen: balance.incomeYen, p50: balance.p50 }
      : null,
  };
}

/** ホームの「今日」と同じ数字を、AIが読む文にする。 */
export function formatTodayNumbers(n: TodayNumbers): string[] {
  const lines: string[] = [
    `ホームの「今日」と同じ数字(${n.computedAt} に明細から計算し直した最新の値):`,
  ];
  const yen = (v: number) => formatYen(v, { sign: 'never' });

  if (n.allowance === null) {
    lines.push('- 今日使える目安: 今期の目標(予算)が無いので出していない');
  } else {
    const a = n.allowance;
    const head = `- 今日使える目安${n.provisional ? '(記録が少ないので仮)' : ''}: 1日の上限${yen(a.capYen)}、今日もう使った${yen(a.spentYen)}`;
    lines.push(
      a.kind === 'left'
        ? `${head} → 今日はあと${yen(a.leftYen)}使える`
        : `${head} → 今日はもう上限を${yen(a.overYen)}超えている`,
    );
    lines.push('  (使わなかった分は明日以降の上限に回る。毎日、予測から出し直す)');
  }

  if (n.outlook !== null) {
    const o = n.outlook;
    const over = o.p50 - o.budgetYen;
    lines.push(
      `- 今期の見通し(${o.from}〜${o.to}、今日を入れて残り${o.remainingDays}日):`,
      `  予算${yen(o.budgetYen)}、今日までに使った額${yen(o.spentYen)}`,
      `  着地見込み${formatEstimate(o.p50)}(10回中8回は${formatEstimate(o.p10, { approx: false })}〜${formatEstimate(o.p90, { approx: false })})` +
        (over > 0 ? ` → 予算を${formatEstimate(over)}超えそう` : ' → 予算内の見込み'),
      `  予算内に収まる確率${formatProbability(o.probWithinBudget)}`,
    );
    if (o.scheduledYen > 0 || o.fixedYen > 0) {
      lines.push(
        `  着地見込みには、これから払う予定${yen(o.scheduledYen)}と固定費${yen(o.fixedYen)}を入れてある`,
      );
    }
  }

  if (n.suggestion !== null) {
    const s = n.suggestion;
    lines.push(
      `- 次の一手: ${s.categoryName}を週${s.perWeek}回へらすと、支出が${formatEstimate(s.savedYen)}へり、予算内の確率は${formatProbability(s.probBefore)} → ${formatProbability(s.probAfter)}`,
    );
  }

  if (n.monthEnd === null) {
    lines.push('- 月末に残る見込み: 今月の収入の記録が無いので出していない');
  } else {
    const m = n.monthEnd;
    lines.push(
      `- 月末(${m.to})に残る見込み: ${formatSignedEstimate(m.p50)}(収入${formatEstimate(m.incomeYen, { approx: false })} − 支出の見込み${formatEstimate(m.incomeYen - m.p50)})`,
    );
  }
  return lines;
}

/** 旧ホームの集計から、貯金・カテゴリの予算・貯金目標の行を作る。 */
function formatSummary(summary: HomeSummary, today: DateOnly): string[] {
  const { savings } = summary;
  const lines: string[] = ['', '貯金(収入 − 支出で自動で数える):'];
  lines.push(
    `- 今月これまで(今日までの収入 − 支出。月末の見込みではない): ${formatYen(savings.thisMonthYen)}`,
  );
  if (savings.paceYen !== null)
    lines.push(`- いつもの月(直近3か月の平均): ${formatYen(savings.paceYen)}`);
  if (savings.startOn !== null) {
    lines.push(`- ${savings.startOn}から貯まった合計: ${formatYen(savings.totalYen)}`);
  }

  lines.push('', 'カテゴリの月の予算(今月分、ホームに出すと決めたカテゴリだけ):');
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
  return lines;
}

export async function buildAdvisorContextText(now: Date = new Date()): Promise<string> {
  const today = todayJst(now);
  const [forecasts, summary] = await Promise.all([
    loadTodayForecasts(now).catch(() => null),
    loadHomeSummary(now).catch(() => null),
  ]);
  if (forecasts === null && summary === null) throw new Error('今の状況を読めませんでした');

  const lines: string[] = [`今日の日付: ${today}`, ''];
  if (forecasts !== null) lines.push(...formatTodayNumbers(todayNumbersOf(forecasts, now)));
  if (summary !== null) lines.push(...formatSummary(summary, today));
  return lines.join('\n');
}
