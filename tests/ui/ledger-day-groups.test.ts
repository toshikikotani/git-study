import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/(app)/spending/actions', () => ({ loadCalendarMonthAction: vi.fn() }));
vi.mock('../../app/(app)/transactions/actions', () => ({
  deleteTransactionAction: vi.fn(),
  duplicateTransactionAction: vi.fn(),
  recordGenreCorrectionAction: vi.fn(),
  replaceSplitsAction: vi.fn(),
  updateTransactionAction: vi.fn(),
  updateTransactionMemoAction: vi.fn(),
  resolveReconcileAction: vi.fn(),
  checkReceiptDuplicatesAction: vi.fn(),
}));
vi.mock('../../app/(app)/transactions/receipt-items-panel', () => ({
  ReceiptItemsPanel: () => null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/spending',
  useSearchParams: () => new URLSearchParams(),
}));

import { LedgerList } from '../../app/(app)/spending/ledger-list';
import { SpendingMonthProvider } from '../../app/(app)/spending/spending-month-provider';
import { buildLedgerViews, type LedgerFilter } from '@/features/spending/views';
import { ledgerTx } from '../helpers/ledger';

const genres = [
  { id: 'dining', name: '外食' },
  { id: 'utilities', name: '通信費' },
];
const entries: Parameters<typeof ledgerTx>[0][] = [
  { id: 'today', occurredOn: '2026-10-18', label: '今日の夕食', amountYen: -3100 },
  { id: 'sixteenth', occurredOn: '2026-10-16', label: '十六日の昼食', amountYen: -800 },
  { id: 'fifteenth', occurredOn: '2026-10-15', label: '十五日の夕食', amountYen: -900 },
  { id: 'first', occurredOn: '2026-10-01', label: '月初の昼食', amountYen: -1000 },
  {
    id: 'refund-only',
    occurredOn: '2026-10-14',
    label: '返品による返金',
    amountYen: 500,
    kind: 'refund' as const,
  },
  {
    id: 'fixed',
    occurredOn: '2026-10-15',
    label: '携帯電話料金',
    amountYen: -5000,
    genreId: 'utilities',
    genreName: '通信費',
  },
  {
    id: 'future',
    occurredOn: '2026-10-23',
    label: 'これからの買い物',
    amountYen: -6000,
    status: 'scheduled' as const,
  },
];
const transactions = entries.map((t) => ({ ...ledgerTx(t), items: [], expenseSubtype: null }));
const views = buildLedgerViews({
  genres: genres.map((genre) => ({ ...genre, budget_yen: null })),
  transactions,
  range: { from: '2026-10-01', to: '2026-10-31' },
  today: '2026-10-18',
});

function render(initialFilter: Partial<LedgerFilter> = {}) {
  return renderToStaticMarkup(
    h(SpendingMonthProvider, {
      today: '2026-10-18',
      currentMonthStart: '2026-10-01',
      currentTransactions: transactions,
      currentGenreBreakdown: views.genreBreakdown,
      currentTotals: views.totals,
      genres,
      accounts: [{ id: 'a', name: '現金' }],
      initialFilter,
      children: h(LedgerList, {
        goalRange: null,
        duplicateCount: 0,
        fixedKeys: ['genre:utilities'],
      }),
    }),
  ).replace(/<!-- -->/g, '');
}

function dayDetails(html: string, heading: string) {
  const group = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/g)?.find((markup) => {
    const summary = markup.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/)?.[1];
    return summary?.includes(heading);
  });
  expect(group, `${heading}は開ける日付グループである`).toBeDefined();
  return group!;
}
function isOpen(markup: string) {
  return /^<details\b[^>]*\bopen(?:=|\s|>)/.test(markup);
}

// スクショに全件が写った日だけを固定実装せず、実データのあるすべての日を開ける。
describe('明細の日付ごとの折り畳み（ADR-116）', () => {
  it('今日だけ最初から開き、過去の日は合計を表示して畳む', () => {
    const html = render();
    expect(isOpen(dayDetails(html, '10月18日'))).toBe(true);
    for (const day of ['10月16日', '10月15日', '10月1日']) {
      expect(isOpen(dayDetails(html, day))).toBe(false);
    }
    const todaySummary = dayDetails(html, '10月18日').match(
      /<summary[^>]*>([\s\S]*?)<\/summary>/,
    )![1]!;
    expect(todaySummary).toContain('3,100');
    const pastSummary = dayDetails(html, '10月15日').match(
      /<summary[^>]*>([\s\S]*?)<\/summary>/,
    )![1]!;
    expect(pastSummary).toContain('5,900');
    expect(pastSummary).toContain('カテゴリ: 外食、通信費');
    expect(pastSummary).not.toContain('十五日の夕食');
    expect(pastSummary).not.toContain('携帯電話料金');
  });

  it('畳んだ日にも全明細があり、どの日も標準のsummary操作で開ける', () => {
    const html = render();
    for (const [day, labels] of [
      ['10月16日', ['十六日の昼食']],
      ['10月15日', ['十五日の夕食', '携帯電話料金']],
      ['10月1日', ['月初の昼食']],
    ] as const) {
      const group = dayDetails(html, day);
      expect(group).toMatch(/<summary\b/);
      expect(group).not.toContain('disabled');
      for (const label of labels) expect(group).toContain(label);
    }
  });

  it('店名を検索すると、一致した過去日のグループを開く', () => {
    const html = render({ search: '月初' });
    expect(html).not.toContain('<details');
    expect(html).toMatch(/aria-label="[^"]*10月1日/);
    expect(html).toContain('月初の昼食');
    expect(html).not.toContain('十五日の夕食');
    expect(html).not.toContain('携帯電話料金');
  });

  it('カレンダーの日付で絞ると、その日を開き別の日の明細を出さない', () => {
    const html = render({ date: '2026-10-15' });
    expect(html).not.toContain('<details');
    expect(html).toMatch(/aria-label="[^"]*10月15日/);
    expect(html).toContain('十五日の夕食');
    expect(html).toContain('携帯電話料金');
    expect(html).not.toContain('十六日の昼食');
    expect(html).not.toContain('今日の夕食');
  });

  it('固定費は独立した先頭セクションに移さず、支払日とその日の合計に含める', () => {
    const html = render();
    const paidDay = dayDetails(html, '10月15日');
    expect(paidDay).toContain('携帯電話料金');
    expect(paidDay).toContain('固定費');
    expect(paidDay).toContain('5,900');
    expect(html).not.toContain('10月の固定費');
    expect(dayDetails(html, '10月16日')).not.toContain('携帯電話料金');
    expect(dayDetails(html, '10月18日')).not.toContain('携帯電話料金');
  });

  it('返金だけの日も明細を残し、その日の支出合計を負の金額で表示する', () => {
    const group = dayDetails(render(), '10月14日');
    const summary = group.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)![1]!;
    expect(summary).toContain('aria-label="支出 -500円"');
    expect(summary).toContain('−');
    expect(group).toContain('返品による返金');
  });

  it('予定は閉じた一行に集約し、開けば元の予定を確認できる', () => {
    const html = render();
    const scheduled = dayDetails(html, 'これからの予定');
    expect(isOpen(scheduled)).toBe(false);
    const summary = scheduled.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)![1]!;
    expect(summary).toContain('1件');
    expect(summary).toContain('6,000');
    expect(scheduled).toContain('使った額には入りません');
    expect(scheduled).toContain('これからの買い物');
  });
});
