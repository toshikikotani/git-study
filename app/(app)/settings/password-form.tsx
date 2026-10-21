'use client';

import { useActionState } from 'react';

import { MIN_PASSWORD_LENGTH } from '@/domain/auth';
import { setPasswordAction, type PasswordFormState } from './password-actions';

const INITIAL_STATE: PasswordFormState = { error: null, saved: false };

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(setPasswordAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input
        type="password"
        name="password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
        placeholder={`新しいパスワード(${MIN_PASSWORD_LENGTH}文字以上)`}
        className="glass w-full rounded-2xl px-4 py-3 text-sm outline-none"
        style={{
          background: 'var(--surface)',
          color: 'var(--ink)',
          boxShadow: 'var(--card-shadow)',
        }}
      />
      <input
        type="password"
        name="passwordConfirmation"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
        placeholder="確認のため再入力"
        className="glass w-full rounded-2xl px-4 py-3 text-sm outline-none"
        style={{
          background: 'var(--surface)',
          color: 'var(--ink)',
          boxShadow: 'var(--card-shadow)',
        }}
      />

      {state.error ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p role="status" className="text-xs" style={{ color: 'var(--income)' }}>
          パスワードを設定しました。次回からこのパスワードでログインできます。
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="btn-primary min-h-11 w-full rounded-2xl py-3 text-sm font-semibold"
      >
        {pending ? '設定しています…' : 'パスワードを設定'}
      </button>
    </form>
  );
}
