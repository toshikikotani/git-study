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
  setCategoryFixedAction: vi.fn(),
  setCategoryForecastClosedAction: vi.fn(),
  deleteCategoryAction: vi.fn(),
}));
vi.mock('../../app/(app)/plan/actions', () => ({
  updatePlanAllocationAction: vi.fn(),
  planLandingAction: vi.fn(),
}));

import { SettingsBody } from '../../app/(app)/settings/categories/[genreId]/settings-body';
import { GenreStyleProvider } from '../../src/components/ui/genre-style-context';
import { GenreBadge } from '../../src/components/ui/genre-badge';
import { selectableColorIndexes } from '../../src/domain/genre-style';
import type { CategorySettingsData } from '../../src/features/category/settings-loader';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

const data: CategorySettingsData = {
  genreName: '外食',
  genreBudgetYen: 30000,
  forecastClosed: false,
  isFixed: false,
  genres: [
    { id: 'dining', name: '外食' },
    { id: 'cafe', name: 'カフェ' },
  ],
  goal: null,
};

describe('P8 カテゴリ設定', () => {
  it('名前・アイコンと色・月の目安・扱い・ルール・削除がそろい、保存は「保存」ボタン', () => {
    const html = visible(renderToString(h(SettingsBody, { data, genreId: 'dining' })));
    for (const t of ['名前', 'アイコンと色', '月の目安', '扱い', 'このカテゴリのルール']) {
      expect(html).toContain(t);
    }
    expect(html).not.toContain('見た目を保存');
    // 固定費と見込みはスイッチ(押したら保存)。固定費にすると見込みも止まることを書く。
    expect(html.match(/role="switch"/g)?.length).toBe(2);
    expect(html).toContain('固定費にすると、月末の見込みも出しません');
    // 削除はここでできる(確かめてから)。
    expect(html).toMatch(/<button[^>]*>このカテゴリを削除/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>このカテゴリを削除/);
    // 色は候補の数だけ。選択中は「(選択中)」で色以外にも伝える。
    expect(html.match(/aria-label="色\d+/g)?.length).toBe(selectableColorIndexes().length);
    expect(html).toContain('(選択中)');
    expect(html).toContain('aria-pressed="true"');
  });

  it('目標が無いときは月の目安を入力、目標中は「配分・総額を調整する」を出す', () => {
    const noGoal = visible(renderToString(h(SettingsBody, { data, genreId: 'dining' })));
    expect(noGoal).toContain('月の目安');
    expect(noGoal).not.toContain('配分・総額を調整する');
    const withGoal = {
      ...data,
      goal: {
        plan: {
          id: 'p1',
          periodStart: '2026-09-25',
          periodEnd: '2026-10-05',
          rows: [
            { genreId: 'dining', genreName: '外食', baselineYen: null, note: null, yen: 8000 },
          ],
        },
      },
    };
    const html = visible(renderToString(h(SettingsBody, { data: withGoal, genreId: 'dining' })));
    expect(html).toContain('目標額');
    expect(html).toContain('このカテゴリの目標');
    expect(html).toContain('8,000円');
    // 目標全体の配分・期間は目標画面へ(ここでは1カテゴリの目標額だけ)。
    expect(html).toContain('href="/plan"');
    expect(html).not.toContain('配分・総額を調整する');
    // 月の目安が残っていれば、目標中は使わないことを示し、消せるようにする。
    expect(html).toContain('目標が無いときの月の目安(30,000円)は、目標の期間中は使いません。');
    expect(html).toContain('目安を消す');

    const withoutGuide = visible(
      renderToString(
        h(SettingsBody, {
          data: { ...withGoal, genreBudgetYen: null },
          genreId: 'dining',
        }),
      ),
    );
    expect(withoutGuide).not.toContain('月の目安');
  });

  it('選んだ見た目は、どこのバッジにも出る(コンテキスト)', () => {
    const html = renderToString(
      h(GenreStyleProvider, {
        overrides: { 外食: { colorIndex: 7 } },
        children: h(GenreBadge, { name: '外食' }),
      }),
    );
    expect(html).toContain('light-dark');
    expect(renderToString(h(GenreBadge, { name: '外食' }))).toContain('light-dark');
  });
});
