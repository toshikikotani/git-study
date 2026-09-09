'use client';

import { useActionState, useState } from 'react';

import type { CategoryOption, TransferRule } from '@/features/transfer-rules/store';
import type { Account } from '@/features/accounts/store';
import type { TransferRuleFormState } from './actions';

const INITIAL_STATE: TransferRuleFormState = { error: null };

const AMOUNT_TYPE_LABELS = {
  fixed: '定額',
  percentage: '入金額に対する割合',
  remainder: '残り全額(この契機に1件まで)',
} as const;

/** 新規登録・編集の両方で使う。編集は initial を渡す。 */
export function RuleForm({
  action,
  initial,
  accounts,
  categories,
  submitLabel,
  onDone,
}: {
  action: (prevState: TransferRuleFormState, formData: FormData) => Promise<TransferRuleFormState>;
  initial?: TransferRule;
  accounts: readonly Account[];
  categories: readonly CategoryOption[];
  submitLabel: string;
  onDone?: () => void;
}) {
  const [amountType, setAmountType] = useState(initial?.amountType ?? 'fixed');
  const [state, formAction, pending] = useActionState(
    async (prev: TransferRuleFormState, fd: FormData) => {
      const result = await action(prev, fd);
      if (result.error === null) onDone?.();
      return result;
    },
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Field label="ルール名">
        <TextInput name="name" defaultValue={initial?.name} required />
      </Field>

      <Field label="金額の指定方式">
        <select
          name="amountType"
          value={amountType}
          onChange={(e) => setAmountType(e.target.value as typeof amountType)}
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          {Object.entries(AMOUNT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      {amountType === 'fixed' ? (
        <Field label="金額(円)">
          <TextInput
            name="amountYen"
            inputMode="numeric"
            defaultValue={initial?.amountYen ? String(initial.amountYen) : ''}
            required
          />
        </Field>
      ) : null}

      {amountType === 'percentage' ? (
        <Field label="割合(%)">
          <TextInput
            name="percentage"
            inputMode="decimal"
            defaultValue={initial?.percentage ? String(initial.percentage) : ''}
            required
          />
        </Field>
      ) : null}

      <Field label="振込先口座(任意)">
        <select
          name="toAccountId"
          defaultValue={initial?.toAccountId ?? ''}
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          <option value="">(指定なし)</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="対象カテゴリ(任意)" hint="支出の残額計算に使うカテゴリへの振替のとき指定します">
        <select
          name="categoryId"
          defaultValue={initial?.categoryId ?? ''}
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          <option value="">(指定なし)</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="メモ(任意)">
        <TextInput name="note" defaultValue={initial?.note ?? ''} required={false} />
      </Field>

      {state.error ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-full py-2.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {pending ? '保存中…' : submitLabel}
        </button>
        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded-full px-4 py-2.5 text-sm font-medium"
            style={{ color: 'var(--ink-muted)' }}
          >
            やめる
          </button>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {hint ? (
        <span className="mt-1 block text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      {...props}
      className="w-full rounded-xl px-3 py-2 text-sm"
      style={{
        background: 'var(--plane)',
        color: 'var(--ink)',
        border: '1px solid var(--hairline)',
      }}
    />
  );
}
