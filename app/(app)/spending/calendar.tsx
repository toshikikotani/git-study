'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { formatYen } from '@/domain/money';
import type { CategoryOption } from '@/features/classification/store';
import type { LedgerTransaction } from '@/features/spending/store';
import {
  addDays,
  addMonths,
  daysBetween,
  formatDateJa,
  splitDateOnly,
  weekdayOf,
} from '@/lib/date';
import { updateTransactionAction } from '../transactions/actions';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/**
 * 家計簿トップのカレンダー(本人発案、ADR-043:「カレンダー追加。家計簿の
 * トップはカレンダー、その下に詳細。カレンダー押したら何に使ったかすぐ
 * 見れるように編集できるように」)。
 *
 * ── 何を見せるか ────────────────────────────────────────────
 * 月の全体像を一目で見せる(日ごとの支出額を小さく添えた月間グリッド)。
 * 日を押すと、その日の明細一覧がすぐ下に展開される——「押したらすぐ見れる」
 * という要望どおり、ページ遷移せずこのカード内で完結させる。既定で選ばれて
 * いるのは今日(period.to)なので、開いた瞬間から何か見えている。
 *
 * ── 編集はカテゴリの変更だけに絞った ──────────────────────────
 * 「何に使ったかすぐ見れるように編集できるように」への対応として、各明細に
 * カテゴリだけをその場で直せる小さなセレクトを付けた(split-editor.tsx の
 * 単純なカテゴリ変更と同じ `updateTransactionAction()`)。分割・レシート品目
 * までは踏み込まない——それらは既に `/transactions` の明細行や
 * `CategoryBreakdownChart` の深掘り(ADR-040/041)にあり、ここは月の一覧性と
 * 「押してすぐ直す」という速さを優先した別の入り口という位置づけ。
 *
 * ── 新しいクエリを増やさない ────────────────────────────────
 * `ledger.transactions`(今月の月初〜今日)を `page.tsx` からそのまま受け取り、
 * 日付ごとにクライアント側でグルーピングするだけ。カレンダーのために
 * 明細を読み直すことはしない。
 *
 * ── 保存後は router.refresh() で揃える(pull-to-refresh.tsx と同じ理由) ──
 * カテゴリを変えると `CategoryBreakdownChart` の内訳・カテゴリ別集計も
 * 本来ずれる。ローカル state だけで見た目を合わせるのはこのカードの中に
 * 限られるため、保存直後は現在のルートの Server Component を再取得して
 * ページ全体を最新化する。
 */
export function SpendingCalendar({
  transactions,
  period,
  categories,
}: {
  transactions: readonly LedgerTransaction[];
  period: { from: string; to: string };
  categories: readonly CategoryOption[];
}) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(period.to);

  const transactionsByDate = useMemo(() => {
    const map = new Map<string, LedgerTransaction[]>();
    for (const t of transactions) {
      const list = map.get(t.occurredOn) ?? [];
      list.push(t);
      map.set(t.occurredOn, list);
    }
    return map;
  }, [transactions]);

  const spentByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const [date, list] of transactionsByDate) {
      const spentYen = list.filter((t) => t.amountYen < 0).reduce((acc, t) => acc - t.amountYen, 0);
      if (spentYen > 0) map.set(date, spentYen);
    }
    return map;
  }, [transactionsByDate]);

  const daysInMonth = daysBetween(period.from, addMonths(period.from, 1));
  const leadingBlanks = weekdayOf(period.from);
  const cells: (string | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => addDays(period.from, i)),
  ];

  const selectedTransactions = transactionsByDate.get(selectedDate) ?? [];

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className="text-[10px] font-medium" style={{ color: 'var(--ink-muted)' }}>
            {w}
          </span>
        ))}
        {cells.map((date, i) =>
          date === null ? (
            <span key={`blank-${i}`} />
          ) : (
            <CalendarDayCell
              key={date}
              date={date}
              isFuture={date > period.to}
              isSelected={date === selectedDate}
              isToday={date === period.to}
              spentYen={spentByDate.get(date) ?? 0}
              onSelect={() => setSelectedDate(date)}
            />
          ),
        )}
      </div>

      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          {formatDateJa(selectedDate)}
        </p>

        {selectedTransactions.length === 0 ? (
          <p className="mt-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            この日の明細はありません
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {selectedTransactions.map((t) => (
              <CalendarTransactionRow
                key={t.id}
                transaction={t}
                categories={categories}
                onSaved={() => router.refresh()}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CalendarDayCell({
  date,
  isFuture,
  isSelected,
  isToday,
  spentYen,
  onSelect,
}: {
  date: string;
  isFuture: boolean;
  isSelected: boolean;
  isToday: boolean;
  spentYen: number;
  onSelect: () => void;
}) {
  const dayNumber = splitDateOnly(date)[2];

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={isFuture}
      className="flex flex-col items-center gap-0.5 rounded-lg py-1.5 disabled:opacity-30"
      style={{
        background: isSelected ? 'var(--accent-track)' : 'transparent',
        border: isToday ? '1px solid var(--accent)' : '1px solid transparent',
      }}
    >
      <span
        className="tabular text-[11px]"
        style={{ color: isSelected ? 'var(--accent)' : 'var(--ink)' }}
      >
        {dayNumber}
      </span>
      <span
        className="tabular text-[9px] leading-none"
        style={{ color: 'var(--ink-muted)', minHeight: '9px' }}
      >
        {spentYen > 0 ? spentYen.toLocaleString('ja-JP') : ''}
      </span>
    </button>
  );
}

/** カレンダーから辿った明細1件。押すとカテゴリだけをその場で直せる。 */
function CalendarTransactionRow({
  transaction,
  categories,
  onSaved,
}: {
  transaction: LedgerTransaction;
  categories: readonly CategoryOption[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? '');
  const [categoryName, setCategoryName] = useState(transaction.categoryName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isIncome = transaction.amountYen > 0;
  const categoryUnchanged = categoryId === (transaction.categoryId ?? '');

  async function save(): Promise<void> {
    if (!categoryId || categoryUnchanged) return;
    setSaving(true);
    setError(null);
    const result = await updateTransactionAction(transaction.id, categoryId);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setCategoryName(categories.find((c) => c.id === categoryId)?.name ?? null);
    setEditing(false);
    onSaved();
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="min-w-0 truncate text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {transaction.label}
          <span className="ml-1.5" style={{ color: 'var(--ink-muted)' }}>
            ({categoryName ?? '未分類'})
          </span>
        </span>
        <span
          className="tabular shrink-0 text-xs font-semibold"
          style={{ color: isIncome ? 'var(--income)' : 'var(--ink)' }}
        >
          {isIncome ? '+' : '−'}
          {formatYen(Math.abs(transaction.amountYen), { sign: 'never' })}
        </span>
      </button>

      {editing ? (
        <div className="mt-1.5 flex gap-2">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="flex-1 rounded-xl px-3 py-1.5 text-xs"
            style={{
              background: 'var(--plane)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          >
            <option value="" disabled>
              カテゴリを選ぶ
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !categoryId || categoryUnchanged}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </li>
  );
}
