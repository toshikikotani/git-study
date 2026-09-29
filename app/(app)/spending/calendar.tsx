'use client';

import { DayPicker, type DayButtonProps } from '@daypicker/react';
import { ja } from '@daypicker/react/locale';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useMemo, useState } from 'react';

import { formatYen } from '@/domain/money';
import type { GenreOption } from '@/features/genre/store';
import type { ReceiptItem } from '@/features/receipts/items-store';
import {
  addMonths,
  dateOnlyToLocalDate,
  formatDateJa,
  localDateToDateOnly,
  nthDayOfMonth,
  splitDateOnly,
} from '@/lib/date';
import { useSpendingMonth } from './spending-month-provider';
import { updateTransactionAction } from '../transactions/actions';
import { ReceiptItemsPanel } from '../transactions/receipt-items-panel';
import type { DrilldownTransaction } from './category-breakdown-chart';

/**
 * 家計簿トップのカレンダー(本人発案、ADR-043/044:「カレンダー追加。家計簿の
 * トップはカレンダー、その下に詳細。カレンダー押したら何に使ったかすぐ
 * 見れるように編集できるように」)。
 *
 * ── 何を見せるか ────────────────────────────────────────────
 * 月の全体像を一目で見せる(日ごとの支出額を小さく添えた月間グリッド)。
 * 日を押すと、その日の明細一覧がすぐ下に展開される——「押したらすぐ見れる」
 * という要望どおり、ページ遷移せずこのカード内で完結させる。既定で選ばれて
 * いるのは今日(period.to)なので、開いた瞬間から何か見えている。
 *
 * ── 日別明細もカテゴリごとに分け、レシートを見せる(本人発案、ADR-044:
 *    「カレンダーに紐づくやつもカテゴリーごとに分けてレシート表示して。
 *    今カテゴリーが弱いな、生活費ってなっちゃう全部」)────────────────
 * カテゴリだけでは「生活費」に丸められて何を買ったか分からない明細が
 * 多いため、その日の明細をカテゴリでグルーピングした上で、各明細には
 * `CategoryBreakdownChart`(ADR-040/041)と同じ `ReceiptItemsPanel` を
 * 出し、レシートの品目まで見えるようにした。新しい部品は作らず、
 * 既存のものを再利用する(ADR-033)。
 *
 * ── 編集はカテゴリの変更 + レシート(ReceiptItemsPanel が持つ範囲) ──
 * 「何に使ったかすぐ見れるように編集できるように」への対応として、各明細に
 * カテゴリだけをその場で直せる小さなセレクトを付けた(split-editor.tsx の
 * 単純なカテゴリ変更と同じ `updateTransactionAction()`)。分割の編集までは
 * 踏み込まない——それは `/transactions` の明細行にあり、ここは月の一覧性と
 * 「押してすぐ直す」という速さを優先した別の入り口という位置づけ。
 *
 * ── 新しいクエリを増やさない ────────────────────────────────
 * `page.tsx` が `CategoryBreakdownChart` 用に組み立てた
 * `drilldownTransactions`(品目・小分類つき)をそのまま受け取り、日付ごとに
 * クライアント側でグルーピングするだけ。カレンダーのために明細やレシートを
 * 読み直すことはしない。
 *
 * ── 保存後は router.refresh() で揃える(pull-to-refresh.tsx と同じ理由) ──
 * カテゴリを変えると `CategoryBreakdownChart` の内訳・カテゴリ別集計も
 * 本来ずれる。ローカル state だけで見た目を合わせるのはこのカードの中に
 * 限られるため、保存直後は現在のルートの Server Component を再取得して
 * ページ全体を最新化する。
 */
/** カレンダーで移動できる範囲(今日から前後何か月まで。actions.ts と揃える)。 */
const MONTHS_BACK = 120;
const MONTHS_FORWARD = 24;

/** 日付ごとの支出額を、日付ボタン(DayButton)へ渡す。 */
const SpentByDateContext = createContext<ReadonlyMap<string, number>>(new Map());

/**
 * ライブラリ標準のスタイル(style.css)は使わず、このアプリの見た目(CSS 変数)に
 * 合わせたクラスだけを当てる。標準のスタイルは日付セルの幅を固定するため、
 * スマートフォンの幅いっぱいに広げると崩れる。
 */
