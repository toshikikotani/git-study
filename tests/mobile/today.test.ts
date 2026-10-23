import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSupabase } from '../helpers/fake-supabase';

const s = vi.hoisted(() => ({
  client: null as unknown,
  forecasts: null as unknown,
  check: [] as unknown[],
  payday: null as unknown,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => s.client }));
vi.mock('@/features/home/today-forecasts', () => ({
  loadTodayForecasts: async () => s.forecasts,
  todayCapYen: (view: { cap: number }) => view.cap,
}));
vi.mock('@/features/today-check/store', () => ({ listTodayCheck: async () => s.check }));
vi.mock('@/features/home/pending', () => ({
  needsInputSummary: async () => ({ count: 2, firstId: 'c' }),
}));
vi.mock('@/features/transfer-runs/store', () => ({
  resolvePaydayChecklistState: async () => s.payday,
}));

import { loadMobileToday } from '@/features/mobile/today';

/** iPhone アプリの「今日」(ADR-132):Web の今日の画面と同じ数字を、アプリが出せる形で返す。 */

const goalView = (cap: number, spentToday: number) => ({
  cap,
  todaySpentYen: spentToday,
  tomorrowLimit: { todayLimitYen: 2400 },
  forecast: {
    provisional: false,
    breakdown: { actualYen: 52_000 },
    total: { p50: 98_000 },
    probWithinBudget: 0.62,
  },
});

beforeEach(() => {
  s.client = fakeSupabase(
    {
      transactions: [
        {
          id: 't1',
          user_id: 'me',
          occurred_on: '2026-10-21',
          created_at: '2026-10-21T01:00:00Z',
          description: 'VISA',
          merchant_name: 'セブン',
          amount_yen: -453,
          genre_id: 'food',
        },
        {
          id: 'old',
          user_id: 'me',
          occurred_on: '2026-10-20',
          created_at: '2026-10-20T01:00:00Z',
          description: '昨日',
          merchant_name: null,
          amount_yen: -100,
          genre_id: null,
        },
      ],
      genres: [{ id: 'food', user_id: 'me', name: '食料品' }],
    },
    { id: 'me' },
  ).client;
  s.check = [{}, {}, {}];
  s.payday = { kind: 'needs_amount', paydayOn: '2026-10-25' };
  s.forecasts = {
    today: '2026-10-21',
    goal: { period: { from: '2026-10-01', to: '2026-10-31' }, budgetYen: 100_000 },
    goalView: goalView(3000, 1000),
  };
});

describe('今日', () => {
  it('目安・明日から・見通し・今日やること・今日の記録', async () => {
    const today = await loadMobileToday('me');
    expect(today.allowance).toEqual({ kind: 'left', yen: 2000 });
    expect(today.tomorrowYen).toBe(2400);
    expect(today.outlook).toEqual({
      periodLabel: '10/1〜10/31 · 残り11日',
      spentYen: 52_000,
      p50Yen: 98_000,
      budgetYen: 100_000,
      probWithin: 0.62,
    });
    expect(today.todo).toEqual({ checkCount: 3, capturesCount: 2, payday: true });
    expect(today.records).toEqual([
      {
        id: 't1',
        occurredOn: '2026-10-21',
        label: 'セブン',
        amountYen: -453,
        genreId: 'food',
        genreName: '食料品',
      },
    ]);
  });

  it('こえた日は「こえています」の額、目標が無ければ目安を出さない', async () => {
    s.forecasts = { ...(s.forecasts as object), goalView: goalView(3000, 4200) };
    expect((await loadMobileToday('me')).allowance).toEqual({ kind: 'over', yen: 1200 });
    s.forecasts = { today: '2026-10-21', goal: null, goalView: null };
    const none = await loadMobileToday('me');
    expect(none.allowance).toBeNull();
    expect(none.outlook).toBeNull();
  });
});
