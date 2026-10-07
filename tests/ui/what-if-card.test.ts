import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WhatIfCard } from '../../app/(app)/spending/category/[genreKey]/what-if-card';
import type { CategoryWhatIfView } from '@/features/forecast/what-if';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

const view: CategoryWhatIfView = {
  genreId: 'dining',
  categoryName: '外食',
  promise: null,
  spentThisMonthYen: 16019,
  spentYen: 16019,
  scheduledYen: 5000,
  lastMonth: null,
  stop: {
    keepRate: 0.6,
    kept: {
      perWeek: 0,
      landing: { p10: 21019, p50: 21019, p90: 21019 },
      exceedance: 0,
      probWithinBudget: 0.72,
      savedYen: 29000,
    },
    usual: {
      perWeek: 0,
      landing: { p10: 26000, p50: 33000, p90: 41000 },
      exceedance: 0.1,
      probWithinBudget: 0.58,
      savedYen: 17000,
    },
  },
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
    expect(html).toContain('5.0</span><span class="text-xl font-semibold">万円');
    // 上のカード:使った・予定・自由に使える残り(目標 − 使った − 予定)
    expect(html).toContain('使った');
    expect(html).toContain('16,019円');
    expect(html).toContain('5,000円');
    expect(html).toContain('自由に使える残り');
    expect(html).toContain('20,481円');
    expect(html).toContain('10回中8回は 3.8万〜6.4万円');
    expect(html).toContain('このままだと 約8,800円オーバー');
    expect(html).toContain('外食が目標を超える');
    expect(html).toContain('10回中7回');
    expect(html).toContain('全体で予算に収まる');
    expect(html).toContain('10回中4回');
    expect(html).toContain('+9.7万円');
    expect(html).toContain('1回 約3,100円 × 月末まで約3.7週で計算した目安です。');
    // 選択肢はラジオ(押せる大きさ)で、いつも通りが選ばれている
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*class="min-h-11/);
  });

  it('約束が無ければ、選んだ選択肢で「決める」。いつも通りを選んでいる間はボタンを出さない', () => {
    const html = visible(renderToString(h(WhatIfCard, { view })));
    expect(html).not.toContain('と決める');
    expect(html).not.toContain('約束を見込みに入れています');
  });

  it('約束があれば、その選択肢を選んだ状態で、今月の使った額と約束どおりの額を出す', () => {
    const html = visible(
      renderToString(
        h(WhatIfCard, {
          view: {
            ...view,
            promise: {
              genreId: 'dining',
              month: '2026-10-01',
              perWeek: 1,
              promisedOn: '2026-10-06',
              usualYen: 50300,
              limitYen: 39000,
            },
          },
        }),
      ),
    );
    expect(html).toContain('週1回へらす約束を見込みに入れています(10/6から)');
    expect(html).toContain('今月の外食:使った 16,019円 / 約束どおりなら 約3.9万円まで');
    expect(html).toMatch(/aria-checked="true"[^>]*>週1回へらす/);
    // 選んでいるのが今の約束なので、ボタンは出さない
    expect(html).not.toContain('約束をやめる');
  });

  it('先月の約束が守れたかを、使った額と約束どおりの額で出す', () => {
    const lastPromise = {
      genreId: 'dining',
      month: '2026-09-01',
      perWeek: 2,
      promisedOn: '2026-09-10',
      usualYen: 48000,
      limitYen: 36000,
    };
    const kept = visible(
      renderToString(
        h(WhatIfCard, {
          view: { ...view, lastMonth: { promise: lastPromise, spentYen: 35200, kept: true } },
        }),
      ),
    );
    expect(kept).toContain('先月の約束(週2回へらす):');
    expect(kept).toContain('守れました');
    expect(kept).toContain('使った 35,200円 / 約束どおりなら 約3.6万円まで');
    const missed = visible(
      renderToString(
        h(WhatIfCard, {
          view: { ...view, lastMonth: { promise: lastPromise, spentYen: 41000, kept: false } },
        }),
      ),
    );
    expect(missed).toContain('守れませんでした');
  });

  it('これ以上は使わない:守れたときと、いつもの守り方の2つの見込みを並べて「決める」', () => {
    const html = visible(renderToString(h(WhatIfCard, { view })));
    expect(html).toContain('これ以上は使わない');
    expect(html).toContain('「守れたとき」と「いつもの守り方」の2つの見込みを出します');
    expect(html).toContain('外食を月末まで使わなかったら');
    expect(html).toContain('約2.1万円');
    expect(html).toContain('予算に収まる 10回中7回');
    expect(html).toContain('いつもの守り方なら');
    expect(html).toContain('約3.3万円');
    expect(html).toContain('これまでの約束は10回中6回守れた、として見込む');
    expect(html).toContain('>決める<');
  });

  it('これ以上は使わないと決めてあれば、約束中と出し、やめられる。上の選択肢は約束中にしない', () => {
    const html = visible(
      renderToString(
        h(WhatIfCard, {
          view: {
            ...view,
            promise: {
              genreId: 'dining',
              month: '2026-10-01',
              perWeek: 0,
              promisedOn: '2026-10-07',
              usualYen: 50300,
              limitYen: 21019,
            },
          },
        }),
      ),
    );
    expect(html).toContain('これ以上は使わない約束を見込みに入れています(10/7から)');
    expect(html).toContain('>やめる<');
    expect(html).not.toContain('(約束中)');
    expect(html).not.toContain('いつも通り約束');
    // いつも通りを選んでいる状態では、上の試算から約束をやめられる
    expect(html).toContain('約束をやめる(いつも通りに戻す)');
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
            stop: {
              ...view.stop,
              kept: { ...view.stop.kept, exceedance: null, probWithinBudget: null },
              usual: { ...view.stop.usual, exceedance: null, probWithinBudget: null },
            },
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
