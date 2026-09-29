import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/(app)/spending/actions', () => ({ loadCalendarMonthAction: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    h('a', { href, ...rest }, children),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/spending',
}));

import { CategoryHeader } from '../../app/(app)/spending/category/[genreKey]/category-header';
import { GenreBreakdown } from '../../app/(app)/spending/genre-breakdown';
import { SpendingMonthProvider } from '../../app/(app)/spending/spending-month-provider';
import { GenreBudgetRow } from '@/components/ui/genre-budget-row';
import { parseMonthKey } from '@/features/category/loader';
import {
  EDGE_BACK_PX,
  categoryHref,
  classifyHorizontalSwipe,
  isEdgeBackSwipe,
} from '@/lib/category-nav';
import { buildLedgerViews } from '@/features/spending/views';
import { ledgerTx } from '../helpers/ledger';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('P2 遷移の入り口(受け入れ基準1)', () => {
  it('URL は家計簿の期間を引き継ぐ。未分類は none', () => {
    expect(categoryHref('dining', '2026-09-01')).toBe('/spending/category/dining?month=2026-09');
    expect(categoryHref('none', '2026-08')).toBe('/spending/category/none?month=2026-08');
  });

  it('ジャンル行(目標・家計簿で共通)は、href があるとリンクになり、詳細を開くと読み上げる', () => {
    const html = visible(
      renderToString(
        h(GenreBudgetRow, {
          name: '外食',
          spentYen: 5000,
          budgetYen: 8000,
          maxYen: 5000,
          href: categoryHref('dining', '2026-09'),
          sharedKey: 'dining',
        }),
      ),
    );
    expect(html).toContain('href="/spending/category/dining?month=2026-09"');
    expect(html).toContain('タップして詳細を開く');
    expect(html).toContain('min-h-11');
  });

  it('家計簿のジャンル内訳の各行は、絞り込みではなくカテゴリ詳細へのリンク(未分類も)', () => {
    const txs = [
      {
        ...ledgerTx({ id: 'a', occurredOn: '2026-09-05', genreId: 'dining', amountYen: -1200 }),
        items: [],
        expenseSubtype: null,
      },
      {
        ...ledgerTx({
          id: 'b',
          occurredOn: '2026-09-06',
          genreId: null,
          genreName: null,
          amountYen: -400,
        }),
        items: [],
        expenseSubtype: null,
      },
    ];
    const views = buildLedgerViews({
      genres: [{ id: 'dining', name: '外食', budget_yen: null }],
      transactions: txs,
      range: { from: '2026-09-01', to: '2026-09-30' },
      today: '2026-09-29',
    });
    const html = visible(
      renderToString(
        h(SpendingMonthProvider, {
          today: '2026-09-29',
          currentMonthStart: '2026-09-01',
          currentTransactions: txs,
          currentGenreBreakdown: views.genreBreakdown,
          currentTotals: views.totals,
          genres: [{ id: 'dining', name: '外食' }],
          accounts: [],
          children: [h(GenreBreakdown, { key: 'g', goalRows: null })],
        }),
      ),
    );
    expect(html).toContain('href="/spending/category/dining?month=2026-09"');
    expect(html).toContain('href="/spending/category/none?month=2026-09"');
    expect(html).not.toContain('aria-pressed');
  });

  it('月の指定が不正なら今月', () => {
    expect(parseMonthKey('2026-08', '2026-09-29')).toBe('2026-08');
    expect(parseMonthKey('2026-08-01', '2026-09-29')).toBe('2026-08');
    expect(parseMonthKey('bogus', '2026-09-29')).toBe('2026-09');
    expect(parseMonthKey(undefined, '2026-09-29')).toBe('2026-09');
    expect(parseMonthKey('2026-13', '2026-09-29')).toBe('2026-09');
  });
});

describe('P2 ヘッダー', () => {
  const html = visible(
    renderToString(
      h(CategoryHeader, {
        genreKey: 'dining',
        genreName: '外食',
        monthStart: '2026-09-01',
        isCurrentMonth: true,
        totalYen: 12279,
        onBack: () => {},
      }),
    ),
  );

  it('大きな表示:カテゴリ名・期間の切り替え(‹ 9月 ›)・合計金額(読み上げは最終の金額)', () => {
    expect(html).toContain('外食');
    expect(html).toContain('2026年9月');
    expect(html).toContain('aria-label="前の月"');
    expect(html).toContain('aria-label="次の月"');
    expect(html).toContain('aria-label="12,279円"');
  });

  it('今月は次の月へ進めない。戻るボタン・矢印は44pt', () => {
    expect(html).toMatch(/aria-label="次の月"[^>]*disabled/);
    expect(html).toContain('‹ 家計簿');
    expect((html.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('スクロールすると上部に小さく固定されるバー(アイコン+カテゴリ名+合計)がある', () => {
    expect(html).toContain('fixed inset-x-0 top-0');
    expect(html).toContain('aria-hidden="true"'); // 最初は隠れていて読み上げない
  });
});

describe('P2 スワイプ', () => {
  it('横スワイプ:距離が足りない・斜め(縦スクロール)は無視。右=前の月、左=次の月', () => {
    expect(classifyHorizontalSwipe(80, 5)).toBe('right');
    expect(classifyHorizontalSwipe(-80, 10)).toBe('left');
    expect(classifyHorizontalSwipe(40, 0)).toBeNull();
    expect(classifyHorizontalSwipe(80, 70)).toBeNull();
  });

  it('画面の左端からのスワイプで戻る(端以外・短い・斜めは戻らない)', () => {
    expect(isEdgeBackSwipe(10, EDGE_BACK_PX + 10, 5)).toBe(true);
    expect(isEdgeBackSwipe(60, 200, 0)).toBe(false);
    expect(isEdgeBackSwipe(10, 50, 0)).toBe(false);
    expect(isEdgeBackSwipe(10, 100, 100)).toBe(false);
  });
});
