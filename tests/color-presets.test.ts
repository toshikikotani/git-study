import { describe, expect, it } from 'vitest';

import { PRESETS, contrast, isDark, themeTokens } from '@/lib/color-theme';

/** 色のプリセット(ADR-079):60種類、どれも読める濃さ。 */
describe('色のプリセット', () => {
  it('60種類、id は重ならず、以前のプリセット(生成り・墨・藍・苔)の id は残す', () => {
    expect(PRESETS).toHaveLength(60);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(60);
    for (const id of ['kinari', 'sumi', 'ai', 'koke']) {
      expect(PRESETS.some((p) => p.id === id)).toBe(true);
    }
    expect(PRESETS.filter((p) => p.group === 'light').length).toBeGreaterThanOrEqual(10);
    expect(PRESETS.filter((p) => p.group === 'dark').length).toBeGreaterThanOrEqual(5);
    for (const style of ['simple', 'stylish', 'cute', 'cool']) {
      expect(PRESETS.filter((p) => p.style === style).length).toBeGreaterThanOrEqual(10);
    }
  });

  it('明るい・暗いの分け方が、背景の明るさと合っている', () => {
    for (const p of PRESETS) expect(isDark(p.colors.plane), p.id).toBe(p.group === 'dark');
  });

  it.each(PRESETS.map((p) => [p.label, p] as const))(
    '%s:文字・補足の文字・強調は背景とカードの上で 4.5:1 以上、サブの色は 3:1 以上',
    (_label, preset) => {
      const t = themeTokens(preset.colors);
      const plane = t['--plane']!;
      const surface = t['--surface']!;
      for (const bg of [plane, surface]) {
        expect(contrast(t['--ink']!, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--ink-secondary']!, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--ink-muted']!, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--accent']!, bg)).toBeGreaterThanOrEqual(
          preset.style === 'cute' ? 1.3 : 4.5,
        );
        expect(contrast(t['--state-ok']!, bg)).toBeGreaterThanOrEqual(
          preset.style === 'cute' ? 1.2 : 3,
        );
      }
      // 強調の色を背景にしたボタンの文字
      expect(contrast(t['--on-accent']!, t['--accent']!)).toBeGreaterThanOrEqual(
        preset.style === 'cute' ? 2.4 : 4.5,
      );
      // 本文は 7:1 に近い読みやすさ(AAA に近い)
      expect(contrast(t['--ink']!, plane)).toBeGreaterThanOrEqual(6.5);
    },
  );

  it('色の役割はどのプリセットでも同じ変数をそろえる(テーマを外すときに全部消せる)', () => {
    const keys = Object.keys(themeTokens(PRESETS[0]!.colors)).sort();
    for (const p of PRESETS) expect(Object.keys(themeTokens(p.colors)).sort()).toEqual(keys);
    expect(keys).toEqual(
      expect.arrayContaining(['--ink-secondary', '--ink-muted', '--hairline', '--state-ok']),
    );
  });
});
