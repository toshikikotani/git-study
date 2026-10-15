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
 * カテゴリ別(デザインの「家計簿」:ドーナツ + 一覧、上位5つと「ほかNカテゴリ」)。既存の「明細サマリーカード」は廃止し、
 * 内訳はここ1つに統一した。数字は domain/ledger.ts の集計(ヘッダーと同じ値)。
 * 行をタップすると、明細リストがそのジャンルに絞り込まれる(もう一度で解除)。
 *
 * 目標があるときは「今月 / 目標期間」を切り替えられ、目標期間では目標画面と共通の
 * 行(実績バー + 今日時点の理想ラインの目印 + 状態色)で見せる。
 *
 * ジャンルの月の目安(genres.budget_yen)は目標が無いときだけのものなので、目標の期間中は
 * 出さない(目標額と食い違う目安が一部の行にだけ付き、バーの基準もそろわないため)。
 */
export function GenreBreakdown({
  goalRows,
  goalActive = false,
}: {
  goalRows: readonly GoalBreakdownRow[] | null;
  goalActive?: boolean;
}) {
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
        budgetYen: goalActive ? null : r.budgetYen,
        idealYen: null,
        scheduledYen: 0,
      }));

  const total = rows.reduce((a, r) => a + r.spentYen, 0);
  const maxYen = Math.max(...rows.map((r) => r.spentYen), 1);
  const sorted = [...rows].sort((a, b) => b.spentYen - a.spentYen);
  const top = sorted.slice(0, TOP_COUNT);
  const rest = sorted.slice(TOP_COUNT);
  const restYen = rest.reduce((a, r) => a + r.spentYen, 0);
  const monthNumber = Number(visibleMonth.slice(5, 7));

  const row = (r: (typeof rows)[number]) => {
    const selected =
      filter.genreId === (r.genreId === null ? 'none' : r.genreId) && filter.genreId !== null;
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
          shareRatio={total > 0 ? r.spentYen / total : null}
        />
      </li>
    );
  };

  return (
    <section aria-label="カテゴリ別の内訳" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 px-1 pt-2">
        <h2 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>
          カテゴリ別
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
        className="glass rounded-[28px] px-5 py-4"
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
            <Donut
              rows={sorted}
              total={total}
              label={`${monthNumber}月の支出`}
              colorOf={(r) =>
                genreBarColor(
                  r.genreId === null ? null : r.name,
                  r.genreId === null ? null : overrides[r.name],
                )
              }
              grow={justSaved}
            />

            <ul className="mt-3 space-y-1">{top.map(row)}</ul>
            {rest.length > 0 ? (
              <details className="mt-1" style={{ borderTop: '1px solid var(--hairline)' }}>
                <summary
                  className="tabular flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-2 text-sm"
                  style={{ color: 'var(--ink)' }}
                >
                  <span>ほか{rest.length}カテゴリ</span>
                  <span className="flex items-center gap-3">
                    {formatYen(restYen, { sign: 'never' })}
                    <span className="w-10 text-right text-xs" style={{ color: 'var(--ink-muted)' }}>
                      {total > 0 ? Math.round((restYen / total) * 100) : 0}%
                    </span>
                  </span>
                </summary>
                <ul className="space-y-1 pb-1">{rest.map(row)}</ul>
              </details>
            ) : null}
            <p className="tabular mt-2 text-right text-xs" style={{ color: 'var(--ink-muted)' }}>
              合計 {formatYen(total, { sign: 'never' })}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/** 上位の数(残りは「ほかNカテゴリ」に畳む)。 */
const TOP_COUNT = 5;
const SIZE = 168;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** ドーナツ(中央に月の支出)。一覧と同じ色・同じ順。 */
function Donut<T extends { key: string; name: string; spentYen: number }>({
  rows,
  total,
  label,
  colorOf,
  grow,
}: {
  rows: readonly T[];
  total: number;
  label: string;
  colorOf: (row: T) => string;
  grow: boolean;
}) {
  const segments = rows
    .filter((r) => r.spentYen > 0)
    .reduce<{ row: T; dash: number; offset: number }[]>((acc, r) => {
      const prev = acc.at(-1);
      acc.push({
        row: r,
        dash: (r.spentYen / Math.max(total, 1)) * CIRCUMFERENCE,
        offset: prev ? prev.offset + prev.dash : 0,
      });
      return acc;
    }, []);
  return (
    <div className="flex justify-center">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`内訳:${rows.map((r) => `${r.name} ${formatYen(r.spentYen, { sign: 'never' })}`).join('、')}`}
          className={grow ? 'bar-grow' : undefined}
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--state-none-track)"
            strokeWidth={STROKE}
          />
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {segments.map(({ row, dash, offset: o }) => (
              <circle
                key={row.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={colorOf(row)}
                strokeWidth={STROKE}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-o}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {label}
          </span>
          <span className="tabular text-lg font-bold" style={{ color: 'var(--ink)' }}>
            {formatYen(total, { sign: 'never' })}
          </span>
        </div>
      </div>
    </div>
  );
}
