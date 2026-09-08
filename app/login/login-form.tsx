/**
 * ログイン画面(M0-3、ADR-011)。
 *
 * パスワードを主経路にする。毎回メールを開いてリンクを押す手間が
 * 継続利用そのものを阻害していたため(2026-09-08、ADR-011 改定)。
 * Magic Link は初回のパスワード設定・失念時の復旧経路として残す
 * (「メールでログイン」タブ)。shouldCreateUser: false で新規サインアップは
 * 拒む――他人がこの URL の存在を知ってメールアドレスを打ち込んでも、
 * アカウントは作られない(Supabase 側の signup 設定と二重で守る)。
 */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';

type Tab = 'password' | 'magic_link';

export function LoginForm() {
  const searchParams = useSearchParams();
  const hadCallbackError = searchParams.get('error') === 'auth';

  const [tab, setTab] = useState<Tab>('password');

  return (
    <div className="rise">
      <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        ログイン
      </h1>

      <div className="mt-5 flex gap-1.5">
        <TabButton active={tab === 'password'} onClick={() => setTab('password')}>
          パスワード
        </TabButton>
        <TabButton active={tab === 'magic_link'} onClick={() => setTab('magic_link')}>
          メールでログイン
        </TabButton>
      </div>

      {hadCallbackError ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--over)' }}>
          リンクの有効期限が切れています。もう一度送信してください。
        </p>
      ) : null}

      <div className="mt-4">{tab === 'password' ? <PasswordForm /> : <MagicLinkForm />}</div>
    </div>
  );
}

function PasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('sending');

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus('error');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
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
      <input
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="パスワード"
        className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
        style={{
          background: 'var(--surface)',
          color: 'var(--ink)',
          boxShadow: 'var(--card-shadow)',
        }}
      />

      {status === 'error' ? (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--over)' }}>
          メールアドレスまたはパスワードが違います。初めての場合やお忘れの場合は
          「メールでログイン」からお試しください。
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded-2xl py-3 text-sm font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {status === 'sending' ? 'ログインしています…' : 'ログイン'}
      </button>
    </form>
  );
}

function MagicLinkForm() {
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
      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {email} 宛にログインリンクを送りました。メールを確認してください。
        ログイン後、パスワードの設定画面に移ります。
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        パスワードを初めて設定する場合や忘れた場合は、こちらにログインリンクを送ります。
      </p>
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

      {status === 'error' ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          ログインリンクの送信に失敗しました。時間をおいて試してください。
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded-2xl py-3 text-sm font-medium disabled:opacity-50"
        style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
      >
        {status === 'sending' ? '送信しています…' : 'ログインリンクを送る'}
      </button>
    </form>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-xs font-medium"
      style={
        active
          ? { background: 'var(--accent)', color: '#fff' }
          : { background: 'var(--plane)', color: 'var(--ink-secondary)' }
      }
    >
      {children}
    </button>
  );
}
