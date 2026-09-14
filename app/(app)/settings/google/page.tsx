import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { getGoogleEnv } from '@/lib/env';

/**
 * Google 連携の設定(本人発案)。
 *
 * カレンダー同期(給料日・サブスク更新日・完済予定日)とスプレッドシート
 * への月次バックアップの両方が、ここでの同意1回だけで有効になる
 * (Calendar + Sheets の両方のスコープを一度に要求するため)。
 *
 * `/settings/gmail` と同じ考え方:資格情報そのものはこの画面から
 * 入力させない。OAuth の同意フロー(/api/auth/google/*)を通し、
 * 発行された refresh_token は画面に一度だけ表示し、本人が環境変数
 * (Vercel + GitHub Secrets)へ手でコピーする(ADR-014、NFR-04)。
 */
export default function GoogleSettingsPage() {
  const connected = getGoogleEnv() !== null;

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          Google 連携
        </h1>
        <Link href="/" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          戻る
        </Link>
      </header>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        給料日・サブスクの更新日・完済予定日をGoogleカレンダーへ、毎月の明細を
        Googleスプレッドシートへ自動でバックアップします。
      </p>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              状態
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {connected
                ? '環境変数が設定済みです(実際にカレンダー・スプレッドシートへ書き込めるかは次回の同期を待ってください)'
                : 'まだ連携していません'}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{
              background: connected ? 'var(--accent-track)' : 'var(--plane)',
              color: connected ? 'var(--accent)' : 'var(--ink-muted)',
            }}
          >
            {connected ? '設定済み' : '未設定'}
          </span>
        </div>

        <a
          href="/api/auth/google/start"
          className="mt-4 block w-full rounded-full py-3 text-center text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {connected ? 'Google と再連携する' : 'Google と連携する'}
        </a>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          設定手順
        </h2>
        <ol className="mt-3 space-y-3 text-sm" style={{ color: 'var(--ink-secondary)' }}>
          <Step n={1}>
            <a
              href="https://console.cloud.google.com/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
              style={{ color: 'var(--accent)' }}
            >
              Google Cloud Console
            </a>
            で新しいプロジェクトを作り、「Google Calendar API」と「Google Sheets API」を有効にする
          </Step>
          <Step n={2}>
            「OAuth 同意画面」で User Type を「外部」にし、公開ステータスは
            「テスト」のままでよい(本人のGoogleアカウントを「テストユーザー」に追加する)
          </Step>
          <Step n={3}>
            「認証情報」から OAuth クライアントID(種類:ウェブ アプリケーション)を作成し、
            「承認済みのリダイレクトURI」に次を追加する:
            <Code>{'{アプリのURL}/api/auth/google/callback'}</Code>
          </Step>
          <Step n={4}>
            発行された値を環境変数 <Code>GOOGLE_CLIENT_ID</Code> と{' '}
            <Code>GOOGLE_CLIENT_SECRET</Code> に設定する(Vercel + GitHub Secrets)
          </Step>
          <Step n={5}>
            デプロイ後、上の「Google と連携する」を押して同意する。表示された値を{' '}
            <Code>GOOGLE_REFRESH_TOKEN</Code> として同じく設定する
          </Step>
        </ol>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          安全のために
        </h2>
        <ul className="mt-3 space-y-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          <li>
            ・クライアントID/シークレット/refresh_tokenはこの画面から入力させません。環境変数にのみ置きます
          </li>
          <li>・データベースには何も保存しません</li>
          <li>・OAuth同意画面を「テスト」のままにしておけば、本人以外は連携できません</li>
          <li>
            ・連携をやめたい場合は{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
              style={{ color: 'var(--accent)' }}
            >
              Googleアカウントのアクセス権
            </a>
            からいつでも取り消せます
          </li>
        </ul>
      </Card>
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
      className="rounded px-1.5 py-0.5 font-mono text-[12px] break-all"
      style={{ background: 'var(--plane)', color: 'var(--ink)' }}
    >
      {children}
    </code>
  );
}
