import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InsightsList } from '../../app/(app)/reports/insights-card';
import { LandingRangesCard } from '../../app/(app)/reports/landing-ranges-card';
import { VerificationCard } from '../../app/(app)/reports/verification-card';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('レポートの着地まわりのカード', () => {
  it('ジャンルごとの幅に、範囲・目標・超える確率を文字でも出す(色だけに頼らない)', () => {
    const html = visible(
      renderToString(
        h(LandingRangesCard, {
          periodLabel: '今月',
          rows: [
            {
              genreId: 'dining',
              name: '外食',
              baseYen: 12000,
              p10: 20000,
              p50: 26000,
              p90: 33000,
              targetYen: 25000,
              exceedance: 0.58,
            },
          ],
        }),
      ),
    );
    expect(html).toContain('外食');
    expect(html).toContain('20,000円 〜 33,000円');
    expect(html).toContain('目標 25,000円 を超える確率 58%');
    expect(html).toContain('role="img"');
  });

  it('行が無ければ何も出さない', () => {
    expect(renderToString(h(LandingRangesCard, { periodLabel: '今月', rows: [] }))).toBe('');
  });

  it('検証カード:検証できたときは的中率と補正を、できないときは理由を出す', () => {
    const ok = visible(
      renderToString(
        h(VerificationCard, {
          verification: {
            calibration: { widthFactor: 1.15, sampleSize: 24 },
            summary: { hitRate80: 0.72, medianAbsErrorRatio: 0.11, pointCount: 24 },
          },
        }),
      ),
    );
    expect(ok).toContain('72%');
    expect(ok).toContain('過去24回');
    expect(ok).toContain('1.15倍');
    const none = visible(renderToString(h(VerificationCard, { verification: null })));
    expect(none).toContain('記録がまだ足りない');
  });

  it('気づき:注意のものには▲を付け、叱る言葉は使わない', () => {
    const html = visible(
      renderToString(
        h(InsightsList, {
          insights: [
            { key: 'a', tone: 'caution', text: '予算に収まる確率は35%。' },
            { key: 'b', tone: 'info', text: '予定と固定費で5万円が決まっている。' },
          ],
        }),
      ),
    );
    expect(html).toContain('▲');
    expect(html).not.toMatch(/ダメ|失敗|使いすぎ/);
    expect(renderToString(h(InsightsList, { insights: [] }))).toBe('');
  });
});
