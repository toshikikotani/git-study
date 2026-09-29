'use client';

import { useId } from 'react';

import { GenreBadge } from '@/components/ui/genre-badge';

import {
  CAPTURE_FIELD_LABEL,
  itemsBar,
  itemsBarMessage,
  type CaptureField,
  type ManualEntryErrors,
  type ManualEntryValues,
  type ManualItem,
} from '@/domain/receipt-capture';

export type ManualEntryGenre = { id: string; name: string };
export type ManualEntryAccount = { id: string; name: string };

/**
 * 手入力のフォーム(F7 の入力待ちの画面と、H の「手入力」で共通)。
 *
 * 入力の順番は 金額 → 日付 → 店名 → ジャンル → 口座 → メモ。読み取りで一部だけ読めた
 * ときは、読めた項目を入れたうえで、読めなかった項目に「▲ 読み取れませんでした」と枠をつける
 * (色だけに頼らず、印と文言も添える)。品目は任意で、入れると税率(8%/10%)ごとの内訳と、
 * 合計との照合バーが出る。
 */
export function ManualEntryForm({
  values,
  onChange,
  genres,
  accounts,
  recentStores,
  unread = [],
  autofilled = [],
  errors = {},
  showErrors = false,
  variant = 'receipt',
}: {
  values: ManualEntryValues;
  /** field は本人が触った項目(再読み取りの上書き防止の印に使う)。 */
  onChange: (next: ManualEntryValues, field?: CaptureField) => void;
  genres: readonly ManualEntryGenre[];
  accounts: readonly ManualEntryAccount[];
  recentStores: readonly string[];
  unread?: readonly CaptureField[];
  autofilled?: readonly CaptureField[];
  errors?: ManualEntryErrors;
  showErrors?: boolean;
  /**
   * receipt: 金額 → 日付 → 店名 → ジャンル → 口座 → メモ(画像を見ながら入力する画面)
   * quick  : 金額 → ジャンル(アイコンの格子)→ 最近使った店 → 日付 → 口座 → メモ(レシートなしの手入力)
   */
  variant?: 'receipt' | 'quick';
}) {
  const id = useId();
  const bar = itemsBar(values.items, values.amountYen);

  const fieldTone = (f: CaptureField) =>
    unread.includes(f) ? 'unread' : autofilled.includes(f) ? 'auto' : 'plain';

  const setItem = (itemId: string, patch: Partial<ManualItem>) =>
    onChange({
      ...values,
      items: values.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    });
  const fields = {
    amount: (
      <Field
        label={CAPTURE_FIELD_LABEL.amountYen}
        htmlFor={`${id}-amount`}
        tone={fieldTone('amountYen')}
        error={showErrors ? errors.amountYen : undefined}
      >
        <div className="flex items-baseline gap-1">
          <input
            id={`${id}-amount`}
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            value={values.amountYen === null ? '' : values.amountYen.toLocaleString('ja-JP')}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, '');
              onChange(
                { ...values, amountYen: digits === '' ? null : Number(digits.slice(0, 9)) },
                'amountYen',
              );
            }}
            className="tabular min-h-11 w-full bg-transparent text-3xl font-semibold outline-none"
            style={{ color: 'var(--ink)' }}
          />
          <span className="text-base" style={{ color: 'var(--ink-secondary)' }}>
            円
          </span>
        </div>
      </Field>
    ),
    date: (
      <Field
        label={CAPTURE_FIELD_LABEL.occurredOn}
        htmlFor={`${id}-date`}
        tone={fieldTone('occurredOn')}
        error={showErrors ? errors.occurredOn : undefined}
      >
        <input
          id={`${id}-date`}
          type="date"
          value={values.occurredOn}
          onChange={(e) => onChange({ ...values, occurredOn: e.target.value }, 'occurredOn')}
          className="min-h-11 w-full bg-transparent text-base outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </Field>
    ),
    store: (
      <Field
        label={CAPTURE_FIELD_LABEL.storeName}
        htmlFor={`${id}-store`}
        tone={fieldTone('storeName')}
      >
        <input
          id={`${id}-store`}
          list={`${id}-stores`}
          autoComplete="off"
          placeholder="例:ファミリーマート"
          value={values.storeName}
          onChange={(e) => onChange({ ...values, storeName: e.target.value }, 'storeName')}
          className="min-h-11 w-full bg-transparent text-base outline-none"
          style={{ color: 'var(--ink)' }}
        />
        <datalist id={`${id}-stores`}>
          {recentStores.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {recentStores.length > 0 && values.storeName.trim() === '' ? (
          <div className="-mx-1 mt-1 flex flex-wrap gap-2">
            {recentStores.slice(0, 5).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...values, storeName: s }, 'storeName')}
                className="min-h-11 rounded-full px-3 text-xs font-semibold"
                style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </Field>
    ),
    genre: (
      <Field label="ジャンル" tone="plain">
        <div role="group" aria-label="ジャンル" className="flex flex-wrap gap-2">
          {genres.map((g) => {
            const on = values.genreId === g.id;
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...values, genreId: on ? null : g.id })}
                className="min-h-11 rounded-full px-4 text-sm font-semibold"
                style={{
                  background: on ? 'var(--ink)' : 'var(--plane)',
                  color: on ? 'var(--surface)' : 'var(--ink-secondary)',
                }}
              >
                {g.name}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          選ばなければ未分類になります(あとで家計簿から2タップで分類できます)
        </p>
      </Field>
    ),
    quickGenre: (
      <Field label="ジャンル" tone="plain">
        <div role="group" aria-label="ジャンル" className="grid grid-cols-4 gap-2">
          {genres.map((g) => {
            const on = values.genreId === g.id;
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                aria-label={g.name}
                onClick={() => onChange({ ...values, genreId: on ? null : g.id })}
                className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2"
                style={{
                  background: on ? 'var(--accent)' : 'var(--surface-raised)',
                  color: on ? 'var(--on-accent)' : 'var(--ink-secondary)',
                }}
              >
                <GenreBadge name={g.name} size={28} />
                <span className="w-full truncate text-center text-xs font-semibold">{g.name}</span>
              </button>
            );
          })}
        </div>
      </Field>
    ),
    account: (
      <Field
        label="口座"
        htmlFor={`${id}-account`}
        tone="plain"
        error={showErrors ? errors.accountId : undefined}
      >
        <select
          id={`${id}-account`}
          value={values.accountId}
          onChange={(e) => onChange({ ...values, accountId: e.target.value })}
          className="min-h-11 w-full bg-transparent text-base outline-none"
          style={{ color: 'var(--ink)' }}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
    ),
    memo: (
      <Field label="メモ" htmlFor={`${id}-memo`} tone="plain">
        <input
          id={`${id}-memo`}
          autoComplete="off"
          placeholder="任意"
          value={values.memo}
          onChange={(e) => onChange({ ...values, memo: e.target.value })}
          className="min-h-11 w-full bg-transparent text-base outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </Field>
    ),
  };
  const ordered =
    variant === 'quick'
      ? [fields.amount, fields.quickGenre, fields.store, fields.date, fields.account, fields.memo]
      : [fields.amount, fields.date, fields.store, fields.genre, fields.account, fields.memo];

  return (
    <div className="space-y-5">
      {ordered.map((node, i) => (
        <div key={i}>{node}</div>
      ))}

      <details
        className="rounded-2xl"
        style={{ background: 'var(--surface)', border: '1px solid var(--hairline)' }}
        open={values.items.length > 0}
      >
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold">
          品目を入力する(任意)
        </summary>
        <div className="space-y-3 px-4 pb-4">
          {values.items.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <input
                aria-label="品名"
                placeholder="品名"
                value={item.name}
                onChange={(e) => setItem(item.id, { name: e.target.value })}
                className="min-h-11 min-w-0 flex-1 rounded-xl bg-transparent px-2 text-sm outline-none"
                style={{ border: '1px solid var(--hairline)', color: 'var(--ink)' }}
              />
              <input
                aria-label="金額(税込)"
                inputMode="numeric"
                placeholder="税込"
                value={item.amountYen === null ? '' : item.amountYen.toLocaleString('ja-JP')}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, '');
                  setItem(item.id, {
                    amountYen: digits === '' ? null : Number(digits.slice(0, 9)),
                  });
                }}
                className="tabular min-h-11 w-24 rounded-xl bg-transparent px-2 text-right text-sm outline-none"
                style={{ border: '1px solid var(--hairline)', color: 'var(--ink)' }}
              />
              <button
                type="button"
                aria-label={`税率 ${item.taxRate}%(押すと切り替え)`}
                onClick={() => setItem(item.id, { taxRate: item.taxRate === 8 ? 10 : 8 })}
                className="tabular min-h-11 w-14 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--plane)', color: 'var(--ink)' }}
              >
                {item.taxRate}%
              </button>
              <button
                type="button"
                aria-label="この品目を削除"
                onClick={() =>
                  onChange({ ...values, items: values.items.filter((i) => i.id !== item.id) })
                }
                className="min-h-11 w-11 text-base"
                style={{ color: 'var(--ink-secondary)' }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({
                ...values,
                items: [
                  ...values.items,
                  { id: crypto.randomUUID(), name: '', amountYen: null, taxRate: 8 },
                ],
              })
            }
            className="min-h-11 text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            品目を追加 +
          </button>

          <div
            role="status"
            className="rounded-xl px-3 py-2 text-xs"
            style={{
              background: 'var(--plane)',
              color:
                bar.status === 'short' || bar.status === 'over'
                  ? 'var(--ink)'
                  : 'var(--ink-secondary)',
            }}
          >
            <p>
              {bar.status === 'short' || bar.status === 'over' ? <span aria-hidden>▲ </span> : null}
              {itemsBarMessage(bar)}
            </p>
            {bar.byRate.length > 0 ? (
              <p className="tabular mt-1">
                {bar.byRate
                  .map(
                    (g) =>
                      `${g.rate}%対象 ${g.grossYen.toLocaleString('ja-JP')}円(内税 ${g.taxYen.toLocaleString('ja-JP')}円)`,
                  )
                  .join(' ・ ')}
              </p>
            ) : null}
          </div>
        </div>
      </details>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  tone,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  tone: 'plain' | 'unread' | 'auto';
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div
      data-tone={tone}
      className="rounded-2xl px-4 py-3"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${
          error ? 'var(--over)' : tone === 'unread' ? 'var(--state-caution)' : 'var(--hairline)'
        }`,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="text-xs font-semibold"
          style={{ color: 'var(--ink-secondary)' }}
        >
          {label}
        </label>
        {tone === 'unread' ? (
          <span className="text-xs font-semibold" style={{ color: 'var(--state-caution)' }}>
            <span aria-hidden>▲ </span>読み取れませんでした
          </span>
        ) : tone === 'auto' ? (
          <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            読み取り結果
          </span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
