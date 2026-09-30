import { describe, expect, it } from 'vitest';

import { cacheKeyFor } from '@/lib/ai-gateway/cache';

describe('cacheKeyFor — N1本人要件「同じ入力の結果はキャッシュする」', () => {
  it('同じ入力なら同じキーになる(決定的)', () => {
    const input = { dateKey: '2026-09-30', totalSpentYen: 3500 };
    expect(cacheKeyFor('daily-report', input)).toBe(cacheKeyFor('daily-report', input));
  });

  it('オブジェクトのキー順序が違っても同じキーになる', () => {
    const a = { totalSpentYen: 3500, dateKey: '2026-09-30' };
    const b = { dateKey: '2026-09-30', totalSpentYen: 3500 };
    expect(cacheKeyFor('daily-report', a)).toBe(cacheKeyFor('daily-report', b));
  });

  it('入力が違えば違うキーになる', () => {
    const a = { dateKey: '2026-09-30', totalSpentYen: 3500 };
    const b = { dateKey: '2026-09-30', totalSpentYen: 3600 };
    expect(cacheKeyFor('daily-report', a)).not.toBe(cacheKeyFor('daily-report', b));
  });

  it('機能名が違えば同じ入力でも違うキーになる', () => {
    const input = { dateKey: '2026-09-30' };
    expect(cacheKeyFor('daily-report', input)).not.toBe(cacheKeyFor('monthly-report', input));
  });

  it('入れ子のオブジェクト・配列もキー順序に依存せず一致する', () => {
    const a = { items: [{ name: 'A', amountYen: 100 }], meta: { x: 1, y: 2 } };
    const b = { meta: { y: 2, x: 1 }, items: [{ amountYen: 100, name: 'A' }] };
    expect(cacheKeyFor('feature', a)).toBe(cacheKeyFor('feature', b));
  });
});
