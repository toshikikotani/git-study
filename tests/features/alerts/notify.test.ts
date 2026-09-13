import { describe, expect, it } from 'vitest';

import { buildEmbedForAlert, buildLineTextForAlert } from '@/features/alerts/notify';

describe('buildEmbedForAlert(FR-24, M3-1)', () => {
  it('info は青系の色になる', () => {
    const embed = buildEmbedForAlert({ title: 't', body: 'b', severity: 'info' });
    expect(embed).toEqual({ title: 't', description: 'b', color: 0x5865f2 });
  });

  it('warn は黄系の色になる', () => {
    expect(buildEmbedForAlert({ title: 't', body: null, severity: 'warn' }).color).toBe(0xfaa61a);
  });

  it('critical は赤系の色になる', () => {
    expect(buildEmbedForAlert({ title: 't', body: null, severity: 'critical' }).color).toBe(
      0xed4245,
    );
  });

  it('body が null なら description は undefined', () => {
    const embed = buildEmbedForAlert({ title: 't', body: null, severity: 'info' });
    expect(embed.description).toBeUndefined();
  });
});

describe('buildLineTextForAlert(LINE連携)', () => {
  it('info には🔵を付ける', () => {
    expect(buildLineTextForAlert({ title: 't', body: 'b', severity: 'info' })).toBe('🔵 t\nb');
  });

  it('warn には🟠を付ける', () => {
    expect(buildLineTextForAlert({ title: 't', body: null, severity: 'warn' })).toBe('🟠 t');
  });

  it('critical には🔴を付ける', () => {
    expect(buildLineTextForAlert({ title: 't', body: null, severity: 'critical' })).toBe('🔴 t');
  });

  it('body が null なら見出しだけになる(改行を付けない)', () => {
    expect(buildLineTextForAlert({ title: 't', body: null, severity: 'info' })).toBe('🔵 t');
  });
});