const CALENDAR_CLASS_NAMES = {
  root: 'w-full',
  months: 'relative w-full',
  month: 'w-full',
  nav: 'absolute top-0 right-0 flex h-9 items-center gap-1',
  button_previous:
    'flex size-9 items-center justify-center rounded-full text-[var(--ink-secondary)] disabled:opacity-30',
  button_next:
    'flex size-9 items-center justify-center rounded-full text-[var(--ink-secondary)] disabled:opacity-30',
  chevron: 'fill-current',
  month_caption: 'flex h-9 items-center',
  caption_label: 'text-sm font-semibold text-[var(--ink)]',
  month_grid: 'mt-1 w-full table-fixed border-collapse',
  weekday: 'py-1 text-center text-[10px] font-medium text-[var(--ink-muted)]',
  day: 'p-0.5 text-center',
  day_button: 'flex h-12 w-full items-center justify-center rounded-xl border border-transparent',
  selected: '[&>button]:border-[var(--accent)] [&>button]:bg-[var(--accent-track)]',
  today: '[&>button]:border-[var(--accent)]',
  outside: 'opacity-40',
  hidden: 'invisible',
} as const;

export function SpendingCalendar({ categories }: { categories: readonly GenreOption[] }) {
  const router = useRouter();
  // 表示中の月と、その月の明細は「ジャンル別の内訳」と共有する(SpendingMonthProvider)。
  const {
    visibleMonth,
    currentMonthStart,
    today,
    isCurrentMonth,
    transactions: visibleTransactions,
    loading: loadingMonth,
    error: monthError,
    goToMonth,
    reloadVisibleMonth,
  } = useSpendingMonth();
  const [selectedDate, setSelectedDate] = useState(today);
  // 日付を押すと、その日の明細の上に開くメニュー(家計簿を手で登録する)。
  const [menuOpen, setMenuOpen] = useState(false);

  const transactionsByDate = useMemo(() => {
    const map = new Map<string, DrilldownTransaction[]>();
    for (const t of visibleTransactions) {
      const list = map.get(t.occurredOn) ?? [];
      list.push(t);
      map.set(t.occurredOn, list);
    }
    return map;
  }, [visibleTransactions]);

  const spentByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const [date, list] of transactionsByDate) {
      const spentYen = list.filter((t) => t.amountYen < 0).reduce((acc, t) => acc - t.amountYen, 0);
      if (spentYen > 0) map.set(date, spentYen);
    }
    return map;
  }, [transactionsByDate]);

  const selectedByCategory = useMemo(
    () => groupByGenre(transactionsByDate.get(selectedDate) ?? []),
    [transactionsByDate, selectedDate],
  );

  const changeMonth = (month: Date) => {
    const monthStart = nthDayOfMonth(localDateToDateOnly(month), 1);
    // 移動先では、今月なら今日、それ以外は1日を選んでおく。
    setSelectedDate(monthStart === currentMonthStart ? today : monthStart);
    setMenuOpen(false);
    goToMonth(monthStart);
  };

  const selectDate = (date: string) => {
    // 選択中の日をもう一度押すとメニューを閉じる。
    setMenuOpen(date !== selectedDate || !menuOpen);
    setSelectedDate(date);
  };

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <SpentByDateContext.Provider value={spentByDate}>
        <DayPicker
          mode="single"
          locale={ja}
          weekStartsOn={0}
          month={dateOnlyToLocalDate(visibleMonth)}
          onMonthChange={changeMonth}
          startMonth={dateOnlyToLocalDate(addMonths(nthDayOfMonth(today, 1), -MONTHS_BACK))}
          endMonth={dateOnlyToLocalDate(addMonths(nthDayOfMonth(today, 1), MONTHS_FORWARD))}
          selected={dateOnlyToLocalDate(selectedDate)}
          onDayClick={(day) => selectDate(localDateToDateOnly(day))}
          modifiers={{ today: dateOnlyToLocalDate(today) }}
          components={{ DayButton: CalendarDayButton }}
          classNames={CALENDAR_CLASS_NAMES}
        />
      </SpentByDateContext.Provider>

      <div className="mt-1 flex items-center justify-between text-xs">
        <span style={{ color: 'var(--ink-muted)' }}>
          {loadingMonth ? 'この月の明細を読み込んでいます…' : ''}
        </span>
        {!isCurrentMonth ? (
          <button
            type="button"
            onClick={() => changeMonth(dateOnlyToLocalDate(currentMonthStart))}
            className="font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            今月へ戻る
          </button>
        ) : null}
      </div>
      {monthError ? (
        <p className="mt-1 text-xs" style={{ color: 'var(--over)' }}>
          {monthError}
        </p>
      ) : null}

      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          {formatDateJa(selectedDate)}
        </p>

        {/* 日付を押すと、その日の明細のすぐ上にメニューを出す(本人発案)。 */}
        {menuOpen ? (
          <div
            role="menu"
            aria-label={`${formatDateJa(selectedDate)}のメニュー`}
            className="mt-2 overflow-hidden rounded-xl"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--hairline)' }}
          >
            <Link
              href={`/transactions/new?date=${selectedDate}`}
              role="menuitem"
              prefetch={false}
              className="block px-3 py-2.5 text-sm font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              家計簿を手で登録する
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="block w-full border-t px-3 py-2.5 text-left text-sm"
              style={{ color: 'var(--ink-muted)', borderColor: 'var(--hairline)' }}
            >
              閉じる
            </button>
          </div>
        ) : null}

        {selectedByCategory.length === 0 ? (
          <p className="mt-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            この日の明細はありません
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {selectedByCategory.map((group) => (
              <CalendarGenreGroup
                key={group.genreId ?? 'uncategorized'}
                group={group}
                categories={categories}
                onSaved={() => {
                  router.refresh();
                  reloadVisibleMonth();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type GenreGroup = {
  genreId: string | null;
  genreName: string;
  transactions: DrilldownTransaction[];
};

/** その日の明細をカテゴリでまとめ、支出額の大きい順に並べる(本人発案、ADR-044)。 */
function groupByGenre(transactions: readonly DrilldownTransaction[]): GenreGroup[] {
  const map = new Map<string, GenreGroup>();
  for (const t of transactions) {
    const key = t.genreId ?? 'uncategorized';
    const group = map.get(key) ?? {
      genreId: t.genreId,
      genreName: t.genreName ?? '未分類',
      transactions: [],
    };
    group.transactions.push(t);
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => spentYenOf(b) - spentYenOf(a));
}

function spentYenOf(group: GenreGroup): number {
  return group.transactions.filter((t) => t.amountYen < 0).reduce((acc, t) => acc - t.amountYen, 0);
}

/** 日付ボタン。日付の下にその日の支出額を小さく添える。 */
function CalendarDayButton({ day, modifiers, ...buttonProps }: DayButtonProps) {
  const spentByDate = useContext(SpentByDateContext);
  const dateOnly = localDateToDateOnly(day.date);
  const spentYen = spentByDate.get(dateOnly) ?? 0;
  const isSelected = Boolean(modifiers.selected);

  return (
    <button {...buttonProps} type="button">
      <span className="flex flex-col items-center gap-0.5">
        <span
          className="tabular text-[13px]"
          style={{
            color: isSelected ? 'var(--accent)' : 'var(--ink)',
            fontWeight: modifiers.today ? 700 : 500,
          }}
        >
          {splitDateOnly(dateOnly)[2]}
        </span>
        <span
          className="tabular text-[9px] leading-none"
          style={{ color: 'var(--ink-muted)', minHeight: '9px' }}
        >
          {spentYen > 0 ? spentYen.toLocaleString('ja-JP') : ''}
        </span>
      </span>
    </button>
  );
}

/** カテゴリ1つ分の見出し(名前・小計)と、その中の明細一覧。 */
function CalendarGenreGroup({
  group,
  categories,
  onSaved,
}: {
  group: GenreGroup;
  categories: readonly GenreOption[];
  onSaved: () => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>
          {group.genreName}
        </p>
        <p className="tabular text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {formatYen(spentYenOf(group), { sign: 'never' })}
        </p>
      </div>
      <ul className="mt-1 space-y-1.5">
        {group.transactions.map((t) => (
          <CalendarTransactionRow
            key={t.id}
            transaction={t}
            categories={categories}
            onSaved={onSaved}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * カレンダーから辿った明細1件。押すとカテゴリの変更とレシートの品目
 * (ReceiptItemsPanel、`CategoryBreakdownChart` と共通)が展開される。
 */
function CalendarTransactionRow({
  transaction,
  categories,
  onSaved,
}: {
  transaction: DrilldownTransaction;
  categories: readonly GenreOption[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [genreId, setGenreId] = useState(transaction.genreId ?? '');
  const [items, setItems] = useState<readonly ReceiptItem[]>(transaction.items);
  const [subtype, setSubtype] = useState(transaction.expenseSubtype);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isIncome = transaction.amountYen > 0;
  const categoryUnchanged = genreId === (transaction.genreId ?? '');

  async function saveCategory(): Promise<void> {
    if (!genreId || categoryUnchanged) return;
    setSaving(true);
    setError(null);
    const result = await updateTransactionAction(transaction.id, genreId);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="min-w-0 truncate text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {transaction.label}
        </span>
        <span
          className="tabular shrink-0 text-xs font-semibold"
          style={{ color: isIncome ? 'var(--income)' : 'var(--ink)' }}
        >
          {isIncome ? '+' : '−'}
          {formatYen(Math.abs(transaction.amountYen), { sign: 'never' })}
        </span>
      </button>

      {open ? (
        <div className="mt-1.5 space-y-2">
          <div className="flex gap-2">
            <select
              value={genreId}
              onChange={(e) => setGenreId(e.target.value)}
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
              onClick={() => void saveCategory()}
              disabled={saving || !genreId || categoryUnchanged}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {saving ? '保存中…' : 'カテゴリを保存'}
            </button>
          </div>
          {error ? (
            <p className="text-[11px]" style={{ color: 'var(--over)' }}>
              {error}
            </p>
          ) : null}

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
