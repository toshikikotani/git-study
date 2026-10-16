import { describe, expect, it } from 'vitest';

import { homeDateLine } from '../../app/(app)/_home/date-line';

describe('ホームの見出し(デザイン仕様書の「今日」)', () => {
  it('日付と曜日', () => {
    expect(homeDateLine('2026-10-16')).toBe('10月16日 金曜日');
    expect(homeDateLine('2026-10-31')).toBe('10月31日 土曜日');
    expect(homeDateLine('2026-02-01')).toBe('2月1日 日曜日');
  });
});
