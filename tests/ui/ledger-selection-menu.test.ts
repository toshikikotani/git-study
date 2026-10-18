import { isValidElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookState } from '../helpers/hook-state';
import { ledgerTx } from '../helpers/ledger';
import type { DrilldownTransaction } from '../../app/(app)/spending/drilldown';
import type { useSpendingMonth } from '../../app/(app)/spending/spending-month-provider';
import { EMPTY_FILTER } from '@/features/spending/views';

const state = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  month: null as ReturnType<typeof useSpendingMonth> | null,
  client: true,
  portal: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useRef: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useRef']>) =>
    state.host!.hooks.useRef(...args),
  useMemo: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useMemo']>) =>
    state.host!.hooks.useMemo(...args),
  useCallback: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useCallback']>) =>
    state.host!.hooks.useCallback(...args),
  useEffect: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useEffect']>) =>
    state.host!.hooks.useEffect(...args),
  useId: () => 'ledger-selection-actions-test',
}));
vi.mock('react-dom', async (original) => ({
  ...(await original<typeof import('react-dom')>()),
  createPortal: (children: ReactNode, container: unknown) => {
    state.portal(container);
    return children;
  },
}));
vi.mock('@/components/ui/use-is-client', () => ({ useIsClient: () => state.client }));
vi.mock('@/lib/just-saved', () => ({ useJustSaved: () => [] }));
vi.mock('../../app/(app)/spending/spending-month-provider', () => ({
  useSpendingMonth: () => state.month!,
}));
vi.mock('../../app/(app)/spending/filter-sheet', () => ({ ActiveFilterChips: () => null }));
vi.mock('../../app/(app)/spending/pending-receipt-rows', () => ({
  PendingReceiptRows: () => null,
}));
vi.mock('../../app/(app)/transactions/split-editor', () => ({
  TransactionRowWithSplit: () => null,
}));
vi.mock('../../app/(app)/spending/split-payment-sheet', () => ({ SplitPaymentSheet: () => null }));
vi.mock('../../app/(app)/spending/selection-copy-sheet', () => ({
  SelectionCopySheet: () => null,
}));

import {
  DaySection,
  LedgerList,
  LedgerListContent,
  SelectableTransaction,
} from '../../app/(app)/spending/ledger-list';
import { LedgerSelectionMenu } from '../../app/(app)/spending/ledger-selection-menu';
import { SplitPaymentSheet } from '../../app/(app)/spending/split-payment-sheet';
import { SelectionCopySheet } from '../../app/(app)/spending/selection-copy-sheet';
import { TransactionRowWithSplit } from '../../app/(app)/transactions/split-editor';

type MenuProps = ComponentProps<typeof LedgerSelectionMenu>;
type NodeProps = {
  children?: ReactNode;
  className?: string;
  'aria-label'?: string;
  'aria-hidden'?: boolean;
  'aria-expanded'?: boolean;
  disabled?: boolean;
  checked?: boolean;
  open?: boolean;
  onToggle?: (event: { currentTarget: { open: boolean } }) => void;
  onClick?: () => void;
  onChange?: () => void;
};

function nodes(tree: ReactNode) {
  const pending = [tree];
  const result: { type: unknown; props: NodeProps }[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }
    if (!isValidElement<NodeProps>(node)) continue;
    result.push(node);
    pending.push(node.props.children);
  }
  return result;
}
function propsOf<T>(tree: ReactNode, component: unknown): T {
  const found = nodes(tree).find((node) => node.type === component);
  expect(found, 'component should be present').toBeDefined();
  return found!.props as T;
}
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isValidElement<NodeProps>(node) && !node.props['aria-hidden']
    ? textOf(node.props.children)
    : '';
}
function button(tree: ReactNode, text: string) {
  const found = nodes(tree).find(
    (node) => node.type === 'button' && textOf(node.props.children) === text,
  );
  expect(found, `button ${text} should be present`).toBeDefined();
  return found!.props;
}
function transaction(overrides: Parameters<typeof ledgerTx>[0]): DrilldownTransaction {
  return { ...ledgerTx(overrides), items: [], expenseSubtype: null };
}

