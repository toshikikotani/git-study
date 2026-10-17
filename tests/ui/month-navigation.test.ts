import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ledgerTx } from '../helpers/ledger';

const store = vi.hoisted(() => ({
  calendar: vi.fn(),
  monthlyReport: vi.fn(),
  monthlyView: vi.fn(),
  dailyView: vi.fn(),
}));

vi.mock('@/features/spending/store', () => ({ loadCalendarMonth: store.calendar }));
vi.mock('@/features/ai-report/store', () => ({
  loadMonthlyReport: store.monthlyReport,
  loadMonthlyAiReportView: store.monthlyView,
  loadDailyAiReportView: store.dailyView,
}));
vi.mock('@/lib/min-loading-duration', () => ({
  withMinDuration: (work: Promise<unknown>) => work,
}));
vi.mock('../../app/(app)/reports/ai/actions', () => ({
  generateMonthlyAiReportAction: vi.fn(),
  generateDailyAiReportAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/reports/month' }));
vi.mock('../../app/(app)/spending/spending-month-provider', () => ({
  useSpendingMonth: () => monthState,
}));

import { GenreBreakdown } from '../../app/(app)/spending/genre-breakdown';
import FrequencyPage from '../../app/(app)/reports/frequency/page';
import AiReportPage from '../../app/(app)/reports/ai/page';
import { MonthAnalysisLinks } from '../../app/(app)/reports/month/month-analysis-links';

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
  monthState = { ...monthState, visibleMonth: '2026-09-01', transactions, loading: false };
});
afterEach(() => vi.useRealTimers());

describe('月のふりかえりから同じ対象へ進む', () => {
  it('頻度・AIリンクと要約を選択月にそろえ、年の分析は12か月のまま残す', () => {
    const html = renderToString(h(MonthAnalysisLinks)).replace(/<!-- -->/g, '');
    expect(html).toContain('href="/reports/frequency?month=2026-09"');
    expect(html).toContain('href="/reports/ai?month=2026-09"');
    expect(html).toContain('外食は回数が多く、趣味は1回が高め');
    expect(html).toContain('href="/reports/monthly"');
    expect(html).toContain('今月までの直近12か月');
    expect(html).toContain('href="/reports/more"');

    monthState = { ...monthState, visibleMonth: '2026-08-01', transactions: [] };
    const changed = renderToString(h(MonthAnalysisLinks));
    expect(changed).toContain('href="/reports/frequency?month=2026-08"');
    expect(changed).not.toContain('外食は回数が多く');
  });

  it('通常カテゴリも未分類も選択した月の内訳へ直行し、戻り先を持つ', () => {
    const html = renderToString(h(GenreBreakdown));
    expect(html).toContain('href="/spending/category/dining?month=2026-09&amp;period=month');
    expect(html).toContain('href="/spending/category/none?month=2026-09&amp;period=month');
    expect(html).toContain('returnTo=%2Freports%2Fmonth%3Fmonth%3D2026-09');
  });

  it('頻度は指定月の明細で集計し、見出しと戻り先も一致する', async () => {
    const page = await FrequencyPage({ searchParams: Promise.resolve({ month: '2026-09' }) });
    expect(store.calendar).toHaveBeenCalledWith('2026-09-01', expect.any(Date));
    const html = renderToString(page).replace(/<!-- -->/g, '');
    expect(html).toContain('2026年9月');
    expect(html).toContain('外食は回数が多く、趣味は1回が高め');
    expect(html).toContain('href="/reports/month?month=2026-09"');
  });

  it('壊れたURLでは有効な今月を読み込む', async () => {
    await FrequencyPage({ searchParams: Promise.resolve({ month: '2026-13' }) });
    expect(store.calendar).toHaveBeenCalledWith('2026-10-01', expect.any(Date));
  });
});

describe('選択月のAIレポート', () => {
  it('過去月に未保存なら、その事実と次の操作を表示し、今月データを混ぜない', async () => {
    const page = await AiReportPage({ searchParams: Promise.resolve({ month: '2026-09' }) });
    const html = renderToString(page).replace(/<!-- -->/g, '');
    expect(store.monthlyReport).toHaveBeenCalledWith('2026-09');
    expect(store.calendar).toHaveBeenCalledWith('2026-09-01', expect.any(Date));
    expect(store.monthlyView).not.toHaveBeenCalled();
    expect(store.dailyView).not.toHaveBeenCalled();
    expect(html).toContain('この月のAIレポートは保存されていません');
    expect(html).toContain('href="/reports/month?month=2026-09"');
    expect(html).toContain('href="/reports/ai?month=2026-10"');
    expect(html).not.toContain('今日の支出');
    expect(html).not.toContain('今月の傾向');
  });

  it('保存済みの過去月レポートを表示し、根拠もその月へ戻す', async () => {
    store.monthlyReport.mockResolvedValue({
      personaType: 'balanced',
      personaReasoning: '9月は使うところを選べました。',
      insights: ['9月の外食の記録です。'],
      advice: ['買い物の予定を確認しましょう。'],
      createdAt: '2026-09-30T12:00:00Z',
      forecastRead: null,
    });
    const page = await AiReportPage({ searchParams: Promise.resolve({ month: '2026-09' }) });
    const html = renderToString(page).replace(/<!-- -->/g, '');
    expect(html).toContain('9月は使うところを選べました。');
    expect(html).toContain('2026年9月30日に作成した内容です。');
    expect(html).toContain('href="/spending?month=2026-09"');
    expect(html).not.toContain('保存されていません');
    expect(html).not.toContain('今月のレポートを更新する');
  });

  it('今月では従来の日次・月次の作成機能を維持する', async () => {
    await AiReportPage({ searchParams: Promise.resolve({ month: '2026-10' }) });
    expect(store.monthlyView).toHaveBeenCalledOnce();
    expect(store.dailyView).toHaveBeenCalledOnce();
    expect(store.monthlyReport).not.toHaveBeenCalled();
  });
});
