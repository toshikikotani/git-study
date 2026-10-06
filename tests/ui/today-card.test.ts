import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TodayCard } from '../../app/(app)/_home/today-card';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('ホームの今日あと使える額(設計書 v3 3.1)', () => {
  it('今日あと使える額 → 月末の収支 → 収まる見込み → 提案 の順で出す', () => {
    const html = visible(
      renderToString(
        h(TodayCard, {
          today: { kind: 'left', capYen: 2400, spentYen: 300, leftYen: 2100 },
          balance: { p10: 44000, p50: 97000, p90: 132000 },
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
        }),
      ),
    );
    expect(html).toContain('今日 あと');
    expect(html).toContain('2,100円');
    expect(html).toContain('1日の上限 2,400円');
    expect(html).toContain('+9.7万円');
    expect(html).toContain('10回中8回 4.4万〜13.2万円');
    expect(html).toContain('10回中4回');
    expect(html).toContain('外食を週1回減らすと、収まる確率 41% → 55%');
    const order = ['2,100円', '月末の収支の見込み', '予算に収まる見込み', '外食を週1回'].map((t) =>
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
