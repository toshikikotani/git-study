import { describe, expect, it } from 'vitest';

import { aiTrust, applyAiRead, isAiAdjustPercent } from '@/domain/ai-forecast-read';
import { calendarContext } from '@/domain/forecast/calendar';

const read = (percent: number, stat: number, adjusted: number, actual: number) => ({
  month: '2026-09',
  percent,
  statP50Yen: stat,
  adjustedP50Yen: adjusted,
  actualYen: actual,
});

describe('aiTrust(AIの読みの当たり具合)', () => {
  it('記録が無ければ半分だけ効かせる', () => {
    expect(aiTrust([])).toEqual({ weight: 0.5, wins: 0, compared: 0 });
  });

  it('統計より近かった回が多いほど強く効かせる。補正0の回は数えない', () => {
    const trust = aiTrust([
      read(10, 100000, 105000, 110000),
      read(10, 100000, 105000, 104000),
      read(-10, 100000, 95000, 120000),
      read(0, 100000, 100000, 90000),
    ]);
    expect(trust.compared).toBe(3);
    expect(trust.wins).toBe(2);
    expect(trust.weight).toBeCloseTo(3 / 5);
  });
});

describe('applyAiRead(補正の計算はアプリがする)', () => {
  it('決まっている額は動かさず、残りの部分だけを、当たり具合に応じて動かす', () => {
    const out = applyAiRead({
      knownYen: 60000,
      band: { p10: 90000, p50: 100000, p90: 120000 },
      percent: 20,
      weight: 0.5,
    });
    // 残り 40,000円 × (1 + 20% × 0.5) = 44,000円
    expect(out.p50).toBe(104000);
    expect(out.p10).toBe(93000);
    expect(out.p90).toBe(126000);
    expect(out.effectivePercent).toBe(10);
  });

  it('選択肢だけを許す', () => {
    expect(isAiAdjustPercent(10)).toBe(true);
    expect(isAiAdjustPercent(15)).toBe(false);
  });
});

describe('calendarContext(残りの日の暦)', () => {
  it('連休・平日の祝日・給料日・時期を数える', () => {
    const c = calendarContext('2026-04-27', '2026-05-10', 25);
    expect(c.remainingDays).toBe(13);
    expect(c.longestBreak).toEqual({ from: '2026-05-02', to: '2026-05-06', days: 5 });
    expect(c.weekdayHolidays).toBeGreaterThanOrEqual(3);
    expect(c.seasons).toContain('ゴールデンウィーク');
    expect(c.payday).toBeNull();
  });

  it('残りの日に給料日があれば返す(土日祝なら前の平日)', () => {
    expect(calendarContext('2026-10-01', '2026-10-31', 25).payday).toBe('2026-10-23');
  });
});
