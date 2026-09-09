'use client';

import { useActionState } from 'react';

import type { Account } from '@/features/accounts/store';
import type { AccountFormState } from './actions';
import { ACCOUNT_KIND_LABELS, ACCOUNT_PURPOSE_LABELS } from './kind-labels';

const INITIAL_STATE: AccountFormState = { error: null };

/** 新規登録・編集の両方で使う。編集は initial を渡す。 */
export function AccountForm({
  action,
  initial,
  submitLabel,
  onDone,
}: {
  action: (prevState: AccountFormState, formData: FormData) => Promise<AccountFormState>;
  initial?: Account;
  submitLabel: string;
  /** 保存成功後に閉じる・一覧へ戻るなどの後片付け。編集フォームの折りたたみに使う。 */
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: AccountFormState, fd: FormData) => {
      const result = await action(prev, fd);
      if (result.error === null) onDone?.();
      return result;
    },
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-3">
      <Field label="口座名">
        <TextInput name="name" defaultValue={initial?.name} required />
      </Field>

      <Field label="金融機関名(任意)">
        <TextInput
          name="institutionName"
          defaultValue={initial?.institutionName ?? ''}
          required={false}
        />
      </Field>

      <Field label="種別">
        <select
          name="kind"
          defaultValue={initial?.kind ?? 'credit_card'}
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          {Object.entries(ACCOUNT_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="用途">
        <select
          name="purpose"
          defaultValue={initial?.purpose ?? 'other'}
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          {Object.entries(ACCOUNT_PURPOSE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="締め日(1〜31・任意)"
        hint="クレジットカードのみ。銀行口座・現金は空欄で構いません"
      >
        <input
          name="closingDay"
          type="number"
          min={1}
          max={31}
          defaultValue={initial?.closingDay ?? ''}
          required={false}
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
      </Field>

      <Field label="支払日(1〜31・任意)">
        <input
          name="paymentDay"
          type="number"
          min={1}
          max={31}
          defaultValue={initial?.paymentDay ?? ''}
          required={false}
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
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
