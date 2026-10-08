'use client';

import { categoryHref } from '@/lib/category-nav';
import { useJustSaved } from '@/lib/just-saved';
import { useState } from 'react';

import { GenreBudgetRow } from '@/components/ui/genre-budget-row';
import { useGenreOverrides } from '@/components/ui/genre-style-context';
import { genreBarColor } from '@/domain/genre-style';
import { formatYen } from '@/domain/money';
import type { GoalBreakdownRow } from '@/features/goals/view';
import type { GenreBreakdownRow } from '@/features/spending/ledger-types';
import { useSpendingMonth } from './spending-month-provider';

/**
 * ジャンル内訳(積み上げバー + 一覧)。既存の「明細サマリーカード」は廃止し、
 * 内訳はここ1つに統一した。数字は domain/ledger.ts の集計(ヘッダーと同じ値)。
 * 行をタップすると、明細リストがそのジャンルに絞り込まれる(もう一度で解除)。
 *
 * 目標があるときは「今月 / 目標期間」を切り替えられ、目標期間では目標画面と共通の
 * 行(実績バー + 今日時点の理想ラインの目印 + 状態色)で見せる。
 */
export function GenreBreakdown({ goalRows }: { goalRows: readonly GoalBreakdownRow[] | null }) {
  const overrides = useGenreOverrides();
  const { genreBreakdown, filter, isCurrentMonth, loading, visibleMonth } = useSpendingMonth();
  const [scope, setScope] = useState<'month' | 'goal'>('month');
  const justSaved = useJustSaved().length > 0;
  const useGoal = scope === 'goal' && goalRows !== null && isCurrentMonth;

  const rows: {
    key: string;
    genreId: string | null;
    name: string;
    spentYen: number;
    budgetYen: number | null;
    idealYen: number | null;
    scheduledYen: number;
  }[] = useGoal
    ? goalRows!.map((r) => ({
        key: r.genreId ?? 'none',
        genreId: r.genreId,
        name: r.genreName,
        spentYen: r.spentYen,
        budgetYen: r.targetYen,
        idealYen: r.idealYen,
        scheduledYen: r.scheduledYen,
      }))
    : genreBreakdown.map((r: GenreBreakdownRow) => ({
        key: r.genreId ?? 'none',
        genreId: r.genreId,
        name: r.genreName,
        spentYen: r.spentYen,
        budgetYen: r.budgetYen,
        idealYen: null,
        scheduledYen: 0,
      }));

  const total = rows.reduce((a, r) => a + r.spentYen, 0);
  const maxYen = Math.max(...rows.map((r) => r.spentYen), 1);

  return (
    <section aria-label="ジャンル別の内訳" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 px-1 pt-2">
        <h2 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>
          ジャンル別
        </h2>
        {goalRows !== null && isCurrentMonth ? (
          <div role="radiogroup" aria-label="集計の範囲" className="flex gap-1 text-xs">
            {(
              [
                ['month', '今月'],
                ['goal', '目標期間'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                onClick={() => setScope(value)}
                className="min-h-11 rounded-full px-3 py-1 font-semibold"
                style={{
                  background: scope === value ? 'var(--accent)' : 'var(--plane)',
                  color: scope === value ? 'var(--on-accent)' : 'var(--ink-secondary)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div
        className="rounded-[28px] px-5 py-4"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        {loading && !isCurrentMonth ? (
          <div className="space-y-3" role="status" aria-label="読み込み中">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-lg"
                style={{ background: 'var(--hairline)' }}
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {isCurrentMonth
              ? 'まだ支出の記録がありません。レシートを撮ると、ここに内訳が出ます。'
              : 'この月の支出はありません。'}
          </p>
        ) : (
          <>
            <div
              role="img"
              aria-label={`内訳:${rows
                .map((r) => `${r.name} ${formatYen(r.spentYen, { sign: 'never' })}`)
                .join('、')}`}
              className={`flex h-3 w-full overflow-hidden rounded-full ${justSaved ? 'bar-grow' : ''}`}
              style={{ background: 'var(--state-none-track)' }}
            >
              {rows.map((r) => (
                <span
                  key={r.key}
                  style={{
                    width: `${(r.spentYen / Math.max(total, 1)) * 100}%`,
                    background: genreBarColor(
                      r.genreId === null ? null : r.name,
                      r.genreId === null ? null : overrides[r.name],
                    ),
                  }}
                />
              ))}
            </div>

            <ul className="mt-2 space-y-1">
              {rows.map((r) => {
                const selected =
                  filter.genreId === (r.genreId === null ? 'none' : r.genreId) &&
                  filter.genreId !== null;
                return (
                  <li key={r.key}>
                    <GenreBudgetRow
                      name={r.name}
                      spentYen={r.spentYen}
                      budgetYen={r.budgetYen}
                      idealYen={r.idealYen}
                      scheduledYen={r.scheduledYen}
                      maxYen={maxYen}
                      selected={selected}
                      href={categoryHref(r.key, visibleMonth)}
                      sharedKey={r.key}
                    />
                  </li>
                );
              })}
            </ul>
            <p className="tabular mt-2 text-right text-xs" style={{ color: 'var(--ink-muted)' }}>
              合計 {formatYen(total, { sign: 'never' })}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
