import Link from 'next/link';

import { Card } from '@/components/ui/card';

/**
 * Gmail 自動取得の設定案内(ADR-018)。
 *
 * 資格情報そのものはこの画面から入力させない。アプリパスワードを DB や
 * フォームに通すと、バックアップ・ログ・スクリーンショットの全てが
 * 漏洩経路になる。入力先は環境変数で、ここは手順の案内に徹する(NFR-04)。
 */
export default function GmailSettingsPage() {
  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          Gmail 自動取得
        </h1>
        <Link href="/transactions" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          戻る
        </Link>
      </header>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        カード会社の利用通知メールを自動で取り込みます。設定すると、リボ・
        キャッシングを月末を待たずにその日のうちに検知できます。
      </p>

      <Card>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          設定手順
        </h2>
        <ol className="mt-3 space-y-3 text-sm" style={{ color: 'var(--ink-secondary)' }}>
          <Step n={1}>
            Google アカウントで<strong>2段階認証</strong>を有効にする
          </Step>
          <Step n={2}>
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
              style={{ color: 'var(--accent)' }}
            >
              アプリパスワード
            </a>
            を発行する(16文字が表示されます)
          </Step>
          <Step n={3}>
            発行した値を環境変数 <Code>GMAIL_ADDRESS</Code> と <Code>GMAIL_APP_PASSWORD</Code>{' '}
            に設定する
          </Step>
        </ol>

        <div
          className="mt-4 rounded-2xl p-3 text-xs leading-relaxed"
          style={{ background: 'var(--plane)', color: 'var(--ink-muted)' }}
        >
          通常の Gmail パスワードでは接続できません。Google は 2025年5月に
          通常パスワードでの外部アプリ接続を停止しました。
          <br />
          アプリパスワードはメールの読み取りにのみ使われ、同じ画面からいつでも 失効させられます。
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          安全のために
        </h2>
        <ul className="mt-3 space-y-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          <li>・パスワードはこの画面から入力しません。環境変数にのみ置きます</li>
          <li>・データベースにも保存しません。保存するのは変数名だけです</li>
          <li>・読み取りは指定したカード会社の差出人に限定できます</li>
          <li>・取り込み済みのメールは二度読みません</li>
        </ul>
      </Card>

      <p className="px-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        現在は未設定です。設定が済むまでは
        <Link href="/transactions/paste" className="underline underline-offset-4">
          メールの貼り付け
        </Link>
        で個別に取り込めます。
      </p>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="tabular flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
        style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
      >
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="rounded px-1.5 py-0.5 font-mono text-[12px]"
      style={{ background: 'var(--plane)', color: 'var(--ink)' }}
    >
      {children}
    </code>
  );
}
