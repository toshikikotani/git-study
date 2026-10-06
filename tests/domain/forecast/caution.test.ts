import { describe, expect, it } from 'vitest';

import { cautionsFor, type CautionInput } from '@/domain/forecast/caution';

const row = (over: Partial<CautionInput> = {}): CautionInput => ({
  categoryId: 'dining',
  type: 'steady',
  targetYen: 40000,
  medianYen: 48000,
  baseYen: 20000,
  exceedance: 0.7,
  ...over,
});

describe('cautionsFor(設計書 v3 3.2)', () => {
  it('定常型で、超える確率50%以上・超過が下限以上なら出す', () => {
    expect(cautionsFor([row()])).toEqual([
      { categoryId: 'dining', kind: 'likely', overshootYen: 8000, probability: 0.7 },
    ]);
  });

  it('確率が50%未満、または超過が max(1000円, 目標の10%) 未満なら出さない', () => {
    expect(cautionsFor([row({ exceedance: 0.49 })])).toEqual([]);
    // 目標 40,000 の 10% = 4,000 円に届かない
    expect(cautionsFor([row({ medianYen: 43000 })])).toEqual([]);
    // 目標が小さいときは 1,000 円が下限
    expect(cautionsFor([row({ targetYen: 5000, baseYen: 2000, medianYen: 5900 })])).toEqual([]);
    expect(cautionsFor([row({ targetYen: 5000, baseYen: 2000, medianYen: 6000 })])).toHaveLength(1);
  });

  it('まとまり型・決まった型には「このままだと」を出さない', () => {
    expect(cautionsFor([row({ type: 'lumpy' }), row({ type: 'fixed' })])).toEqual([]);
  });

  it('決まっている額だけで超えたら、型を問わず「超えた」を出す', () => {
    const out = cautionsFor([row({ type: 'fixed', baseYen: 42000 })]);
    expect(out).toEqual([
      { categoryId: 'dining', kind: 'over', overshootYen: 2000, probability: 1 },
    ]);
  });

  it('同時に2つまで。超過の大きい順', () => {
    const out = cautionsFor([
      row({ categoryId: 'a', medianYen: 46000 }),
      row({ categoryId: 'b', medianYen: 60000 }),
      row({ categoryId: 'c', medianYen: 50000 }),
    ]);
    expect(out.map((c) => c.categoryId)).toEqual(['b', 'c']);
  });

  it('その時点帯の精度が70%未満なら止める(数が少ないうちは止めない)', () => {
    const rows = [row()];
    expect(
      cautionsFor(rows, { phase: 'early', precision: { early: { issued: 10, hits: 6 } } }),
    ).toEqual([]);
    expect(
      cautionsFor(rows, { phase: 'early', precision: { early: { issued: 10, hits: 7 } } }),
    ).toHaveLength(1);
    expect(
      cautionsFor(rows, { phase: 'early', precision: { early: { issued: 4, hits: 0 } } }),
    ).toHaveLength(1);
    // 別の時点帯の精度は関係しない
    expect(
      cautionsFor(rows, { phase: 'mid', precision: { early: { issued: 10, hits: 0 } } }),
    ).toHaveLength(1);
  });

  it('止めても「超えた」は出す', () => {
    const out = cautionsFor([row(), row({ categoryId: 'x', baseYen: 50000 })], {
      phase: 'late',
      precision: { late: { issued: 10, hits: 1 } },
    });
    expect(out.map((c) => c.kind)).toEqual(['over']);
  });
});
