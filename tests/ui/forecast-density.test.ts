import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { pathDensity } from '@/domain/forecast/path-density';
import { ForecastDensity } from '../../app/(app)/reports/forecast-density';

const render = (rows: Parameters<typeof ForecastDensity>[0]['rows']) =>
  renderToStaticMarkup(
    h(
      'svg',
      null,
      h(ForecastDensity, { rows, x: (i) => i * 20, y: (v) => v, origin: { x: 0, yen: 0 } }),
    ),
  );

function paths(markup: string) {
  return [...markup.matchAll(/<path\b([^>]+)>/g)].map((match) =>
    Object.fromEntries([...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])),
  );
}

describe('累計の予測の濃淡', () => {
  it('中央値を濃くせず、離れた2つの山と間の空白を描く', () => {
    const forecastDensity = pathDensity(
      {
        amounts: [...Array(40).fill(110), ...Array(20).fill(150), ...Array(40).fill(190)],
        calibration: null,
      },
      { lowYen: 100, highYen: 200, bins: 10 },
    );
    const markup = render([{ date: '2026-10-20', index: 1, forecastDensity }]);
    const ribbons = paths(markup);
    const strengthAt = (low: number) =>
      Number(
        ribbons.find((ribbon) => Number(ribbon['data-density-low']) === low)![
          'data-density-strength'
        ],
      );
    expect(strengthAt(110)).toBe(1);
    expect(strengthAt(190)).toBe(1);
    expect(strengthAt(150)).toBeCloseTo(0.5);
    expect(strengthAt(130)).toBe(0);
    const empty = ribbons.find((ribbon) => Number(ribbon['data-density-low']) === 130)!;
    const id = empty.fill!.slice(5, -1);
    const gradient = markup.match(
      new RegExp(`<linearGradient[^>]+id="${id}"[\\s\\S]*?</linearGradient>`),
    )![0];
    expect(gradient.match(/stop-opacity="0"/g)).toHaveLength(2);
  });

  it('日によって区間数が違っても、金額幅を重ねて濃くしない', () => {
    const markup = render([
      {
        date: '2026-10-20',
        index: 1,
        forecastDensity: pathDensity(
          { amounts: [1, 2], calibration: null },
          { lowYen: 0, highYen: 2, bins: 2 },
        ),
      },
      {
        date: '2026-10-21',
        index: 2,
        forecastDensity: pathDensity(
          { amounts: [1, 2, 3], calibration: null },
          { lowYen: 0, highYen: 3, bins: 3 },
        ),
      },
    ]);
    const ribbons = paths(markup).filter((ribbon) => ribbon['data-density-date'] === '2026-10-21');
    const intervals = ribbons.map((ribbon) => {
      const points = [...ribbon.d!.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map((m) => [
        Number(m[1]),
        Number(m[2]),
      ]);
      return {
        beforeLow: points[0]![1]!,
        beforeHigh: points[3]![1]!,
        low: points[1]![1]!,
        high: points[2]![1]!,
      };
    });
    expect(intervals).toHaveLength(4);
    expect(intervals[0]!.beforeLow).toBe(0);
    expect(intervals.at(-1)!.beforeHigh).toBe(2);
    expect(intervals[0]!.low).toBe(0);
    expect(intervals.at(-1)!.high).toBe(3);
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i]!.beforeLow).toBeCloseTo(intervals[i - 1]!.beforeHigh);
      expect(intervals[i]!.low).toBeCloseTo(intervals[i - 1]!.high);
    }
  });

  it('全試行が同額のときは、偽の幅を作らず線にする', () => {
    const markup = render([
      {
        date: '2026-10-20',
        index: 1,
        forecastDensity: [{ lowYen: 0, highYen: 0, probability: 1 }],
      },
    ]);
    const ribbon = paths(markup)[0]!;
    expect(ribbon.fill).toBe('none');
    expect(ribbon.stroke).toMatch(/^url\(#/);
    expect(ribbon.d).toBe('M0,0 L20,0');
    expect(markup).toContain('stop-opacity="0.7"');
  });

  it('複数のグラフを表示してもグラデーションの参照が衝突しない', () => {
    const props = {
      rows: [
        {
          date: '2026-10-20',
          index: 1,
          forecastDensity: [{ lowYen: 1, highYen: 2, probability: 1 }],
        },
      ],
      x: (i: number) => i,
      y: (v: number) => v,
      origin: { x: 0, yen: 0 },
    };
    const markup = renderToStaticMarkup(
      h('svg', null, h(ForecastDensity, props), h(ForecastDensity, props)),
    );
    const ids = [...markup.matchAll(/<linearGradient[^>]+id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(markup).toContain(`url(#${id})`);
  });
});
