import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  pathname: '/spending',
  account: { email: 'me@example.com' as string | null, isOwner: false },
  payday: null as unknown,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('@/features/auth/actions', () => ({ signOutAction: vi.fn() }));
vi.mock('@/features/auth/owner', () => ({ getCurrentAccount: async () => state.account }));
vi.mock('@/features/settings/store', () => ({
  getAppSettings: async () => ({ aiEnabled: true, monthlySavingsTargetYen: 30000 }),
}));
vi.mock('@/features/transfer-runs/store', () => ({
  resolvePaydayChecklistState: async () => state.payday,
}));
vi.mock('../../app/(app)/settings/ai-actions', () => ({ updateAiSettingsAction: vi.fn() }));
vi.mock('../../app/(app)/settings/password-actions', () => ({ setPasswordAction: vi.fn() }));
vi.mock('../../app/(app)/payday/checklist-actions', () => ({
  createPaydayRunAction: vi.fn(),
  toggleTransferRunItemAction: vi.fn(),
}));
vi.mock('@/components/ui/bottom-sheet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/bottom-sheet')>()),
  BottomSheet: ({ children }: { children: ReactNode }) => children,
}));

import { SettingsLink } from '@/components/ui/settings-link';
import { ASSISTANT_SCREENS } from '@/features/assistant/screens';
import { backTargetOf, knownBackTarget, SETTINGS_BACK } from '@/lib/back-target';
import { PaydayCard } from '../../app/(app)/_home/payday-card';
import InvestmentsPage from '../../app/(app)/investments/page';
import JobChangePage from '../../app/(app)/job-change/page';
import PaydayPage from '../../app/(app)/payday/page';
import AiSettingsPage from '../../app/(app)/settings/ai/page';
import SettingsPage from '../../app/(app)/settings/page';
import PasswordSettingsPage from '../../app/(app)/settings/password/page';
import SideHustlePage from '../../app/(app)/side-hustle/page';

/**
 * 設定とお金まわり(提案書の段階5、ADR-127):… のメニューをやめて、どのタブの右上にも設定の歯車。設定は
 * 1画面(AI機能は1行のスイッチ、パスワードと給料日はシート)。使っていない投資・副業・転職準備は外す。
 */

const visible = (html: string) => html.replace(/<!-- -->/g, '');
const read = (path: string) => readFileSync(path, 'utf8');
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? '');

async function settingsHtml(from?: string) {
  const element = await SettingsPage({ searchParams: Promise.resolve(from ? { from } : {}) });
  return visible(renderToString(element));
}

beforeEach(() => {
  state.pathname = '/spending';
  state.account = { email: 'me@example.com', isOwner: false };
  state.payday = null;
});

describe('どのタブの右上にも設定の歯車(… のメニューをやめる)', () => {
  it('今日・明細・分析(目標・月のふりかえり)・AI の見出しに、同じ歯車を置く', () => {
    for (const file of [
      'app/(app)/_home/home-header.tsx',
      'app/(app)/spending/period-switcher.tsx',
      'app/(app)/reports/page.tsx',
      'app/(app)/assistant/assistant-chat.tsx',
    ]) {
      expect(read(file), file).toContain('<SettingsLink />');
    }
    expect(read('app/(app)/reports/month/page.tsx')).toContain('<PeriodSwitcher title="分析" />');
    expect(existsSync('src/components/ui/more-menu.tsx')).toBe(false);
    expect(read('app/(app)/_home/home-header.tsx')).not.toContain('MoreMenu');
  });

  it('歯車は開いた画面を渡し、設定の「‹ 戻り先」をその画面の名前にする', () => {
    state.pathname = '/reports/month';
    const html = renderToString(h(SettingsLink));
    expect(html).toContain('href="/settings?from=%2Freports%2Fmonth"');
    expect(html).toContain('aria-label="設定"');
    expect(html).toMatch(/class="[^"]*min-h-11/);
  });
});