const fixtures = [
  transaction({ id: 'dinner', label: '夕食', amountYen: -1001 }),
  transaction({ id: 'taxi', label: 'タクシー', amountYen: -2000 }),
  transaction({ id: 'salary', label: '給与', amountYen: 200000 }),
  transaction({ id: 'refund', label: '返品', amountYen: 500, kind: 'refund' }),
  transaction({ id: 'transfer', label: '振替', amountYen: -10000, isTransfer: true }),
  transaction({
    id: 'future',
    label: '予定',
    occurredOn: '2026-09-30',
    status: 'scheduled',
    amountYen: -3000,
  }),
];
const documentListeners = new Map<string, Set<(event: unknown) => void>>();
const body = {};
class TestNode {}
let menuProps: MenuProps;
let fixedKeys: readonly string[];

function renderMenu() {
  state.host!.begin();
  const tree = LedgerSelectionMenu(menuProps);
  state.host!.flush();
  return tree;
}
function renderList() {
  state.host!.begin();
  const tree = LedgerListContent({ goalRange: null, duplicateCount: 0, fixedKeys });
  state.host!.flush();
  return tree;
}
const listMenu = () => propsOf<MenuProps>(renderList(), LedgerSelectionMenu);
function renderedIds() {
  return nodes(renderList())
    .filter((node) => typeof node.type === 'function' && node.type.name === 'DaySection')
    .flatMap((node) =>
      (node.props as { transactions: DrilldownTransaction[] }).transactions.map((t) => t.id),
    );
}
function toggle(id: string) {
  const group = nodes(renderList()).find(
    (node) =>
      typeof node.type === 'function' &&
      node.type.name === 'DaySection' &&
      (node.props as { transactions: DrilldownTransaction[] }).transactions.some(
        (t) => t.id === id,
      ),
  );
  expect(group, `row ${id} should be present`).toBeDefined();
  const selection = group!.props as {
    selection: { onToggle: (id: string) => void };
  };
  selection.selection.onToggle(id);
}

beforeEach(() => {
  state.host = createHookState();
  state.client = true;
  fixedKeys = [];
  vi.clearAllMocks();
  documentListeners.clear();
  state.month = {
    transactions: fixtures,
    genreBreakdown: [],
    totals: {
      spentYen: 3001,
      incomeYen: 200000,
      specialYen: 0,
      scheduledYen: 3000,
      daySpend: {},
      scheduledDaySpend: {},
    },
    today: '2026-09-29',
    visibleMonth: '2026-09-01',
    currentMonthStart: '2026-09-01',
    filter: { ...EMPTY_FILTER },
    genres: [],
    accounts: [],
    captures: [],
    loading: false,
    error: null,
    isCurrentMonth: true,
    setFilter: vi.fn(),
    clearFilter: vi.fn(),
    goToMonth: vi.fn(),
    reloadVisibleMonth: vi.fn(),
  };
  menuProps = {
    selectMode: true,
    count: 2,
    availableCount: 6,
    ready: true,
    splitDisabledReason: null,
    onStart: vi.fn(),
    onExit: vi.fn(),
    onSplit: vi.fn(),
    onCopy: vi.fn(),
    onSelectAll: vi.fn(),
    onClear: vi.fn(),
  };
  vi.stubGlobal('document', {
    body,
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      const listeners = documentListeners.get(type) ?? new Set();
      listeners.add(handler);
      documentListeners.set(type, listeners);
    },
    removeEventListener: (type: string, handler: (event: unknown) => void) => {
      documentListeners.get(type)?.delete(handler);
    },
  });
  vi.stubGlobal('Node', TestNode);
});
afterEach(() => vi.unstubAllGlobals());

