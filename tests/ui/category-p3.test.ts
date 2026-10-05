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

import { CategoryScreen } from '../../app/(app)/spending/category/[genreKey]/category-screen';
import type { CategoryDetailData } from '@/features/category/loader';
import type { CategoryTx } from '@/features/category/model';
import { ledgerTx } from '../helpers/ledger';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

const tx = (o: Parameters<typeof ledgerTx>[0]): CategoryTx => ({ ...ledgerTx(o), items: [] });

const base: CategoryDetailData = {
  genreKey: 'dining',
  genreName: '外食',
  genreBudgetYen: 20000,
  forecastClosed: false,
  monthKey: '2026-09',
  monthStart: '2026-09-01',
  today: '2026-09-29',
  isCurrentMonth: true,
  range: { from: '2026-09-01', to: '2026-09-30' },
  windowFrom: '2026-03-01',
  transactions: [
    tx({ id: 'a', occurredOn: '2026-09-05', label: 'ココカラファイン', amountYen: -1200 }),
    tx({ id: 'b', occurredOn: '2026-09-12', label: 'ローソン', amountYen: -800 }),
    tx({ id: 'c', occurredOn: '2026-09-21', label: 'ローソン', amountYen: 300, kind: 'refund' }),
    tx({
      id: 'f',
      occurredOn: '2026-09-30',
      label: '打ち上げ',
      amountYen: -5000,
      status: 'scheduled',
    }),
    // 前月
    tx({ id: 'p', occurredOn: '2026-08-05', label: 'ローソン', amountYen: -1500 }),
  ],
  genres: [{ id: 'dining', name: '外食' }],
  accounts: [{ id: 'a', name: '現金' }],
  genreHistory: [],
  goal: null,
};

describe('P3 サマリー(画面)', () => {
  const html = visible(renderToString(h(CategoryScreen, { data: base })));

  it('合計(主役)・件数・1回あたり・前月同日比(言葉)が出る', () => {
    // 合計 = 1200 + 800 − 300 = 1,700円(返金は差し引く)
    expect(html).toContain('aria-label="1,700円"');
    // 件数(返金は数えない)と1回あたりは、大きな数字にせず1行(「2件 · 1回あたり 850円」)
    expect(html).toContain('>2件</span> · 1回あたり <span');
    expect(html).toContain('>850円</span>'); // 1,700 ÷ 2
    expect(html).toMatch(/前月の同じ日までより [\d,]+円 多い/);
  });

  it('予定は「予定 ○円」を1行、タップで展開して日付・名前・金額を見せる', () => {
    expect(html).toContain('予定');
    expect(html).toContain('5,000<span class="yen-unit">円</span>');
    expect(html).toContain('打ち上げ');
    expect(html).toContain('<details');
  });

  it('気づきが無いときは、気づきのセクションごと出さない', () => {
    expect(html).not.toContain('aria-label="気づき"');
  });

  it('前月のデータが無いときは、前月比を出さない。目標が無ければ目標の行も出さない', () => {
    const noPrev = visible(
      renderToString(
        h(CategoryScreen, {
          data: { ...base, transactions: base.transactions.filter((t) => t.id !== 'p') },
        }),
      ),
    );
    expect(noPrev).not.toContain('前月の同じ日まで');
    expect(noPrev).not.toContain('目標期間 ');
  });

  it('目標期間中は、共通のジャンル行(予算バー・理想ライン・状態)を出す', () => {
    const withGoal = visible(
      renderToString(
        h(CategoryScreen, {
          data: {
            ...base,
            goal: {
              range: { from: '2026-09-25', to: '2026-10-05' },
              dailyAllowanceYen: 2300,
              active: true,
              row: {
                genreId: 'dining',
                genreName: '外食',
                spentYen: 1700,
                targetYen: 8000,
                idealYen: 3000,
                scheduledYen: 5000,
                reserved: false,
              },
              plan: null,
            },
          },
        }),
      ),
    );
    expect(withGoal).toContain('目標期間 ');
    expect(withGoal).toContain('予定 5,000');
    expect(withGoal).toContain('自由に使える残り');
  });
});

describe('P3 気づきの表示', () => {
  it('気づきがあれば、事実+次にできることと、根拠の取引の件数を出す。タップで絞り込む', () => {
    const many: CategoryTx[] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        ...ledgerTx({
          id: `t${i}`,
          occurredOn: `2026-09-0${i + 1}`,
          label: 'ファミリーマート',
          amountYen: -500,
        }),
        items: [
          {
            id: `i${i}`,
            name: 'お茶',
            amountYen: -500,
            genreId: 'dining',
            genreName: '外食',
            productType: null,
          },
        ],
      })),
    ];
    const html = visible(
      renderToString(h(CategoryScreen, { data: { ...base, transactions: many } })),
    );
    expect(html).toContain('aria-label="気づき"');
    expect(html).toContain('お茶を今月4回');
    expect(html).toContain('根拠の取引 4件を見る');
    expect(html).toContain('min-h-11');
  });
});
