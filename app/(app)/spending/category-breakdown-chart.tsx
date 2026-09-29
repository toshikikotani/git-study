'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Meter } from '@/components/ui/meter';
import { formatYen } from '@/domain/money';
import type { GenreOption } from '@/features/genre/store';
import type { PaymentMethod } from '@/features/import/adapters';
import type { ReceiptItem } from '@/features/receipts/items-store';
import type { GenreBreakdownRow } from '@/features/spending/store';
import { formatDateJa, splitDateOnly } from '@/lib/date';
import { ReceiptItemsPanel } from '../transactions/receipt-items-panel';
import { useSpendingMonth } from './spending-month-provider';

/**
 * ジャンル別内訳から辿れる当月の明細1件分(本人発案、ADR-040/ADR-057)。
 *
 * 「カテゴリ別の内訳を押したら使った一覧が見れて、さらにそれを見ると
 * レシートの詳細が見れる(画像は要らない)」という要望への対応。品目・
 * 小分類は features/spending/store.ts の loadMonthlyLedger() が明細と
 * まとめて読んでおいたものをそのまま持ち回るだけで、ここでは新しい
 * クエリは発生しない。
 *
 * `genreId`/`genreName` は本来この配列の親(ジャンルごとのグループ)
 * から自明だったが、`SpendingCalendar`(calendar.tsx、ADR-044)が同じ配列を
 * 日付順に並べ替えてから改めてジャンルでグルーピングするため、明細1件だけ
 * 見ても分かるように持たせた(page.tsx で1回作るだけで、両方の画面から
 * 共有する——ADR-033、同じ考慮を複数箇所で作らない)。
 */
export type DrilldownTransaction = {
  id: string;
  occurredOn: string;
  label: string;
  genreId: string | null;
  genreName: string | null;
  amountYen: number;
  accountId: string;
  paymentMethod: PaymentMethod;
  items: readonly ReceiptItem[];
  expenseSubtype: string | null;
};

/**
 * 今月のジャンル別内訳(本人発案:「普通の家計簿」への作り直し)。
 *
 * 予算があるジャンルは既存の Meter(components/ui/meter.tsx)をそのまま使い、
 * 「予算に対してどれだけ使ったか」を示す(ホームの予算タイルと同じ色・
 * 判断ロジック=domain/budget.ts の budgetTone()、サーバー側で計算済みの
 * `tone` を受け取るだけ)。予算が無いジャンル(投資・返済など)は比較対象が
 * 無いため、単純に「このジャンルの中での大きさ」を表す中立のバーにする。
 *
 * ── ジャンル行を押すと当月の明細が見える(ADR-040)────────────────
 * /spending は当月明細の再掲を置かない(P10-32)方針だが、あれは
 * 「/transactions と中身がそのまま重複する全件一覧」の話。ここはジャンルで
 * 絞った上に既定で畳んであり、押さないと出てこない——重複というより、
 * ジャンル別内訳の「内訳」そのものを深掘りする経路として別物として扱う。
 */
