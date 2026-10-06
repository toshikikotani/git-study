import { describe, expect, it } from 'vitest';

import { fanAt } from '@/domain/forecast/fan';
import {
  approxRange,
  approxSignedYen,
  approxYen,
  outOfTen,
  percent,
  probabilityWord,
} from '@/domain/forecast/format';

describe('probabilityWord(M6の5段階)', () => {
  it.each([
    [0.9, 'ほぼ大丈夫'],
    [0.85, 'ほぼ大丈夫'],
    [0.72, 'おそらく大丈夫'],
    [0.6, 'おそらく大丈夫'],
    [0.5, '五分五分'],
    [0.4, '五分五分'],
    [0.2, '厳しめ'],
    [0.15, '厳しめ'],
    [0.1, 'このままだと超えそう'],
  ])('%s → %s', (p, word) => {
    expect(probabilityWord(p).word).toBe(word);
  });
});

describe('数字の丸め', () => {
  it('確率は整数の%、10回中N回', () => {
    expect(percent(0.724)).toBe(72);
    expect(outOfTen(0.76)).toBe(8);
    expect(outOfTen(0.04)).toBe(0);
  });

  it('金額は100円単位、1万円以上は「約4.2万円」', () => {
    expect(approxYen(41_960)).toBe('約4.2万円');
    expect(approxYen(3_861)).toBe('約3,900円');
    expect(approxYen(178_000, { unit: false })).toBe('約17.8万');
    expect(approxRange(38_000, 47_000)).toBe('3.8万〜4.7万円');
    expect(approxSignedYen(97_000)).toBe('+9.7万円');
    expect(approxSignedYen(-8_000)).toBe('−8,000円');
  });

  it('統計用語を含まない', () => {
    const texts = [0, 0.2, 0.5, 0.7, 0.9].map((p) => probabilityWord(p).word);
    for (const t of texts) expect(t).not.toMatch(/信頼区間|分位|事後|確率分布|パーセンタイル/);
  });
});

describe('fanAt(扇形のグラフ)', () => {
  const landing = { p10: 140_000, p50: 178_000, p90: 231_000 };

  it('今日は幅0(今日の累計)、期間の最終日は着地の帯と一致する', () => {
    expect(fanAt({ todayCumulative: 90_000, landing, fraction: 0 })).toEqual({
      p10: 90_000,
      p25: 90_000,
      p50: 90_000,
      p75: 90_000,
      p90: 90_000,
    });
    const end = fanAt({ todayCumulative: 90_000, landing, fraction: 1 });
    expect(end.p10).toBeCloseTo(140_000);
    expect(end.p50).toBeCloseTo(178_000);
    expect(end.p90).toBeCloseTo(231_000);
    expect(end.p25).toBeGreaterThan(end.p10);
    expect(end.p75).toBeLessThan(end.p90);
  });

  it('帯の下端は今日の累計を下回らない(実績は減らない)', () => {
    const wide = { p10: 0, p50: 100_000, p90: 300_000 };
    const mid = fanAt({ todayCumulative: 90_000, landing: wide, fraction: 0.5 });
    expect(mid.p10).toBeGreaterThanOrEqual(90_000);
  });
});
