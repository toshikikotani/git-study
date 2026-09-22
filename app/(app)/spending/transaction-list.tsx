'use client';

/**
 * 今月の明細一覧(本人発案:「普通に今月分使った一覧」「ソート順変更」)。
 *
 * 明細の一覧・編集そのものは /transactions(全期間、分類の修正も可能)が
 * 担っており、ここで重複させる必要はない。家計簿で欲しいのは「今月、結局
 * 何にいくら使ったか」を一望できることと、それを並べ替えられることなので、
 * 表示専用(読み取り専用)に絞ってある。
 */

import { useState } from 'react';

import { formatYen } from '@/domain/money';
import type { LedgerTransaction } from '@/features/spending/store';
import { formatDateJa } from '@/lib/date';

type SortOrder = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';

const SORT_OPTIONS: readonly { value: SortOrder; label: string }[] = [
  { value: 'date-desc', label: '新しい順' },
  { value: 'date-asc', label: '古い順' },
  { value: 'amount-desc', label: '金額が大きい順' },
  { value: 'amount-asc', label: '金額が小さい順' },
];

function sortTransactions(
  transactions: readonly LedgerTransaction[],
  order: SortOrder,
): LedgerTransaction[] {
  const sorted = [...transactions];
  switch (order) {
    case 'date-desc':
      return sorted.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
    case 'date-asc':
      return sorted.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
    // 金額の大小は支出・収入を問わず絶対値で比べる(「一番大きな動き」を知りたい場面を想定)。
    case 'amount-desc':
      return sorted.sort((a, b) => Math.abs(b.amountYen) - Math.abs(a.amountYen));
    case 'amount-asc':
      return sorted.sort((a, b) => Math.abs(a.amountYen) - Math.abs(b.amountYen));
  }
}

export function MonthlyTransactionList({
  transactions,
}: {
  transactions: readonly LedgerTransaction[];
}) {
  const [order, setOrder] = useState<SortOrder>('date-desc');
  const sorted = sortTransactions(transactions, order);

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          今月の明細({transactions.length}件)
        </p>
        <select
          value={order}
          onChange={(event) => setOrder(event.target.value as SortOrder)}
          aria-label="並び替え"
          className="rounded-full px-2.5 py-1 text-[11px] font-medium"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink-secondary)',
            border: '1px solid var(--hairline)',
          }}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {sorted.length === 0 ? (
        <p className="px-4 pb-4 text-xs" style={{ color: 'var(--ink-muted)' }}>
          今月はまだ明細がありません。
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--hairline)' }}>
          {sorted.map((t) => {
            const isIncome = t.amountYen > 0;
            return (
              <li key={t.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm" style={{ color: 'var(--ink)' }}>
                    {t.label}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {formatDateJa(t.occurredOn)}
                    {t.categoryName ? ` ・ ${t.categoryName}` : ''}
                  </span>
                  {/* レシートの商品名(本人発案「レシートは店と品目を合わせた
                      概念」、ADR-034)。何に使ったかをここでも見せる。 */}
                  {t.itemNames.length > 0 ? (
                    <span className="truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {t.itemNames.join('、')}
                    </span>
                  ) : null}
                </span>
                <span
                  className="tabular shrink-0 text-sm font-medium"
                  style={{ color: isIncome ? 'var(--income)' : 'var(--ink)' }}
                >
                  {formatYen(t.amountYen)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
