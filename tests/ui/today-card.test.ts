import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TodayCard } from '../../app/(app)/_home/today-card';
import { outlookLabel } from '../../app/(app)/_home/today-section';

const visible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '');

describe('ホームの「今日」(デザイン、ADR-085)', () => {
  it('今日使える額 → 見通し → 次の一手 の順に出す', () => {
    const text = visible(
      renderToString(
        h(TodayCard, {
          today: { kind: 'left', capYen: 2400, spentYen: 500, leftYen: 1900 },
          outlook: {
            label: '10月の見通し',
            spentYen: 95000,
            p10: 160000,
            p50: 190000,
            p90: 266000,
            budgetYen: 170000,
          },
          suggestion: {
            categoryId: 'dining',
            categoryName: '外食',
            perWeek: 1,
            savedYen: 6600,
            probBefore: 0.25,
            probAfter: 0.4,
          },
          probWithinBudget: 0.25,
          provisional: false,
          monthKey: '2026-10',
        }),
      ),
    );
    expect(text).toContain('今日 使えるのは');
    expect(text).toContain('1,900円');
    expect(text).toContain('毎日この額までなら、80%の確率で予算内に収まります。');
    expect(text).toContain('使わなかった分は、明日に回ります。');
    expect(text).toContain('10月の見通し');
    expect(text).toContain('約2.0万円 超えそう');
    expect(text).toContain('約19.0万円');
    expect(text).toContain('/ 予算 17.0万円');
    expect(text).toContain('75%の確率で 予算を超えます');
    expect(text).toContain('外食を週1回へらすと');
    const order = ['今日 使えるのは', '10月の見通し', '次の一手'].map((s) => text.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('上限を超えたら、超えた額を文字で(色だけにしない)', () => {
    const text = visible(
      renderToString(
        h(TodayCard, {
          today: { kind: 'over', capYen: 2400, spentYen: 3000, overYen: 600 },
          outlook: null,
          suggestion: null,
          probWithinBudget: 0.3,
          provisional: true,
        }),
      ),
    );
    expect(text).toContain('今日は上限を');
    expect(text).toContain('600円 超え');
    expect(text).toContain('目安');
  });

  it('目標が無ければ、決め方を案内する', () => {
    const html = renderToString(
      h(TodayCard, {
        today: null,
        outlook: null,
        suggestion: null,
        probWithinBudget: null,
        provisional: false,
      }),
    );
    expect(visible(html)).toContain('目標(ジャンルごとの予算)を決めると');
    expect(html).toContain('href="/plan"');
  });

  it('見通しの名前:暦の1か月なら「10月の見通し」、それ以外は終わりの日まで', () => {
    expect(outlookLabel({ from: '2026-10-01', to: '2026-10-31' })).toBe('10月の見通し');
    expect(outlookLabel({ from: '2026-10-08', to: '2026-10-14' })).toBe('10月14日までの見通し');
  });
});
