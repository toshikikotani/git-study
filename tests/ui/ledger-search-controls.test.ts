import { isValidElement, type CSSProperties, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_FILTER } from '@/features/spending/views';
import type { useSpendingMonth } from '../../app/(app)/spending/spending-month-provider';
import { createHookState } from '../helpers/hook-state';

const state = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  month: null as ReturnType<typeof useSpendingMonth> | null,
  record: vi.fn(),
  client: false,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useMemo: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useMemo']>) =>
    state.host!.hooks.useMemo(...args),
  useId: () => 'ledger-calendar-test',
  useSyncExternalStore: (
    _subscribe: unknown,
    getSnapshot: () => unknown,
    getServerSnapshot: () => unknown,
  ) => (state.client ? getSnapshot() : getServerSnapshot()),
}));
vi.mock('../../app/(app)/spending/spending-month-provider', () => ({
  useSpendingMonth: () => state.month!,
}));
vi.mock('../../app/(app)/record-sheet', () => ({ useOpenRecord: () => state.record }));

import { CalendarHeatmap } from '../../app/(app)/spending/calendar-heatmap';
import { FilterSheet } from '../../app/(app)/spending/filter-sheet';
import { LedgerSearchControls } from '../../app/(app)/spending/ledger-search-controls';

type Props = {
  children?: ReactNode;
  'aria-label'?: string;
  'aria-expanded'?: boolean;
  'aria-selected'?: boolean;
  'aria-current'?: string;
  href?: string;
  style?: CSSProperties;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
};
function nodes(tree: ReactNode) {
  const pending = [tree];
  const result: { type: unknown; props: Props }[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }
    if (!isValidElement<Props>(node)) continue;
    result.push(node);
    pending.push(node.props.children);
  }
  return result;
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<Props>(node) ? text(node.props.children) : '';
}
function click(tree: ReactNode, label: string) {
  const button = nodes(tree).find(
    (node) =>
      node.type === 'button' &&
      (node.props['aria-label'] === label || text(node.props.children) === label),
  );
  expect(button, `${label} button`).toBeDefined();
  button!.props.onClick!();
}
function controls() {
  state.host!.begin();
  return LedgerSearchControls({ initialCalendarView: 'month' });
}
function calendar() {
  state.host!.begin();
  return CalendarHeatmap({ initialView: 'month' });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.host = createHookState();
  state.client = false;
  state.month = {
    visibleMonth: '2026-10-01',
    currentMonthStart: '2026-10-01',
    today: '2026-10-18',
    isCurrentMonth: true,
    loading: false,
    error: null,
    transactions: [],
    genreBreakdown: [],
    totals: {
      spentYen: 1000,
      incomeYen: 0,
      specialYen: 0,
      scheduledYen: 6000,
      daySpend: { '2026-10-16': 200, '2026-10-17': 800 },
      scheduledDaySpend: { '2026-10-23': 6000 },
    },
    genres: [],
    accounts: [{ id: 'bank', name: '銀行' }],
    captures: [],
    goToMonth: vi.fn(),
    reloadVisibleMonth: vi.fn(),
    filter: { ...EMPTY_FILTER },
    setFilter: vi.fn(),
    clearFilter: vi.fn(),
  };
});
afterEach(() => vi.unstubAllGlobals());

