import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WhatIfCard } from '../../app/(app)/spending/category/[genreKey]/what-if-card';
import type { CategoryWhatIfView } from '@/features/forecast/what-if';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

const view: CategoryWhatIfView = {
  categoryName: '外食',
  perVisitYen: 3100,
  weeks: 3.7,
  targetYen: 41500,
  budgetYen: 170000,
  balanceP50: 97000,
  provisional: true,
  options: [
    {
      perWeek: 0,
      landing: { p10: 38000, p50: 50300, p90: 64000 },
      exceedance: 0.72,
      probWithinBudget: 0.41,
      savedYen: 0,
    },
    {
      perWeek: 1,
      landing: { p10: 30000, p50: 39000, p90: 52000 },
      exceedance: 0.38,
      probWithinBudget: 0.52,
      savedYen: 11300,
    },
    {
      perWeek: 2,
      landing: { p10: 24000, p50: 28000, p90: 40000 },
      exceedance: 0.08,
      probWithinBudget: 0.63,
      savedYen: 22600,
    },
  ],
};

describe('ジャンル画面の「もし、へらしたら」', () => {
  it('いつも通りの数字で、選択肢・目標を超える回数・予算に収まる回数・収支を出す', () => {
    const html = visible(renderToString(h(WhatIfCard, { view })));
    expect(html).toContain('もし、外食をへらしたら');
    expect(html).toContain('目安');
    for (const label of ['いつも通り', '週1回へらす', '週2回へらす']) expect(html).toContain(label);
    expect(html).toContain('約5.0万円');
    expect(html).toContain('10回中8回は 3.8万〜6.4万円');
    expect(html).toContain('目標を 約8,800円超えそう');
    expect(html).toContain('外食が目標を超える');
    expect(html).toContain('10回中7回');
    expect(html).toContain('全体で予算に収まる');
    expect(html).toContain('10回中4回');
    expect(html).toContain('+9.7万円');
    expect(html).toContain('1回 約3,100円 × 残り約3.7週で計算した目安です。');
    // 選択肢はラジオ(押せる大きさ)で、いつも通りが選ばれている
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*class="min-h-11/);
  });

  it('統計の言葉は使わない', () => {
    const html = visible(renderToString(h(WhatIfCard, { view })));
    for (const word of ['確率分布', '分位', '信頼区間', '標準偏差', 'パーセンタイル']) {
      expect(html).not.toContain(word);
    }
  });

  it('予算・収入・目標が無ければ、その行は出さない', () => {
    const html = visible(
      renderToString(
        h(WhatIfCard, {
          view: {
            ...view,
            targetYen: null,
            budgetYen: null,
            balanceP50: null,
            provisional: false,
            options: view.options.map((o) => ({ ...o, exceedance: null, probWithinBudget: null })),
          },
        }),
      ),
    );
    expect(html).not.toContain('目標を超える');
    expect(html).not.toContain('予算に収まる');
    expect(html).not.toContain('月末の収支');
    expect(html).not.toContain('目安</span>');
  });
});
