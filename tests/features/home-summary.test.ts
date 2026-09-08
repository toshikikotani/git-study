import { describe, expect, it } from 'vitest';

import type { BudgetTransaction } from '@/domain/budget';
import {
  MAX_HOME_TILES,
  buildHomeTiles,
  computePayoffSummary,
  loadHomeSummary,
  type HomeCategory,
} from '@/features/home/summary';

/**
 * ADR-016:カテゴリの表示名も、ホームに出す枠の選択も、本人が変更できる。
 *
 * このテストの主目的は「UI にラベルを直書きし直す」退行を落とすこと。
 * ここが緑であるかぎり、本人が改名すればホームの表示も追従する。
 */

function category(overrides: Partial<HomeCategory> = {}): HomeCategory {
  return {
    categoryId: 'cat-sanctuary',
    code: 'sanctuary',
    name: '聖域',
    budgetYen: 40_000,
    carryOverYen: 0,
    sortOrder: 30,
    showOnHome: true,
    isActive: true,
    ...overrides,
  };
}

function spend(categoryId: string, amountYen: number): BudgetTransaction {
  return { categoryId, amountYen, isTransfer: false, reviewStatus: 'auto_ok' };
}

describe('buildHomeTiles — 表示名はデータから来る(ADR-016)', () => {
  it('ラベルは categories.name をそのまま使う', () => {
    const [tile] = buildHomeTiles([category()], []);
    expect(tile!.label).toBe('聖域');
  });

  it('本人が改名すると、ホームのラベルも変わる', () => {
    const renamed = buildHomeTiles([category({ name: '交際費' })], []);
    expect(renamed[0]!.label).toBe('交際費');

    const renamedAgain = buildHomeTiles([category({ name: 'たのしみ枠' })], []);
    expect(renamedAgain[0]!.label).toBe('たのしみ枠');
  });

  it('改名しても code は変わらない(ルールと集計が壊れない)', () => {
    const [tile] = buildHomeTiles([category({ name: '別の名前' })], []);
    expect(tile!.code).toBe('sanctuary');
  });

  it('日本語のカテゴリ名がコードに直書きされていない', async () => {
    // 表示名を1つも渡さなければ、画面に出せるラベルは1つも無いはず。
    // ここで何か出てくるなら、どこかに名前が焼き付いている。
    expect(buildHomeTiles([], [])).toEqual([]);
  });
});

describe('buildHomeTiles — どの枠を出すかも本人が選ぶ(FR-61)', () => {
  const living = category({
    categoryId: 'cat-living',
    code: 'living',
    name: '生活費',
    budgetYen: 60_000,
    sortOrder: 20,
  });
  const waste = category({
    categoryId: 'cat-waste',
    code: 'waste',
    name: '浪費',
    budgetYen: 20_000,
    sortOrder: 40,
    showOnHome: false,
  });

  it('show_on_home が立っている枠だけを出す', () => {
    const tiles = buildHomeTiles([living, category(), waste], []);
    expect(tiles.map((t) => t.code)).toEqual(['living', 'sanctuary']);
  });

  it('本人が別の枠に切り替えられる', () => {
    const tiles = buildHomeTiles(
      [living, category({ showOnHome: false }), { ...waste, showOnHome: true }],
      [],
    );
    expect(tiles.map((t) => t.code)).toEqual(['living', 'waste']);
  });

  it('sort_order の順に並ぶ', () => {
    const tiles = buildHomeTiles([category(), living], []);
    expect(tiles.map((t) => t.code)).toEqual(['living', 'sanctuary']);
  });

  it('数字3個に収めるため2件までに切る(FR-61)', () => {
    const many = [living, category(), { ...waste, showOnHome: true }];
    expect(buildHomeTiles(many, [])).toHaveLength(MAX_HOME_TILES);
  });

  it('無効化したカテゴリは出さない', () => {
    expect(buildHomeTiles([category({ isActive: false })], [])).toEqual([]);
  });

  it('1件も選ばれていなければ空を返す(画面側で案内を出す)', () => {
    expect(buildHomeTiles([category({ showOnHome: false })], [])).toEqual([]);
  });
});

describe('buildHomeTiles — 残額', () => {
  it('当月の支出を差し引いた残額を出す', () => {
    const [tile] = buildHomeTiles([category()], [spend('cat-sanctuary', -30_000)]);
    expect(tile!.spentYen).toBe(30_000);
    expect(tile!.remainingYen).toBe(10_000);
    expect(tile!.usageRatio).toBeCloseTo(0.75);
  });

  it('他カテゴリの支出は混ざらない', () => {
    const [tile] = buildHomeTiles([category()], [spend('cat-living', -50_000)]);
    expect(tile!.spentYen).toBe(0);
  });

  it('予算未設定の枠は残額 null(画面は「予算なし」と出す)', () => {
    const [tile] = buildHomeTiles([category({ budgetYen: null })], []);
    expect(tile!.remainingYen).toBeNull();
    expect(tile!.usageRatio).toBeNull();
  });
});

describe('computePayoffSummary', () => {
  const debts = [
    {
      id: 'd1',
      balanceYen: 400_000,
      annualRate: 0.15,
      minimumPaymentYen: 10_000,
      paymentDay: 27,
    },
  ];
  const now = new Date('2026-09-08T00:00:00Z');

  it('残り日数と残債を返す', () => {
    const payoff = computePayoffSummary(
      { debts, monthlyBudgetYen: 100_000, originalTotalYen: 1_000_000, isEstimated: true },
      now,
    );
    expect(payoff.remainingYen).toBe(400_000);
    expect(payoff.daysRemaining).toBeGreaterThan(0);
    expect(payoff.isEstimated).toBe(true);
  });

  it('返済済みの割合を進捗ゲージ用に返す', () => {
    const payoff = computePayoffSummary(
      { debts, monthlyBudgetYen: 100_000, originalTotalYen: 1_000_000, isEstimated: true },
      now,
    );
    expect(payoff.progressRatio).toBeCloseTo(0.6);
  });

  it('完済していれば日付も日数も null(推定バッジも消える)', () => {
    const payoff = computePayoffSummary(
      { debts: [], monthlyBudgetYen: 100_000, originalTotalYen: 1_000_000, isEstimated: true },
      now,
    );
    expect(payoff.daysRemaining).toBeNull();
    expect(payoff.payoffOn).toBeNull();
    expect(payoff.progressRatio).toBe(1);
    expect(payoff.isEstimated).toBe(false);
  });
});

describe('loadHomeSummary', () => {
  it('ホームに出す数字は完済カウントダウン + 枠2件(FR-61)', async () => {
    const summary = await loadHomeSummary(new Date('2026-09-08T00:00:00Z'));
    expect(summary.tiles).toHaveLength(2);
    expect(summary.payoff.remainingYen).toBe(1_000_000);
  });

  it('仮置きデータでもラベルはカテゴリ由来', async () => {
    const summary = await loadHomeSummary(new Date('2026-09-08T00:00:00Z'));
    expect(summary.tiles.map((t) => t.code)).toEqual(['living', 'sanctuary']);
    expect(summary.tiles.every((t) => t.label.length > 0)).toBe(true);
  });
});
