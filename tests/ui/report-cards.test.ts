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
              excludedYen: 0,
              status: 'forecast',
            },
            {
              genreId: 'hobby',
              name: '娯楽・趣味',
              baseYen: 36940,
              p10: 36940,
              p50: 36940,
              p90: 36940,
              targetYen: 42940,
              exceedance: 0,
              excludedYen: 3000,
              status: 'settled',
            },
            {
              genreId: 'tax',
              name: '保険・税金・手数料',
              baseYen: 32000,
              p10: 32000,
              p50: 32000,
              p90: 32000,
              targetYen: 35700,
              exceedance: 0,
              excludedYen: 0,
              status: 'closed',
            },
          ],
        }),
      ),
    );
    expect(html).toContain('外食');
    // 見込みは幅より細かく出さない(1万円以上は千円単位)。
    expect(html).toContain('約2.6万円');
    expect(html).toContain('2.0万〜3.3万円');
    expect(html).toContain('目標 25,000円 を超える確率 58%');
    expect(html).toContain('role="img"');
    // 目印の凡例(点=中央、「目標」の目盛り)。
    expect(html).toContain('点は中央');
    expect(html).toContain('>目標<');
    // 見込みの無いジャンルは、幅ではなく言葉で。範囲から外した額は行で出す。
    expect(html).toContain('確定(この先の見込みなし)');
    expect(html).toContain('うち 3,000円 は目標の対象外');
    expect(html).toContain('予測を止めています');
    expect(html).not.toContain('36,940円〜36,940円');
  });

  it('行が無ければ何も出さない', () => {
    expect(renderToString(h(LandingRangesCard, { periodLabel: '今月', rows: [] }))).toBe('');
  });

  it('検証カード:検証できたときは的中率と補正を、できないときは理由を出す', () => {
    const ok = visible(
      renderToString(
        h(VerificationCard, {
          verification: {
            calibration: null,
            halfLifeDays: 90,
            monthLevelK: 8,
            summary: {
              hitRate80: 0.72,
              medianAbsErrorRatio: 0.11,
              pointCount: 24,
              months: 2,
              calibratedHitRate80: 0.79,
              calibratedBias: -0.01,
            },
          },
        }),
      ),
    );
    expect(ok).toContain('79%');
    expect(ok).toContain('過去2か月・24');
    expect(ok).toContain('補正の前は72%');
    expect(ok).toContain('目安');
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
