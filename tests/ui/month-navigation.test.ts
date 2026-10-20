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

  it('別の画面だった 回数・月ごとの表・AIレポート・そのほかの分析・カテゴリ分析・ちりつも は、月のふりかえりへ', () => {
    for (const Page of [FrequencyPage, AiReportPage, MonthlyPage, MorePage, GenresPage, PilePage]) {
      expect(() => Page()).toThrow('REDIRECT /reports/month');
    }
  });
});
