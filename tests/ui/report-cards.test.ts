import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InsightsList } from '../../app/(app)/reports/insights-card';
import { BudgetCategoryGroups } from '../../app/(app)/plan/category-groups';
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

  const row = (over: Record<string, unknown>) => ({
    ...base,
    genreId: 'dining',
    name: '外食',
    baseYen: 22752,
    p10: 35000,
    p50: 45000,
    p90: 63000,
    targetYen: 42500,
    exceedance: 0.7,
    status: 'forecast' as const,
    ...over,
  });

  it('予算のカテゴリ:超えた → 超えそう → 予算内(畳む)の順に、見込み / 予算と80%の幅を出す', () => {
    const html = visible(
      renderToString(
        h(BudgetCategoryGroups, {
          monthKey: '2026-10',
          rows: [
            row({}),
            row({
              genreId: 'daily',
              name: '日用品',
              baseYen: 1878,
              p10: 2200,
              p50: 5500,
              p90: 25000,
              targetYen: 916,
            }),
            row({
              genreId: 'liquor',
              name: '酒',
              baseYen: 1175,
              p10: 1400,
              p50: 2400,
              p90: 5000,
              targetYen: 2600,
            }),
          ],
        }),
      ),
    );
    expect(html).toContain('カテゴリ');
    expect(html.indexOf('超えた')).toBeLessThan(html.indexOf('超えそう'));
    expect(html.indexOf('超えそう')).toBeLessThan(html.indexOf('予算内'));
    expect(html).toContain('約4.5万円');
    expect(html).toContain('/ 42,500円');
    expect(html).toContain('使った額 22,752円 · 80%の確率で 3.5万〜6.3万円');
    // 予算内は畳んで、名前だけ先に見せる
    expect(html).toMatch(/<details[^>]*>.*予算内.*酒.*表示/s);
    // 行を押すと、そのカテゴリの詳細へ
    expect(html).toContain('href="/spending/category/dining?month=2026-10"');
    expect(html).toContain('aria-label="外食、見込み約4.5万円、予算42,500円。');
  });

  it('予測を止めた・確定したカテゴリは、言葉で出す', () => {
    const html = visible(
      renderToString(
        h(BudgetCategoryGroups, {
          monthKey: '2026-10',
          rows: [
            row({ genreId: 'hobby', name: '娯楽・趣味', status: 'closed', p50: 33940, p90: 33940 }),
            row({
              genreId: 'tax',
              name: '税金',
              status: 'settled',
              baseYen: 32000,
              p10: 32000,
              p50: 32000,
              p90: 32000,
              targetYen: null,
            }),
          ],
        }),
      ),
    );
    expect(html).toContain('予測を止めています');
    expect(html).toContain('確定(この先の見込みなし)');
    expect(html).toContain('予算なし');
  });

  it('行が無ければ何も出さない', () => {
    expect(renderToString(h(BudgetCategoryGroups, { monthKey: '2026-10', rows: [] }))).toBe('');
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
