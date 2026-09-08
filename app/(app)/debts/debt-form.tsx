'use client';

import { useActionState } from 'react';

import { formatAnnualRate } from '@/domain/money';
import type { Debt } from '@/features/debts/store';
import type { DebtFormState } from './actions';
import { DEBT_KIND_LABELS } from './kind-labels';

const INITIAL_STATE: DebtFormState = { error: null };

/** 新規登録・編集の両方で使う。編集は initial を渡す。 */
export function DebtForm({
  action,
  initial,
  submitLabel,
  onDone,
}: {
  action: (prevState: DebtFormState, formData: FormData) => Promise<DebtFormState>;
  initial?: Debt;
  submitLabel: string;
  /** 保存成功後に閉じる・一覧へ戻るなどの後片付け。編集フォームの折りたたみに使う。 */
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(async (prev: DebtFormState, fd: FormData) => {
    const result = await action(prev, fd);
    if (result.error === null) onDone?.();
    return result;
  }, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <Field label="借入先">
        <TextInput name="lenderName" defaultValue={initial?.lenderName} required />
      </Field>

      <Field label="種別">
        <select
          name="kind"
          defaultValue={initial?.kind ?? 'revolving'}
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        >
          {Object.entries(DEBT_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="現在残高(円)">
        <TextInput
          name="currentBalanceYen"
          inputMode="numeric"
          defaultValue={initial ? String(initial.currentBalanceYen) : ''}
          required
        />
      </Field>

      <Field label="最低返済額(円)">
        <TextInput
          name="minimumPaymentYen"
          inputMode="numeric"
          defaultValue={initial ? String(initial.minimumPaymentYen) : ''}
          required
        />
      </Field>

      <Field label="年利" hint="「15」と入力すると 15% として保存されます">
        <TextInput
          name="annualRate"
          inputMode="decimal"
          defaultValue={initial ? formatAnnualRate(initial.annualRate).replace('%', '') : ''}
          required
        />
      </Field>

      <Field label="返済日(1〜31)">
        <input
          name="paymentDay"
          type="number"
          min={1}
          max={31}
          defaultValue={initial?.paymentDay}
          required
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
