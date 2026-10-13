'use client';

import Link from 'next/link';
import { useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Yen } from '@/components/ui/money';
import { subscriptionKeyOf } from '@/domain/subscriptions';
import { isRiskyPaymentMethod } from '@/features/classification/rules';
import {
  EMPTY_FILTER,
  buildListModel,
  filterLedger,
  isFilterActive,
  splitShares,
} from '@/features/spending/views';
import { useJustSaved } from '@/lib/just-saved';
import { setTransactionMustPayAction } from '../transactions/actions';
import { formatDateJa, weekdayOf } from '@/lib/date';
import { TransactionRowWithSplit } from '../transactions/split-editor';
import type { DrilldownTransaction } from './drilldown';
import { ActiveFilterChips } from './filter-sheet';
import { LedgerMenu } from './ledger-menu';
import { PendingReceiptRows } from './pending-receipt-rows';
import { useSpendingMonth } from './spending-month-provider';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 明細リスト。
 *
 * 行:正規化した店名(1行目)、支店名と品目のプレビュー(2行目)、右に金額、ジャンルの
 * アイコンと色、レシートのサムネイル。分割した明細は品目の羅列ではなく、ジャンル比率の
 * 細い積み上げバー。日付ヘッダーは画面上部に固定し、その日の使った額を出す。
 * 今日より先の日付は「予定」に分ける。スワイプ:右=ジャンル変更、左=複製・削除。
 * 各行に赤字のエラーは出さない(確認が要るものは要確認カードに集約)。
 *
 * フィルターは横スクロールのチップ1行(口座/ジャンル/期間/目標期間)+検索。
 */
export function LedgerList({
  goalRange,
  duplicateCount,
  fixedKeys = [],
}: {
  goalRange: { from: string; to: string } | null;
  duplicateCount: number;
  fixedKeys?: readonly string[];
}) {
  const {
    transactions,
    today,
    filter,
    setFilter,
    loading,
    error,
    isCurrentMonth,
    reloadVisibleMonth,
    captures,
    visibleMonth,
  } = useSpendingMonth();
  const fixedKeySet = useMemo(() => new Set(fixedKeys), [fixedKeys]);
  const isFixed = useCallback(
    (t: (typeof transactions)[number]) =>
      fixedKeySet.has(subscriptionKeyOf(t.label, t.description, t.amountYen)) ||
      (t.genreId !== null && fixedKeySet.has(`genre:${t.genreId}`)),
    [fixedKeySet],
  );

  const filtered = useMemo(() => filterLedger(transactions, filter), [transactions, filter]);
  const model = useMemo(() => buildListModel(filtered, today), [filtered, today]);
  const fixed = useMemo(
    () => filtered.filter((t) => t.amountYen < 0 && isFixed(t)),
    [filtered, isFixed],
  );
  const dayGroups = useMemo(
    () =>
      model.dayGroups
        .map((g) => {
          const rows = g.transactions.filter((t) => !isFixed(t));
          return {
            ...g,
            transactions: rows,
            spentYen: rows.reduce((sum, t) => sum + (t.amountYen < 0 ? -t.amountYen : 0), 0),
          };
        })
        .filter((g) => g.transactions.length > 0),
    [model.dayGroups, isFixed],
  );
  const monthLabel = `${Number(visibleMonth.slice(5, 7))}月 固定費`;
  const risky = useMemo(
    () => transactions.filter((t) => isRiskyPaymentMethod(t.paymentMethod)),
    [transactions],
  );
  const active = isFilterActive(filter);

  return (
    <section id="ledger" aria-label="明細" className="scroll-mt-16 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          明細
        </h2>
        <LedgerMenu />
      </div>
      <input
        type="search"
        value={filter.search ?? ''}
        onChange={(e) => setFilter({ search: e.target.value })}
        placeholder="店名・品目・メモを検索"
        aria-label="明細を検索"
        className="min-h-11 w-full rounded-xl px-3 text-sm"
        style={{
          background: 'var(--surface-raised)',
          color: 'var(--ink)',
          border: '1px solid var(--hairline)',
        }}
      />
      <ActiveFilterChips goalRange={goalRange} />
      <PendingReceiptRows />
      {risky.length > 0 ? (
        <Link
          href="/transactions/reconcile"
          className="flex min-h-11 items-center justify-between rounded-2xl px-4 py-3"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
            二重に入っていそうな明細が {duplicateCount} 組
          </p>
          <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
            確認する →
          </span>
        </Link>
      ) : null}

      {error !== null && !isCurrentMonth ? (
        <div role="alert" className="px-1 py-6 text-center">
          <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
            {error}
          </p>
          <button
            type="button"
            onClick={reloadVisibleMonth}
            className="min-h-11 mt-2 text-sm font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            もう一度読み込む
          </button>
        </div>
      ) : filter.pendingOnly ? (
        captures.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm" style={{ color: 'var(--ink-secondary)' }}>
            入力待ちのレシートはありません。
          </p>
        ) : null
      ) : loading && !isCurrentMonth ? (
        <ListSkeleton />
      ) : transactions.length === 0 ? (
        <EmptyState />
      ) : dayGroups.length === 0 && model.scheduled.length === 0 && fixed.length === 0 ? (
        <div className="px-1 py-6 text-center">
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            この絞り込みに一致する明細がありません。
          </p>
          <button
            type="button"
            onClick={() => setFilter(EMPTY_FILTER)}
            className="min-h-11 mt-2 text-sm font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            絞り込みを解除
          </button>
        </div>
      ) : (
        <>
          {fixed.length > 0 ? (
            <DaySection
              key="fixed"
              heading={monthLabel}
              sub="日付ではなく、この月の固定費です"
              total={fixed.reduce((sum, t) => sum - t.amountYen, 0)}
              transactions={fixed}
            />
          ) : null}
          {model.scheduled.length > 0 ? (
            <DaySection
              key="scheduled"
              heading="予定"
              sub="今日より先の日付(使った額には入りません)"
              transactions={model.scheduled.filter((t) => !isFixed(t))}
            />
          ) : null}
          {dayGroups.map((g) => (
            <DaySection
              key={g.date}
              heading={`${formatDateJa(g.date)}(${WEEKDAYS[weekdayOf(g.date)]})`}
              total={g.spentYen}
              transactions={g.transactions}
            />
          ))}
          <p className="px-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {active
              ? `${filtered.length}件 / この月 ${transactions.length}件`
              : `${transactions.length}件`}
          </p>
        </>
      )}
    </section>
  );
}

