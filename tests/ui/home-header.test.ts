import { describe, expect, it } from 'vitest';

import { homeDateLine } from '../../app/(app)/_home/home-header';

describe('ホームの見出し(デザインのホーム)', () => {
  it('日付・曜日と、その月の残りの日数(今日を含む)', () => {
    expect(homeDateLine('2026-10-06')).toBe('10月6日(火) · 10月は残り26日');
    expect(homeDateLine('2026-10-31')).toBe('10月31日(土) · 10月は残り1日');
    expect(homeDateLine('2026-02-01')).toBe('2月1日(日) · 2月は残り28日');
  });
});
