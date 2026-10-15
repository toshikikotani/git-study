import { describe, expect, it } from 'vitest';

import {
  MIGRATED_PRESETS,
  PRESETS,
  SEMANTIC,
  contrast,
  isDark,
  themeTokens,
} from '@/lib/color-theme';

/** 色のプリセット(ADR-079):50種類、どれも読める濃さ。 */
describe('色のプリセット', () => {
  it('50種類、id は重ならず、以前のプリセット(生成り・墨・藍・苔)の id は残す', () => {
    expect(PRESETS).toHaveLength(50);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(50);
    for (const id of ['kinari', 'sumi', 'ai', 'koke']) {
      expect(PRESETS.some((p) => p.id === id)).toBe(true);
    }
    expect(PRESETS.filter((p) => p.group === 'light').length).toBeGreaterThanOrEqual(10);
    expect(PRESETS.filter((p) => p.group === 'dark').length).toBeGreaterThanOrEqual(5);
    for (const style of ['simple', 'stylish', 'cute', 'cool', 'adult']) {
      expect(PRESETS.filter((p) => p.style === style).length).toBeGreaterThanOrEqual(10);
    }
  });

  it('明るい・暗いの分け方が、背景の明るさと合っている', () => {
    for (const p of PRESETS) expect(isDark(p.colors.plane), p.id).toBe(p.group === 'dark');
  });

  it.each(PRESETS.map((p) => [p.label, p] as const))(
    '%s:文字・補足の文字・強調の文字は背景とカードの上で 4.5:1 以上、サブの線は 3:1 以上',
    (_label, preset) => {
      const t = themeTokens(preset.colors);
      const plane = t['--plane']!;
      const surface = t['--surface']!;
      for (const bg of [plane, surface]) {
        expect(contrast(t['--ink']!, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--ink-secondary']!, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--ink-muted']!, bg)).toBeGreaterThanOrEqual(4.5);
        // 強調・サブは塗りと文字・線を分けたので、淡いテーマでも文字と線は読める
        expect(contrast(t['--accent']!, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--state-ok']!, bg)).toBeGreaterThanOrEqual(3);
        // 収入・超過・注意の文字
        for (const k of ['--income', '--over', '--state-caution']) {
          expect(contrast(t[k]!, bg), k).toBeGreaterThanOrEqual(4.5);
        }
      }
      // 強調の塗りの上のボタンの文字、強調の文字を塗りにしたときの文字
      expect(contrast(t['--on-action']!, t['--action']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--on-accent']!, t['--accent']!)).toBeGreaterThanOrEqual(4.5);
      // 収入・超過・注意は、その薄い面の上でも読める
      expect(contrast(t['--income']!, t['--income-track']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--over']!, t['--over-track']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--state-caution']!, t['--state-caution-track']!)).toBeGreaterThanOrEqual(
        4.5,
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

  it('配色見本帳の値をそのまま持つ(読める濃さに足りない文字だけ、少し濃くする)', () => {
    const kinari = PRESETS.find((p) => p.id === 'kinari')!;
    expect(kinari.colors).toMatchObject({
      plane: '#f7f6f3',
      accent: '#8a6840',
      sub: '#5f7d62',
      inkSub: '#7a6f6d',
    });
    const candy = PRESETS.find((p) => p.id === 'candy')!;
    // 淡い強調は塗りに、読める強調の文字は別に
    expect(themeTokens(candy.colors)['--action']).toBe('#7ed6d9');
    expect(themeTokens(candy.colors)['--accent']).not.toBe('#7ed6d9');
  });

  it('収入・超過・注意は、テーマではなく明るい・暗いで決まる', () => {
    const light = themeTokens(PRESETS.find((p) => p.id === 'kinari')!.colors);
    const dark = themeTokens(PRESETS.find((p) => p.id === 'sumi')!.colors);
    // 塗りは見本の値そのまま。文字の色は、読める濃さに足りなければ少しだけ濃くする。
    expect(light['--income-track']).toBe(SEMANTIC.light.incomeBg);
    expect(light['--over-track']).toBe(SEMANTIC.light.overBg);
    expect(dark['--income']).toBe(SEMANTIC.dark.income);
    expect(dark['--state-caution']).toBe(SEMANTIC.dark.caution);
    const lighter = themeTokens(PRESETS.find((p) => p.id === 'snow')!.colors);
    expect(lighter['--income-track']).toBe(light['--income-track']);
  });

  it('なくしたプリセットは、今あるプリセットへ引き継ぐ', () => {
    for (const [from, to] of Object.entries(MIGRATED_PRESETS)) {
      expect(
        PRESETS.some((p) => p.id === from),
        from,
      ).toBe(false);
      expect(
        PRESETS.some((p) => p.id === to),
        to,
      ).toBe(true);
    }
  });
});
