'use client';

import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { LedgerAmount, Yen } from '@/components/ui/money';
import { GenreBadge } from '@/components/ui/genre-badge';
import { ledgerRowPresentation } from '@/domain/ledger-row-presentation';
import { MAX_YEN } from '@/domain/money';
import { isSplitPaymentEligible } from '@/domain/split-payment-request';
import { subscriptionKeyOf } from '@/domain/subscriptions';
import {
  EMPTY_FILTER,
  buildListModel,
  filterLedger,
  isFilterActive,
  splitShares,
  toLedgerEntries,
} from '@/features/spending/views';
import { useJustSaved } from '@/lib/just-saved';
import { weekdayOf, formatDateJa } from '@/lib/date';
import type { CalendarView } from '@/lib/calendar-view';
import { TransactionRowWithSplit } from '../transactions/split-editor';
import type { DrilldownTransaction } from './drilldown';
import { ActiveFilterChips } from './filter-sheet';
import { PendingReceiptRows } from './pending-receipt-rows';
import { LedgerSelectionMenu } from './ledger-selection-menu';
import { LedgerSearchControls } from './ledger-search-controls';
import { CompactTransactionSummary } from './compact-transaction-summary';
import { SelectionCopySheet } from './selection-copy-sheet';
import { SplitPaymentSheet } from './split-payment-sheet';
import { useSpendingMonth } from './spending-month-provider';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 今日を開き、過去の日は合計とカテゴリでたたむ。検索・複数選択では対象行を開く。 */
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

export function LedgerListContent({ goalRange, fixedKeys = [] }: LedgerListProps) {
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
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [splitOpen, setSplitOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const selectionReady = !loading && (error === null || isCurrentMonth) && !filter.pendingOnly;
  const fixedKeySet = useMemo(() => new Set(fixedKeys), [fixedKeys]);
  const isFixed = useCallback(
    (t: (typeof transactions)[number]) =>
      fixedKeySet.has(subscriptionKeyOf(t.label, t.description, t.amountYen)) ||
      (t.genreId !== null && fixedKeySet.has(`genre:${t.genreId}`)),
    [fixedKeySet],
  );

  const filtered = useMemo(() => filterLedger(transactions, filter), [transactions, filter]);
  const model = useMemo(() => buildListModel(filtered, today), [filtered, today]);
  const dayGroups = model.dayGroups;
  const scheduledTotal = toLedgerEntries(model.scheduled).reduce(
    (sum, entry) => sum + Math.max(0, -entry.amountYen),
    0,
  );
  const fixedIds = useMemo(
    () => new Set(filtered.filter((t) => t.amountYen < 0 && isFixed(t)).map((t) => t.id)),
    [filtered, isFixed],
  );
  const selectable = useMemo(() => {
    // 全選択で、一覧に出ていない振替・対象外などを巻き込まない。
    const visibleIds = new Set([
      ...model.scheduled.map((t) => t.id),
      ...dayGroups.flatMap((g) => g.transactions.map((t) => t.id)),
    ]);
    const seen = new Set<string>();
    return filtered.filter((t) => {
      if (!visibleIds.has(t.id) || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [filtered, model.scheduled, dayGroups]);
  const selected = useMemo(
    () => selectable.filter((t) => selectedIds.has(t.id)),
    [selectable, selectedIds],
  );
  const selectedTotal = selected.reduce((sum, t) => sum - t.amountYen, 0);
  const validTotal = Number.isSafeInteger(selectedTotal) && selectedTotal <= MAX_YEN;
  const splitDisabledReason =
    selected.length === 0
      ? '明細を選択してください。'
      : !selected.every(isSplitPaymentEligible)
        ? '割り勘は実績の支出だけを選ぶと使えます。'
        : !validTotal
          ? '割り勘の合計が金額の上限を超えています。'
          : null;
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
    setCopyOpen(false);
  };
  const selection = selectMode
    ? { selectedIds, onToggle: toggleSelected, disabled: !selectionReady }
    : undefined;
  const active = isFilterActive(filter);

  return (
    <section id="ledger" aria-label="明細" className="scroll-mt-16 flex flex-col gap-3">
      <ActiveFilterChips goalRange={goalRange} />
      {filter.pendingOnly ? <PendingReceiptRows /> : null}

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
      ) : dayGroups.length === 0 && model.scheduled.length === 0 ? (
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
              heading={`これからの予定 ${model.scheduled.length}件`}
              total={scheduledTotal}
              transactions={model.scheduled}
              selection={selection}
              initiallyOpen={false}
              forceOpen={selectMode || active}
              fixedIds={fixedIds}
              upcoming
            />
          ) : null}
          {dayGroups.map((g) => (
            <DaySection
              key={g.date}
              heading={`${g.date === today ? '今日 · ' : ''}${dayHeading(g.date)}`}
              total={g.spentYen}
              transactions={g.transactions}
              selection={selection}
              initiallyOpen={g.date === today}
              forceOpen={selectMode || active}
              fixedIds={fixedIds}
            />
          ))}
          <p className="px-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {active
              ? `${filtered.length}件 / この月 ${transactions.length}件`
              : `${transactions.length}件`}
          </p>
        </>
      )}
      <LedgerSelectionMenu
        selectMode={selectMode}
        count={selected.length}
        availableCount={selectable.length}
        ready={selectionReady}
        splitDisabledReason={splitDisabledReason}
        expenseTotalYen={
          selected.length > 0 && splitDisabledReason === null ? selectedTotal : undefined
        }
        hidden={(splitOpen || copyOpen) && selectionReady}
        onStart={() => selectionReady && setSelectMode(true)}
        onExit={exitSelect}
        onSplit={() => selectionReady && splitDisabledReason === null && setSplitOpen(true)}
        onCopy={() => selectionReady && selected.length > 0 && setCopyOpen(true)}
        onSelectAll={() => selectionReady && setSelectedIds(new Set(selectable.map((t) => t.id)))}
        onClear={() => setSelectedIds(new Set())}
      />
      <SplitPaymentSheet
        open={splitOpen && selectionReady}
        transactions={selected}
        onClose={() => setSplitOpen(false)}
      />
      <SelectionCopySheet
        open={copyOpen && selectionReady}
        transactions={selected}
        onClose={() => setCopyOpen(false)}
      />
    </section>
  );
}

