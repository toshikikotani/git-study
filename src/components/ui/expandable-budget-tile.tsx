'use client';

/**
 * ホームの残額タイル(本人発案:「あといくら使えるの所を押したら使った
 * 一覧の表示ができるように。その画面から遷移せずに」)。
 *
 * 以前は `/budget/{categoryId}` へ遷移していた(P9-7)。ホーム画面から
 * 離れずその場で開閉できるほうが、ホームを「開いて数字を見て閉じる」用途
 * (設計原則3・FR-61)に合う。明細は事前にサーバー側で取得済みのものを
 * そのまま受け取り、ここでは開閉の状態だけを持つ(追加の fetch をしない)。
 */

import { useState } from 'react';

import type { CategoryTransactionDetail } from '@/features/categories/category-detail-types';
import { formatYen } from '@/domain/money';
import { formatDateJa } from '@/lib/date';
import { StatTile } from './stat-tile';

export function ExpandableBudgetTile({
  tile,
  transactions,
  style,
}: {
  tile: React.ComponentProps<typeof StatTile>;
  transactions: readonly CategoryTransactionDetail[];
  style?: React.CSSProperties;
}) {
  const [expanded, setExpanded] = useState(false);
  const maxAbsYen = Math.max(...transactions.map((t) => Math.abs(t.amountYen)), 1);

  return (
    <div className="rise" style={style}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="block w-full text-left"
      >
        <StatTile {...tile} hint={{ text: expanded ? '閉じる' : '内訳を見る', expanded }} />
      </button>

      {expanded ? (
        <div
          className="pop-in mt-2 rounded-[22px] p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          {transactions.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              今月、このカテゴリの明細はまだありません。
            </p>
          ) : (
            <>
              <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                今月の明細({transactions.length}件)
              </p>
              <ul className="mt-3 space-y-3">
                {transactions.map((t) => {
                  const percent = Math.round((Math.abs(t.amountYen) / maxAbsYen) * 100);
                  const isIncome = t.amountYen > 0;
                  return (
                    <li key={t.id}>
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium" style={{ color: 'var(--ink)' }}>
                            {t.merchantName ?? t.description}
                          </span>
                          <span style={{ color: 'var(--ink-muted)' }}>
                            {formatDateJa(t.occurredOn)}
                          </span>
                        </span>
                        <span
                          className="tabular shrink-0 font-medium"
                          style={{ color: isIncome ? 'var(--income)' : 'var(--ink)' }}
                        >
                          {formatYen(t.amountYen)}
                        </span>
                      </div>
                      <div
                        className="mt-1 h-2 overflow-hidden rounded-full"
                        style={{
                          background: isIncome ? 'var(--income-track)' : 'var(--over-track)',
                        }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${percent}%`,
                            background: isIncome ? 'var(--income)' : 'var(--over)',
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
