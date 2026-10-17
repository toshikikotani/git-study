import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TodayCard } from '../../app/(app)/_home/today-card';
import { outlookLabel } from '../../app/(app)/_home/today-section';

const visible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '');

describe('ホームの「今日」(デザイン v3-1、ADR-108)', () => {
  it('今日の目安 → 今期の見通し の順。言葉は「目標」にそろえる', () => {
    const text = visible(
      renderToString(
        h(TodayCard, {
          today: { kind: 'left', capYen: 2400, spentYen: 500, leftYen: 1900 },
          outlook: {
            periodLabel: '10/1〜11/5 · 残り21日',
            spentYen: 95000,
            p10: 160000,
            p50: 190000,
            p90: 266000,
            budgetYen: 170000,
          },
          probWithinBudget: 0.25,
          provisional: false,
          tomorrowYen: 1320,
          daysAfterToday: 19,
        }),
      ),
    );
    expect(text).toContain('今日の目安');
    expect(text).toContain('1,900円 使えます');
    expect(text).toContain('使わなかった分は明日に回ります。');
    expect(text).toContain('明日からの目安1日 約1,300円');
    expect(text).toContain('今期の見通し');
    expect(text).toContain('10/1〜11/5 · 残り21日');
    expect(text).toContain('約2.0万円 こえそう');
    expect(text).toContain('約19.0万円');
    expect(text).toContain('/ 目標 17.0万円');
    expect(text).toContain('使った額 9.5万円');
    expect(text).toContain('目標内の確率 25%');
    expect(text).toContain('分析で見る');
    expect(text).not.toContain('予算');
    const order = ['今日の目安', '今期の見通し'].map((s) => text.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('こえた日は「9,389 円 こえています」と、何で多めだったか・明日からの目安を出す(文を途中で切らない)', () => {
    const text = visible(
      renderToString(
        h(TodayCard, {
          today: { kind: 'over', capYen: 1000, spentYen: 10389, overYen: 9389 },
          outlook: null,
          probWithinBudget: 0.01,
          provisional: true,
          tomorrowYen: 1320,
          daysAfterToday: 19,
          todayTopNames: ['同窓会', 'スーパーセルフ熊谷SS'],
        }),
      ),
    );
    expect(text).toContain('今日の目安記録が少ないので仮');
    expect(text).toContain('9,389円 こえています');
    expect(text).toContain(
      '同窓会とスーパーセルフ熊谷SSで、今日は多めの日です。こえた分は残り19日で少しずつならします。',
    );
    expect(text).toContain('明日からの目安');
    expect(text).not.toContain('今日は目安を');
  });

  it('目標が無ければ、決め方を案内する', () => {
    const html = renderToString(
      h(TodayCard, {
        today: null,
        outlook: null,
        probWithinBudget: null,
        provisional: false,
      }),
    );
    expect(visible(html)).toContain('目標(カテゴリごとの額)を決めると、今日使える目安を出せます。');
    expect(html).toContain('href="/reports"');
  });

  it('見通しの名前:暦の1か月なら「10月の見通し」、それ以外は終わりの日まで', () => {
    expect(outlookLabel({ from: '2026-10-01', to: '2026-10-31' })).toBe('10月の見通し');
    expect(outlookLabel({ from: '2026-10-08', to: '2026-10-14' })).toBe('10月14日までの見通し');
  });
});
