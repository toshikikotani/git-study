'use client';

import { useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { activeFilterCount, isFilterActive } from '@/features/spending/views';
import { addDays, formatDateJa, splitDateOnly } from '@/lib/date';
import { useSpendingMonth } from './spending-month-provider';

export function monthDay(date: string): string {
  const [, m, d] = splitDateOnly(date);
  return `${m}/${d}`;
}

/**
 * フィルター。横スクロールのチップ1行をやめ、「フィルター(n)」のボタンからボトムシートで
 * 選ぶ。n は選んでいる条件の数。条件は「口座・ジャンル・期間・入力待ち」で、まとめて解除できる。
 * 選んでいる間は、明細の上に「○○で絞り込み中 ×」のチップ(ActiveFilterChips)が出る。
 */
export function FilterSheet({ goalRange }: { goalRange: { from: string; to: string } | null }) {
  const { filter, setFilter, clearFilter, genres, accounts, today, captures } = useSpendingMonth();
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(filter);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="tabular flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold"
        style={{
          background: count > 0 ? 'var(--accent)' : 'transparent',
          color: count > 0 ? 'var(--on-accent)' : 'var(--ink)',
          border: '1px solid var(--hairline)',
        }}
      >
        フィルター{count > 0 ? `(${count})` : ''}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} role="dialog">
        <div className="space-y-5 px-3 pt-1 pb-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
              フィルター{count > 0 ? `(${count})` : ''}
            </h2>
            <button
              type="button"
              onClick={clearFilter}
              disabled={!isFilterActive(filter)}
              className="min-h-11 px-2 text-sm font-semibold disabled:opacity-40"
              style={{ color: 'var(--ink)' }}
            >
              すべて解除
            </button>
          </div>

          <Group label="期間">
            <Choice
              on={filter.date === null && filter.range === null}
              onClick={() => setFilter({ date: null, range: null })}
            >
              月全体
            </Choice>
            <Choice
              on={filter.date === today}
              onClick={() => setFilter({ date: today, range: null })}
            >
              今日
            </Choice>
            <Choice
              on={filter.range !== null && filter.range.from === addDays(today, -6)}
              onClick={() =>
                setFilter({ date: null, range: { from: addDays(today, -6), to: today } })
              }
            >
              直近7日
            </Choice>
            {goalRange !== null ? (
              <Choice
                on={filter.range?.from === goalRange.from && filter.range?.to === goalRange.to}
                onClick={() => setFilter({ date: null, range: goalRange })}
              >
                目標期間
              </Choice>
            ) : null}
          </Group>

          <Group label="ジャンル">
            <Choice on={filter.genreId === null} onClick={() => setFilter({ genreId: null })}>
              すべて
            </Choice>
            <Choice on={filter.genreId === 'none'} onClick={() => setFilter({ genreId: 'none' })}>
              未分類
            </Choice>
            {genres.map((g) => (
              <Choice
                key={g.id}
                on={filter.genreId === g.id}
                onClick={() => setFilter({ genreId: g.id })}
              >
                {g.name}
              </Choice>
            ))}
          </Group>

          <Group label="口座">
            <Choice on={filter.accountId === null} onClick={() => setFilter({ accountId: null })}>
              すべて
            </Choice>
            {accounts.map((a) => (
              <Choice
                key={a.id}
                on={filter.accountId === a.id}
                onClick={() => setFilter({ accountId: a.id })}
              >
                {a.name}
              </Choice>
            ))}
          </Group>

          <Group label="状態">
            <Choice
              on={filter.pendingOnly}
              onClick={() => setFilter({ pendingOnly: !filter.pendingOnly })}
            >
              入力待ち{captures.length > 0 ? `(${captures.length})` : ''}
            </Choice>
          </Group>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-12 w-full rounded-2xl text-base font-semibold"
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            完了
          </button>
        </div>
      </BottomSheet>
    </>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** 選択中=白地に濃紺の文字、未選択=枠線のみ。 */
function Choice({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="min-h-11 rounded-full px-4 text-sm font-semibold"
      style={{
        background: on ? 'var(--accent)' : 'transparent',
        color: on ? 'var(--on-accent)' : 'var(--ink-secondary)',
        border: `1px solid ${on ? 'transparent' : 'var(--hairline)'}`,
      }}
    >
      {children}
    </button>
  );
}

/** 選んでいる絞り込みの一覧。1つずつ「×」で外せる(タップ領域は44pt)。 */
export function ActiveFilterChips({
  goalRange,
}: {
  goalRange: { from: string; to: string } | null;
}) {
  const { filter, setFilter, genres, accounts } = useSpendingMonth();
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filter.date !== null) {
    chips.push({
      key: 'date',
      label: `${monthDay(filter.date)}で絞り込み中`,
      clear: () => setFilter({ date: null }),
    });
  }
  if (filter.range !== null) {
    const isGoal =
      goalRange !== null &&
      filter.range.from === goalRange.from &&
      filter.range.to === goalRange.to;
    chips.push({
      key: 'range',
      label: `${isGoal ? '目標期間' : `${monthDay(filter.range.from)}〜${monthDay(filter.range.to)}`}で絞り込み中`,
      clear: () => setFilter({ range: null }),
    });
  }
  if (filter.genreId !== null) {
    const name =
      filter.genreId === 'none'
        ? '未分類'
        : (genres.find((g) => g.id === filter.genreId)?.name ?? 'ジャンル');
    chips.push({
      key: 'genre',
      label: `${name}で絞り込み中`,
      clear: () => setFilter({ genreId: null }),
    });
  }
  if (filter.accountId !== null) {
    chips.push({
      key: 'account',
      label: `${accounts.find((a) => a.id === filter.accountId)?.name ?? '口座'}で絞り込み中`,
      clear: () => setFilter({ accountId: null }),
    });
  }
  if (filter.pendingOnly) {
    chips.push({
      key: 'pending',
      label: '入力待ちで絞り込み中',
      clear: () => setFilter({ pendingOnly: false }),
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="選んでいる絞り込み">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.clear}
          aria-label={`${c.label.replace('で絞り込み中', '')}の絞り込みを解除`}
          className="tabular inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-xs font-semibold"
          style={{
            background: 'var(--surface-raised)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          {c.label}
          <span aria-hidden>×</span>
        </button>
      ))}
    </div>
  );
}

export { formatDateJa };
