import { describe, expect, it } from 'vitest';

import { classifySpending } from '@/domain/forecast/spending-type';
import { addDays } from '@/lib/date';

const every = (from: string, step: number, n: number) =>
  Array.from({ length: n }, (_, i) => addDays(from, i * step));

const base = {
  name: '外食',
  eventDates: [] as string[],
  recordDays: 120,
  hasRegularMerchant: false,
  hasBills: false,
  closed: false,
};

describe('classifySpending(設計書 v3 4.1)', () => {
  it('予測を止めたジャンルは決まった型', () => {
    expect(
      classifySpending({ ...base, closed: true, eventDates: every('2026-06-01', 2, 50) }),
    ).toBe('fixed');
  });

  it('請求だけのジャンルは決まった型', () => {
    expect(classifySpending({ ...base, hasBills: true })).toBe('fixed');
  });

  it('月に何度も、規則的に使うジャンルは定常型', () => {
    expect(classifySpending({ ...base, eventDates: every('2026-06-01', 3, 40) })).toBe('steady');
  });

  it('規則的に通う店があれば定常型', () => {
    expect(
      classifySpending({ ...base, hasRegularMerchant: true, eventDates: ['2026-06-01'] }),
    ).toBe('steady');
  });

  it('月に2回未満なら、まとまり型', () => {
    expect(
      classifySpending({
        ...base,
        name: '娯楽',
        eventDates: ['2026-06-10', '2026-08-02', '2026-09-20'],
      }),
    ).toBe('lumpy');
  });

  it('記録が短いうちは、回数では決めず、名前(旅行など)で決める', () => {
    const short = { ...base, recordDays: 14, eventDates: ['2026-10-01'] };
    expect(classifySpending({ ...short, name: 'カフェ' })).toBe('steady');
    expect(classifySpending({ ...short, name: '旅行' })).toBe('lumpy');
  });
});