describe('明細の複数選択は割り勘から独立した共通操作', () => {
  it('全選択は表示された収入・返金・予定も選び、混在時は割り勘だけを無効にする', () => {
    listMenu().onStart();
    expect(listMenu()).toMatchObject({ selectMode: true, count: 0, availableCount: 5 });
    listMenu().onSelectAll();
    expect(listMenu().count).toBe(5);
    expect(listMenu().splitDisabledReason).toEqual(expect.any(String));
    expect(listMenu().expenseTotalYen).toBeUndefined();
    expect(
      propsOf<ComponentProps<typeof SplitPaymentSheet>>(renderList(), SplitPaymentSheet).open,
    ).toBe(false);
    listMenu().onSplit();
    expect(
      propsOf<ComponentProps<typeof SplitPaymentSheet>>(renderList(), SplitPaymentSheet).open,
    ).toBe(false);
  });

  it('選んだ全件が実績支出のときだけ、選択を残して割り勘を開く', () => {
    listMenu().onStart();
    toggle('dinner');
    toggle('taxi');
    expect(listMenu()).toMatchObject({
      count: 2,
      splitDisabledReason: null,
      expenseTotalYen: 3001,
    });
    listMenu().onSplit();
    const sheet = propsOf<ComponentProps<typeof SplitPaymentSheet>>(
      renderList(),
      SplitPaymentSheet,
    );
    expect(sheet.open).toBe(true);
    expect(sheet.transactions.map((t) => t.id)).toEqual(['dinner', 'taxi']);
    expect(listMenu().hidden).toBe(true);
    sheet.onClose();
    expect(listMenu()).toMatchObject({ count: 2, hidden: false });
  });

  it('割り勘の対象外を含む全件でも、内容コピーを開いて選択を維持できる', () => {
    listMenu().onStart();
    listMenu().onSelectAll();
    listMenu().onCopy();
    const sheet = propsOf<ComponentProps<typeof SelectionCopySheet>>(
      renderList(),
      SelectionCopySheet,
    );
    expect(sheet.open).toBe(true);
    expect(sheet.transactions.map((t) => t.id).sort()).toEqual(renderedIds().sort());
    expect(sheet.transactions.map((t) => t.id)).not.toContain('transfer');
    expect(listMenu()).toMatchObject({ count: 5, hidden: true });
    sheet.onClose();
    expect(listMenu()).toMatchObject({ count: 5, hidden: false });
  });

  it('非表示の振替・対象外を全選択に混ぜず、表示中の支出2件だけを割り勘にする', () => {
    state.month!.transactions = [
      fixtures[0]!,
      fixtures[1]!,
      fixtures[4]!,
      transaction({ id: 'ignored', label: '対象外', amountYen: -1000, reviewStatus: 'ignored' }),
    ];
    listMenu().onStart();
    expect(renderedIds().sort()).toEqual(['dinner', 'taxi']);
    listMenu().onSelectAll();
    expect(listMenu()).toMatchObject({ count: 2, availableCount: 2, splitDisabledReason: null });
    listMenu().onSplit();
    const sheet = propsOf<ComponentProps<typeof SplitPaymentSheet>>(
      renderList(),
      SplitPaymentSheet,
    );
    expect(sheet.open).toBe(true);
    expect(sheet.transactions.map((t) => t.id)).toEqual(['dinner', 'taxi']);
  });

  it('固定費の条件に一致する入金も日付に残し、表示された全件をコピーできる', () => {
    fixedKeys = ['genre:dining'];
    state.month!.transactions = [
      fixtures[0]!,
      fixtures[1]!,
      transaction({ id: 'fixed-income', label: '固定費の入金', amountYen: 1000 }),
    ];
    listMenu().onStart();
    expect(renderedIds().sort()).toEqual(['dinner', 'fixed-income', 'taxi']);
    listMenu().onSelectAll();
    expect(listMenu()).toMatchObject({ count: 3, availableCount: 3 });
    expect(listMenu().splitDisabledReason).toEqual(expect.any(String));
    listMenu().onCopy();
    expect(
      propsOf<ComponentProps<typeof SelectionCopySheet>>(
        renderList(),
        SelectionCopySheet,
      ).transactions.map((t) => t.id),
    ).toEqual(['dinner', 'taxi', 'fixed-income']);
  });

  it('複数選択中は過去日と予定をすべて開き、全選択・コピーと画面に出る行を一致させる', () => {
    const groups = () =>
      nodes(renderList())
        .filter((node) => typeof node.type === 'function' && node.type.name === 'DaySection')
        .map(
          (node) =>
            node.props as {
              forceOpen: boolean;
              initiallyOpen: boolean;
              transactions: DrilldownTransaction[];
            },
        );
    expect(groups().length).toBeGreaterThan(1);
    expect(groups().every((group) => !group.forceOpen && !group.initiallyOpen)).toBe(true);
    listMenu().onStart();
    expect(groups().every((group) => group.forceOpen)).toBe(true);
    const visibleIds = groups().flatMap((group) => group.transactions.map((t) => t.id));
    expect(visibleIds).toContain('future');
    expect(listMenu().availableCount).toBe(visibleIds.length);
    listMenu().onSelectAll();
    listMenu().onCopy();
    const copied = propsOf<ComponentProps<typeof SelectionCopySheet>>(
      renderList(),
      SelectionCopySheet,
    );
    expect(copied.transactions.map((t) => t.id).sort()).toEqual(visibleIds.sort());
    listMenu().onExit();
    expect(groups().every((group) => !group.forceOpen)).toBe(true);
  });

  it('選択解除は選択モードを保ち、完了は件数と開いた画面をリセットする', () => {
    listMenu().onStart();
    toggle('dinner');
    listMenu().onClear();
    expect(listMenu()).toMatchObject({ selectMode: true, count: 0 });
    toggle('taxi');
    listMenu().onExit();
    expect(listMenu()).toMatchObject({ selectMode: false, count: 0 });
    listMenu().onStart();
    expect(listMenu().count).toBe(0);
  });

  it('表示中の絞り込みに全選択を限定し、分割の子を件数に含めない', () => {
    state.month!.filter = { ...EMPTY_FILTER, search: '夕食' };
    state.month!.transactions = [
      {
        ...fixtures[0]!,
        splits: [
          { id: 'food', genreId: 'food', genreName: '食費', amountYen: -600, note: null },
          { id: 'drink', genreId: 'drink', genreName: '飲料', amountYen: -401, note: null },
        ],
      },
      ...fixtures.slice(1),
    ];
    listMenu().onStart();
    listMenu().onSelectAll();
    expect(listMenu()).toMatchObject({ count: 1, availableCount: 1, splitDisabledReason: null });
    listMenu().onSplit();
    expect(
      propsOf<ComponentProps<typeof SplitPaymentSheet>>(renderList(), SplitPaymentSheet)
        .transactions,
    ).toHaveLength(1);
  });

  it.each(['loading', 'error', 'pendingOnly'] as const)(
    '%s時は未確認の選択で操作を実行できない',
    (reason) => {
      listMenu().onStart();
      toggle('dinner');
      if (reason === 'loading') state.month!.loading = true;
      if (reason === 'error') {
        state.month!.error = '明細を取得できませんでした';
        state.month!.isCurrentMonth = false;
      }
      if (reason === 'pendingOnly') state.month!.filter.pendingOnly = true;
      expect(listMenu().ready).toBe(false);
      listMenu().onSplit();
      expect(
        propsOf<ComponentProps<typeof SplitPaymentSheet>>(renderList(), SplitPaymentSheet).open,
      ).toBe(false);
      listMenu().onCopy();
      expect(
        propsOf<ComponentProps<typeof SelectionCopySheet>>(renderList(), SelectionCopySheet).open,
      ).toBe(false);
    },
  );

  it('月または絞り込みが変わると選択を持つリストを再生成する', () => {
    const props = { goalRange: null, duplicateCount: 0 };
    const initialKey = LedgerList(props).key;
    state.month!.visibleMonth = '2026-08-01';
    const monthKey = LedgerList(props).key;
    expect(monthKey).not.toBe(initialKey);
    state.month!.filter = { ...EMPTY_FILTER, search: '夕食' };
    expect(LedgerList(props).key).not.toBe(monthKey);
  });

  it.each(fixtures)('$labelのチェックは割り勘対象でなくても有効で、チェックを変更できる', (t) => {
    const onToggle = vi.fn();
    const tree = SelectableTransaction({ transaction: t, selected: true, onToggle });
    const checkbox = nodes(tree).find((node) => node.type === 'input')!.props;
    expect(checkbox.disabled).not.toBe(true);
    expect(checkbox.checked).toBe(true);
    checkbox.onChange!();
    expect(onToggle).toHaveBeenCalledOnce();
    expect(renderToStaticMarkup(tree)).not.toContain('支出の実績だけ選べます');
  });
});

