import { readFileSync } from 'node:fs';
import { createElement as h, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 今日やること(デザインの課題 #1、ADR-131):目安の下に1枚。答え合わせ(確認待ちを含む)・入力待ちの
 * レシート・給料日の振り分け。どれも無ければ出さない。
 */
const s = vi.hoisted(() => ({
  check: 0,
  input: { count: 0, firstId: null as string | null },
  payday: null as unknown,
  unsaved: 0,
}));
vi.mock('../../app/(app)/_home/today-check-card', () => ({
  countTodayCheck: async () => s.check,
}));
vi.mock('@/features/home/pending', () => ({
  needsInputSummary: async () => s.input,
  countReadyCaptures: async () => s.unsaved,
}));
vi.mock('../../app/(app)/payday/payday-panel', () => ({
  loadPaydayState: async () => s.payday,
  PaydayPanel: () => null,
}));
vi.mock('../../app/(app)/spending/today-check', () => ({ TodayCheckSheet: () => null }));
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ children }: { children: ReactNode }) => children,
  BottomSheetHeader: ({ children }: { children: ReactNode }) => children,
}));

const { TodayTodo } = await import('../../app/(app)/_home/today-todo');
const visible = (html: string) => html.replace(/<!-- -->/g, '');

beforeEach(() => {
  s.check = 0;
  s.input = { count: 0, firstId: null };
  s.payday = null;
  s.unsaved = 0;
});

describe('今日やること', () => {
  it('片づけるものが無ければ出さない', async () => {
    expect(await TodayTodo({})).toBeNull();
  });

  it('保存前のレシートがあれば、いちばん上に「保存前のレシート N件」を出す(ADR-133)', async () => {
    s.unsaved = 3;
    s.check = 1;
    const html = visible(renderToString(h('main', null, await TodayTodo({}))));
    expect(html).toContain('保存前のレシート 3件');
    expect(html).toContain('href="/spending/review"');
    expect(html.indexOf('保存前のレシート')).toBeLessThan(html.indexOf('今日の答え合わせ'));
  });

  it('答え合わせ・入力待ち・給料日を1枚にまとめる(確認待ちは答え合わせの数に入る)', async () => {
    s.check = 4;
    s.input = { count: 2, firstId: 'capture-one' };
    s.payday = { kind: 'needs_amount', paydayOn: '2026-10-25' };
    const html = visible(renderToString(h('main', null, await TodayTodo({}))));
    expect(html.match(/<section/g)).toHaveLength(1);
    expect(html).toContain('今日やること');
    expect(html).toContain('今日の答え合わせ 4件');
    expect(html).toContain('レシート2件が入力待ち');
    expect(html).toContain('href="/spending/review"');
    expect(html).toContain('給料日です');
    expect(html).toContain('入った額から振り分けを出す');
    expect(html).not.toContain('確認待ちの記録');
  });

  it('入力待ちが1件ならレシートを直接開き、次の入力待ちへ戻れる', async () => {
    s.input = { count: 1, firstId: 'capture-one' };
    const html = renderToString(h('main', null, await TodayTodo({})));
    expect(html).toContain(
      'href="/transactions/receipt/capture-one?returnTo=%2Fspending%2Freview"',
    );
  });

  it('給料日でない日は給料日の行を出さない', async () => {
    s.check = 1;
    s.payday = { kind: 'not_payday' };
    const html = visible(renderToString(h('main', null, await TodayTodo({}))));
    expect(html).not.toContain('給料日です');
  });

  it('目安をいちばん上に置き、今日やることはその下(見出しのすぐ下に3枚を積まない)', () => {
    const page = readFileSync('app/(app)/page.tsx', 'utf8');
    expect(page).not.toMatch(/HomeBanners|PaydayCard|TodayCheckCard/);
    expect(page).toMatch(
      /<HomeHeader \/>\s*<Suspense fallback=\{<TodaySkeleton \/>\}>\s*<TodaySection/,
    );
    expect(page).toContain("<TodayTodo autoOpen={check === 'today'} />");
    const card = readFileSync('app/(app)/_home/today-card.tsx', 'utf8');
    expect(card).toMatch(/<TodayHero[\s\S]*\{props\.afterHero\}[\s\S]*<OutlookCard/);
  });
});
