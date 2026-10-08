import { describe, expect, it } from 'vitest';

import { homeDateLine } from '../../app/(app)/_home/date-line';

describe('ホームの見出し(デザインのホーム)', () => {
  it('日付・曜日と、その月の残りの日数(今日を含む)', () => {
    expect(homeDateLine('2026-10-08')).toBe('10月8日 木曜日 · 残り24日');
    expect(homeDateLine('2026-10-31')).toBe('10月31日 土曜日 · 残り1日');
    expect(homeDateLine('2026-02-01')).toBe('2月1日 日曜日 · 残り28日');
  });
});