describe('過去日の開閉', () => {
  it('どの過去日も開く・閉じる操作を繰り返せ、明細を失わない', () => {
    const renderDay = () => {
      state.host!.begin();
      const tree = DaySection({
        heading: '9月10日（木）',
        transactions: fixtures.slice(0, 2),
        initiallyOpen: false,
      });
      state.host!.flush();
      return tree;
    };
    let details = nodes(renderDay()).find((node) => node.type === 'details')!.props;
    expect(details.open).toBe(false);
    details.onToggle!({ currentTarget: { open: true } });
    const opened = renderDay();
    details = nodes(opened).find((node) => node.type === 'details')!.props;
    expect(details.open).toBe(true);
    const rowIds = (tree: ReactNode) =>
      nodes(tree)
        .filter((node) => node.type === TransactionRowWithSplit)
        .map(
          (node) => (node.props as ComponentProps<typeof TransactionRowWithSplit>).transaction.id,
        );
    expect(nodes(opened).some((node) => node.type === 'summary')).toBe(true);
    expect(rowIds(opened).sort()).toEqual(['dinner', 'taxi']);
    details.onToggle!({ currentTarget: { open: false } });
    const closed = renderDay();
    details = nodes(closed).find((node) => node.type === 'details')!.props;
    expect(details.open).toBe(false);
    expect(rowIds(closed).sort()).toEqual(['dinner', 'taxi']);
  });
});