describe('戻り先(‹ 前の画面の名前)', () => {
  it.each([
    [undefined, '/', '今日'],
    ['/', '/', '今日'],
    ['/spending', '/spending', '明細'],
    ['/spending/review', '/spending/review', '確認が必要'],
    ['/reports', '/reports', '分析'],
    ['/reports/month', '/reports/month', '月のふりかえり'],
    ['/assistant', '/assistant', 'AI'],
    ['/settings', '/settings', '設定'],
    ['/plan/edit', '/plan/edit', '今期の目標'],
  ])('from=%s → ‹ %s(%s)', (from, href, label) => {
    expect(backTargetOf(from)).toEqual({ href, label });
  });

  it('知らない画面・外へのリンクは使わない', () => {
    for (const from of ['//evil.example', '/\\evil.example', 'https://evil.example', '/unknown']) {
      expect(backTargetOf(from)).toEqual({ href: '/', label: '今日' });
      expect(knownBackTarget(from)).toBeNull();
    }
    expect(backTargetOf('/unknown', SETTINGS_BACK)).toEqual(SETTINGS_BACK);
  });

  it('設定の下の画面は ‹ 設定 で戻る。もとの「戻る」「やめる」「→」の文字のリンクは使わない', () => {
    for (const file of [
      'app/(app)/settings/gmail/page.tsx',
      'app/(app)/settings/google/page.tsx',
      'app/(app)/settings/rescued-emails/page.tsx',
      'app/(app)/settings/theme/page.tsx',
      'app/(app)/briefs/page.tsx',
      'app/(app)/accounts/page.tsx',
    ]) {
      const page = read(file);
      expect(page, file).toContain("back={{ href: '/settings', label: '設定' }}");
      expect(page, file).not.toMatch(/>\s*戻る\s*</);
    }
    expect(read('app/(app)/settings/categories/page.tsx')).toContain(
      'back={backTargetOf(from, SETTINGS_BACK)}',
    );
    expect(read('app/(app)/plan/edit/goal-editor.tsx')).toContain(
      'href="/settings/categories?from=/plan/edit"',
    );
    expect(read('app/(app)/settings/categories/[genreId]/page.tsx')).toContain(
      "<BackLink back={{ href: '/settings/categories', label: 'カテゴリ' }} />",
    );
    expect(read('app/(app)/briefs/[id]/page.tsx')).toContain(
      "back={{ href: '/briefs', label: '朝配信' }}",
    );
  });

  it('入力をやめる画面は「キャンセル」(CSVを取り込む・設定から開いた はじめての設定)', () => {
    const csv = read('app/(app)/transactions/import/page.tsx');
    expect(csv).toContain("back={{ href: '/spending', label: '明細', cancel: true }}");
    expect(csv).not.toMatch(/>\s*やめる\s*</);
    expect(read('app/(app)/welcome/page.tsx')).toContain(
      '{back ? <BackLink back={{ ...back, cancel: true }} /> : null}',
    );
    expect(read('app/(app)/transactions/receipt/[id]/page.tsx')).toContain(
      '<BackHeader back={target} title="レシートを入力" />',
    );
  });
});

