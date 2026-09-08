/**
 * ログイン画面(M0-3、NFR-04)。
 *
 * パスワードを持たない。Magic Link のみ。本人専用のシングルユーザーなので、
 * shouldCreateUser: false で新規サインアップを拒む――他人がこの URL の
 * 存在を知ってメールアドレスを打ち込んでも、アカウントは作られない
 * (Supabase 側の signup 設定と二重で守る。ADR-011)。
 */
'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';

export function LoginForm() {
  const searchParams = useSearchParams();
  const hadCallbackError = searchParams.get('error') === 'auth';

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('sending');

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setStatus(error ? 'error' : 'sent');
  }

  if (status === 'sent') {
    return (
      <p
        className="rise text-center text-sm leading-relaxed"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {email} 宛にログインリンクを送りました。メールを確認してください。
      </p>
    );
  }

  return (
    <div className="rise">
      <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        ログイン
      </h1>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        登録済みのメールアドレスにログインリンクを送ります。
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
          style={{
            background: 'var(--surface)',
            color: 'var(--ink)',
            boxShadow: 'var(--card-shadow)',
          }}
        />

        {status === 'error' || hadCallbackError ? (
          <p className="text-xs" style={{ color: 'var(--over)' }}>
            {status === 'error'
              ? 'ログインリンクの送信に失敗しました。時間をおいて試してください。'
              : 'リンクの有効期限が切れています。もう一度送信してください。'}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={status === 'sending'}
          className="w-full rounded-2xl py-3 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {status === 'sending' ? '送信しています…' : 'ログインリンクを送る'}
        </button>
      </form>
    </div>
  );
}
