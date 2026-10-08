import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InsightsList } from '../../app/(app)/reports/insights-card';
import { LandingRangesCard } from '../../app/(app)/reports/landing-ranges-card';
import { VerificationCard } from '../../app/(app)/reports/verification-card';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('レポートの着地まわりのカード', () => {
  const base = {
    excludedYen: 0,
    type: 'steady' as const,
    group: 'changeable' as const,
    caution: null,
    cutPerWeekYen: null,
  };

  it('変えられる支出:範囲・目標・超える見込みを文字でも出し、注意は形と文字で', () => {
    const html = visible(
      renderToString(
        h(LandingRangesCard, {
          periodLabel: '今月',
          rows: [
            {
              ...base,
              genreId: 'dining',
              name: '外食',
              baseYen: 12000,
              p10: 33000,
              p50: 50000,
              p90: 80000,
              targetYen: 42000,
              exceedance: 0.7,
              status: 'forecast',
              caution: {
                categoryId: 'dining',
                kind: 'likely',
                overshootYen: 8800,
                probability: 0.7,
              },
              cutPerWeekYen: 6200,
            },
          ],
        }),
      ),
    );
    // デザインの「見通し」のジャンル別(ADR-085):見込み / 目標、超える確率と1行の提案。
    expect(html).toContain('ジャンル別');
    expect(html).toContain('約5.0万円');
    expect(html).toContain('/ 目標 4.2万円');
    expect(html).toContain('70%の確率で 目標を超えます · 週1回へらすと約6,200円減');
    expect(html).toContain('変えられる支出');
    expect(html).not.toContain('決まった支出');
    // 読み上げ(3.10)。
    expect(html).toContain(
      'aria-label="外食、月末の見込み約5.0万円、10回中8回は3.3万〜8.0万円、目標4.2万円を超える見込み 10回中7回"',
    );
    // 行を開くと「なぜ」。
    expect(html).toContain('<details');
    expect(html).toContain('この先の見込み(中央)');
    expect(html).toContain('>目標<');
    expect(html).toContain('塗った帯は使った額');
  });

  it('決まった支出は1行に畳み、見込みの無いジャンルは言葉で出す', () => {
    const html = visible(
      renderToString(
        h(LandingRangesCard, {
          periodLabel: '今月',
          rows: [
            {
              ...base,
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
              group: 'fixed',
            },
            {
              ...base,
              genreId: 'tax',
              name: '保険・税金・手数料',
              baseYen: 32000,
              p10: 32000,
              p50: 32000,
              p90: 32000,
              targetYen: 30000,
              exceedance: 1,
              status: 'closed',
              type: 'fixed',
              group: 'fixed',
              caution: { categoryId: 'tax', kind: 'over', overshootYen: 2000, probability: 1 },
            },
          ],
        }),
      ),
    );
    expect(html).toContain('保険・税金・手数料');
    expect(html).toContain('確定(この先の見込みなし)');
    expect(html).toContain('うち 3,000円 は特別費だった記録(今は目標に含む)');
    expect(html).toContain('予測を止めています');
    // 赤は、決まっている額だけで超えたときだけ(形と文字も付ける)。
    expect(html).toContain('決まっている額だけで、目標を2,000円超えています');
    expect(html).toContain('var(--state-over)');
    expect(html).not.toContain('36,940円〜36,940円');
  });

  it('「これ以上は使わない」のジャンルは、守れたら・いつもの守り方なら の2つを出す(設計書 v3 4.7)', () => {
    const html = visible(
      renderToString(
        h(LandingRangesCard, {
          periodLabel: '今月',
          rows: [
            {
              ...base,
              genreId: 'hobby',
              name: '娯楽・趣味',
              baseYen: 33940,
              p10: 33940,
              p50: 36000,
              p90: 40000,
              targetYen: null,
              exceedance: null,
              status: 'closed',
              type: 'fixed',
              group: 'fixed',
            },
          ],
        }),
      ),
    );
    expect(html).toContain('予測を止めています');
    expect(html).toContain('守れたら 33,940円、いつもの守り方なら 約3.6万円');
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
            genreLevelK: null,
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
    const none = visible(
      renderToString(h(VerificationCard, { verification: null, monthStart: '2026-10-01' })),
    );
    // 設計書 v3 3.8:いつ出せるかを言う。
    expect(none).toContain('10月が終わると、予測が当たったかを出せます');
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