/** 2026-10-15 → 10月15日（木） */
function dayHeading(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${WEEKDAYS[weekdayOf(date)]}）`;
}

/** 日付や予定を開く。明細はたたんでも削らず、検索・複数選択ではすべて見せる(ADR-116)。 */
export function DaySection({
  heading,
  total,
  transactions,
  selection,
  initiallyOpen = false,
  forceOpen = false,
  fixedIds = new Set<string>(),
  upcoming = false,
}: {
  heading: string;
  total?: number;
  transactions: DrilldownTransaction[];
  selection?:
    | {
        selectedIds: ReadonlySet<string>;
        onToggle: (id: string) => void;
        disabled: boolean;
      }
    | undefined;
  initiallyOpen?: boolean;
  forceOpen?: boolean;
  fixedIds?: ReadonlySet<string>;
  upcoming?: boolean;
}) {
  const { genres, transactions: monthTransactions } = useSpendingMonth();
  const justSavedIds = useJustSaved();
  const [expanded, setExpanded] = useState(initiallyOpen);
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
  const categories = useMemo(() => {
    const unique = new Map<string, { genreId: string | null; genreName: string | null }>();
    for (const t of transactions) {
      const summary = ledgerRowPresentation({ name: t.label, ...t });
      for (const part of summary.breakdown) {
        const key = part.genreId ?? part.genreName ?? 'none';
        if (!unique.has(key)) unique.set(key, part);
      }
    }
    return [...unique.values()];
  }, [transactions]);
  const isOpen = forceOpen || expanded;
  const first = transactions[0];
  const scheduledNote = upcoming ? (
    <p className="px-3 pb-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
      予定は使った額には入りません。
    </p>
  ) : null;
  const header = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{heading}</span>
        {upcoming && first ? (
          <span
            className="mt-1 block truncate text-[12px] font-normal"
            style={{ color: 'var(--ink-muted)' }}
          >
            {formatDateJa(first.occurredOn)}{' '}
            {ledgerRowPresentation({ name: first.label, ...first }).name}
          </span>
        ) : null}
      </span>
      {!isOpen && !upcoming ? (
        <span
          role="img"
          aria-label={`カテゴリ: ${categories.map((g) => g.genreName ?? '未分類').join('、')}`}
          className="flex shrink-0 items-center -space-x-1"
        >
          {categories.slice(0, 4).map((g) => (
            <GenreBadge key={g.genreId ?? g.genreName ?? 'none'} name={g.genreName} size={24} />
          ))}
          {categories.length > 4 ? (
            <span className="pl-2 text-[11px]">+{categories.length - 4}</span>
          ) : null}
        </span>
      ) : null}
      {total !== undefined ? (
        <span
          className="tabular shrink-0 text-[13px] font-semibold"
          aria-label={`支出 ${total.toLocaleString('ja-JP')}円`}
        >
          {total < 0 ? '−' : ''}
          <Yen value={total} />
        </span>
      ) : null}
      {!forceOpen ? (
        <span aria-hidden className="shrink-0 text-[13px]">
          {isOpen ? '⌄' : '›'}
        </span>
      ) : null}
    </>
  );
  const rows = (
    <ul
      className="divider-list overflow-hidden rounded-2xl"
      style={{ background: 'var(--surface)' }}
    >
      {transactions.map((t) =>
        selection ? (
          <SelectableTransaction
            key={t.id}
            transaction={t}
            selected={selection.selectedIds.has(t.id)}
            disabled={selection.disabled}
            fixed={fixedIds.has(t.id)}
            onToggle={() => selection.onToggle(t.id)}
          />
        ) : (
          <TransactionRowWithSplit
            key={t.id}
            transaction={t}
            categories={genres}
            initialSplits={t.splits.map((part) => ({ ...part }))}
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
              compact: true,
              fixed: fixedIds.has(t.id),
            }}
          />
        ),
      )}
    </ul>
  );
  if (forceOpen) {
    return (
      <section aria-label={heading} className="flex flex-col gap-1">
        <div
          className="flex min-h-11 items-center gap-2 px-2"
          style={{ color: 'var(--ink-muted)' }}
        >
          {header}
        </div>
        {scheduledNote}
        {rows}
      </section>
    );
  }
  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      aria-label={heading}
      className="rounded-2xl"
      style={{ background: expanded ? undefined : 'var(--surface)' }}
    >
      <summary
        className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-3 py-3 [&::-webkit-details-marker]:hidden"
        style={{ color: expanded ? 'var(--ink-muted)' : 'var(--ink-secondary)' }}
      >
        {header}
      </summary>
      {scheduledNote}
      {rows}
    </details>
  );
}

/** 選択中は行全体でチェックを切り替え、編集やスワイプの誤操作を避ける。 */
export function SelectableTransaction({
  transaction: t,
  selected,
  onToggle,
  disabled = false,
  fixed = false,
}: {
  transaction: DrilldownTransaction;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  fixed?: boolean;
}) {
  const summary = ledgerRowPresentation({ name: t.label, ...t });
  const shownSummary =
    t.status === 'scheduled'
      ? { ...summary, subtitle: `${formatDateJa(t.occurredOn)} · ${summary.subtitle}` }
      : summary;
  return (
    <li style={selected ? { background: 'var(--accent-track)' } : undefined}>
      <label className="flex h-16 items-center gap-3 px-3 py-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`${summary.name}、${Math.abs(t.amountYen).toLocaleString('ja-JP')}円を選択`}
          className="size-5 shrink-0"
          style={{ accentColor: 'var(--accent)' }}
        />
        <GenreBadge name={summary.genreName} size={32} />
        <CompactTransactionSummary summary={shownSummary} fixed={fixed} />
        <LedgerAmount
          amountYen={t.amountYen}
          muted={t.status === 'scheduled'}
          className="shrink-0 text-[15px]"
        />
      </label>
    </li>
  );
}

/** 検索・絞り込み・カレンダー(出す / 隠す と 週 / 月 は覚えておく、ADR-121)。 */
export function LedgerSearch({
  initialCalendarView = 'week',
  initialCalendarOpen = true,
}: { initialCalendarView?: CalendarView; initialCalendarOpen?: boolean } = {}) {
  return (
    <LedgerSearchControls
      initialCalendarView={initialCalendarView}
      initialCalendarOpen={initialCalendarOpen}
    />
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
          <Button href="/spending/review" variant="filled">
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
