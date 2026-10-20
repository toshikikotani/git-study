import type { Route } from 'next';
import Link from 'next/link';

import { BackHeader } from '@/components/ui/back-header';
import { DetailSheet } from '@/components/ui/detail-sheet';
import { getCurrentAccount } from '@/features/auth/owner';
import { getAppSettings } from '@/features/settings/store';
import { backTargetOf } from '@/lib/back-target';
import { loadPaydayState, PaydayPanel } from '../payday/payday-panel';
import { AiSwitch } from './ai-switch';
import { PasswordForm } from './password-form';
import { SignOutButton } from './sign-out-button';

export const dynamic = 'force-dynamic';

/**
 * 設定(提案書「設定は1画面」、ADR-127)。どのタブの右上の歯車からも開く(もとは今日の画面の「…」の
 * メニューと、AI機能・パスワード・給料日の別々の画面)。AI機能はこの画面の1行のスイッチ、パスワードと
 * 給料日の振り分けはシートで開く。連携(Gmail・Google・朝配信)はオーナーだけに出す(ADR-082)。
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { from } = await searchParams;
  const [account, settings, payday] = await Promise.all([
    getCurrentAccount(),
    getAppSettings().catch(() => null),
    loadPaydayState(),
  ]);

  return (
    <div className="rise flex flex-col gap-6" style={{ color: 'var(--ink)' }}>
      <BackHeader
        back={backTargetOf(from)}
        title="設定"
        {...(account.email ? { sub: `${account.email} でログイン中` } : {})}
      />

      <Group title="お金">
        <DetailSheet
          row
          label="給料日の振り分け"
          sub="入った額を入れて、振り分けを確かめる"
          title="給料日の振り分け"
        >
          <PaydayPanel state={payday} />
        </DetailSheet>
        <Row href="/savings?from=/settings" label="貯金" sub="貯金目標と貯まり具合" />
        <Row href="/accounts" label="口座" sub="残高・締め日・資産の推移" />
        <Row
          href="/upcoming?from=/settings"
          label="予定と固定費"
          sub="これからの支払いと毎月の固定費"
        />
      </Group>

      <Group title="表示と分類">
        <Row
          href="/settings/categories"
          label="カテゴリ"
          sub="追加・名前・アイコンと色・目標額・固定費"
        />
        <Row href="/settings/theme" label="色" sub="背景・文字・強調を変える" />
      </Group>

      <Group title="AI">
        <AiSwitch aiEnabled={settings?.aiEnabled ?? true} />
      </Group>

      <Group title="そのほか">
        <Row
          href="/welcome?from=/settings"
          label="はじめての設定"
          sub="手取り・今日からの目標・貯金目標"
        />
        <Row href="/notifications" label="お知らせ" />
        <DetailSheet row label="パスワード" title="パスワードを設定">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            次回からはメールを開かずに、このパスワードでログインできます。
          </p>
          <PasswordForm />
        </DetailSheet>
      </Group>

      {account.isOwner ? (
        <Group title="連携">
          <Row href="/settings/gmail" label="Gmail連携" />
          <Row href="/settings/google" label="Google連携" />
          <Row href="/settings/rescued-emails" label="読み取れなかったメール" />
          <Row href="/briefs" label="朝配信" />
        </Group>
      ) : null}

      <SignOutButton />
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="px-2 text-[13px] font-medium" style={{ color: 'var(--ink-muted)' }}>
        {title}
      </h2>
      <div
        className="flex flex-col overflow-hidden [&>*+*]:border-t [&>*+*]:border-[var(--hairline)]"
        style={{ borderRadius: 'var(--radius-inner)', background: 'var(--surface)' }}
      >
        {children}
      </div>
    </section>
  );
}

function Row({ href, label, sub }: { href: string; label: string; sub?: string }) {
  return (
    <Link
      href={href as Route}
      prefetch={false}
      className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 active:opacity-60"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-medium" style={{ color: 'var(--ink)' }}>
          {label}
        </span>
        {sub ? (
          <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {sub}
          </span>
        ) : null}
      </span>
      <span aria-hidden style={{ color: 'var(--ink-muted)' }}>
        ›
      </span>
    </Link>
  );
}
