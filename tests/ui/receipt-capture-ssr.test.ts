import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/(app)/spending/actions', () => ({ loadCalendarMonthAction: vi.fn() }));
vi.mock('../../app/(app)/accounts/actions', () => ({ ensureDefaultAccountAction: vi.fn() }));
vi.mock('../../app/(app)/transactions/actions', () => ({
  deleteTransactionAction: vi.fn(),
  duplicateTransactionAction: vi.fn(),
  recordGenreCorrectionAction: vi.fn(),
  replaceSplitsAction: vi.fn(),
  updateTransactionAction: vi.fn(),
  updateTransactionMemoAction: vi.fn(),
  resolveReconcileAction: vi.fn(),
  checkReceiptDuplicatesAction: vi.fn(),
  undoReceiptSaveAction: vi.fn(),
}));
vi.mock('../../app/(app)/transactions/receipt/capture-actions', () => ({
  attachCaptureToTransactionAction: vi.fn(),
  discardCaptureAction: vi.fn(),
  recordRescanAction: vi.fn(),
  replaceCaptureImageAction: vi.fn(),
  resolveCaptureAction: vi.fn(),
  restoreCaptureAction: vi.fn(),
  saveCaptureDraftAction: vi.fn(),
  saveEditedCaptureImageAction: vi.fn(),
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
  useSearchParams: () => new URLSearchParams(),
}));

import { AttentionCard } from '../../app/(app)/spending/attention-card';
import { LedgerList } from '../../app/(app)/spending/ledger-list';
import { SpendingMonthProvider } from '../../app/(app)/spending/spending-month-provider';
import { MonthSummary } from '../../app/(app)/spending/month-summary';
import { CaptureEntry } from '../../app/(app)/transactions/receipt/[id]/capture-entry';
import { buildLedgerViews } from '@/features/spending/views';
import type { CaptureView } from '@/features/receipt-captures/types';
import { ledgerTx } from '../helpers/ledger';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

