import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NextStepCard } from '../../app/(app)/reports/next-step-card';
import { formatAxisYen } from '@/features/category/chart-layout';

const visible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '');

describe('次の一手とグラフの金額(デザイン仕様書)', () => {
  const suggestion = {
    categoryId: 'dining',
    categoryName: '外食',
    perWeek: 1,
    savedYen: 5100,
    probBefore: 0.41,
    probAfter: 0.52,
  };

  it('今日の次の一手:へらすと月末の支出がどれだけ減るかと、確率の変わり方。押すとカテゴリ(⑦)', () => {
    const html = visible(renderToString(h(NextStepCard, { suggestion })));
    expect(html).toContain('次の一手');
    expect(html).toContain('外食を週1回へらす');
    expect(html).toContain('月末の支出が約5,100円へり、目標内の確率は41% → 52%に。');
    expect(html).toContain('外食の見通しを見る');
    // 画面を移らずシートを開くので、リンクではなくボタン
    expect(renderToString(h(NextStepCard, { suggestion }))).not.toContain('href=');
  });

  it('分析 › 目標の「いちばん効く一手」', () => {
    const html = visible(renderToString(h(NextStepCard, { suggestion, variant: 'goal' })));
    expect(html).toContain('いちばん効く一手');
    expect(html).toContain('月末の支出が約5,100円へり、目標内の確率も上がります。');
    expect(html).toContain('外食をひらく');
  });

  it('グラフの右端の金額は、万円なら小数1桁まで(本文の「17.0万円」とそろえる)', () => {
    expect(formatAxisYen(220800)).toBe('22.1万');
    expect(formatAxisYen(169598)).toBe('17.0万');
    expect(formatAxisYen(200000)).toBe('20万');
    expect(formatAxisYen(3800)).toBe('3,800');
  });
});
