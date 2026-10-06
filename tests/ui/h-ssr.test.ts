import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/(app)/spending/actions', () => ({ loadCalendarMonthAction: vi.fn() }));
vi.mock('../../app/(app)/transactions/actions', () => ({
  deleteTransactionAction: vi.fn(),
  duplicateTransactionAction: vi.fn(),
  recordGenreCorrectionAction: vi.fn(),
  replaceSplitsAction: vi.fn(),
  replaceReceiptItemsAction: vi.fn(),
  restoreDeletedTransactionAction: vi.fn(),
  restoreRowFieldsAction: vi.fn(),
  setTransactionKindAction: vi.fn(),
  updateTransactionAction: vi.fn(),
  updateTransactionMemoAction: vi.fn(),
  resolveReconcileAction: vi.fn(),
  checkReceiptDuplicatesAction: vi.fn(),
  saveImportBatchAction: vi.fn(),
  undoReceiptSaveAction: vi.fn(),
}));
vi.mock('../../app/(app)/transactions/receipt-items-panel', () => ({
  ReceiptItemsPanel: () => null,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/spending',
}));

import { ActiveFilterChips, FilterSheet } from '../../app/(app)/spending/filter-sheet';
import { LedgerList } from '../../app/(app)/spending/ledger-list';
import { SpendingMonthProvider } from '../../app/(app)/spending/spending-month-provider';
import { ViewSwitch } from '../../app/(app)/spending/view-switch';
import { ManualEntryForm } from '../../app/(app)/transactions/manual-entry-form';
import { emptyManualValues } from '@/domain/receipt-capture';
import { buildLedgerViews } from '@/features/spending/views';
import type { CaptureView } from '@/features/receipt-captures/types';
import { UndoToastHost } from '@/components/ui/undo-toast';
import { ledgerTx } from '../helpers/ledger';

const visible = (html: string) => html.replace(/<!-- -->/g, '');
const genres = [
  { id: 'dining', name: '外食' },
  { id: 'cafe', name: 'カフェ・飲料' },
];
const txs = [
  {
    ...ledgerTx({ id: 'a', occurredOn: '2026-09-28', label: 'ローソン', amountYen: -400 }),
    items: [],
    expenseSubtype: null,
  },
];
const views = buildLedgerViews({
  genres: genres.map((g) => ({ ...g, budget_yen: null })),
  transactions: txs,
  range: { from: '2026-09-01', to: '2026-09-30' },
  today: '2026-09-29',
});
const capture: CaptureView = {
  id: 'c1',
  status: 'needs_input',
  receiptStatus: 'failed',
  imageUrl: 'https://example.test/x.jpg',
  hasEditedImage: false,
  readFields: {},
  unreadFields: [],
  draft: null,
  capturedOn: '2026-09-29',
  ocrWarnings: [],
};

const render = (initialFilter: object, children: unknown[], captures: CaptureView[] = []) =>
  visible(
    renderToString(
      h(SpendingMonthProvider, {
        today: '2026-09-29',
        currentMonthStart: '2026-09-01',
        currentTransactions: txs,
        currentGenreBreakdown: views.genreBreakdown,
        currentTotals: views.totals,
        genres,
        accounts: [{ id: 'acc', name: '現金' }],
        captures,
        initialFilter,
        children,
      } as never),
    ),
  );

describe('H フィルター(ボトムシート)', () => {
  it('「フィルター(n)」に選択中の条件の数が出る。0のときは数を出さない', () => {
    const two = render({ genreId: 'dining', accountId: 'acc' }, [
      h(FilterSheet, { key: 'f', goalRange: null }),
    ]);
    expect(two).toContain('フィルター(2)');
    const none = render({}, [h(FilterSheet, { key: 'f', goalRange: null })]);
    expect(none).toContain('フィルター');
    expect(none).not.toContain('フィルター(');
  });

  it('選んでいる条件は「○○で絞り込み中 ×」のチップで見える(44pt)', () => {
    const html = render({ genreId: 'dining', date: '2026-09-29' }, [
      h(ActiveFilterChips, { key: 'c', goalRange: null }),
    ]);
    expect(html).toContain('外食で絞り込み中');
    expect(html).toContain('9/29で絞り込み中');
    expect((html.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('条件に「入力待ち」があり、選ぶと入力待ちのレシートだけが出る(明細は出ない)', () => {
    const html = render(
      { pendingOnly: true },
      [
        h(ActiveFilterChips, { key: 'c', goalRange: null }),
        h(LedgerList, { key: 'l', goalRange: null, duplicateCount: 0 }),
      ],
      [capture],
    );
    expect(html).toContain('入力待ちで絞り込み中');
    expect(html).toContain('href="/transactions/receipt/c1"');
    expect(html).not.toContain('ローソン');
  });

  it('横スクロールのチップ行(口座・ジャンル・期間のセレクト)はなくなった', () => {
    const html = render({}, [h(LedgerList, { key: 'l', goalRange: null, duplicateCount: 0 })]);
    expect(html).not.toContain('口座で絞り込む');
    expect(html).toContain('明細を検索');
  });
});

describe('H 概要/明細の切り替え', () => {
  it('概要・明細の2つのタブが、44pt以上で出る', () => {
    const html = visible(renderToString(h(ViewSwitch)));
    expect(html).toContain('概要');
    expect(html).toContain('明細');
    expect(html).toContain('role="tablist"');
    expect((html.match(/min-h-11/g) ?? []).length).toBe(2);
  });
});

describe('H 手入力(レシートなし)と共通のフォーム', () => {
  const props = {
    values: emptyManualValues('2026-09-29', 'acc'),
    onChange: () => {},
    genres,
    accounts: [{ id: 'acc', name: '現金' }],
    recentStores: ['ローソン', 'ファミリーマート'],
  };

  it('quick: 金額 → ジャンル(アイコンの格子)→ 最近使った店 → 日付 → 口座 → メモ', () => {
    const html = visible(renderToString(h(ManualEntryForm, { ...props, variant: 'quick' })));
    const order = [
      '>金額</label>',
      '>ジャンル</label>',
      '>店名</label>',
      '>日付</label>',
      '>口座</label>',
      '>メモ</label>',
    ].map((k) => html.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('grid-cols-4'); // アイコンの格子
    expect(html).toContain('ローソン'); // 最近使った店
  });

  it('receipt(F7の画面)は 金額 → 日付 → 店名 → ジャンル → 口座 → メモ。同じ部品', () => {
    const html = visible(renderToString(h(ManualEntryForm, { ...props })));
    const order = [
      '>金額</label>',
      '>日付</label>',
      '>店名</label>',
      '>ジャンル</label>',
      '>口座</label>',
      '>メモ</label>',
    ].map((k) => html.indexOf(k));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('grid-cols-4');
  });
});

describe('H Undo のトースト', () => {
  it('何も積んでいないときは何も出ない', () => {
    expect(renderToString(h(UndoToastHost))).toBe('');
  });
});
