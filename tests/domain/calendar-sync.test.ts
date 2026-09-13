import { describe, expect, it } from 'vitest';

import { planPaydayEvents, planPayoffEvent, planSubscriptionEvents } from '@/domain/calendar-sync';

describe('planPaydayEvents', () => {
  it('今日以降、直近3ヶ月分の給料日を積む', () => {
    const events = planPaydayEvents(25, '2026-09-01');
    expect(events.map((e) => e.date)).toEqual(['2026-09-25', '2026-10-25', '2026-11-25']);
    expect(events.every((e) => e.title === '給料日')).toBe(true);
  });

  it('今日より前の今月分の給料日は含めない', () => {
    const events = planPaydayEvents(25, '2026-09-26');
    expect(events.map((e) => e.date)).toEqual(['2026-10-25', '2026-11-25']);
  });

  it('月ごとに別の key にする(同じ「給料日」でも別イベント)', () => {
    const events = planPaydayEvents(25, '2026-09-01');
    const keys = new Set(events.map((e) => e.key));
    expect(keys.size).toBe(events.length);
  });
});

describe('planSubscriptionEvents', () => {
  it('サブスクの次回更新見込み日をイベントにする', () => {
    const events = planSubscriptionEvents([
      { key: 'netflix:1490', label: 'Netflix', amountYen: 1490, nextExpectedOn: '2026-10-05' },
    ]);
    expect(events).toEqual([
      {
        key: 'subscription:netflix:1490',
        title: 'Netflix(1,490円)の更新日',
        date: '2026-10-05',
      },
    ]);
  });

  it('key に日付を含めない(見込みが動いても同じイベントを上書きするため)', () => {
    const first = planSubscriptionEvents([
      { key: 'netflix:1490', label: 'Netflix', amountYen: 1490, nextExpectedOn: '2026-10-05' },
    ]);
    const later = planSubscriptionEvents([
      { key: 'netflix:1490', label: 'Netflix', amountYen: 1490, nextExpectedOn: '2026-10-08' },
    ]);
    expect(first[0]!.key).toBe(later[0]!.key);
    expect(first[0]!.date).not.toBe(later[0]!.date);
  });
});

describe('planPayoffEvent', () => {
  it('完済予定日を1件のイベントにする', () => {
    expect(planPayoffEvent('2028-03-01')).toEqual([
      { key: 'payoff', title: '完済予定日', date: '2028-03-01' },
    ]);
  });

  it('完済済み(null)なら空配列', () => {
    expect(planPayoffEvent(null)).toEqual([]);
  });
});
