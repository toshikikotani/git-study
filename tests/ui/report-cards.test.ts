import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VerificationCard } from '../../app/(app)/reports/verification-card';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('レポートの着地まわりのカード', () => {
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
});