describe('設定は1画面', () => {
  it('お金・表示と分類・AI・そのほか の行と、一番下のログアウト', async () => {
    const html = await settingsHtml();
    for (const label of [
      '給料日の振り分け',
      '貯金',
      '口座',
      '予定と固定費',
      'カテゴリ',
      '色',
      'AI機能',
      'はじめての設定',
      'お知らせ',
      'パスワード',
      'ログアウト',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('me@example.com でログイン中');
    expect(hrefs(html).sort()).toEqual(
      [
        '/',
        '/accounts',
        '/notifications',
        '/savings?from=/settings',
        '/settings/categories',
        '/settings/theme',
        '/upcoming?from=/settings',
        '/welcome?from=/settings',
      ].sort(),
    );
    expect(html.lastIndexOf('ログアウト')).toBeGreaterThan(html.lastIndexOf('パスワード'));
  });

  it('開いた画面の名前で戻る', async () => {
    expect(await settingsHtml('/reports/month')).toMatch(
      /href="\/reports\/month"[^>]*>[\s\S]{0,400}月のふりかえり<\/a>/,
    );
  });

  it('連携(Gmail・Google・読み取れなかったメール・朝配信)はオーナーだけ', async () => {
    const owner = ['/settings/gmail', '/settings/google', '/settings/rescued-emails', '/briefs'];
    expect(hrefs(await settingsHtml()).filter((href) => owner.includes(href))).toEqual([]);
    state.account = { email: null, isOwner: true };
    expect(hrefs(await settingsHtml()).filter((href) => owner.includes(href))).toEqual(owner);
  });

  it('AI機能は1行のスイッチ(押したらそのまま保存)。別の画面にしない', async () => {
    const html = await settingsHtml();
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*role="switch"[^>]*checked/);
    expect(html).toContain('aria-label="AI機能を使う"');
    expect(html).not.toContain('保存する');
    expect(read('app/(app)/settings/ai-switch.tsx')).toContain(
      'onChange={() => form.current?.requestSubmit()}',
    );
  });

  it('パスワードと給料日の振り分けはシートで開く(画面を移らない)', async () => {
    const html = await settingsHtml();
    expect(html).toContain('新しいパスワード');
    expect(html).toContain('給料日になったら、入った額だけ入れます。');
    expect(html).not.toContain('href="/settings/password"');
    expect(html).not.toContain('href="/payday"');
  });

  it('古い画面(AI機能・パスワード・給料日)は設定へ送る', () => {
    for (const Page of [AiSettingsPage, PasswordSettingsPage, PaydayPage]) {
      expect(() => Page()).toThrow('REDIRECT /settings');
    }
  });
});

describe('給料日は今日の画面のカード＋シート', () => {
  it('給料日でない日は出さない', async () => {
    state.payday = { kind: 'not_payday' };
    expect(await PaydayCard()).toBeNull();
    state.payday = null;
    expect(await PaydayCard()).toBeNull();
  });

  it('給料日には「給料日です」と、入った額を入れるシート', async () => {
    state.payday = { kind: 'needs_amount', paydayOn: '2026-10-25' };
    const element = await PaydayCard();
    const html = visible(renderToString(element!));
    expect(html).toContain('給料日です');
    expect(html).toContain('振り分ける');
    expect(read('app/(app)/page.tsx')).toMatch(/<HomeBanners \/>[\s\S]*<PaydayCard \/>/);
  });
});

describe('使っていない画面を外す(投資・副業・転職準備。データは残す)', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  }

  it('画面は設定へ送るだけ。どこからもリンクしない', () => {
    for (const path of ['investments', 'side-hustle', 'job-change']) {
      expect(readdirSync(`app/(app)/${path}`)).toEqual(['page.tsx']);
    }
    for (const Page of [InvestmentsPage, SideHustlePage, JobChangePage]) {
      expect(() => Page()).toThrow('REDIRECT /settings');
    }
    const linked = [...walk('app'), ...walk('src')].filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !/app\/\(app\)\/(investments|side-hustle|job-change)\//.test(file) &&
        /['"`]\/(investments|side-hustle|job-change)\b/.test(read(file)),
    );
    expect(linked).toEqual([]);
  });

  it('AIが出す画面のボタンは、いまある画面だけ(古い画面への受け皿は出さない)', () => {
    for (const { href } of Object.values(ASSISTANT_SCREENS)) {
      const route = href === '/' ? '' : href;
      const page = `app/(app)${route}/page.tsx`;
      expect(existsSync(page), href).toBe(true);
      expect(read(page), href).not.toMatch(/^\s*redirect\(/m);
    }
  });
});

describe('貯金目標を1つに', () => {
  it('毎月の額が目標。「何のために」はその目標のくわしい内容。前の目標はたたむ', () => {
    const page = read('app/(app)/savings/page.tsx');
    expect(page.match(/<h2[^>]*>\s*貯金目標\s*<\/h2>/g)).toHaveLength(1);
    expect(page).toContain('<MonthlyTarget initialYen={target} />');
    expect(page).toContain('前につくった目標({older.length}件)');
    expect(read('app/(app)/savings/new-goal.tsx')).toContain('+ 何のために貯めるか(任意)');
  });

  it('AIの月のレポートも、今日の画面と同じ毎月の額で「あといくら」を言う', () => {
    expect(read('src/features/ai-report/store.ts')).toContain(
      'savingsForReport(home.savings, settings?.monthlySavingsTargetYen ?? 0)',
    );
    expect(read('src/features/ai-report/monthly-report-ai.ts')).toContain(
      '`貯金目標 毎月${s.monthlyTargetYen}円 ・ 今月あと$',
    );
  });
});
