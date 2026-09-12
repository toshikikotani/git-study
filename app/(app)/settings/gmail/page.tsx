import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { getGmailSettings } from '@/features/settings/gmail-store';
import { GmailSettingsForm } from './gmail-settings-form';

/**
 * Gmail 自動取得の設定(T-22、ADR-018)。
 *
 * 資格情報そのものはこの画面から入力させない。アプリパスワードを DB や
 * フォームに通すと、バックアップ・ログ・スクリーンショットの全てが
 * 漏洩経路になる。入力先は環境変数で、ここで編集するのは
 * 有効フラグ・差出人の絞り込み・取得件数上限の3つだけ(NFR-04)。
 */
export default async function GmailSettingsPage() {
  const settings = await getGmailSettings();

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
          設定
        </h2>
        <div className="mt-3">
          <GmailSettingsForm settings={settings} />
        </div>
      </Card>

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
          <li>・データベースに保存するのは上の設定(有効フラグ・差出人・件数上限)だけです</li>
          <li>・読み取りは指定したカード会社の差出人に限定できます</li>
          <li>・取り込み済みのメールは二度読みません</li>
        </ul>
      </Card>

      <p className="px-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {settings.gmailEnabled
          ? 'この設定に加えて、環境変数(GMAIL_ADDRESS/GMAIL_APP_PASSWORD/GMAIL_IMPORT_ACCOUNT_ID)の設定が済んでいる必要があります。'
          : '自動取得を有効にするまでは'}
        {settings.gmailEnabled ? null : (
          <>
            <Link href="/transactions/paste" className="underline underline-offset-4">
              メールの貼り付け
            </Link>
            で個別に取り込めます。
          </>
        )}
      </p>

      <Link
        href="/settings/rescued-emails"
        className="inline-flex items-center gap-1 px-1 text-xs font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        AI救済メールの見直し
        <span aria-hidden>→</span>
      </Link>
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
