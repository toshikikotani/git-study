import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings/categories',
}));
vi.mock('../../app/(app)/spending/category/actions', () => ({
  createCategoryAction: vi.fn(),
  mergeCategoryAction: vi.fn(),
  reorderCategoriesAction: vi.fn(),
}));

import { CategoryList } from '../../app/(app)/settings/categories/category-list';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('設定 > カテゴリ', () => {
  const html = visible(
    renderToString(
      h(CategoryList, {
        categories: [
          { id: 'dining', name: '外食' },
          { id: 'cafe', name: 'カフェ' },
        ],
      }),
    ),
  );

  it('行を開くと、そのカテゴリの設定ページへ行く', () => {
    expect(html).toContain('href="/settings/categories/dining"');
    expect(html).toContain('href="/settings/categories/cafe"');
  });

  it('1行に押せる所は1つ(名前)。スイッチは置かず、1つの一覧に数を出す(本人の指摘、ADR-117)', () => {
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('ホームに表示');
    expect(html).not.toContain('そのほか');
    expect(html).toContain('カテゴリ · 2');
    expect(html).toContain('並べ替え');
  });

  it('カテゴリを追加できる', () => {
    expect(html).toContain('カテゴリを追加');
    expect(html).toContain('新しいカテゴリ名');
  });
});
