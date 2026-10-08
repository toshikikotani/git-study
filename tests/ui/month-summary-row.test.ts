import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MonthSummaryRow } from '../../app/(app)/reports/month-summary-row';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('今月の収支(設計書 v3 2.2 の3)', () => {
  it('月末の収支の見込みを主にし、今日までの値は小さく添える', () => {
    const html = visible(
      renderToString(
        h(MonthSummaryRow, {
          spentYen: 98645,
          incomeYen: 275000,
          incomeRegistered: true,
          balance: { p10: 44000, p50: 97000, p90: 132000 },
        }),
      ),
    );
    expect(html).toContain('月末の見込み');
    expect(html).toContain('+9.7万円');
    expect(html).toContain('今日まで +176,355円');
  });

  it('見込みが無ければ、今日までの収支と名前で出す', () => {
    const html = visible(
      renderToString(
        h(MonthSummaryRow, { spentYen: 98645, incomeYen: 275000, incomeRegistered: true }),
      ),
    );
    expect(html).toContain('今日までの収支');
    expect(html).not.toContain('月末の収支');
  });
});
