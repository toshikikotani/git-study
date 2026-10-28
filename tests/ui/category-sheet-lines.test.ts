/**
 * カテゴリのシート(⑦)の今期の明細(本人「カテゴリを見た時に明細一覧がない」、ADR-138)。
 */
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));
vi.mock('../../app/(app)/category-sheet-actions', () => ({
  loadCategorySheetAction: vi.fn(),
  saveCategoryTargetAction: vi.fn(),
}));
vi.mock('../../app/(app)/upcoming/actions', () => ({
  releaseCategoryFixedAction: vi.fn(),
  restoreCategoryFixedAction: vi.fn(),
}));

import { CategorySheetBody } from '../../app/(app)/category-sheet';
import type { CategorySheetData } from '../../app/(app)/category-sheet-actions';
import { categorySheetLines } from '../../src/features/category/sheet-lines';
import type { CategoryTx } from '../../src/features/category/model';

let n = 0;
const tx = (occurredOn: string, amountYen: number, extra: Partial<CategoryTx> = {}) =>
  ({
    id: `t${++n}`,
    occurredOn,
    amountYen,
    genreId: 'dining',
    label: `店${n}`,
    branchName: null,
    isTransfer: false,
    reviewStatus: 'auto_ok',
    needsInput: false,
    kind: 'normal',
    splits: [],
    items: [],
    memo: null,
    ...extra,
  }) as unknown as CategoryTx;

const range = { from: '2026-10-25', to: '2026-11-24' };
const today = '2026-10-28';

describe('今期の明細の行', () => {
  it('実績は新しい順、そのあとに予定(近い順)。ほかのカテゴリ・振替・期間の外は入れない', () => {
    const lines = categorySheetLines(
      [
        tx('2026-10-26', -800),
        tx('2026-10-28', -1200),
        tx('2026-11-10', -1500),
        tx('2026-11-01', -3000),
        tx('2026-10-27', -999, { genreId: 'cafe' }),
        tx('2026-10-27', -999, { isTransfer: true }),
        tx('2026-10-20', -999),
      ],
      'dining',
      range,
      today,
    );
    expect(lines.map((l) => [l.occurredOn, l.spentYen, l.scheduled])).toEqual([
      ['2026-10-28', 1200, false],
      ['2026-10-26', 800, false],
      ['2026-11-01', 3000, true],
      ['2026-11-10', 1500, true],
    ]);
  });

  it('分けたレシートは、このカテゴリの分とレシート全体の額', () => {
    const [line] = categorySheetLines(
      [
        tx('2026-10-27', -3000, {
          genreId: null,
          splits: [
            { genreId: 'dining', amountYen: -1000 },
            { genreId: 'cafe', amountYen: -2000 },
          ] as unknown as CategoryTx['splits'],
        }),
      ],
      'dining',
      range,
      today,
    );
    expect(line).toMatchObject({ spentYen: 1000, receiptTotalYen: 3000 });
  });

  it('返金は差し引く(負の額)', () => {
    const [line] = categorySheetLines(
      [tx('2026-10-27', 500, { kind: 'refund' })],
      'dining',
      range,
      today,
    );
    expect(line).toMatchObject({ spentYen: -500, refund: true });
  });
});

const outlook = {
  genreId: 'dining',
  name: '外食',
  targetYen: 15000,
  untargeted: false,
  spentYen: 6000,
  scheduledYen: 0,
  lastMonthYen: null,
  p10: null,
  p50: null,
  p90: null,
  caution: null,
  fixed: false,
  sub: null,
  days: [],
};
const base: CategorySheetData = {
  outlook,
  planId: 'p1',
  periodStart: '2026-10-25',
  periodEnd: '2026-11-24',
  today,
  remainingDays: 28,
  isFixed: false,
  planTotalYen: 80000,
};
const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('シートの「今期の明細」', () => {
  const lines = Array.from({ length: 7 }, (_, i) => ({
    id: `l${i}`,
    occurredOn: `2026-10-${String(28 - i).padStart(2, '0')}`,
    label: `お店${i}`,
    spentYen: 1000 + i,
    receiptTotalYen: i === 1 ? 5000 : null,
    scheduled: false,
    refund: false,
  }));

  it('件数と、はじめの5件・残りを見るボタン・カテゴリの画面への入口を出す', () => {
    const html = visible(
      renderToString(
        h(CategorySheetBody, { data: { ...base, lines }, onCancel: () => {}, onDone: () => {} }),
      ),
    );
    expect(html).toContain('今期の明細 · 7件');
    expect(html).toContain('お店0');
    expect(html).toContain('お店4');
    expect(html).not.toContain('お店5');
    expect(html).toContain('残り2件を見る');
    expect(html).toContain('10/28(水)');
    expect(html).toContain('1,000円');
    expect(html).toContain('レシート 5,000円のうち');
    expect(html).toContain('href="/spending/category/dining"');
  });

  it('記録が無ければ、まだ無いと言う', () => {
    const html = visible(
      renderToString(
        h(CategorySheetBody, {
          data: { ...base, lines: [] },
          onCancel: () => {},
          onDone: () => {},
        }),
      ),
    );
    expect(html).toContain('今期の明細 · 0件');
    expect(html).toContain('今期の記録はまだありません。');
  });

  it('今期の目標(⑥)の中から開いたとき(明細を渡さない)は出さない', () => {
    const html = visible(
      renderToString(h(CategorySheetBody, { data: base, onCancel: () => {}, onDone: () => {} })),
    );
    expect(html).not.toContain('今期の明細');
  });
});
