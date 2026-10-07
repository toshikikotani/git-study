/**
 * ログイン画面(M0-3、ADR-011改定、ADR-066)。
 *
 * パスワードでログインする。「新規登録」で、誰でも自分のアカウントを作れる(データはユーザーごとに
 * 分かれる)。既存アカウントのパスワードを、メールアドレスだけで書き換える経路は廃止した
 * (actions.ts の `signUpAction`)。
 */
'use client';

import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';

import { signUpAction } from './actions';

type Tab = 'password' | 'register';

/**
 * ログインできたら、ホームをページごと読み直して開く(ADR-083)。
 *
 * 以前は `router.push('/')` の直後に `router.refresh()` を呼んでいた。refresh は「今の画面」を
 * 読み直すため、ホームへの移動が終わる前に呼ばれるとログイン画面を読み直してしまい、ホームへ
 * 移れずに「ログインしています…」のまま止まることがあった(ホームの読み込みが重いほど起きる)。
 * ページごと読み直せば、新しいセッションの cookie を必ず持ってホームを開ける。戻るボタンで
 * ログイン画面に戻らないよう replace にする。
 */
function openHome() {
  window.location.replace('/');
}

export function LoginForm() {
  const [tab, setTab] = useState<Tab>('password');

  return (
    <div className="rise">
      <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        ログイン
      </h1>

      <div className="mt-5 flex gap-2">
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
    openHome();
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
          メールアドレスまたはパスワードが違います。初めての場合は「新規登録」から
          アカウントを作れます。
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded-2xl py-3 text-sm font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--action)' }}
      >
        {status === 'sending' ? 'ログインしています…' : 'ログイン'}
      </button>
    </form>
  );
}

function RegisterForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('sending');

    let result: { error: string | null };
    try {
      result = await signUpAction(email, password, passwordConfirmation);
    } catch {
      // サーバー側の設定不備などで例外が飛んでくることがある。
      // 「設定しています…」のまま固まって見えるのを防ぐため、
      // ここで必ず error 状態に落とす。
      setStatus('error');
      setErrorMessage('登録処理でエラーが発生しました。しばらくしてから再度お試しください。');
      return;
    }

    if (result.error) {
      setStatus('error');
      setErrorMessage(result.error);
      return;
    }

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setStatus('error');
      setErrorMessage(
        'アカウントは作れましたが、ログインに失敗しました。パスワードタブからログインしてください。',
      );
      return;
    }

    openHome();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        メールアドレスとパスワードで、自分のアカウントを作れます。家計簿のデータは、あなただけが
        見られます(ほかの人には見えません)。
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
        placeholder="パスワード(8文字以上)"
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
        {status === 'sending' ? '登録しています…' : 'アカウントを作ってはじめる'}
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
      className="rounded-full px-3 py-2 text-xs font-medium"
      style={
        active
          ? { background: 'var(--accent)', color: 'var(--on-accent)' }
          : { background: 'var(--plane)', color: 'var(--ink-secondary)' }
      }
    >
      {children}
    </button>
  );
}
