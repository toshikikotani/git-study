'use client';

import { useActionState } from 'react';

import { MIN_PASSWORD_LENGTH } from '@/domain/auth';
import { setPasswordAction, type PasswordFormState } from './actions';

const INITIAL_STATE: PasswordFormState = { error: null };

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
        className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
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
        className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
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

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl py-3 text-sm font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {pending ? '設定しています…' : 'パスワードを設定'}
      </button>
    </form>
  );
}
