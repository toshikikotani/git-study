import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TodayCard } from '../../app/(app)/_home/today-card';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('ホームの今日あと使える額(設計書 v3 3.1)', () => {
  it('今日あと使える額 → 月末の収支 → 予算に収まる → 次の一手 の順で、デザインのカードに分けて出す', () => {
    const html = visible(
      renderToString(
        h(TodayCard, {
          dateLine: '10月6日(火) · 10月は残り26日',
          today: { kind: 'left', capYen: 2400, spentYen: 300, leftYen: 2100 },
          balance: { p10: 44000, p50: 97000, p90: 132000, incomeYen: 275000 },
          suggestion: {
            categoryId: 'dining',
            categoryName: '外食',
            perWeek: 1,
            savedYen: 9000,
            probBefore: 0.41,
            probAfter: 0.55,
          },
          probWithinBudget: 0.41,
          provisional: false,
          budget: { yen: 169598, landingP50: 178000, expectedOvershoot: 36000 },
          monthKey: '2026-10',
        }),
      ),
    );
    expect(html).toContain('10月6日(火) · 10月は残り26日');
    expect(html).toContain('今日の家計');
    expect(html).toContain('今日 あと使える');
    expect(html).toContain('2,100円');
    expect(html).toContain('毎日この額までなら、月末に予算に収まる');
    expect(html).toContain('1日の上限 2,400円');
    // 月末の収支:中央を大きく、幅と内訳
    expect(html).toContain('+9.7');
    expect(html).toContain('+4.4万');
    expect(html).toContain('+13.2万');
    expect(html).toContain('10回中8回は、この幅に入る');
    expect(html).toContain('収入 27.5万 − 支出の見込み 17.8万');
    // 予算に収まる:回数と点、このままだと
    expect(html).toContain('予算 17.0万円に収まる');
    expect(html).toContain('10回中4回');
    expect(html).toContain('このままだと月末は約17.8万円。超えるときは、平均で約3.6万円超える。');
    // 次の一手
    expect(html).toContain('外食を週1回へらすと');
    expect(html).toContain('外食で試してみる');
    expect(html).toContain('href="/spending/category/dining?month=2026-10"');
    const order = ['2,100円', '月末の収支の見込み', '予算 17.0万円に収まる', '次の一手'].map((t) =>
      html.indexOf(t),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('音で聞く');
  });

  it('上限を超えたら、超えた額を文字で(色だけにしない)', () => {
    const html = visible(
      renderToString(
        h(TodayCard, {
          today: { kind: 'over', capYen: 2400, spentYen: 3000, overYen: 600 },
          balance: null,
          suggestion: null,
          probWithinBudget: 0.3,
          provisional: true,
        }),
      ),
    );
    expect(html).toContain('今日は上限を');
    expect(html).toContain('600円 超え');
    expect(html).toContain('目安');
  });

  it('目標が無ければ、決め方を案内する', () => {
    const html = visible(
      renderToString(
        h(TodayCard, {
          today: null,
          balance: null,
          suggestion: null,
          probWithinBudget: null,
          provisional: false,
        }),
      ),
    );
    expect(html).toContain('目標(ジャンルごとの予算)を決めると');
    expect(html).toContain('href="/plan"');
  });
});