function DaySection({
  heading,
  sub,
  total,
  transactions,
}: {
  heading: string;
  sub?: string;
  total?: number;
  transactions: DrilldownTransaction[];
}) {
  const { genres, transactions: monthTransactions, reloadVisibleMonth } = useSpendingMonth();
  const justSavedIds = useJustSaved();
  const history = useMemo(
    () =>
      monthTransactions
        .filter((t) => t.genreId !== null)
        .reduce(
          (acc, t) => {
            if (t.genreId && !acc.some((e) => e.storeName === t.label)) {
              acc.push({ storeName: t.label, genreId: t.genreId });
            }
            return acc;
          },
          [] as { storeName: string; genreId: string }[],
        ),
    [monthTransactions],
  );

  return (
    <section
      className="overflow-hidden rounded-2xl"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div
        className="sticky z-10 flex items-baseline justify-between rounded-t-2xl px-4 py-2"
        style={{
          top: 'var(--sticky-top, env(safe-area-inset-top))',
          background: 'var(--surface)',
          color: 'var(--ink-muted)',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <span className="text-xs font-medium">
          {heading}
          {sub ? <span className="ml-2 text-xs font-normal">{sub}</span> : null}
        </span>
        {total !== undefined && total > 0 ? (
          <span className="tabular text-xs">
            <Yen value={total} />
          </span>
        ) : null}
      </div>
      <ul className="divider-list">
        {transactions.map((t) => (
          <div key={t.id} className="relative">
            <TransactionRowWithSplit
              transaction={t}
              categories={genres}
              initialSplits={t.splits.map((s) => ({
                id: s.id,
                genreId: s.genreId,
                genreName: s.genreName,
                amountYen: s.amountYen,
                note: s.note,
              }))}
              genreHistory={history}
              justSaved={justSavedIds.includes(t.id)}
              receiptItems={t.items}
              expenseSubtype={t.expenseSubtype}
              display={{
                name: t.label,
                branch: t.branchName,
                thumbnailUrl: t.thumbnailUrl,
                shares: splitShares(t),
                scheduled: t.status === 'scheduled',
                special: t.kind === 'special',
              }}
            />
            {t.amountYen < 0 ? (
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  const next = !t.mustPay;
                  const result = await setTransactionMustPayAction(t.id, next);
                  if (result.error) alert(result.error);
                  else reloadVisibleMonth();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex min-h-11 items-center rounded-full px-3 py-1 text-[11px] font-medium"
                style={{
                  background: t.mustPay ? 'var(--state-ok)' : 'var(--plane)',
                  color: t.mustPay ? 'var(--on-action)' : 'var(--ink-secondary)',
                }}
              >
                {t.mustPay ? '固定' : '変動'}
              </button>
            ) : null}
          </div>
        ))}
      </ul>
    </section>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="明細を読み込み中" className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="glass flex items-center gap-3 rounded-2xl p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div
            className="size-8 animate-pulse rounded-full"
            style={{ background: 'var(--hairline)' }}
          />
          <div className="flex-1 space-y-2">
            <div
              className="h-3 w-1/2 animate-pulse rounded-lg"
              style={{ background: 'var(--hairline)' }}
            />
            <div
              className="h-3 w-1/3 animate-pulse rounded-lg"
              style={{ background: 'var(--hairline)' }}
            />
          </div>
          <div
            className="h-3 w-14 animate-pulse rounded-lg"
            style={{ background: 'var(--hairline)' }}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="space-y-3">
      <div
        className="glass rounded-3xl p-6"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
      >
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          この月の明細はまだありません。
          <br />
          レシートを撮るか、銀行・カードの CSV を取り込むと、自動で分類されます。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button href="/transactions/receipt" variant="filled">
            レシートを撮る
            <span aria-hidden>→</span>
          </Button>
          <Button href="/transactions/import" variant="outlined">
            CSV を取り込む
            <span aria-hidden>→</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
