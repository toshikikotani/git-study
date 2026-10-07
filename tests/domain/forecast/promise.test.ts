import { describe, expect, it } from 'vitest';

import { promiseKeepRate, promiseKept } from '@/domain/forecast/promise';

describe('約束の守れ具合(ADR-078)', () => {
  it('約束が無ければ半分。守れた月が多いほど上がり、1回の失敗で 0 にはならない', () => {
    expect(promiseKeepRate([])).toBe(0.5);
    expect(promiseKeepRate([{ kept: false }])).toBeCloseTo(1 / 3, 9);
    expect(promiseKeepRate([{ kept: true }, { kept: true }, { kept: false }])).toBeCloseTo(
      3 / 5,
      9,
    );
  });

  it('守れたか:使った額が約束どおりの見込み以下', () => {
    expect(promiseKept(36000, 36000)).toBe(true);
    expect(promiseKept(36001, 36000)).toBe(false);
  });
});