const genres = [
  { id: 'dining', name: '外食' },
  { id: 'cafe', name: 'カフェ・飲料' },
];
const txs = [
  {
    ...ledgerTx({
      id: 'a',
      occurredOn: '2026-09-28',
      label: 'ローソン',
      genreId: 'dining',
      genreName: '外食',
      amountYen: -3000,
    }),
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

const capture = (over: Partial<CaptureView> = {}): CaptureView => ({
  id: 'cap-1',
  status: 'needs_input',
  receiptStatus: 'failed',
  imageUrl: 'https://example.test/receipt.jpg',
  hasEditedImage: false,
  readFields: {},
  unreadFields: ['amountYen', 'occurredOn', 'storeName'],
  draft: null,
  capturedOn: '2026-09-29',
  ocrWarnings: [],
  ...over,
});

const ledgerHtml = (captures: CaptureView[], pendingOnly = false) =>
  visible(
    renderToString(
      h(SpendingMonthProvider, {
        today: '2026-09-29',
        currentMonthStart: '2026-09-01',
        currentTransactions: txs,
        currentGenreBreakdown: views.genreBreakdown,
        currentTotals: views.totals,
        genres,
        accounts: [{ id: 'a', name: '現金' }],
        captures,
        initialFilter: { pendingOnly },
        children: [
          h(MonthSummary, { key: 's' }),
          h(AttentionCard, { key: 'at', hasGoal: true }),
          h(LedgerList, { key: 'l', goalRange: null, duplicateCount: 0 }),
        ],
      }),
    ),
  );

describe('F7 入力待ち(受け入れ基準13)', () => {
  it('通常の明細では入力待ちを「確認が必要」に集約し、画像付きの行を並べない（ADR-116）', () => {
    const html = ledgerHtml([capture()]);
    expect(html).toContain('aria-label="確認が必要。1項目"');
    expect(html).toContain('入力待ち 1件');
    expect(html).not.toContain('src="https://example.test/receipt.jpg"');
    expect(html).not.toContain('href="/transactions/receipt/cap-1"');
    expect(html).not.toContain('aria-label="読み取り中・入力待ちのレシート"');
  });

  it('入力待ちの一覧を開くと画像と入力リンクがあり、元のレシート画面へ進める', () => {
    const html = ledgerHtml([capture()], true);
    expect(html).toContain('aria-label="読み取り中・入力待ちのレシート"');
    expect(html).toContain('入力待ちのレシート');
    expect(html).toContain('src="https://example.test/receipt.jpg"');
    expect(html).toContain('href="/transactions/receipt/cap-1"');
    expect(html).toContain('まだ集計に入っていません');
    expect(html).toContain('入力');
  });

  it('入力待ちは集計に入らない(使った額は入力待ちの有無で変わらない)', () => {
    const without = ledgerHtml([]);
    const withCapture = ledgerHtml([capture(), capture({ id: 'cap-2' })]);
    expect(without).toContain('3,000円');
    expect(withCapture).toContain('3,000円');
    // 合計の表示は同じ。入力待ちの金額は0円(まだ金額が無い)
    expect(views.totals.spentYen).toBe(3000);
    expect(without).not.toContain('入力待ち');
  });
});

describe('F7 手入力の画面(受け入れ基準14・15・17)', () => {
  const render = (c: CaptureView) =>
    visible(
      renderToString(
        h(CaptureEntry, {
          capture: c,
          genres,
          accounts: [{ id: 'acc', name: '現金' }],
          recentStores: ['ローソン'],
          today: '2026-09-29',
        }),
      ),
    );

  it('画像とフォームが同じ画面にあり、入力順は 金額 → 日付 → 店名 → カテゴリ → 口座 → メモ', () => {
    const html = render(capture());
    expect(html).toContain('src="https://example.test/receipt.jpg"');
    const order = ['金額', '日付', '店名', 'カテゴリ', '口座', 'メモ'].map((k) =>
      html.indexOf(`>${k}</label>`) >= 0 ? html.indexOf(`>${k}</label>`) : html.indexOf(`>${k}</`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('保存する');
  });

  it('一部だけ読めたとき、読めた項目は入っていて、読めなかった項目に「読み取れませんでした」が付く', () => {
    const html = render(
      capture({
        receiptStatus: 'partial',
        readFields: { amountYen: 1280, storeName: 'ファミリーマート' },
        unreadFields: ['occurredOn'],
      }),
    );
    expect(html).toContain('value="1,280"');
    expect(html).toContain('value="ファミリーマート"');
    // 読めなかった日付だけが強調される(1件)
    expect(html.match(/読み取れませんでした<\/span>/g)?.length).toBe(1);
    expect(html).toContain('読み取り結果');
  });

  it('画像の操作:もう一度読み取る・撮り直す・写真から選ぶ・画像を補正', () => {
    const html = render(capture());
    for (const label of ['もう一度読み取る', '撮り直す', '写真から選ぶ', '画像を補正']) {
      expect(html).toContain(label);
    }
  });

  it('下書きがあれば、離れて戻ってもその値で開く(受け入れ基準17)', () => {
    const html = render(
      capture({
        draft: {
          values: {
            amountYen: 980,
            occurredOn: '2026-09-27',
            storeName: '肉のハナマサ',
            genreId: 'dining',
            accountId: 'acc',
            memo: '下書き',
            items: [],
          },
          touched: ['amountYen'],
        },
      }),
    );
    expect(html).toContain('value="980"');
    expect(html).toContain('value="肉のハナマサ"');
    expect(html).toContain('value="下書き"');
    expect(html).toContain('value="2026-09-27"');
  });

  it('破棄は確認を挟む(押すまで確認シートは出ない)', () => {
    const html = render(capture());
    expect(html).toContain('このレシートを破棄する');
    expect(html).not.toContain('破棄しますか');
  });
});
