import { createElement as h, useEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookState } from '../helpers/hook-state';

const state = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  url: 'https://example.test/spending?month=2026-09',
  load: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useRef: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useRef']>) =>
    state.host!.hooks.useRef(...args),
  useEffect: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useEffect']>) =>
    state.host!.hooks.useEffect(...args),
  useMemo: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useMemo']>) =>
    state.host!.hooks.useMemo(...args),
  useCallback: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useCallback']>) =>
    state.host!.hooks.useCallback(...args),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/spending',
  useSearchParams: () => new URL(state.url).searchParams,
}));
vi.mock('../../app/(app)/spending/actions', () => ({
  loadCalendarMonthAction: (...args: unknown[]) => state.load(...args),
}));
import {
  SpendingMonthProvider,
  useSpendingMonth,
} from '../../app/(app)/spending/spending-month-provider';

const totals = {
  spentYen: 0,
  incomeYen: 0,
  specialYen: 0,
  scheduledYen: 0,
  daySpend: {},
  scheduledDaySpend: {},
};
const result = { error: null, transactions: [], genreBreakdown: [], totals };
let current!: ReturnType<typeof useSpendingMonth>;
function Probe() {
  const value = useSpendingMonth();
  useEffect(() => {
    current = value;
  }, [value]);
  return null;
}
function render() {
  state.host!.begin();
  renderToString(
    h(SpendingMonthProvider, {
      today: '2026-10-17',
      currentMonthStart: '2026-10-01',
      initialMonth: '2026-09-01',
      currentTransactions: [],
      currentGenreBreakdown: [],
      currentTotals: totals,
      genres: [],
      accounts: [],
      children: h(Probe),
    }),
  );
  state.host!.flush();
}
beforeEach(() => {
  state.host = createHookState();
  state.url = 'https://example.test/spending?month=2026-09';
  vi.clearAllMocks();
  state.load.mockResolvedValue(result);
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('window', {
    location: {
      get href() {
        return state.url;
      },
    },
    history: {
      replaceState: (_data: unknown, _title: string, url: string) => {
        state.url = new URL(url, state.url).href;
      },
    },
    sessionStorage: { getItem: () => null, setItem: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    clearTimeout,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('月切替と同じページのURL変更', () => {
  it('内部で月を切り替えたあともURLと表示月がそろい、二重読込や元の月への巻き戻りを起こさない', async () => {
    render();
    await Promise.resolve();
    render();
    expect(current.visibleMonth).toBe('2026-09-01');
    current.goToMonth('2026-08-01');
    render();
    await Promise.resolve();
    render();
    expect(new URL(state.url).searchParams.get('month')).toBe('2026-08');
    expect(current.visibleMonth).toBe('2026-08-01');
    expect(current.loading).toBe(false);
    expect(state.load.mock.calls.map(([month]) => month)).toEqual(['2026-09-01', '2026-08-01']);
  });

  it('外部リンクや戻るで同じパスの月が変わったら追従し、別の月の日付とカテゴリを外す', async () => {
    render();
    await Promise.resolve();
    render();
    current.setFilter({ date: '2026-09-02', genreId: 'food', search: 'お店' });
    render();
    state.url = 'https://example.test/spending?month=2026-07';
    render();
    await Promise.resolve();
    render();
    expect(current.visibleMonth).toBe('2026-07-01');
    expect(current.filter).toMatchObject({ date: null, genreId: null, search: 'お店' });
    expect(state.load).toHaveBeenLastCalledWith('2026-07-01');
    state.url = 'https://example.test/spending?month=2026-09';
    render();
    await Promise.resolve();
    render();
    expect(current.visibleMonth).toBe('2026-09-01');
    expect(state.load).toHaveBeenCalledTimes(2);
  });

  it('先に開いた月の応答が遅れても、後で開いた月の読込状態を解除しない', async () => {
    const finish = new Map<string, (value: typeof result) => void>();
    state.load.mockImplementation(
      (month: string) =>
        new Promise((resolve) => {
          finish.set(month, resolve);
        }),
    );
    render();
    current.goToMonth('2026-08-01');
    render();
    finish.get('2026-09-01')!(result);
    await Promise.resolve();
    render();
    expect(current.visibleMonth).toBe('2026-08-01');
    expect(current.loading).toBe(true);
    finish.get('2026-08-01')!(result);
    await Promise.resolve();
    render();
    expect(current.loading).toBe(false);
  });
});
