import { describe, expect, it } from 'vitest';

import {
  assertCategoryBudgetYen,
  assertCategoryName,
  CategoryError,
  expandMergedCategoryIds,
  resolveCategoryRoot,
  type CategoryMergeNode,
} from '@/domain/category';

describe('assertCategoryName', () => {
  it('前後の空白を取り除く', () => {
    expect(assertCategoryName('  食費  ')).toBe('食費');
  });

  it('空文字・空白のみは拒否する', () => {
    expect(() => assertCategoryName('')).toThrow(CategoryError);
    expect(() => assertCategoryName('   ')).toThrow(/カテゴリ名/);
  });
});

describe('assertCategoryBudgetYen', () => {
  it('null は上限なしとしてそのまま通す', () => {
    expect(assertCategoryBudgetYen(null)).toBeNull();
  });

  it('0以上の整数は許可する', () => {
    expect(assertCategoryBudgetYen(0)).toBe(0);
    expect(assertCategoryBudgetYen(50000)).toBe(50000);
  });

  it('負数・小数は拒否する', () => {
    expect(() => assertCategoryBudgetYen(-1)).toThrow(CategoryError);
    expect(() => assertCategoryBudgetYen(1.5)).toThrow(/月次予算/);
  });
});

describe('resolveCategoryRoot', () => {
  const categories: CategoryMergeNode[] = [
    { id: 'a', mergedIntoId: 'b' },
    { id: 'b', mergedIntoId: 'c' },
    { id: 'c', mergedIntoId: null },
    { id: 'd', mergedIntoId: null },
  ];

  it('統合されていなければ自分自身を返す', () => {
    expect(resolveCategoryRoot('d', categories)).toBe('d');
  });

  it('複数段の統合を辿って最終的な行き先を返す(a→b→c)', () => {
    expect(resolveCategoryRoot('a', categories)).toBe('c');
  });

  it('一覧に存在しない id はそのまま返す', () => {
    expect(resolveCategoryRoot('missing', categories)).toBe('missing');
  });

  it('循環があっても無限ループにならない', () => {
    const cyclic: CategoryMergeNode[] = [
      { id: 'x', mergedIntoId: 'y' },
      { id: 'y', mergedIntoId: 'x' },
    ];
    expect(() => resolveCategoryRoot('x', cyclic)).not.toThrow();
  });
});

describe('expandMergedCategoryIds', () => {
  const categories: CategoryMergeNode[] = [
    { id: 'old1', mergedIntoId: 'new' },
    { id: 'old2', mergedIntoId: 'old1' }, // new への複数段の統合
    { id: 'new', mergedIntoId: null },
    { id: 'unrelated', mergedIntoId: null },
  ];

  it('対象そのものと、そこへ統合された旧カテゴリを両方含む', () => {
    const result = expandMergedCategoryIds(categories, ['new']);
    expect(new Set(result)).toEqual(new Set(['new', 'old1', 'old2']));
  });

  it('無関係なカテゴリは含めない', () => {
    const result = expandMergedCategoryIds(categories, ['new']);
    expect(result).not.toContain('unrelated');
  });

  it('統合が無ければ対象そのものだけを返す', () => {
    expect(expandMergedCategoryIds(categories, ['unrelated'])).toEqual(['unrelated']);
  });
});
