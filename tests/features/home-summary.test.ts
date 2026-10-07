import { describe, expect, it } from 'vitest';

import type { BudgetTransaction } from '@/domain/budget';
import { MAX_HOME_TILES, buildHomeTiles, type HomeGenre } from '@/features/home/summary';

/**
 * ADR-016/ADR-057:ジャンルの表示名も、ホームに出す枠の選択も、本人が変更できる。
 *
 * このテストの主目的は「UI にラベルを直書きし直す」退行を落とすこと。
 * ここが緑であるかぎり、本人が改名すればホームの表示も追従する。
 */

function genre(overrides: Partial<HomeGenre> = {}): HomeGenre {
  return {
    categoryId: 'genre-sanctuary',
    name: '聖域',
    budgetYen: 40_000,
    carryOverYen: 0,
    sortOrder: 30,
    showOnHome: true,
    ...overrides,
  };
}

function spend(genreId: string, amountYen: number): BudgetTransaction {
  return { categoryId: genreId, amountYen, isTransfer: false, reviewStatus: 'auto_ok' };
}

describe('buildHomeTiles — 表示名はデータから来る(ADR-016)', () => {
  it('ラベルは genres.name をそのまま使う', () => {
    const [tile] = buildHomeTiles([genre()], []);
    expect(tile!.label).toBe('聖域');
  });

  it('本人が改名すると、ホームのラベルも変わる', () => {
    const renamed = buildHomeTiles([genre({ name: '交際費' })], []);
    expect(renamed[0]!.label).toBe('交際費');

    const renamedAgain = buildHomeTiles([genre({ name: 'たのしみ枠' })], []);
    expect(renamedAgain[0]!.label).toBe('たのしみ枠');
  });

  it('日本語のジャンル名がコードに直書きされていない', async () => {
    // 表示名を1つも渡さなければ、画面に出せるラベルは1つも無いはず。
    // ここで何か出てくるなら、どこかに名前が焼き付いている。
    expect(buildHomeTiles([], [])).toEqual([]);
  });
});

describe('buildHomeTiles — どの枠を出すかも本人が選ぶ(FR-61)', () => {
  const living = genre({
    categoryId: 'genre-living',
    name: '生活費',
    budgetYen: 60_000,
    sortOrder: 20,
  });
  const waste = genre({
    categoryId: 'genre-waste',
    name: '浪費',
    budgetYen: 20_000,
    sortOrder: 40,
    showOnHome: false,
  });

  it('show_on_home が立っている枠だけを出す', () => {
    const tiles = buildHomeTiles([living, genre(), waste], []);
    expect(tiles.map((t) => t.genreId)).toEqual(['genre-living', 'genre-sanctuary']);
  });

  it('本人が別の枠に切り替えられる', () => {
    const tiles = buildHomeTiles(
      [living, genre({ showOnHome: false }), { ...waste, showOnHome: true }],
      [],
    );
    expect(tiles.map((t) => t.genreId)).toEqual(['genre-living', 'genre-waste']);
  });

  it('sort_order の順に並ぶ', () => {
    const tiles = buildHomeTiles([genre(), living], []);
    expect(tiles.map((t) => t.genreId)).toEqual(['genre-living', 'genre-sanctuary']);
  });

  it('数字3個に収めるため2件までに切る(FR-61)', () => {
    const many = [living, genre(), { ...waste, showOnHome: true }];
    expect(buildHomeTiles(many, [])).toHaveLength(MAX_HOME_TILES);
  });

  it('1件も選ばれていなければ空を返す(画面側で案内を出す)', () => {
    expect(buildHomeTiles([genre({ showOnHome: false })], [])).toEqual([]);
  });
});

describe('buildHomeTiles — 残額', () => {
  it('当月の支出を差し引いた残額を出す', () => {
    const [tile] = buildHomeTiles([genre()], [spend('genre-sanctuary', -30_000)]);
    expect(tile!.spentYen).toBe(30_000);
    expect(tile!.remainingYen).toBe(10_000);
    expect(tile!.usageRatio).toBeCloseTo(0.75);
  });

  it('他ジャンルの支出は混ざらない', () => {
    const [tile] = buildHomeTiles([genre()], [spend('genre-living', -50_000)]);
    expect(tile!.spentYen).toBe(0);
  });

  it('予算未設定の枠は残額 null(画面は「予算なし」と出す)', () => {
    const [tile] = buildHomeTiles([genre({ budgetYen: null })], []);
    expect(tile!.remainingYen).toBeNull();
    expect(tile!.usageRatio).toBeNull();
  });
});
