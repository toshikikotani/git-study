import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WhyCard } from '../../app/(app)/reports/why-card';
import type { Forecast } from '@/domain/forecast/types';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

/** 画面の例(10月6日):使った額 90,540円・予定 11,000円・来店 約3,500円・特別費 約5,400円。 */
const forecast = {
  remainingDays: 25,
  visits: {
    expectedYen: 3500,
    merchants: [{ label: 'ファミリーマート', everyDays: 2, probability: 0.9, meanYen: 400 }],
  },
  bills: { expectedYen: 0, items: [] },
  pace: { remainingYen: 92000, perDayYen: 3700, recentPerDayYen: 7400 },
  breakdown: {
    actualYen: 90540,
    committedYen: 11000,
    visitsYen: 3500,
    billsYen: 0,
    unrecordedYen: 0,
    specialYen: 5400,
    variableYen: 83060,
    totalYen: 193500,
    variableByCategory: [
      { categoryId: 'dining', categoryName: '外食', yen: 36000 },
      { categoryId: 'grocery', categoryName: '食料品', yen: 12000 },
      { categoryId: 'transit', categoryName: '交通・車両', yen: 8900 },
      { categoryId: 'conv', categoryName: 'コンビニ', yen: 26160 },
    ],
  },
} as unknown as Forecast;

describe('なぜこの見込み?(わかりやすい言葉で、決まっている額とこれからに分ける)', () => {
  const html = visible(renderToString(h(WhyCard, { forecast, endLabel: '月末' })));

  it('「もう決まっている」と「これから使いそうな額」に分け、足すと見込みになる', () => {
    expect(html).toContain('月末の見込み');
    expect(html).toContain('約19.4万円');
    expect(html).toContain('もう決まっている');
    expect(html).toContain('101,540円');
    expect(html).toContain('これから使いそうな額');
    expect(html).toContain('約9.2万円');
    expect(html).toContain('残り25日・1日 約3,700円');
  });

  it('「残りの変動費」ではなく、ふだんの買い物として、ジャンルと1日あたりで出す', () => {
    expect(html).not.toContain('残りの変動費');
    expect(html).toContain('ふだんの買い物 約8.3万円');
    expect(html).toContain('外食');
    expect(html).toContain('1日 約1,400円');
    expect(html).toContain('そのほか');
  });

  it('来店・特別費も、ふだんの言葉で出どころを添える', () => {
    expect(html).toContain('いつも通う店');
    expect(html).toContain('ファミリーマートなど');
    expect(html).toContain('大きめの出費');
    expect(html).not.toContain('平均の比');
  });

  it('直近のペースと、この先のペースを並べる', () => {
    expect(html).toContain('直近2週間は1日 約7,400円、この先は1日 約3,700円で見ています');
  });
});
