import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));

import { GoalStatusCard } from '../../app/(app)/reports/goal-status-card';

const visible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ');

/** 10/1〜11/5(36日)、今日は10/16(15番目)。 */
const days = Array.from({ length: 36 }, (_, i) => {
  const date = i < 31 ? `2026-10-${String(i + 1).padStart(2, '0')}` : `2026-11-0${i - 30}`;
  const t = (i - 15) / 20;
  const mid = 111000 + 78000 * t;
  return {
    date,
    index: i,
    actualYen: i <= 15 ? Math.round((111000 * i) / 15) : null,
    idealYen: Math.round((169000 * i) / 35),
    scheduledYen: 0,
    forecastYen: i > 15 ? mid : null,
    forecastLowYen: i > 15 ? mid - 13000 * t : null,
    forecastHighYen: i > 15 ? mid + 15000 * t : null,
    forecastInnerLowYen: null,
    forecastInnerHighYen: null,
  };
});

const raw = renderToString(
  h(GoalStatusCard, {
    status: {
      budgetYen: 169000,
      p10: 176000,
      p50: 189000,
      p90: 204000,
      probWithin: 0.14,
      days,
      spentYen: 111000,
    },
    periodLabel: '10/1〜11/5 · 残り21日',
    endLabel: '11月5日',
    remainingDays: 21,
  }),
);

describe('分析 › 目標「いまの状況」(ADR-094)', () => {
  it('着地見込みの下に、10回中8回の幅の金額を出す', () => {
    expect(visible(raw)).toContain('10回中8回は 17.6万〜20.4万円');
  });

  it('目標の線は、10回中8回の帯より後に描く(帯に隠れない)', () => {
    const band = raw.indexOf('data-band="outer"');
    const budget = raw.indexOf('data-line="budget"');
    expect(band).toBeGreaterThan(-1);
    expect(budget).toBeGreaterThan(band);
  });

  it('読み上げにも幅を入れる', () => {
    expect(raw).toContain('10回中8回は17.6万〜20.4万円の間');
  });
});

const densityDays = days.map((day) => ({
  ...day,
  ...(day.forecastLowYen !== null && day.forecastHighYen !== null
    ? {
        forecastDensity: [
          { lowYen: day.forecastLowYen, highYen: day.forecastHighYen, probability: 0.8 },
        ],
      }
    : {}),
}));

function renderStatus(overrides: Partial<Parameters<typeof GoalStatusCard>[0]['status']> = {}) {
  return renderToString(
    h(GoalStatusCard, {
      status: {
        budgetYen: 169000,
        p10: 176000,
        p50: 189000,
        p90: 204000,
        probWithin: 0.14,
        days: densityDays,
        spentYen: 111000,
        ...overrides,
      },
      periodLabel: '10/1〜11/5 · 残り21日',
      endLabel: '11月5日',
      remainingDays: 21,
    }),
  );
}

describe('予測の濃淡とその読み方', () => {
  it('濃淡・読み方を加え、見込み・帯の幅・確率・目標線を保つ', () => {
    const markup = renderStatus();
    expect(markup).toContain('data-forecast-density="true"');
    expect(visible(markup)).toContain('同じ日の中で、濃いところほど予測が多い');
    expect(visible(markup)).toContain('約18.9万円');
    expect(visible(markup)).toContain('10回中8回は 17.6万〜20.4万円');
    expect(visible(markup)).toContain('14%');
    expect(markup.indexOf('data-line="budget"')).toBeGreaterThan(
      markup.indexOf('data-forecast-density="true"'),
    );
  });

  it('濃淡の材料がない古い結果は、従来の帯で示す', () => {
    expect(raw).not.toContain('data-forecast-density');
    expect(visible(raw)).not.toContain('濃いところほど');
    expect(raw).toContain('fill="var(--band-outer)"');
    const partial = renderStatus({
      days: densityDays.map((day, i) => (i === 20 ? { ...day, forecastDensity: [] } : day)),
    });
    expect(partial).not.toContain('data-forecast-density');
    expect(visible(partial)).not.toContain('濃いところほど');
  });

  it('記録が少ない予測は、このカードでも目安と分かる', () => {
    const markup = renderStatus({ provisional: true });
    expect(visible(markup)).toContain('記録が少ないため、確率は目安です。');
    expect(renderStatus()).not.toContain('記録が少ないため');
  });
});
