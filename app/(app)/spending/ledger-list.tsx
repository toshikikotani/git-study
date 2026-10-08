'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Yen } from '@/components/ui/money';
import { formatYen } from '@/domain/money';
import { isRiskyPaymentMethod } from '@/features/classification/rules';
import {
  EMPTY_FILTER,
  buildListModel,
  filterLedger,
  isFilterActive,
  splitShares,
} from '@/features/spending/views';
import { useJustSaved } from '@/lib/just-saved';
import { formatDateJa, weekdayOf } from '@/lib/date';
import { TransactionRowWithSplit } from '../transactions/split-editor';
import type { DrilldownTransaction } from './drilldown';
import { ActiveFilterChips, FilterSheet } from './filter-sheet';
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
}: {
  goalRange: { from: string; to: string } | null;
  duplicateCount: number;
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
  } = useSpendingMonth();

  const filtered = useMemo(() => filterLedger(transactions, filter), [transactions, filter]);
  const model = useMemo(() => buildListModel(filtered, today), [filtered, today]);
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

      {/* 検索 + フィルター(ボトムシート)。選んでいる条件は下のチップで見せる */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={filter.search}
          onChange={(e) => setFilter({ search: e.target.value })}
          placeholder="店名・品目・メモを検索"
          aria-label="明細を検索"
          className="min-h-11 min-w-0 flex-1 rounded-xl px-3 text-sm"
          style={{
            background: 'var(--surface-raised)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
        <FilterSheet goalRange={goalRange} />
      </div>
      <ActiveFilterChips goalRange={goalRange} />

      <PendingReceiptRows />

      {/* リボ・キャッシング(FR-21):増やしてはいけない借入は、一覧の上で数を見せる */}
      {risky.length > 0 ? (
        <div
          role="note"
          className="rounded-2xl p-4"
          style={{ background: 'var(--attention-track)', border: '1px solid var(--state-caution)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            <span aria-hidden>▲ </span>リボ・キャッシング・分割が {risky.length} 件あります
          </p>
          <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            合計 {formatYen(risky.reduce((a, t) => a + Math.abs(t.amountYen), 0))}。
            該当カードの停止を検討してください。
          </p>
        </div>
      ) : null}

      {duplicateCount > 0 ? (
        <Link
          href="/transactions/duplicates"
          className="glass min-h-11 flex items-center justify-between gap-3 rounded-2xl p-4"
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
      ) : model.dayGroups.length === 0 && model.scheduled.length === 0 ? (
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
          {model.scheduled.length > 0 ? (
            <DaySection
              key="scheduled"
              heading="予定"
              sub="今日より先の日付(使った額には入りません)"
              transactions={model.scheduled}
            />
          ) : null}
          {model.dayGroups.map((g) => (
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
  /** その日の使った額(正の数)。予定には出さない。 */
  total?: number;
  transactions: DrilldownTransaction[];
}) {
  const { genres, transactions: monthTransactions } = useSpendingMonth();
  const justSavedIds = useJustSaved();
  // 未分類の予測に使う、この月の「店 → ジャンル」の履歴。
  const history = useMemo(
    () =>
      monthTransactions
        .filter((t) => t.genreId !== null && t.amountYen < 0)
        .map((t) => ({ storeName: t.label, genreId: t.genreId! })),
    [monthTransactions],
  );
  return (
    <section
      aria-label={heading}
      className="glass rounded-2xl"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      {/* 日付ヘッダーは画面上部に固定(ステータスバー下のぼかしの下に付く) */}
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
          <TransactionRowWithSplit
            key={t.id}
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
