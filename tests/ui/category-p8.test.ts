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
vi.mock('../../app/(app)/spending/category/actions', () => ({
  listRulesAction: vi.fn(async () => ({ error: null, rules: [] })),
  deleteRuleAction: vi.fn(),
  renameCategoryAction: vi.fn(),
  saveCategoryStyleAction: vi.fn(),
  updateCategoryBudgetAction: vi.fn(),
  updateRuleGenreAction: vi.fn(),
  updatePlanAllocationAction: vi.fn(),
}));
vi.mock('../../app/(app)/plan/actions', () => ({
  updatePlanAllocationAction: vi.fn(),
  planLandingAction: vi.fn(),
}));

import { SettingsBody } from '../../app/(app)/spending/category/[genreKey]/category-settings';
import { GenreStyleProvider } from '../../src/components/ui/genre-style-context';
import { GenreBadge } from '../../src/components/ui/genre-badge';
import { selectableColorIndexes } from '../../src/domain/genre-style';
import type { CategoryDetailData } from '../../src/features/category/loader';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

const data = {
  genreKey: 'dining',
  genreName: '外食',
  genreBudgetYen: 30000,
  forecastClosed: false,
  genres: [
    { id: 'dining', name: '外食' },
    { id: 'cafe', name: 'カフェ' },
  ],
  goal: null,
} as unknown as CategoryDetailData;

describe('P8 カテゴリ設定', () => {
  it('名前・アイコン・色・予算・ルールがあり、削除は無効(理由つき)', () => {
    const html = visible(
      renderToString(h(SettingsBody, { data, genreId: 'dining', onClose: () => {} })),
    );
    for (const t of ['名前', 'アイコン', '色', '予算', 'このカテゴリのルール', '見た目を保存']) {
      expect(html).toContain(t);
    }
    expect(html).toMatch(/<button[^>]*disabled[^>]*>このカテゴリを削除/);
    expect(html).toContain('今後対応します');
    // 色は候補の数だけ。選択中は「(選択中)」で色以外にも伝える。
    expect(html.match(/aria-label="色\d+/g)?.length).toBe(selectableColorIndexes().length);
    expect(html).toContain('(選択中)');
    expect(html).toContain('aria-pressed="true"');
  });

  it('目標が無いときは月の目安を入力、目標中は「配分・総額を調整する」を出す', () => {
    const noGoal = visible(
      renderToString(h(SettingsBody, { data, genreId: 'dining', onClose: () => {} })),
    );
    expect(noGoal).toContain('月の目安');
    expect(noGoal).not.toContain('配分・総額を調整する');
    const withGoal = {
      ...data,
      goal: {
        range: { from: '2026-09-25', to: '2026-10-05' },
        dailyAllowanceYen: 1000,
        active: true,
        row: {
          genreId: 'dining',
          genreName: '外食',
          spentYen: 0,
          targetYen: 8000,
          idealYen: 0,
          scheduledYen: 0,
          reserved: false,
        },
        plan: {
          id: 'p1',
          periodStart: '2026-09-25',
          periodEnd: '2026-10-05',
          rows: [
            { genreId: 'dining', genreName: '外食', baselineYen: null, note: null, yen: 8000 },
          ],
        },
      },
    } as unknown as CategoryDetailData;
    const html = visible(
      renderToString(h(SettingsBody, { data: withGoal, genreId: 'dining', onClose: () => {} })),
    );
    expect(html).toContain('配分・総額を調整する');
    expect(html).not.toContain('月の目安');
  });

  it('選んだ見た目は、どこのバッジにも出る(コンテキスト)', () => {
    const html = renderToString(
      h(GenreStyleProvider, {
        overrides: { 外食: { colorIndex: 7 } },
        children: h(GenreBadge, { name: '外食' }),
      }),
    );
    expect(html).toContain('var(--genre-7)');
    expect(renderToString(h(GenreBadge, { name: '外食' }))).toContain('var(--genre-2)');
  });
});
