'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { formatSignedYen } from '@/domain/budget-state';
import { formatYen } from '@/domain/money';
import { isRiskyPaymentMethod } from '@/features/classification/rules';
import {
  EMPTY_FILTER,
  buildListModel,
  filterLedger,
  isFilterActive,
  splitShares,
} from '@/features/spending/views';
import { addDays, formatDateJa, weekdayOf } from '@/lib/date';
import { TransactionRowWithSplit } from '../transactions/split-editor';
import type { DrilldownTransaction } from './drilldown';
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
    clearFilter,
    genres,
    accounts,
    loading,
    error,
    isCurrentMonth,
    reloadVisibleMonth,
  } = useSpendingMonth();

  const filtered = useMemo(() => filterLedger(transactions, filter), [transactions, filter]);
  const model = useMemo(() => buildListModel(filtered, today), [filtered, today]);
  const risky = useMemo(
    () => transactions.filter((t) => isRiskyPaymentMethod(t.paymentMethod)),
    [transactions],
  );
  const active = isFilterActive(filter);

  const periodValue =
    filter.date !== null
      ? `date:${filter.date}`
      : filter.range !== null && (goalRange === null || filter.range.from !== goalRange.from)
        ? 'week'
        : '';

  return (
    <section aria-label="明細" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          明細
        </h2>
        <LedgerMenu />
      </div>

      {/* 検索 + 横スクロールのフィルターチップ(1行) */}
      <input
        type="search"
        value={filter.search}
        onChange={(e) => setFilter({ search: e.target.value })}
        placeholder="店名・品目・メモを検索"
        aria-label="明細を検索"
        className="w-full rounded-xl px-3 py-2 text-sm"
        style={{
          background: 'var(--plane)',
          color: 'var(--ink)',
          border: '1px solid var(--hairline)',
        }}
      />
      <div
        role="group"
        aria-label="明細の絞り込み"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        style={{ scrollbarWidth: 'none' }}
      >
        <ChipSelect
          label="口座で絞り込む"
          value={filter.accountId ?? ''}
          onChange={(v) => setFilter({ accountId: v || null })}
          options={[
            ['', 'すべての口座'],
            ...accounts.map((a) => [a.id, a.name] as [string, string]),
          ]}
        />
        <ChipSelect
          label="ジャンルで絞り込む"
          value={filter.genreId ?? ''}
          onChange={(v) => setFilter({ genreId: v || null })}
          options={[
            ['', 'すべてのジャンル'],
            ['none', '未分類'],
            ...genres.map((g) => [g.id, g.name] as [string, string]),
          ]}
        />
        <ChipSelect
          label="期間で絞り込む"
          value={periodValue}
          onChange={(v) => {
            if (v === '') setFilter({ date: null, range: null });
            else if (v === 'week')
              setFilter({ date: null, range: { from: addDays(today, -6), to: today } });
            else if (v === 'today') setFilter({ date: today, range: null });
          }}
          options={[
            ['', '月全体'],
            ['today', '今日'],
            ['week', '直近7日'],
            ...(filter.date !== null && filter.date !== today
              ? ([[`date:${filter.date}`, formatDateJa(filter.date)]] as [string, string][])
              : []),
          ]}
        />
        {goalRange !== null ? (
          <button
            type="button"
            aria-pressed={filter.range?.from === goalRange.from}
            onClick={() =>
              setFilter({
                date: null,
                range: filter.range?.from === goalRange.from ? null : goalRange,
              })
            }
            className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold"
            style={{
              background: filter.range?.from === goalRange.from ? 'var(--accent)' : 'var(--plane)',
              color:
                filter.range?.from === goalRange.from ? 'var(--on-accent)' : 'var(--ink-secondary)',
              border: '1px solid var(--hairline)',
            }}
          >
            目標期間
          </button>
        ) : null}
        {active ? (
          <button
            type="button"
            onClick={clearFilter}
            className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            解除
          </button>
        ) : null}
      </div>

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
          className="flex items-center justify-between gap-3 rounded-2xl p-4"
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
            className="mt-2 text-sm font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            もう一度読み込む
          </button>
        </div>
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
            className="mt-2 text-sm font-semibold"
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
          <p className="px-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {active
              ? `${filtered.length}件 / この月 ${transactions.length}件`
              : `${transactions.length}件`}
          </p>
        </>
      )}
    </section>
  );
}

function ChipSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  const active = value !== '';
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold"
      style={{
        background: active ? 'var(--accent-track)' : 'var(--plane)',
        color: active ? 'var(--accent)' : 'var(--ink-secondary)',
        border: '1px solid var(--hairline)',
        // iOS はフォント 16px 未満だと拡大されるが、チップは見た目を優先して小さく保つ。
        fontSize: 12,
      }}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
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
      className="rounded-2xl"
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
          {sub ? <span className="ml-2 text-[10px] font-normal">{sub}</span> : null}
        </span>
        {total !== undefined && total > 0 ? (
          <span className="tabular text-xs">{formatSignedYen(-total)}</span>
        ) : null}
      </div>
      <ul className="divide-y" style={{ borderColor: 'var(--hairline)' }}>
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
          className="flex items-center gap-3 rounded-2xl p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div
            className="size-8 animate-pulse rounded-full"
            style={{ background: 'var(--hairline)' }}
          />
          <div className="flex-1 space-y-2">
            <div
              className="h-3 w-1/2 animate-pulse rounded"
              style={{ background: 'var(--hairline)' }}
            />
            <div
              className="h-2.5 w-1/3 animate-pulse rounded"
              style={{ background: 'var(--hairline)' }}
            />
          </div>
          <div
            className="h-3 w-14 animate-pulse rounded"
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
        className="rounded-3xl p-6"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
      >
        <p className="text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
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
