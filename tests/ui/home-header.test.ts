import { describe, expect, it } from 'vitest';

import { homeDateLine } from '../../app/(app)/_home/date-line';

describe('ホームの見出し(デザイン仕様書の「今日」)', () => {
  it('日付と曜日', () => {
    expect(homeDateLine('2026-10-16')).toBe('10月16日 金曜日');
    expect(homeDateLine('2026-10-31')).toBe('10月31日 土曜日');
    expect(homeDateLine('2026-02-01')).toBe('2月1日 日曜日');
  });
});

describe('今日の見出し:「今日」の横に日付(本人の要望、ADR-104)', () => {
  it('日付と曜日は「今日」と同じ見出しの中、横に並べる', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/(app)/_home/home-header.tsx', 'utf8');
    expect(src).toMatch(/<h1[\s\S]*?今日[\s\S]*?\{homeDateLine\(today\)\}[\s\S]*?<\/h1>/);
  });

  it('今日使える目安の数字は 56px(68px は大きすぎた)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/(app)/_home/today-card.tsx', 'utf8');
    expect(src).toContain('text-[56px]');
    expect(src).not.toContain('text-[68px]');
  });
});
