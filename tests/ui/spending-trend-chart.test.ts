import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { addDays, todayJst } from '@/lib/date';
import { SpendingTrendChart } from '../../app/(app)/reports/spending-trend-chart';

const visible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ');

describe('最近の支出の勢い:今日の棒から除いた固定費を書く(ADR-102)', () => {
  const today = todayJst();
  const daySpend = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [addDays(today, -i), 1000 + i * 10]),
  );
  const render = (todayFixed: { yen: number; names: string[] } | null) =>
    visible(
      renderToString(
        h(SpendingTrendChart, { daySpend, from: addDays(today, -15), to: today, todayFixed }),
      ),
    );

  it('今日の支出から固定費として除いた額と、その元(カテゴリ)を出す', () => {
    const text = render({ yen: 2000, names: ['娯楽・趣味'] });
    expect(text).toContain('今日の支出のうち');
    expect(text).toContain('2,000円');
    expect(text).toContain('（娯楽・趣味）は固定費として、今日の棒に入れていません');
  });

  it('除いたものが無ければ出さない', () => {
    expect(render(null)).not.toContain('今日の支出のうち');
  });
});

describe('記録するの「固定費にする」は、その記録だけを固定費にする(ADR-102)', () => {
  const src = readFileSync('app/(app)/record-sheet.tsx', 'utf8');

  it('カテゴリ全体を固定費にする confirmFixedCostAction を使わない', () => {
    expect(src).not.toContain('confirmFixedCostAction');
    expect(src).toContain('markRecordFixedAction(');
  });

  it('記録だけを固定費(must_pay)にし、カテゴリの予測は止めない', () => {
    const actions = readFileSync('app/(app)/reports/fixed-cost-actions.ts', 'utf8');
    const body = actions.slice(actions.indexOf('export async function markRecordFixedAction'));
    expect(body).toContain('must_pay: true');
    expect(body).not.toContain('setGenreForecastClosed');
  });
});