describe('右上固定の選択操作メニュー', () => {
  it('サーバー描画またはシート表示中はPortalを出さず、操作を重ねない', () => {
    state.client = false;
    expect(renderMenu()).toBeNull();
    expect(state.portal).not.toHaveBeenCalled();
    state.client = true;
    menuProps.hidden = true;
    expect(renderMenu()).toBeNull();
    expect(state.portal).not.toHaveBeenCalled();
  });

  it('bodyへ固定表示し、選択開始と完了を同じ場所から実行できる', () => {
    menuProps.selectMode = false;
    const initial = renderMenu();
    expect(state.portal).toHaveBeenCalledWith(body);
    expect(renderToStaticMarkup(initial)).toContain('fixed');
    button(initial, '選択').onClick!();
    expect(menuProps.onStart).toHaveBeenCalledOnce();
    menuProps.selectMode = true;
    const selecting = renderMenu();
    expect(button(selecting, '2件を選択')).toBeDefined();
    button(selecting, '完了').onClick!();
    expect(menuProps.onExit).toHaveBeenCalledOnce();
  });

  it('件数を押して共通操作を開き、閉じても選択解除や終了を実行しない', () => {
    button(renderMenu(), '2件を選択').onClick!();
    const opened = renderMenu();
    const html = renderToStaticMarkup(opened);
    expect(html).toContain('選択した明細の操作');
    for (const label of ['内容をコピー', '割り勘', 'すべて選択', '選択を解除']) {
      expect(button(opened, label)).toBeDefined();
    }
    button(opened, '2件を選択').onClick!();
    expect(renderToStaticMarkup(renderMenu())).not.toContain('選択した明細の操作');
    expect(menuProps.onClear).not.toHaveBeenCalled();
    expect(menuProps.onExit).not.toHaveBeenCalled();
  });

  it.each([
    ['内容をコピー', 'onCopy'],
    ['割り勘', 'onSplit'],
    ['すべて選択', 'onSelectAll'],
    ['選択を解除', 'onClear'],
  ] as const)('%sは対応する共通操作を呼び、メニューを閉じる', (label, callback) => {
    button(renderMenu(), '2件を選択').onClick!();
    button(renderMenu(), label).onClick!();
    expect(menuProps[callback]).toHaveBeenCalledOnce();
    expect(renderToStaticMarkup(renderMenu())).not.toContain('選択した明細の操作');
    expect(menuProps.onExit).not.toHaveBeenCalled();
  });

  it.each([
    { count: 0, ready: true },
    { count: 2, ready: false },
  ])('count=$count・ready=$readyのときはコピーと割り勘を無効にする', (props) => {
    Object.assign(menuProps, props);
    button(renderMenu(), `${props.count}件を選択`).onClick!();
    const opened = renderMenu();
    expect(button(opened, '内容をコピー').disabled).toBe(true);
    expect(button(opened, '割り勘').disabled).toBe(true);
  });

  it('対象外明細の説明を表示し、内容コピーを残したまま割り勘だけを無効にする', () => {
    menuProps.splitDisabledReason = '割り勘には実績の支出だけを選んでください';
    button(renderMenu(), '2件を選択').onClick!();
    const opened = renderMenu();
    expect(renderToStaticMarkup(opened)).toContain(menuProps.splitDisabledReason);
    expect(button(opened, '割り勘').disabled).toBe(true);
    expect(button(opened, '内容をコピー').disabled).not.toBe(true);
  });

  it('実績支出の合計を操作メニューで確認できる', () => {
    menuProps.expenseTotalYen = 3001;
    button(renderMenu(), '2件を選択').onClick!();
    const html = renderToStaticMarkup(renderMenu());
    expect(html).toContain('支出合計');
    expect(html).toContain('3,001');
  });

  it('Escapeでメニューだけ閉じ、選択と件数を保つ', () => {
    button(renderMenu(), '2件を選択').onClick!();
    renderMenu();
    const preventDefault = vi.fn();
    documentListeners
      .get('keydown')!
      .forEach((handler) => handler({ key: 'Escape', preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    const closed = renderMenu();
    expect(renderToStaticMarkup(closed)).not.toContain('選択した明細の操作');
    expect(button(closed, '2件を選択')).toBeDefined();
    expect(menuProps.onClear).not.toHaveBeenCalled();
    expect(menuProps.onExit).not.toHaveBeenCalled();
    expect(documentListeners.get('keydown')?.size).toBe(0);
  });

  it('外側のタップでメニューだけ閉じ、選択を解除しない', () => {
    button(renderMenu(), '2件を選択').onClick!();
    renderMenu();
    documentListeners.get('pointerdown')!.forEach((handler) => handler({ target: new TestNode() }));
    expect(renderToStaticMarkup(renderMenu())).not.toContain('選択した明細の操作');
    expect(menuProps.onClear).not.toHaveBeenCalled();
    expect(menuProps.onExit).not.toHaveBeenCalled();
    expect(documentListeners.get('pointerdown')?.size).toBe(0);
  });

  it.each([0, 2])('選べる件数が%dで残りがない場合、全選択を無効にする', (availableCount) => {
    menuProps.availableCount = availableCount;
    button(renderMenu(), '2件を選択').onClick!();
    expect(button(renderMenu(), 'すべて選択').disabled).toBe(true);
  });
});
