import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/spending/category/dining',
}));

import {
  CategoryTabs,
  ItemDetailBody,
  type CategoryTab,
} from '../../app/(app)/spending/category/[genreKey]/category-tabs';
import { monthRange } from '@/domain/ledger';
import { buildLedgerViews } from '@/features/spending/views';
import { buildItemDetail } from '@/features/category/list';
import {
  buildCategoryLines,
  collectItemOccurrences,
  type CategoryTx,
} from '@/features/category/model';
import { ledgerSplit, ledgerTx } from '../helpers/ledger';

const visible = (html: string) => html.replace(/<!-- -->/g, '');
const TODAY = '2026-09-29';
const SEP = monthRange('2026-09');

let n = 0;
const item = (name: string, yen: number, genreId = 'dining') => ({
  id: `i${++n}`,
  name,
  amountYen: -yen,
  genreId,
  genreName: null,
  productType: null,
});
const tx = (o: Parameters<typeof ledgerTx>[0], items: CategoryTx['items'] = []): CategoryTx => ({
  ...ledgerTx(o),
  items,
});

const data: CategoryTx[] = [
  tx(
    {
      id: 'a',
      occurredOn: '2026-09-05',
      label: 'ココカラファイン',
      branchName: '梅田店',
      genreId: 'dining',
      amountYen: -1200,
    },
    [item('おにぎり', 500), item('お茶', 300)],
  ),
  tx({ id: 'b', occurredOn: '2026-09-12', label: 'ローソン', genreId: 'dining', amountYen: -800 }),
  tx(
    {
      id: 'd',
      occurredOn: '2026-09-20',
      label: 'ドトール',
      genreId: 'dining',
      amountYen: -3000,
      splits: [
        ledgerSplit({ genreId: 'dining', genreName: '外食', amountYen: -1000 }),
        ledgerSplit({ genreId: 'cafe', genreName: 'カフェ', amountYen: -2000 }),
      ],
    },
    [item('サンドイッチ', 1000), item('コーヒー豆', 2000, 'cafe')],
  ),
  tx({
    id: 'r',
    occurredOn: '2026-09-21',
    label: 'ローソン',
    genreId: 'dining',
    amountYen: 300,
    kind: 'refund',
  }),
  tx({
    id: 'f',
    occurredOn: '2026-09-30',
    label: '打ち上げ',
    genreId: 'dining',
    amountYen: -5000,
    status: 'scheduled',
  }),
];
const lines = buildCategoryLines(data, 'dining', SEP, TODAY);
const views = buildLedgerViews({
  genres: [
    { id: 'dining', name: '外食', budget_yen: null },
    { id: 'cafe', name: 'カフェ', budget_yen: null },
  ],
  transactions: data,
  range: SEP,
  today: TODAY,
});
const breakdownYen = views.genreBreakdown.find((r) => r.genreId === 'dining')!.spentYen;

const render = (tab: CategoryTab, extra: Partial<Parameters<typeof CategoryTabs>[0]> = {}) =>
  visible(
    renderToString(
      h(CategoryTabs, {
        genreKey: 'dining',
        lines,
        historyLines: lines,
        tab,
        onTab: () => {},
        focusedLines: null,
        focusLabel: null,
        onClearFocus: () => {},
        onOpenLine: () => {},
        onFocusStore: () => {},
        quickDestination: null,
        onQuickMove: () => {},
        onMoveMenu: () => {},
        ghostLines: [],
        ...extra,
      }),
    ),
  );

/** 各タブの「合計」の表示(読み上げのラベル)を取り出す。 */
const totalOf = (html: string): number => {
  const m = html.match(/aria-label="合計(-?[\d,]+)円"/);
  return Number(m![1]!.replace(/,/g, ''));
};

describe('P5 3つのタブの合計は、家計簿のジャンル内訳と一致する(受け入れ基準3)', () => {
  it('取引・品目・店の合計が、すべて家計簿のジャンル内訳の金額', () => {
    expect(breakdownYen).toBe(1200 + 800 + 1000 - 300);
    expect(totalOf(render('tx'))).toBe(breakdownYen);
    expect(totalOf(render('items'))).toBe(breakdownYen);
    expect(totalOf(render('stores'))).toBe(breakdownYen);
  });
});

