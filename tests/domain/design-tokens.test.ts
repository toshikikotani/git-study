import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { GENRE_COLOR_COUNT, genreColorVar, genreStyle } from '@/domain/genre-style';
import { formatYen } from '@/domain/money';

const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

/** globals.css のうち、light(:root)・dark(media)・dark(data-theme)の3ブロックで定義されているか。 */
function definedInAllThemes(token: string): boolean {
  const occurrences = css.split(`${token}:`).length - 1;
  return occurrences >= 3;
}

describe('デザイントークン', () => {
  it('ジャンルの色 10 色 + 未分類のグレーが、light / dark の全テーマで定義されている', () => {
    for (let i = 1; i <= GENRE_COLOR_COUNT; i += 1) {
      expect(definedInAllThemes(`--genre-${i}`), `--genre-${i}`).toBe(true);
    }
    expect(definedInAllThemes('--genre-none')).toBe(true);
  });

  it('状態色(余裕=青・注意=黄・超過=赤・予算なし=グレー)とトラックが全テーマで定義されている', () => {
    for (const s of ['ok', 'caution', 'over', 'none']) {
      expect(definedInAllThemes(`--state-${s}`), `--state-${s}`).toBe(true);
      expect(definedInAllThemes(`--state-${s}-track`), `--state-${s}-track`).toBe(true);
    }
  });

  it('既定のジャンルはすべて色とアイコンを持ち、色の割り当ては決定的', () => {
    for (const name of ['食料品', '外食', 'カフェ・飲料', '日用品', '旅行', 'その他']) {
      const style = genreStyle(name);
      expect(style.colorIndex).toBeGreaterThanOrEqual(1);
      expect(style.colorIndex).toBeLessThanOrEqual(GENRE_COLOR_COUNT);
    }
    expect(genreColorVar('自作のジャンル')).toBe(genreColorVar('自作のジャンル'));
    expect(genreColorVar(null)).toBe('var(--genre-none)');
    expect(genreStyle(null).icon).toBe('uncategorized');
  });

  it('金額のマイナスは U+2212、数字は等幅(tabular-nums)', () => {
    expect(formatYen(-1234)).toBe('−1,234円');
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('ステータスバーの下のぼかし(safe-area)と、リストの下端の余白がレイアウトに含まれる', () => {
    expect(css).toContain('.status-blur');
    expect(css).toContain('env(safe-area-inset-top');
    const layout = readFileSync(new URL('../../app/(app)/app-shell.tsx', import.meta.url), 'utf8');
    expect(layout).toContain('status-blur');
    expect(layout).toMatch(/pb-\[calc\(9rem\+env\(safe-area-inset-bottom\)\)\]/);
  });
});
