import { describe, expect, it } from 'vitest';

import {
  MovePlanError,
  mergeSplits,
  planCategoryMove,
  planItemMove,
  splitsAreConsistent,
  type MoveInput,
} from '../../src/domain/category-move';

const item = (id: string, amountYen: number, genreId: string | null, name = id) => ({
  id,
  name,
  amountYen,
  genreId,
});

describe('P6 カテゴリの移動(分割なしの明細)', () => {
  const tx: MoveInput = {
    amountYen: -1200,
    genreId: 'dining',
    splits: [],
    items: [item('a', -700, 'dining'), item('b', -500, 'dining')],
  };

  it('明細のジャンルが移り、そのカテゴリの品目のジャンルも一緒に移る', () => {
    const plan = planCategoryMove(tx, 'dining', 'cafe');
    expect(plan.genreId).toBe('cafe');
    expect(plan.splits).toEqual([]);
    expect([...plan.itemGenres.entries()]).toEqual([
      ['a', 'cafe'],
      ['b', 'cafe'],
    ]);
  });

  it('未分類(null)へ戻すこともできる。未分類から移すときは品目を動かさない', () => {
    expect(planCategoryMove(tx, 'dining', null).genreId).toBeNull();
    const un = planCategoryMove(
      { ...tx, genreId: null, items: [item('a', -1200, null)] },
      null,
      'dining',
    );
    expect(un.genreId).toBe('dining');
    expect(un.itemGenres.size).toBe(0);
  });
});

describe('P6 カテゴリの移動(分割したレシート)', () => {
  const tx: MoveInput = {
    amountYen: -3000,
    genreId: 'dining',
    splits: [
      { genreId: 'dining', amountYen: -1000, note: 'サンドイッチ' },
      { genreId: 'cafe', amountYen: -2000, note: 'コーヒー豆' },
    ],
    items: [item('s', -1000, 'dining', 'サンドイッチ'), item('c', -2000, 'cafe', 'コーヒー豆')],
  };

  it('このカテゴリの部分だけを移す。ほかの部分は動かない。合計は明細の金額のまま', () => {
    const plan = planCategoryMove(tx, 'dining', 'hobby');
    expect(plan.splits).toEqual([
      { genreId: 'hobby', amountYen: -1000, note: 'サンドイッチ' },
      { genreId: 'cafe', amountYen: -2000, note: 'コーヒー豆' },
    ]);
    expect(plan.genreId).toBe('cafe'); // 代表ジャンルだった dining が無くなるので、最大の分割に
    expect(splitsAreConsistent(-3000, plan)).toBe(true);
    expect(plan.itemGenres.get('s')).toBe('hobby');
    expect(plan.itemGenres.has('c')).toBe(false);
  });

  it('移した先に同じジャンルの分割があれば1つにまとめる。1つだけになれば分割を解除する', () => {
    const plan = planCategoryMove(tx, 'dining', 'cafe');
    expect(plan.splits).toEqual([]);
    expect(plan.genreId).toBe('cafe');
    expect(mergeSplits(tx.splits.map((s) => ({ ...s, genreId: 'cafe' })))).toEqual([
      { genreId: 'cafe', amountYen: -3000, note: 'サンドイッチ、コーヒー豆' },
    ]);
  });
});

describe('P6 分割したレシートの品目1つだけを移す(受け入れ基準9)', () => {
  const tx: MoveInput = {
    amountYen: -3000,
    genreId: 'dining',
    splits: [
      { genreId: 'dining', amountYen: -1000, note: 'サンドイッチ' },
      { genreId: 'cafe', amountYen: -2000, note: 'コーヒー豆' },
    ],
    items: [item('s', -1000, 'dining', 'サンドイッチ'), item('c', -2000, 'cafe', 'コーヒー豆')],
  };

  it('品目を別のカテゴリへ移すと、レシートの分割の内訳も更新される(合計は変わらない)', () => {
    const plan = planItemMove(tx, 's', 'hobby');
    expect(plan.splits).toEqual([
      { genreId: 'hobby', amountYen: -1000, note: 'サンドイッチ' },
      { genreId: 'cafe', amountYen: -2000, note: 'コーヒー豆' },
    ]);
    expect(splitsAreConsistent(-3000, plan)).toBe(true);
    expect(plan.itemGenres.get('s')).toBe('hobby');
  });

  it('すべての品目を同じカテゴリへ集めると、分割は解除されて明細のジャンルになる', () => {
    const plan = planItemMove(tx, 's', 'cafe');
    expect(plan.splits).toEqual([]);
    expect(plan.genreId).toBe('cafe');
  });

  it('品目に載っていない額(合計との差)は、明細本体のジャンルに残る', () => {
    const t: MoveInput = {
      amountYen: -1500,
      genreId: 'dining',
      splits: [],
      items: [item('a', -500, null, 'おにぎり'), item('b', -700, null, 'お茶')],
    };
    const plan = planItemMove(t, 'a', 'cafe');
    expect(plan.splits).toEqual([
      { genreId: 'cafe', amountYen: -500, note: 'おにぎり' },
      { genreId: 'dining', amountYen: -1000, note: 'お茶' }, // お茶 700 + 差 300
    ]);
    expect(plan.splits.reduce((a, s) => a + s.amountYen, 0)).toBe(-1500);
    expect(plan.genreId).toBe('dining');
  });

  it('品目の合計が金額を超えるデータは、移せない(エラー)。存在しない品目もエラー', () => {
    const bad: MoveInput = { ...tx, amountYen: -100 };
    expect(() => planItemMove(bad, 's', 'hobby')).toThrow(MovePlanError);
    expect(() => planItemMove(tx, 'zzz', 'hobby')).toThrow('品目が見つかりません');
  });
});
