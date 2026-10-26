import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ledgerTx } from '../helpers/ledger';

const store = vi.hoisted(() => ({
  calendar: vi.fn(),
  monthlyReport: vi.fn(),
  monthlyView: vi.fn(),
  dailyView: vi.fn(),
  months: vi.fn(),
}));

vi.mock('@/features/spending/store', () => ({ loadCalendarMonth: store.calendar }));
vi.mock('@/features/ai-report/store', () => ({
  loadMonthlyReport: store.monthlyReport,
  loadMonthlyAiReportView: store.monthlyView,
  loadDailyAiReportView: store.dailyView,
  listMonthlyReportMonths: store.months,
}));
vi.mock('@/lib/min-loading-duration', () => ({
  withMinDuration: (work: Promise<unknown>) => work,
}));
vi.mock('../../app/(app)/reports/ai/actions', () => ({
  generateMonthlyAiReportAction: vi.fn(),
  generateDailyAiReportAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/reports/month',
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('../../app/(app)/spending/spending-month-provider', () => ({
  useSpendingMonth: () => monthState,
}));

import { GenreBreakdown } from '../../app/(app)/spending/genre-breakdown';
import { AiReportLink } from '../../app/(app)/reports/month/ai-report-link';
import { FrequencyCard } from '../../app/(app)/reports/month/frequency-card';
import FrequencyPage from '../../app/(app)/reports/frequency/page';
import AiReportPage from '../../app/(app)/reports/ai/page';
import MonthlyPage from '../../app/(app)/reports/monthly/page';
import MorePage from '../../app/(app)/reports/more/page';
import GenresPage from '../../app/(app)/reports/genres/page';
import PilePage from '../../app/(app)/spending/pile/page';

const transactions = [
  ledgerTx({ id: 'meal1', genreId: 'dining', genreName: '外食', amountYen: -1_000 }),
  ledgerTx({ id: 'meal2', genreId: 'dining', genreName: '外食', amountYen: -1_000 }),
  ledgerTx({ id: 'hobby', genreId: 'hobby', genreName: '趣味', amountYen: -5_000 }),
];
let monthState = {
  visibleMonth: '2026-09-01',
  isCurrentMonth: false,
  loading: false,
  transactions,
  genreBreakdown: [
    { genreId: 'dining', genreName: '外食', spentYen: 2_000 },
    { genreId: null, genreName: '未分類', spentYen: 500 },
  ],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  vi.clearAllMocks();
  store.calendar.mockResolvedValue({ transactions, genreBreakdown: [] });
  store.monthlyReport.mockResolvedValue(null);
  store.monthlyView.mockResolvedValue({ input: { monthKey: '2026-10' }, report: null });
  store.dailyView.mockResolvedValue({ input: { dateKey: '2026-10-17' }, report: null });
  store.months.mockResolvedValue([]);
  monthState = { ...monthState, visibleMonth: '2026-09-01', transactions, loading: false };
});
afterEach(() => vi.useRealTimers());

describe('月のふりかえりから同じ対象へ進む(分析を浅くする、ADR-127)', () => {
  it('回数と1回の金額は、月のふりかえりのカードで、選んだ月の明細から出す', () => {
    const html = renderToString(h(FrequencyCard)).replace(/<!-- -->/g, '');
    expect(html).toContain('回数と1回の金額');
    monthState = { ...monthState, visibleMonth: '2026-08-01', transactions: [] };
    expect(renderToString(h(FrequencyCard))).toBe('');
  });

  it('通常カテゴリも未分類も選択した月の内訳へ直行し、戻り先を持つ', () => {
    monthState = { ...monthState, visibleMonth: '2026-09-01', transactions };
    const html = renderToString(h(GenreBreakdown));
    expect(html).toContain('href="/spending/category/dining?month=2026-09&amp;period=month');
    expect(html).toContain('href="/spending/category/none?month=2026-09&amp;period=month');
    expect(html).toContain('returnTo=%2Freports%2Fmonth%3Fmonth%3D2026-09');
  });

  it('別の画面だった 回数・月ごとの表・そのほかの分析・カテゴリ分析・ちりつも は、月のふりかえりへ', () => {
    for (const Page of [FrequencyPage, MonthlyPage, MorePage, GenresPage, PilePage]) {
      expect(() => Page()).toThrow('REDIRECT /reports/month');
    }
  });
});

/**
 * AIのレポート(本人の指摘「日次のレポート・タイプ診断・アドバイス・見込みの読み・前の月のレポートを
 * どっかで見れるように戻して」、ADR-128)。
 */
describe('AIのレポート', () => {
  const page = async (params: { month?: string; from?: string }) =>
    renderToString(await AiReportPage({ searchParams: Promise.resolve(params) })).replace(
      /<!-- -->/g,
      '',
    );

  it('月のふりかえりから、選んだ月のレポートを開く(目標が無い月でも)', () => {
    const past = renderToString(h(AiReportLink)).replace(/<!-- -->/g, '');
    expect(past).toContain('href="/reports/ai?month=2026-09"');
    expect(past).toContain('この月に保存したレポート');
    monthState = { ...monthState, visibleMonth: '2026-10-01', isCurrentMonth: true };
    const current = renderToString(h(AiReportLink)).replace(/<!-- -->/g, '');
    expect(current).toContain('href="/reports/ai?month=2026-10"');
    expect(current).toContain('タイプ診断');
  });

  it('今月は、日次のレポートと月次(タイプ診断・アドバイス・見込みの読み)を作る・更新する', async () => {
    await AiReportPage({ searchParams: Promise.resolve({ month: '2026-10' }) });
    expect(store.monthlyView).toHaveBeenCalledOnce();
    expect(store.dailyView).toHaveBeenCalledOnce();
    expect(store.monthlyReport).not.toHaveBeenCalled();
  });

  it('過去月に未保存なら、その事実と次の操作を表示し、今月データを混ぜない', async () => {
    const html = await page({ month: '2026-09' });
    expect(store.monthlyReport).toHaveBeenCalledWith('2026-09');
    expect(store.monthlyView).not.toHaveBeenCalled();
    expect(store.dailyView).not.toHaveBeenCalled();
    expect(html).toContain('この期間のAIレポートは保存されていません');
    expect(html).toContain('href="/reports/month?month=2026-09"');
    expect(html).toContain('href="/reports/ai?month=2026-10"');
    expect(html).not.toContain('今日の支出');
    expect(html).not.toContain('今月の傾向');
  });

  it('保存済みの過去月レポートを、タイプ診断・理由・気づき・アドバイスごと出す', async () => {
    store.monthlyReport.mockResolvedValue({
      personaType: 'balanced',
      personaReasoning: '9月は使うところを選べました。',
      insights: ['9月の外食の記録です。'],
      advice: ['買い物の予定を確認しましょう。'],
      createdAt: '2026-09-30T12:00:00Z',
      forecastRead: null,
    });
    const html = await page({ month: '2026-09' });
    expect(html).toContain('2026年9月のレポート');
    expect(html).toContain('支出傾向のタイプ');
    expect(html).toContain('9月は使うところを選べました。');
    expect(html).toContain('9月の外食の記録です。');
    expect(html).toContain('買い物の予定を確認しましょう。');
    expect(html).toContain('2026年9月30日に作成した内容です。');
    expect(html).toContain('href="/spending?month=2026-09"');
    expect(html).not.toContain('今月のレポートを更新する');
    expect(html).not.toContain('今期のレポートを更新する');
  });

  it('前の月のレポートを一覧から開く(開いている月と今月は除く)', async () => {
    store.months.mockResolvedValue(['2026-10', '2026-09', '2026-08', '2026-07']);
    const html = await page({ month: '2026-09' });
    expect(html).toContain('前のレポート');
    expect(html).toContain('href="/reports/ai?month=2026-08"');
    expect(html).toContain('2026年7月のレポート');
    // 開いている月はカードの見出しだけ(一覧に出さない)。今の期間も一覧に出さない。
    expect(html.match(/2026年9月のレポート/g)).toHaveLength(1);
    expect(html).not.toContain('2026年10月のレポート');
  });

  it('戻り先は開いた画面(分析・今日)、無ければその月の月のふりかえり', async () => {
    expect(await page({ month: '2026-09' })).toMatch(
      /href="\/reports\/month\?month=2026-09"[^>]*>[\s\S]{0,400}月のふりかえり<\/a>/,
    );
    expect(await page({ month: '2026-09', from: '/reports' })).toMatch(
      /href="\/reports"[^>]*>[\s\S]{0,400}分析<\/a>/,
    );
    expect(await page({ month: '2026-09', from: '/' })).toMatch(
      /href="\/"[^>]*>[\s\S]{0,400}今日<\/a>/,
    );
  });

  it('分析の「AIの気づき」と今日の1行から開ける', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('app/(app)/reports/ai-card.tsx', 'utf8')).toContain(
      'href="/reports/ai?from=/reports"',
    );
    expect(readFileSync('app/(app)/_home/ai-insight-line.tsx', 'utf8')).toContain(
      'href="/reports/ai?from=/"',
    );
    expect(readFileSync('app/(app)/reports/month/page.tsx', 'utf8')).toContain('<AiReportLink />');
  });
});
