'use client';

import { useState } from 'react';

import { Meter } from '@/components/ui/meter';
import { formatYen } from '@/domain/money';
import type { CategoryOption } from '@/features/classification/store';
import type { PaymentMethod } from '@/features/import/adapters';
import type { ReceiptItem } from '@/features/receipts/items-store';
import type { CategoryBreakdownRow } from '@/features/spending/store';
import { formatDateJa } from '@/lib/date';
import { ReceiptItemsPanel } from '../transactions/receipt-items-panel';

/**
 * カテゴリ別内訳から辿れる当月の明細1件分(本人発案、ADR-038)。
 *
 * 「カテゴリ別の内訳を押したら使った一覧が見れて、さらにそれを見ると
 * レシートの詳細が見れる(画像は要らない)」という要望への対応。品目・
 * 小分類は features/spending/store.ts の loadMonthlyLedger() が明細と
 * まとめて読んでおいたものをそのまま持ち回るだけで、ここでは新しい
 * クエリは発生しない。
 */
export type DrilldownTransaction = {
  id: string;
  occurredOn: string;
  label: string;
  amountYen: number;
  accountId: string;
  paymentMethod: PaymentMethod;
  items: readonly ReceiptItem[];
  expenseSubtype: string | null;
};

/**
 * 今月のカテゴリ別内訳(本人発案:「普通の家計簿」への作り直し)。
 *
 * 予算があるカテゴリは既存の Meter(components/ui/meter.tsx)をそのまま使い、
 * 「予算に対してどれだけ使ったか」を示す(ホームの予算タイルと同じ色・
 * 判断ロジック=domain/budget.ts の budgetTone()、サーバー側で計算済みの
 * `tone` を受け取るだけ)。予算が無いカテゴリ(投資・返済など)は比較対象が
 * 無いため、単純に「このカテゴリの中での大きさ」を表す中立のバーにする。
 *
 * ── カテゴリ行を押すと当月の明細が見える(ADR-038)────────────────
 * /spending は当月明細の再掲を置かない(P10-32)方針だが、あれは
 * 「/transactions と中身がそのまま重複する全件一覧」の話。ここはカテゴリで
 * 絞った上に既定で畳んであり、押さないと出てこない——重複というより、
 * カテゴリ別内訳の「内訳」そのものを深掘りする経路として別物として扱う。
 */
export function CategoryBreakdownChart({
  rows,
  transactionsByCategory,
  categories,
}: {
  rows: readonly CategoryBreakdownRow[];
  /** カテゴリID(未分類は 'uncategorized')ごとの当月の明細。 */
  transactionsByCategory: Readonly<Record<string, readonly DrilldownTransaction[]>>;
  categories: readonly CategoryOption[];
}) {
  if (rows.length === 0) return null;

  const totalYen = rows.reduce((acc, row) => acc + row.spentYen, 0);
  const maxSpentYen = Math.max(...rows.map((row) => row.spentYen), 1);

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        カテゴリ別の内訳
      </p>

      <ul className="mt-3 space-y-3.5">
        {rows.map((row) => (
          <CategoryRow
            key={row.categoryId ?? 'uncategorized'}
            row={row}
            transactions={transactionsByCategory[row.categoryId ?? 'uncategorized'] ?? []}
            categories={categories}
            maxSpentYen={maxSpentYen}
            totalYen={totalYen}
          />
        ))}
      </ul>
    </div>
  );
}

function CategoryRow({
  row,
  transactions,
  categories,
  maxSpentYen,
  totalYen,
}: {
  row: CategoryBreakdownRow;
  transactions: readonly DrilldownTransaction[];
  categories: readonly CategoryOption[];
  maxSpentYen: number;
  totalYen: number;
}) {
  const [open, setOpen] = useState(false);
  const ratio = row.budgetYen !== null && row.budgetYen > 0 ? row.spentYen / row.budgetYen : null;
  const shareOfTotal = totalYen > 0 ? Math.round((row.spentYen / totalYen) * 100) : 0;
  const categoryCode = categories.find((c) => c.id === row.categoryId)?.code ?? null;

  return (
    <li>
      <button type="button" onClick={() => setOpen((v) => !v)} className="block w-full text-left">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm" style={{ color: 'var(--ink)' }}>
            {row.categoryName}
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
              label={`${row.categoryName} 予算の${Math.round(ratio * 100)}%`}
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
              <DrilldownRow
                key={t.id}
                transaction={t}
                categories={categories}
                categoryCode={categoryCode}
              />
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}

/** カテゴリ内訳から辿った明細1件。押すとレシートの品目(あれば)が見える。 */
function DrilldownRow({
  transaction,
  categories,
  categoryCode,
}: {
  transaction: DrilldownTransaction;
  categories: readonly CategoryOption[];
  categoryCode: string | null;
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
            }}
            categories={categories}
            categoryCode={categoryCode}
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
