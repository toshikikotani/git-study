/**
 * ログイン画面(M0-3、ADR-011改定)。
 *
 * パスワードのみ。Magic Link(メール経由のリンク)は「リンクが無効です」
 * というエラーが頻発し実運用に耐えなかったため廃止した(2026-09-13)。
 * 初回のパスワード設定・失念時の復旧経路は「新規登録」タブに置き換えた
 * ――ここでの「登録」は新しいアカウントを作るものではなく、既存の
 * (本人の)アカウントのメールアドレスと一致した場合にしかパスワードを
 * 設定できない(actions.ts の `registerPasswordAction` 参照)。メール
 * アドレスだけでは誰でも知っている前提の情報のため、本人しか知らない
 * 合言葉(REGISTRATION_SECRET)をもう1つの認証要素として要求することで、
 * 他人がこの URL の存在を知っても勝手にログインできないようにしている
 * (元の shouldCreateUser: false と同じ「本人以外は入れない」を保つ)。
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';

import { registerPasswordAction } from './actions';

type Tab = 'password' | 'register';

export function LoginForm() {
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
        <TabButton active={tab === 'register'} onClick={() => setTab('register')}>
          新規登録
        </TabButton>
      </div>

      <div className="mt-4">{tab === 'password' ? <PasswordForm /> : <RegisterForm />}</div>
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
          「新規登録」からお試しください。
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

function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('sending');

    const { error } = await registerPasswordAction(email, password, passwordConfirmation, secret);
    if (error) {
      setStatus('error');
      setErrorMessage(error);
      return;
    }

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setStatus('error');
      setErrorMessage(
        'パスワードは設定できましたが、ログインに失敗しました。パスワードタブからログインしてください。',
      );
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        パスワードを初めて設定する場合や忘れた場合は、こちらから直接設定できます。
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
      <input
        type="password"
        required
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="新しいパスワード(8文字以上)"
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
        autoComplete="new-password"
        value={passwordConfirmation}
        onChange={(event) => setPasswordConfirmation(event.target.value)}
        placeholder="確認のため再入力"
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
        autoComplete="off"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
        placeholder="合言葉"
        className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
        style={{
          background: 'var(--surface)',
          color: 'var(--ink)',
          boxShadow: 'var(--card-shadow)',
        }}
      />

      {status === 'error' ? (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--over)' }}>
          {errorMessage}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded-2xl py-3 text-sm font-medium disabled:opacity-50"
        style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
      >
        {status === 'sending' ? '設定しています…' : 'パスワードを設定してログイン'}
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
