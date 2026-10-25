'use client';

import { useActionState, useState } from 'react';

import type { Account, AccountKind } from '@/features/accounts/store';
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
  const [kind, setKind] = useState<AccountKind>(initial?.kind ?? 'credit_card');
  const [closingDay, setClosingDay] = useState(String(initial?.closingDay ?? ''));
  const [paymentDay, setPaymentDay] = useState(String(initial?.paymentDay ?? ''));
  const [state, formAction, pending] = useActionState(
    async (prev: AccountFormState, fd: FormData) => {
      const result = await action(prev, fd);
      if (result.error === null) onDone?.();
      return result;
    },
    INITIAL_STATE,
  );

  const billingFields = (
    <>
      <Field label="締め日(1〜31・任意)" hint="未設定でも保存できます">
        <input
          name="closingDay"
          type="number"
          min={1}
          max={31}
          value={closingDay}
          onChange={(e) => setClosingDay(e.target.value)}
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
          value={paymentDay}
          onChange={(e) => setPaymentDay(e.target.value)}
          required={false}
          className="w-full rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
      </Field>
    </>
  );

  return (
    <form action={formAction} className="hm-form">
      <Field label="口座名">
        <TextInput name="name" defaultValue={initial?.name} required />
      </Field>

      <Field label="種別">
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as AccountKind)}
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

      <Field
        label="現在残高(円)"
        hint={kind === 'credit_card' ? '未払い残高をマイナスで入力してください' : undefined}
      >
        <TextInput
          name="currentBalanceYen"
          inputMode="numeric"
          defaultValue={initial ? String(initial.currentBalanceYen) : '0'}
          required
        />
      </Field>

      {kind === 'credit_card' ? billingFields : null}

      <details className="rounded-xl px-3 py-1" style={{ background: 'var(--plane)' }}>
        <summary
          className="min-h-11 cursor-pointer py-3 text-sm font-semibold"
          style={{ color: 'var(--ink-secondary)' }}
        >
          詳細設定 · 金融機関・用途・メモ
        </summary>
        <div className="space-y-3 pb-3">
          <Field label="金融機関名(任意)">
            <TextInput
              name="institutionName"
              defaultValue={initial?.institutionName ?? ''}
              required={false}
            />
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

          {kind !== 'credit_card' ? (
            <details>
              <summary className="min-h-11 cursor-pointer py-3 text-xs">
                締め日・支払日を設定する（任意）
              </summary>
              <div className="space-y-3">{billingFields}</div>
            </details>
          ) : null}

          <Field label="メモ(任意)">
            <TextInput name="note" defaultValue={initial?.note ?? ''} required={false} />
          </Field>
        </div>
      </details>

      {state.error ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {state.error}
        </p>
      ) : null}

      <div className="hm-toolbar pt-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 btn-primary flex-1 rounded-full py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hm-focus-color)] active:translate-y-px motion-reduce:transform-none disabled:cursor-not-allowed disabled:bg-[var(--action-off)] disabled:text-[var(--on-action-off)]"
        >
          {pending ? '保存中…' : submitLabel}
        </button>
        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="min-h-11 rounded-full px-4 py-3 text-sm font-semibold"
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
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {hint ? (
        <span className="mt-1 block text-xs" style={{ color: 'var(--ink-muted)' }}>
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
