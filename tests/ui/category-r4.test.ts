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
import { monthChoices } from '../../src/features/category/months';
import type { CategoryDetailData } from '../../src/features/category/loader';
import type { CategoryTx } from '../../src/features/category/model';
import { ledgerTx } from '../helpers/ledger';

const visible = (html: string) => html.replace(/<!-- -->/g, '');
const tx = (o: Parameters<typeof ledgerTx>[0]): CategoryTx => ({ ...ledgerTx(o), items: [] });

const base: CategoryDetailData = {
  genreKey: 'dining',
  genreName: '外食',
  genreBudgetYen: null, forecastClosed: false,
  monthKey: '2026-09',
  monthStart: '2026-09-01',
  today: '2026-09-29',
  isCurrentMonth: true,
  range: { from: '2026-09-01', to: '2026-09-30' },
  windowFrom: '2026-03-01',
  transactions: [
    tx({ id: 'a', occurredOn: '2026-09-21', label: 'A', amountYen: -780 }),
    tx({ id: 'b', occurredOn: '2026-09-27', label: 'B', amountYen: -780 }),
  ],
  genres: [{ id: 'dining', name: '外食' }],
  accounts: [{ id: 'a', name: '現金' }],
  genreHistory: [],
  goal: null,
};
const row = {
  genreId: 'dining',
  genreName: '外食',
  spentYen: 1560,
  targetYen: 8000,
  idealYen: 3000,
  scheduledYen: 0,
  reserved: false,
};
const render = (data: Partial<CategoryDetailData>) =>
  visible(renderToString(h(CategoryScreen, { data: { ...base, ...data } })));

describe('R4 ヘッダーとサマリー', () => {
  it('件数と1回あたりは「2件 · 1回あたり 780円」と1行', () => {
    const html = render({});
    expect(html).toContain('>2件</span> · 1回あたり <span');
    expect(html).toContain('>780円</span>');
    expect(html).not.toContain('>件数<');
  });

  it('期間の選択肢は今月から遡った12か月(新しい月が先頭)', () => {
    const m = monthChoices('2026-09');
    expect(m).toHaveLength(12);
    expect(m[0]).toEqual({ key: '2026-09', label: '2026年9月' });
    expect(m[1]!.key).toBe('2026-08');
    expect(m.at(-1)!.key).toBe('2025-10');
    expect(monthChoices('2026-01')[1]!.key).toBe('2025-12');
  });

  it('目標の行は、表示中の期間が目標期間と重なるときだけ。「目標期間 9/29〜10/6」と明記', () => {
    const goal = {
      range: { from: '2026-09-29', to: '2026-10-06' },
      dailyAllowanceYen: 1000,
      active: true,
      row,
      plan: null,
    };
    const overlap = render({ goal });
    expect(overlap).toContain('目標期間 ');
    expect(overlap).toContain('目標期間 9/29〜10/6');
    // 8月を見ているときは、目標期間と重ならないので出さない
    const aug = render({
      goal,
      monthKey: '2026-08',
      monthStart: '2026-08-01',
      isCurrentMonth: false,
      range: { from: '2026-08-01', to: '2026-08-31' },
    });
    expect(aug).not.toContain('目標期間 ');
    // 目標が無いときも出さない
    expect(render({ goal: null })).not.toContain('目標期間 ');
  });

  it('日 / 週 / 月 は、丸いボタンではなくセグメントコントロール(角丸の溝+選択中が浮く)', () => {
    const html = render({});
    // 累計が初期表示なので、日別に切り替えるセグメントは「累計 / 日別」。
    expect(html).toContain('aria-label="グラフの表示"');
    expect(html).not.toMatch(/rounded-full[^"]*"[^>]*role="tab"/);
  });
});