describe('P5 取引タブ', () => {
  const html = render('tx');

  it('切り替えタブ(取引/品目/店)は44pt以上。検索と並び替えがある', () => {
    for (const t of ['取引', '品目', '店']) expect(html).toContain(`>${t}</button>`);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="カテゴリ内を検索"');
    expect(html).toContain('日付順');
    expect(html).toContain('金額順');
    expect(html).toContain('id="category-tabs"');
  });

  it('日付ごとに表示し、その日の合計(返品は差し引く)。予定だけの日は「予定」', () => {
    expect(html).toContain('2026年9月20日(日)'.replace('2026年', '')); // 見出しの日付
    expect(html).toContain('aria-label="この日の合計1,200円"');
    expect(html).toContain('aria-label="この日の合計300円"'); // 9/21 は返金で −300
    expect(html).toContain('返金');
    expect(html).toContain('<span>予定</span>');
  });

  it('分割したレシートは、このカテゴリの金額だけ。「レシート全体 ○円のうち」を添える(受け入れ基準4)', () => {
    expect(html).toContain('レシート全体 3,000円のうち');
    expect(html).toContain('aria-label="ドトール、支出1,000円、レシート全体3,000円のうち"');
    expect(html).not.toContain('aria-label="ドトール、支出3,000円');
  });

  it('返品・返金は緑の「+」で出る', () => {
    expect(html).toContain('aria-label="ローソン、返品・返金300円"');
    expect(html).toMatch(/\+<span class="tabular ">300<span class="yen-unit">円<\/span>/);
    expect(html).toContain('var(--income)');
  });

  it('絞り込み中は「○○で絞り込み中 ×」のチップが出て、該当する取引だけになる', () => {
    const focused = render('tx', {
      focusedLines: lines.filter((l) => l.txId === 'b'),
      focusLabel: 'ローソンの明細',
    });
    expect(focused).toContain('ローソンの明細で絞り込み中');
    expect(focused).not.toContain('ココカラファイン');
    expect(focused).toContain('ローソン');
  });

  it('1件も無い月は、その旨を出す', () => {
    const empty = visible(
      renderToString(
        h(CategoryTabs, {
          genreKey: 'dining',
          lines: [],
          historyLines: [],
          tab: 'tx',
          onTab: () => {},
          focusedLines: null,
          focusLabel: null,
          onClearFocus: () => {},
          onOpenLine: () => {},
          onFocusStore: () => {},
          quickDestination: null,
          onQuickMove: () => {},
          onMoveMenu: () => {},
          ghostLines: [],
        }),
      ),
    );
    expect(empty).toContain('この月の取引はありません。');
    expect(totalOf(empty)).toBe(0);
  });
});

describe('P5 品目タブ・店タブ', () => {
  it('品目:品目名 ×回数、合計、平均単価。記録が足りないぶんは「品目の記録なし」', () => {
    const html = render('items');
    expect(html).toContain('おにぎり');
    expect(html).toContain('×1');
    expect(html).toContain('aria-label="おにぎり、1回、合計500円、平均単価500円"');
    expect(html).toContain('品目の記録なし');
  });

  it('店:合計、回数、1回あたりの平均、最後に行った日。金額の多い順', () => {
    const html = render('stores');
    expect(html).toContain('aria-label="ココカラファイン、合計1,200円、1回、1回あたり1,200円、');
    const first = html.indexOf('ココカラファイン');
    const second = html.indexOf('ローソン');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(second === -1 ? Infinity : second + 10_000);
    expect(html).toMatch(/最後 /);
  });
});

describe('P5 品目の詳細の表示(受け入れ基準7)', () => {
  it('単価の推移(折れ線)と、店ごとの単価・最安の店の印', () => {
    const t = [
      tx(
        {
          id: 'x1',
          occurredOn: '2026-09-01',
          label: 'ファミリーマート',
          genreId: 'dining',
          amountYen: -118,
        },
        [item("TULLY'S ブラック", 118)],
      ),
      tx(
        {
          id: 'x2',
          occurredOn: '2026-09-08',
          label: 'ローソン',
          genreId: 'dining',
          amountYen: -160,
        },
        [item("TULLY'S ブラック", 160)],
      ),
    ];
    const l = buildCategoryLines(t, 'dining', SEP, TODAY);
    const occ = [...collectItemOccurrences(l, 'dining').byKey.values()][0]!.occurrences;
    const detail = buildItemDetail("TULLY'S ブラック", occ);
    const html = visible(
      renderToString(h(ItemDetailBody, { detail, lines: l, onOpenLine: () => {} })),
    );
    expect(html).toContain('単価の推移');
    expect(html).toContain('<polyline');
    expect(html).toContain('aria-label="単価の推移:');
    expect(html).toContain('店ごとの単価');
    expect(html).toMatch(/ファミリーマート<span[^>]*>.*最安/);
    expect(html).toContain('この品目を含む取引');
  });
});

describe('P5 返金の入力(返品・返金は「返金」として登録できる)', () => {
  it('新規入力に「返金」がある。支出・収入・返金の3つ', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/(app)/transactions/new/new-transaction-form.tsx', 'utf8');
    expect(src).toContain("['refund', '返金']");
    expect(src).toContain("kind: mode === 'refund' ? 'refund'");
  });
});
