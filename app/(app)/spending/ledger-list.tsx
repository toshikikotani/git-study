'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { LedgerAmount, Yen } from '@/components/ui/money';
import { MAX_YEN } from '@/domain/money';
import { isSplitPaymentEligible } from '@/domain/split-payment-request';
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
import { weekdayOf } from '@/lib/date';
import { TransactionRowWithSplit } from '../transactions/split-editor';
import type { DrilldownTransaction } from './drilldown';
import { ActiveFilterChips } from './filter-sheet';
import { PendingReceiptRows } from './pending-receipt-rows';
import { SplitPaymentSheet } from './split-payment-sheet';
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
type LedgerListProps = {
  goalRange: { from: string; to: string } | null;
  duplicateCount: number;
  fixedKeys?: readonly string[];
};

export function LedgerList(props: LedgerListProps) {
  const { visibleMonth, filter } = useSpendingMonth();
  // 月・絞り込みを変えたら、見えなくなった明細の選択と請求文を残さない。
  return <LedgerListContent key={JSON.stringify([visibleMonth, filter])} {...props} />;
}

function LedgerListContent({ goalRange, duplicateCount, fixedKeys = [] }: LedgerListProps) {
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
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [splitOpen, setSplitOpen] = useState(false);
  const selectionReady = !loading && (error === null || isCurrentMonth) && !filter.pendingOnly;
  const fixedKeySet = useMemo(() => new Set(fixedKeys), [fixedKeys]);
  const isFixed = useCallback(
    (t: (typeof transactions)[number]) =>
      fixedKeySet.has(subscriptionKeyOf(t.label, t.description, t.amountYen)) ||
      (t.genreId !== null && fixedKeySet.has(`genre:${t.genreId}`)),
    [fixedKeySet],
  );

  const filtered = useMemo(() => filterLedger(transactions, filter), [transactions, filter]);
  const eligible = useMemo(() => {
    const seen = new Set<string>();
    return filtered.filter((t) => {
      if (!isSplitPaymentEligible(t) || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [filtered]);
  const selected = useMemo(
    () => eligible.filter((t) => selectedIds.has(t.id)),
    [eligible, selectedIds],
  );
  const selectedTotal = selected.reduce((sum, t) => sum - t.amountYen, 0);
  const validTotal = Number.isSafeInteger(selectedTotal) && selectedTotal <= MAX_YEN;
  const toggleSelected = (id: string) =>
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setSplitOpen(false);
  };
  const selection = selectMode ? { selectedIds, onToggle: toggleSelected } : undefined;
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
  const monthLabel = `${Number(visibleMonth.slice(5, 7))}月の固定費`;
  const risky = useMemo(
    () => transactions.filter((t) => isRiskyPaymentMethod(t.paymentMethod)),
    [transactions],
  );
  const active = isFilterActive(filter);

  return (
    <section
      id="ledger"
      aria-label="明細"
      className={`scroll-mt-16 flex flex-col gap-3 ${selectMode ? 'pb-24' : ''}`}
    >
      <ActiveFilterChips goalRange={goalRange} />
      <PendingReceiptRows />
      {eligible.length > 0 || selectMode ? (
        <div className="flex min-h-11 items-center justify-between gap-3 px-1">
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {selectMode ? '割り勘にする支出を選んでください' : 'まとめて割り勘を請求できます'}
          </p>
          <button
            type="button"
            aria-pressed={selectMode}
            disabled={!selectMode && !selectionReady}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            className="min-h-11 shrink-0 px-2 text-[15px] font-semibold disabled:opacity-40"
            style={{ color: 'var(--accent)' }}
          >
            {selectMode ? 'キャンセル' : '選択'}
          </button>
        </div>
      ) : null}
      {risky.length > 0 ? (
        <Link
          href="/transactions/reconcile"
          className="flex min-h-11 items-center justify-between rounded-2xl px-4 py-3"
          style={{ background: 'var(--surface)' }}
        >
          <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
            二重に入っていそうな明細が {duplicateCount} 組
          </p>
          <span className="text-[15px] font-semibold" style={{ color: 'var(--accent)' }}>
            確認する
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
          {model.scheduled.some((t) => !isFixed(t)) ? (
            <DaySection
              key="scheduled"
              heading="予定 · 使った額には入りません"
              transactions={model.scheduled.filter((t) => !isFixed(t))}
              selection={selection}
            />
          ) : null}
          {fixed.length > 0 ? (
            <DaySection
              key="fixed"
              id="fixed-costs"
              heading={monthLabel}
              total={fixed.reduce((sum, t) => sum - t.amountYen, 0)}
              transactions={fixed}
              selection={selection}
            />
          ) : null}
          {dayGroups.map((g) => (
            <DaySection
              key={g.date}
              heading={dayHeading(g.date)}
              total={g.spentYen}
              transactions={g.transactions}
              selection={selection}
            />
          ))}
          <p className="px-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {active
              ? `${filtered.length}件 / この月 ${transactions.length}件`
              : `${transactions.length}件`}
          </p>
        </>
      )}
      {selectMode ? (
        <div
          role="region"
          aria-label="選択した明細の操作"
          className="fixed inset-x-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-lg"
          style={{ background: 'var(--surface)', borderColor: 'var(--hairline)' }}
        >
          <p className="tabular flex min-w-0 flex-col text-[13px]" aria-live="polite">
            <span>{selected.length}件を選択</span>
            {validTotal ? (
              <Yen value={selectedTotal} className="text-[20px] font-bold" />
            ) : (
              <span className="text-[13px]">合計が金額の上限を超えています</span>
            )}
          </p>
          <Button
            type="button"
            disabled={selected.length === 0 || !validTotal || !selectionReady}
            onClick={() => setSplitOpen(true)}
            className="shrink-0 text-[15px] font-semibold"
            variant="filled"
          >
            割り勘
          </Button>
        </div>
      ) : null}
      <SplitPaymentSheet
        open={splitOpen && selectionReady}
        transactions={selected}
        onClose={() => setSplitOpen(false)}
      />
    </section>
  );
}

/** 2026-10-15 → 10月15日（木） */
function dayHeading(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${WEEKDAYS[weekdayOf(date)]}）`;
}

/**
 * 日付・予定・固定費の区切り(デザイン仕様書の「明細」):白い面の上に見出しと合計、その下に行。
 * その日の記録はたたまず、すべて出す(本人の要望「省略はなし」、ADR-095)。
 */
function DaySection({
  id,
  heading,
  total,
  transactions,
  selection,
}: {
  id?: string;
  heading: string;
  total?: number;
  transactions: DrilldownTransaction[];
  selection?:
    | {
        selectedIds: ReadonlySet<string>;
        onToggle: (id: string) => void;
      }
    | undefined;
}) {
  const { genres, transactions: monthTransactions } = useSpendingMonth();
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
    <section id={id} aria-label={heading} className="scroll-mt-16 flex flex-col gap-1">
      <div
        className="tabular flex items-baseline justify-between px-4 pt-2 text-[13px]"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span>{heading}</span>
        {total !== undefined && total > 0 ? <Yen value={total} /> : null}
      </div>
      <div className="overflow-hidden rounded-2xl" style={{ background: 'var(--surface)' }}>
        <ul className="divider-list">
          {transactions.map((t) =>
            selection ? (
              <SelectableTransaction
                key={t.id}
                transaction={t}
                selected={selection.selectedIds.has(t.id)}
                onToggle={() => selection.onToggle(t.id)}
              />
            ) : (
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
                    refund: t.kind === 'refund',
                  }}
                />
              </div>
            ),
          )}
        </ul>
      </div>
    </section>
  );
}

/** 選択中は行全体でチェックを切り替え、編集やスワイプの誤操作を避ける。 */
function SelectableTransaction({
  transaction: t,
  selected,
  onToggle,
}: {
  transaction: DrilldownTransaction;
  selected: boolean;
  onToggle: () => void;
}) {
  const eligible = isSplitPaymentEligible(t);
  return (
    <li style={selected ? { background: 'var(--accent-track)' } : undefined}>
      <label className="flex min-h-14 items-start gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={selected && eligible}
          disabled={!eligible}
          onChange={onToggle}
          aria-label={`${t.label}、${Math.abs(t.amountYen).toLocaleString('ja-JP')}円を選択`}
          className="mt-1 size-5 shrink-0"
          style={{ accentColor: 'var(--accent)' }}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0 text-[15px] font-medium break-words">{t.label}</span>
            <LedgerAmount amountYen={t.amountYen} className="shrink-0 text-[15px]" />
          </span>
          <span className="text-[12px] break-words" style={{ color: 'var(--ink-muted)' }}>
            {t.occurredOn.replaceAll('-', '/')}
            {t.branchName ? ` · ${t.branchName}` : ''}
          </span>
          {t.items.length > 0 ? (
            <span className="text-[12px] break-words" style={{ color: 'var(--ink-secondary)' }}>
              {t.items.map((item) => item.name).join('・')}
            </span>
          ) : null}
          {!eligible ? (
            <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              {t.status === 'scheduled' ? '予定は対象外です' : '支出の実績だけ選べます'}
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );
}

/** 検索(デザイン仕様書の「明細」:灰色の面に虫眼鏡と「店名・品目・メモ」)。 */
export function LedgerSearch() {
  const { filter, setFilter } = useSpendingMonth();
  return (
    <label
      className="flex h-11 items-center gap-2 rounded-xl px-3"
      style={{ background: 'var(--field)', color: 'var(--ink-muted)' }}
    >
      <svg
        aria-hidden
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" />
      </svg>
      <span className="sr-only">検索</span>
      <input
        type="search"
        value={filter.search ?? ''}
        onChange={(e) => setFilter({ search: e.target.value })}
        placeholder="店名・品目・メモ"
        aria-label="明細を検索"
        className="min-w-0 flex-1 bg-transparent text-[17px] outline-none"
        style={{ color: 'var(--ink)' }}
      />
    </label>
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
