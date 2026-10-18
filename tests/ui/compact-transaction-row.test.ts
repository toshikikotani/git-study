import { createElement as h, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookState } from '../helpers/hook-state';
import type { RecordEdit } from '../../app/(app)/record-sheet';

const state = vi.hoisted(() => ({ host: null as ReturnType<typeof createHookState> | null }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
}));
vi.mock('@/components/ui/genre-style-context', () => ({ useGenreOverrides: () => ({}) }));
vi.mock('@/components/ui/swipeable-row', () => ({
  SwipeableRow: ({ children }: { children: ReactNode }) => h('div', null, children),
}));
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? children : null,
  BottomSheetHeader: ({ children }: { children: ReactNode }) => h('div', null, children),
}));
vi.mock('../../app/(app)/category-sheet', () => ({
  CategoryMark: ({ genreId, name }: { genreId: string | null; name: string | null }) =>
    h('span', { 'data-category': genreId, 'data-name': name }),
}));
vi.mock('../../app/(app)/transactions/actions', () => ({
  deleteTransactionAction: vi.fn(),
  duplicateTransactionAction: vi.fn(),
  recordGenreCorrectionAction: vi.fn(),
  replaceReceiptItemsAction: vi.fn(),
  replaceSplitsAction: vi.fn(),
  restoreDeletedTransactionAction: vi.fn(),
  editTransactionAction: vi.fn(),
  restoreRowFieldsAction: vi.fn(),
  updateTransactionAction: vi.fn(),
  updateTransactionMemoAction: vi.fn(),
}));
vi.mock('../../app/(app)/record-sheet', () => ({
  RecordSheet: ({ edit }: { edit: RecordEdit }) =>
    h('section', null, edit.initial.name, edit.footer),
}));
vi.mock('../../app/(app)/transactions/receipt-items-panel', () => ({
  ReceiptItemsPanel: ({ items }: { items: readonly { name: string }[] }) =>
    h('div', { 'aria-label': '全品目' }, items.map((item) => item.name).join('、')),
}));
vi.mock('@/components/receipt/receipt-image-viewer', () => ({
  ReceiptImageViewer: () => h('div', { role: 'dialog' }, 'レシート画像本体'),
}));

import { TransactionRowWithSplit } from '../../app/(app)/transactions/split-editor';
import { RecordSheet } from '../../app/(app)/record-sheet';
import { SwipeableRow } from '@/components/ui/swipeable-row';

type Props = ComponentProps<typeof TransactionRowWithSplit>;
type NodeProps = {
  children?: ReactNode;
  'aria-label'?: string;
  onClick?: () => void;
  edit?: RecordEdit;
};
const props: Props = {
  transaction: {
    id: 'row',
    accountId: 'cash',
    occurredOn: '2026-10-18',
    description: '株式会社スギ薬局',
    amountYen: -1000,
    paymentMethod: 'one_time',
    genreId: 'goods',
    genreName: '日用品',
    memo: null,
  },
  categories: [
    { id: 'goods', name: '日用品' },
    { id: 'food', name: '食料品' },
  ],
  initialSplits: [],
  receiptItems: [
    {
      id: 'a',
      name: 'パン',
      amountYen: -600,
      genreId: 'food',
      genreName: '食料品',
      productType: null,
    },
    {
      id: 'b',
      name: '牛乳',
      amountYen: -200,
      genreId: 'food',
      genreName: '食料品',
      productType: null,
    },
    {
      id: 'c',
      name: '洗剤',
      amountYen: -200,
      genreId: 'goods',
      genreName: '日用品',
      productType: null,
    },
  ],
  display: {
    name: '株式会社スギ薬局',
    branch: '豊津店',
    thumbnailUrl: 'https://example.test/receipt.jpg',
    shares: [{ genreId: 'goods', genreName: '日用品', amountYen: 1000, ratio: 1 }],
    scheduled: false,
    special: false,
    compact: true,
    fixed: true,
  },
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
function render(input = props) {
  state.host!.begin();
  const tree = TransactionRowWithSplit(input);
  return { tree, html: renderToStaticMarkup(tree) };
}
beforeEach(() => {
  state.host = createHookState();
});

describe('明細のコンパクト表示', () => {
  it('店名とカテゴリ・先頭品目の2行に制限し、品目由来のカテゴリをアイコンにも使う', () => {
    const { html } = render();
    expect(html).toContain('data-category="food" data-name="食料品"');
    expect(html).toContain('食料品・日用品 · パン ほか2');
    expect(html).toContain('固定費');
    expect(html).not.toContain('株式会社');
    expect(html).not.toContain('牛乳');
    expect(html).not.toContain('レシート画像を見る');
    expect(html).not.toContain('カテゴリの内訳:');
    expect(html).not.toContain('role="img"');
    expect(html.match(/<p class="[^"]*\bh-5\b/g)).toHaveLength(2);
    expect(html).toContain('<span class="shrink-0">ほか2</span>');
  });

  it('タップ後の画面では原文の店名・全品目とレシート画像を見られる', () => {
    const initial = render();
    nodes(initial.tree).find(
      (node) => node.type === 'button' && node.props['aria-label']?.includes('支出'),
    )!.props.onClick!();
    const opened = render();
    expect(opened.html).toContain('株式会社スギ薬局');
    expect(opened.html).toContain('パン、牛乳、洗剤');
    expect(opened.html).toContain('レシート画像を見る');
    const record = nodes(opened.tree).find((node) => node.type === RecordSheet)!;
    nodes(record.props.edit!.footer).find((node) => node.type === 'button')!.props.onClick!();
    expect(render().html).toContain('レシート画像本体');
  });

  it('日別見出しを持たない予定では、2行目の先頭に日付を示す', () => {
    const { html } = render({
      ...props,
      transaction: { ...props.transaction, occurredOn: '2026-10-23' },
      display: { ...props.display!, scheduled: true },
    });
    expect(html).toContain('2026年10月23日 · 食料品・日用品 · パン ほか2');
    expect(html.match(/<p class="[^"]*\bh-5\b/g)).toHaveLength(2);
    expect(html).toContain('<span class="shrink-0">ほか2</span>');
    expect(render().html).not.toContain('2026年10月18日 ·');
  });

  it('未分類でも補助チップで行を増やさず、既存のカテゴリ変更・長押し・スワイプを保持する', () => {
    const { tree, html } = render({
      ...props,
      transaction: { ...props.transaction, genreId: null, genreName: null },
      receiptItems: [],
      initialSplits: [],
    });
    expect(html).toContain('未分類');
    expect(html).not.toContain('カテゴリを選ぶ');
    expect(html).not.toContain('data-category=""');
    expect(html).not.toContain('data-category=');
    const swipe = nodes(tree).find((node) => node.type === SwipeableRow)!.props as ComponentProps<
      typeof SwipeableRow
    >;
    expect(swipe.onSwipeRight).toBeTypeOf('function');
    expect(swipe.onLongPress).toBeTypeOf('function');
    expect(swipe.actions).toBeDefined();
  });
});
