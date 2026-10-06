'use client';

import { GenreBudgetRow } from '@/components/ui/genre-budget-row';
import { Yen } from '@/components/ui/money';
import type { CategoryDetailData } from '@/features/category/loader';
import {
  previousComparisonWords,
  type CategorySummary as Summary,
} from '@/features/category/insights';
import { goalOverlaps } from '@/features/category/pace';
import { formatDateJa } from '@/lib/date';

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/**
 * サマリー:件数・1回あたりの平均・前月(同日)との比較。目標期間中は、家計簿・目標と共通の
 * ジャンル行(予算バー・理想ライン・状態)を出す。予定があれば「予定 ○円」を1行、タップで展開。
 * 前月のデータが無いときは比較を出さない。
 */
export function SummarySection({
  summary,
  goal,
  monthStart,
  monthEnd,
  genreName,
  today,
}: {
  summary: Summary;
  goal: CategoryDetailData['goal'];
  monthStart: string;
  monthEnd: string;
  genreName: string;
  today: string;
}) {
  // 目標の行は、表示中の期間が目標期間と重なるときだけ出す。
  const inGoal =
    goal !== null &&
    goal.active &&
    goal.row !== null &&
    goal.row.targetYen !== null &&
    goalOverlaps(goal.range, monthStart, monthEnd);
  return (
    <section
      aria-label="サマリー"
      className="space-y-3 rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      {/* 件数と1回あたりは大きな数字にせず、1行にまとめる */}
      <p className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
        <span className="font-semibold" style={{ color: 'var(--ink)' }}>
          {summary.count}件
        </span>
        {summary.averageYen === null ? null : (
          <>
            {' · '}1回あたり{' '}
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>
              {summary.averageYen.toLocaleString('ja-JP')}円
            </span>
          </>
        )}
      </p>

      {summary.vsPrevious ? (
        <p className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
          {previousComparisonWords(summary.vsPrevious)}
          {summary.vsPrevious.percent !== null ? `(${Math.abs(summary.vsPrevious.percent)}%)` : ''}
        </p>
      ) : null}

      {inGoal ? (
        <div className="border-t pt-2" style={{ borderColor: 'var(--divider)' }}>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            目標期間 {md(goal!.range.from)}〜{md(goal!.range.to)}
          </p>
          <GenreBudgetRow
            name={genreName}
            hideName
            spentYen={goal!.row!.spentYen}
            budgetYen={goal!.row!.targetYen}
            idealYen={goal!.row!.idealYen}
            scheduledYen={goal!.row!.scheduledYen}
            maxYen={goal!.row!.spentYen}
          />
        </div>
      ) : null}

      {summary.scheduledYen > 0 ? (
        <details className="border-t pt-2" style={{ borderColor: 'var(--divider)' }}>
          <summary className="flex min-h-11 cursor-pointer items-baseline justify-between gap-3 text-sm">
            <span style={{ color: 'var(--ink-secondary)' }}>
              予定 <Yen value={summary.scheduledYen} />
            </span>
            <span style={{ color: 'var(--ink)' }}>内訳 →</span>
          </summary>
          <ul className="mt-1 space-y-2">
            {summary.scheduledLines.map((l) => (
              <li key={l.txId} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0" style={{ color: 'var(--ink)' }}>
                  <span className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {l.occurredOn === today ? '今日' : formatDateJa(l.occurredOn)}
                  </span>{' '}
                  {l.label}
                </span>
                <Yen value={-l.amountYen} className="shrink-0" />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
