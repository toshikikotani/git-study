import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LandingHero, NextStepCard } from '../../app/(app)/reports/landing-hero';
import { formatAxisYen } from '@/features/category/chart-layout';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('月末の見込みの見出し(デザインの「月末の支出」)', () => {
  it('中央を大きく、予算との差・10回中8回の幅・予算に収まる回数を出す。予算は「17.0万円」の形', () => {
    const html = visible(
      renderToString(
        h(LandingHero, {
          endLabel: '月末',
          landing: { p10: 143000, p50: 178000, p90: 231000 },
          budgetYen: 169598,
          probWithinBudget: 0.41,
          provisional: true,
        }),
      ),
    );
    expect(html).toContain('月末の支出');
    expect(html).toContain('目安');
    expect(html).toContain('17.8');
    expect(html).toContain('万円');
    expect(html).toContain('予算 17.0万円を 約8,400円超えそう');
    expect(html).toContain('10回中8回は 14.3万〜23.1万円');
    expect(html).toContain('予算に収まる');
    expect(html).toContain('10回中4回');
    expect(html.match(/data-dot="on"/g)).toHaveLength(4);
    expect(html.match(/data-dot="off"/g)).toHaveLength(6);
    expect(html).not.toContain('169,598');
  });

  it('予算に収まりそうなら余裕を、予算が無ければ予算の行を出さない', () => {
    const under = visible(
      renderToString(
        h(LandingHero, {
          endLabel: '月末',
          landing: { p10: 120000, p50: 150000, p90: 180000 },
          budgetYen: 170000,
          probWithinBudget: 0.8,
          provisional: false,
        }),
      ),
    );
    expect(under).toContain('予算 17.0万円まで 約2.0万円の余裕');
    expect(under).not.toContain('目安');
    const none = visible(
      renderToString(
        h(LandingHero, {
          endLabel: '月末',
          landing: { p10: 120000, p50: 150000, p90: 180000 },
          budgetYen: null,
          probWithinBudget: null,
          provisional: false,
        }),
      ),
    );
    expect(none).not.toContain('予算');
  });

  it('次の一手:提案と、そのジャンルの「もし」への入口', () => {
    const html = visible(
      renderToString(
        h(NextStepCard, {
          suggestion: {
            categoryId: 'dining',
            categoryName: '外食',
            perWeek: 1,
            savedYen: 5100,
            probBefore: 0.41,
            probAfter: 0.52,
          },
          monthKey: '2026-10',
        }),
      ),
    );
    expect(html).toContain('次の一手');
    expect(html).toContain('外食を週1回へらすと');
    expect(html).toContain('予算に収まる 10回中4回 → ');
    expect(html).toContain('5回');
    expect(html).toContain('外食で試してみる');
    expect(html).toContain('href="/spending/category/dining?month=2026-10"');
  });

  it('グラフの右端の金額は、万円なら小数1桁まで(本文の「17.0万円」とそろえる)', () => {
    expect(formatAxisYen(220800)).toBe('22.1万');
    expect(formatAxisYen(169598)).toBe('17.0万');
    expect(formatAxisYen(200000)).toBe('20万');
    expect(formatAxisYen(3800)).toBe('3,800');
  });
});