describe('明細の検索横の操作', () => {
  it('最初はカレンダーを描画せず、同じボタンから開閉する。保存した月/週表示を渡す', () => {
    let tree = controls();
    expect(nodes(tree).some((node) => node.type === CalendarHeatmap)).toBe(false);
    expect(
      nodes(tree).find((node) => node.props['aria-label'] === 'カレンダー')?.props['aria-expanded'],
    ).toBe(false);
    click(tree, 'カレンダー');
    tree = controls();
    const opened = nodes(tree).find((node) => node.type === CalendarHeatmap);
    expect(opened).toBeDefined();
    expect(opened!.props).toMatchObject({ initialView: 'month' });
    expect(
      nodes(tree).find((node) => node.props['aria-label'] === 'カレンダー')?.props['aria-expanded'],
    ).toBe(true);
    click(tree, 'カレンダー');
    expect(nodes(controls()).some((node) => node.type === CalendarHeatmap)).toBe(false);
  });

  it('検索は既存の共有filterへ反映し、絞り込みも同じ行のアイコンから開ける', () => {
    const tree = controls();
    const input = nodes(tree).find((node) => node.type === 'input');
    expect(input?.props['aria-label']).toBe('明細を検索');
    input!.props.onChange!({ target: { value: 'スギ薬局' } });
    expect(state.month!.setFilter).toHaveBeenCalledWith({ search: 'スギ薬局' });
    expect(nodes(tree).find((node) => node.type === FilterSheet)?.props).toMatchObject({
      compact: true,
      goalRange: null,
    });
  });

  it('絞り込みアイコンは適用数を読み上げ、口座管理のリンクもシート内に残す', () => {
    state.month!.filter.accountId = 'bank';
    state.month!.filter.genreId = 'food';
    state.host!.begin();
    const tree = FilterSheet({ goalRange: null, compact: true });
    expect(nodes(tree).some((node) => node.props['aria-label'] === '絞り込み、2件の条件')).toBe(
      true,
    );
    const management = nodes(tree).find((node) => node.props.href === '/accounts');
    expect(management).toBeDefined();
    expect(text(management!.props.children)).toBe('口座を管理');
  });
});

describe('開いたカレンダー', () => {
  it('支出が多い日ほどセル全面の濃さを上げ、支出なし・今日とは区別する', () => {
    const cells = nodes(calendar()).filter((node) => node.type === 'button');
    const smaller = cells.find((node) => node.props['aria-label']?.includes('10月16日'))!;
    const larger = cells.find((node) => node.props['aria-label']?.includes('10月17日'))!;
    const today = cells.find((node) => node.props['aria-current'] === 'date')!;
    expect(smaller.props.style?.background).toContain('18%');
    expect(larger.props.style?.background).toContain('100%');
    expect(smaller.props['aria-label']).toContain('使った額 200円');
    expect(larger.props['aria-label']).toContain('使った額 800円');
    expect(today.props.style?.background).toBe('var(--plane)');
    expect(today.props.style?.boxShadow).toContain('var(--accent)');
  });

  it('日付タップと再タップで日付の絞り込みを切り替える', () => {
    let tree = calendar();
    const cell = nodes(tree).find((node) => node.props['aria-label']?.includes('10月16日'))!;
    cell.props.onClick!();
    expect(state.month!.setFilter).toHaveBeenLastCalledWith({ date: '2026-10-16' });
    state.month!.filter.date = '2026-10-16';
    tree = calendar();
    const selected = nodes(tree).find((node) => node.props['aria-label']?.includes('10月16日'))!;
    expect(selected.props['aria-selected']).toBe(true);
    selected.props.onClick!();
    expect(state.month!.setFilter).toHaveBeenLastCalledWith({ date: null });
  });

  it('絞った日付を引き継いで手で記録でき、予定金額も読み上げる', () => {
    state.month!.filter.date = '2026-10-16';
    const tree = calendar();
    click(tree, '2026年10月16日に手で記録');
    expect(state.record).toHaveBeenCalledWith({ date: '2026-10-16' });
    expect(nodes(tree).some((node) => node.props['aria-label']?.includes('予定 6,000円'))).toBe(
      true,
    );
    expect(text(tree)).toContain('色が濃いほど多い');
  });

  it('月/週の切替は引き続き使え、表示設定をcookieに保存する', () => {
    const cookieJar = { cookie: '' };
    vi.stubGlobal('document', cookieJar);
    click(calendar(), '週で見る');
    expect(cookieJar.cookie).toContain('spending-calendar-view=week');
    state.client = true;
    let tree = calendar();
    const countDates = (value: ReactNode) =>
      nodes(value).filter(
        (node) => node.type === 'button' && node.props['aria-label']?.startsWith('2026年'),
      ).length;
    expect(countDates(tree)).toBe(7);
    click(tree, '月で見る');
    expect(cookieJar.cookie).toContain('spending-calendar-view=month');
    tree = calendar();
    expect(countDates(tree)).toBeGreaterThan(7);
  });
});
