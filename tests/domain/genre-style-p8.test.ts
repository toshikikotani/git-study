import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  GENRE_COLOR_HEX,
  MIN_GRAPHIC_CONTRAST,
  SELECTABLE_ICONS,
  contrastRatio,
  genreColorVar,
  genreStyle,
  selectableColorIndexes,
} from '../../src/domain/genre-style';

const css = readFileSync('app/globals.css', 'utf8');

describe('P8 カテゴリの見た目', () => {
  it('色の候補の写しは globals.css の --genre-N と一致する(明るい・暗い)', () => {
    const light = [...css.matchAll(/--genre-(\d+): (#[0-9a-f]{6});/g)];
    const first = light.slice(0, 10).map((m) => m[2]);
    expect(first).toEqual([...GENRE_COLOR_HEX.light]);
    const dark = light.slice(10, 20).map((m) => m[2]);
    expect(dark).toEqual([...GENRE_COLOR_HEX.dark]);
  });

  it('選べる色は、明るい・暗いの両方で背景に対して 3:1 以上(図形のコントラスト)', () => {
    const ok = selectableColorIndexes();
    expect(ok.length).toBeGreaterThanOrEqual(6);
    for (const i of ok) {
      expect(
        contrastRatio(GENRE_COLOR_HEX.light[i - 1]!, GENRE_COLOR_HEX.surface.light),
      ).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST);
      expect(
        contrastRatio(GENRE_COLOR_HEX.dark[i - 1]!, GENRE_COLOR_HEX.surface.dark),
      ).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST);
    }
  });

  it('コントラストの計算(白と黒は21:1)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });

  it('上書きは名前からの既定より優先し、未設定の項目は既定のまま。未分類は上書きできない', () => {
    expect(genreStyle('外食')).toEqual({ colorIndex: 2, icon: 'restaurant' });
    expect(genreStyle('外食', { icon: 'cafe', colorIndex: 5 })).toEqual({
      colorIndex: 5,
      icon: 'cafe',
    });
    expect(genreStyle('外食', { icon: 'cafe', colorIndex: null })).toEqual({
      colorIndex: 2,
      icon: 'cafe',
    });
    expect(genreStyle('外食', { colorIndex: 99 })).toEqual({ colorIndex: 2, icon: 'restaurant' });
    expect(genreStyle(null, { icon: 'cafe', colorIndex: 3 }).icon).toBe('uncategorized');
    expect(genreColorVar('外食', { colorIndex: 7 })).toBe('var(--genre-7)');
  });

  it('選べるアイコンに未分類は含まれない', () => {
    expect(SELECTABLE_ICONS).not.toContain('uncategorized');
    expect(new Set(SELECTABLE_ICONS).size).toBe(SELECTABLE_ICONS.length);
  });
});