export function CategoryBreakdownChart({
  rows,
  transactionsByCategory,
  categories,
  monthLabel = null,
  emptyMessage = null,
}: {
  rows: readonly GenreBreakdownRow[];
  /** ジャンルID(未分類は 'uncategorized')ごとの、その月の明細。 */
  transactionsByCategory: Readonly<Record<string, readonly DrilldownTransaction[]>>;
  categories: readonly GenreOption[];
  /** 今月以外を見せているとき、見出しに添える月(例「2026年8月」)。 */
  monthLabel?: string | null;
  /** 支出が無いときに出す言葉。null ならカードごと出さない(従来の動き)。 */
  emptyMessage?: string | null;
}) {
  if (rows.length === 0 && emptyMessage === null) return null;

  const totalYen = rows.reduce((acc, row) => acc + row.spentYen, 0);
  const maxSpentYen = Math.max(...rows.map((row) => row.spentYen), 1);

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          ジャンル別の内訳{monthLabel ? `(${monthLabel})` : ''}
        </p>
        {rows.some((row) => row.genreId === null) ? (
          <Link
            href="/reports/genres"
            className="text-xs font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            未分類をAIで分類する →
          </Link>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {emptyMessage}
        </p>
      ) : null}

      <ul className="mt-3 space-y-3.5">
        {rows.map((row) => (
          <CategoryRow
            key={row.genreId ?? 'uncategorized'}
            row={row}
            transactions={transactionsByCategory[row.genreId ?? 'uncategorized'] ?? []}
            categories={categories}
            maxSpentYen={maxSpentYen}
            totalYen={totalYen}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * カレンダーで表示中の月の「ジャンル別の内訳」(本人発案「カレンダーに連動して
 * 切り替えたらその月のものを表示させて」)。今月に支出が無いあいだは従来どおり
 * カードごと出さず、別の月へ移ったときは読み込み中・支出が無いことを伝える
 * (カードが消えると、押した結果が分からないため)。
 */
export function MonthLinkedCategoryBreakdown({
  categories,
}: {
  categories: readonly GenreOption[];
}) {
  const { genreBreakdown, transactions, isCurrentMonth, visibleMonth, loading, error } =
    useSpendingMonth();

  const [year, month] = splitDateOnly(visibleMonth);
  const transactionsByCategory = useMemo(() => {
    const map: Record<string, DrilldownTransaction[]> = {};
    for (const t of transactions) {
      const key = t.genreId ?? 'uncategorized';
      (map[key] ??= []).push(t);
    }
    return map;
  }, [transactions]);

  return (
    <CategoryBreakdownChart
      rows={genreBreakdown}
      transactionsByCategory={transactionsByCategory}
      categories={categories}
      monthLabel={isCurrentMonth ? null : `${year}年${month}月`}
      emptyMessage={
        isCurrentMonth
          ? null
          : loading
            ? 'この月の内訳を読み込んでいます…'
            : (error ?? 'この月の支出はありません')
      }
    />
  );
}

function CategoryRow({
  row,
  transactions,
  categories,
  maxSpentYen,
  totalYen,
}: {
  row: GenreBreakdownRow;
  transactions: readonly DrilldownTransaction[];
  categories: readonly GenreOption[];
  maxSpentYen: number;
  totalYen: number;
}) {
  const [open, setOpen] = useState(false);
  const ratio = row.budgetYen !== null && row.budgetYen > 0 ? row.spentYen / row.budgetYen : null;
  const shareOfTotal = totalYen > 0 ? Math.round((row.spentYen / totalYen) * 100) : 0;

  return (
    <li>
      <button type="button" onClick={() => setOpen((v) => !v)} className="block w-full text-left">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm" style={{ color: 'var(--ink)' }}>
            {row.genreName}
          </span>
          <span className="tabular shrink-0 text-sm" style={{ color: 'var(--ink)' }}>
            {formatYen(row.spentYen, { sign: 'never' })}
          </span>
        </div>

        <div className="mt-1.5">
          {ratio !== null ? (
            <Meter
              ratio={ratio}
              tone={row.tone}
              label={`${row.genreName} 予算の${Math.round(ratio * 100)}%`}
            />
          ) : (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--over-track)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round((row.spentYen / maxSpentYen) * 100)}%`,
                  background: 'var(--over)',
                }}
              />
            </div>
          )}
        </div>

        <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {row.budgetYen !== null
            ? `予算 ${formatYen(row.budgetYen, { sign: 'never' })} の ${Math.round(
                (ratio ?? 0) * 100,
              )}%`
            : `支出全体の${shareOfTotal}%`}
        </p>
      </button>

      {open ? (
        <ul className="mt-2 space-y-1.5 border-t pt-2" style={{ borderColor: 'var(--hairline)' }}>
          {transactions.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              今月の明細はありません
            </p>
          ) : (
            transactions.map((t) => (
              <DrilldownRow key={t.id} transaction={t} categories={categories} />
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}

/** ジャンル内訳から辿った明細1件。押すとレシートの品目(あれば)が見える。 */
function DrilldownRow({
  transaction,
  categories,
}: {
  transaction: DrilldownTransaction;
  categories: readonly GenreOption[];
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<readonly ReceiptItem[]>(transaction.items);
  const [subtype, setSubtype] = useState(transaction.expenseSubtype);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="min-w-0 truncate text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {formatDateJa(transaction.occurredOn)} {transaction.label}
        </span>
        <span className="tabular shrink-0 text-xs" style={{ color: 'var(--ink)' }}>
          {formatYen(transaction.amountYen, { sign: 'never' })}
        </span>
      </button>

      {open ? (
        <div className="mt-1.5">
          <ReceiptItemsPanel
            transaction={{
              id: transaction.id,
              occurredOn: transaction.occurredOn,
              accountId: transaction.accountId,
              paymentMethod: transaction.paymentMethod,
              amountYen: transaction.amountYen,
            }}
            categories={categories}
            items={items}
            onItemsReplaced={setItems}
            subtype={subtype}
            onSubtypeReplaced={setSubtype}
          />
        </div>
      ) : null}
    </li>
  );
}
