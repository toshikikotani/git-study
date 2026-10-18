import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));
vi.mock('../../app/(app)/category-sheet', () => ({ useOpenCategory: () => () => undefined }));

import { WatchCategories } from '../../app/(app)/_home/watch-categories';

const visible = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

describe('ホームの「気をつけたいカテゴリ」(本人の案、ADR-117)', () => {
  const html = renderToString(
    h(WatchCategories, {
      categories: [
        {
          genreId: 'dining',
          name: '外食',
          spentYen: 22_000,
          targetYen: 20_000,
          p50: 25_000,
          tone: 'over',
        },
        {
          genreId: 'hobby',
          name: '趣味',
          spentYen: 5_000,
          targetYen: 10_000,
          p50: 12_000,
          tone: 'risk',
        },
        {
          genreId: 'food',
          name: '食料品',
          spentYen: 33_000,
          targetYen: 40_000,
          p50: 38_000,
          tone: 'near',
        },
      ],
    }),
  );
  const text = visible(html);

  it('題と、すべてのカテゴリ(分析 › 目標)への入口', () => {
    expect(text).toContain('気をつけたいカテゴリ');
    expect(html).toContain('href="/reports"');
    expect(text).toContain('すべて');
  });

  it('こえた・こえそう・8割をこえた を、使った額 / 目標と一緒に出す', () => {
    expect(text).toContain('外食 こえた');
    expect(text).toContain('22,000円 / 目標 20,000円');
    expect(text).toContain('見込み 約2.5万円');
    expect(text).toContain('趣味 こえそう');
    expect(text).toContain('食料品 8割をこえた');
    expect(text).toContain('あと7,000円');
  });

  it('行を押すとそのカテゴリを開く(1行に押せる所は1つ。スイッチは無い)', () => {
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).not.toContain('role="switch"');
  });

  it('気をつけたいカテゴリが無ければ何も出さない', () => {
    expect(renderToString(h(WatchCategories, { categories: [] }))).toBe('');
  });

  it('ホームは今期の目標の予測から選ぶ(読み込みを増やさない)。AIの窓口にも同じものを渡す', () => {
    const section = readFileSync('app/(app)/_home/today-section.tsx', 'utf8');
    expect(section).toContain('<WatchCategories categories={watchCategoriesOf(goalView)} />');
    const context = readFileSync('src/features/advisor/context.ts', 'utf8');
    expect(context).toContain('watch: view ? watchCategoriesOf(view) : []');
  });

  it('手でホームに出すカテゴリを選ぶスイッチ・AIの道具はもう無い', () => {
    for (const file of [
      'app/(app)/settings/categories/category-list.tsx',
      'app/(app)/category-sheet.tsx',
      'app/(app)/spending/category/actions.ts',
      'app/api/assistant/chat/route.ts',
      'src/features/assistant/plan.ts',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('setCategoryShowOnHomeAction');
      expect(source).not.toContain('set_genre_show_on_home');
    }
  });
});
