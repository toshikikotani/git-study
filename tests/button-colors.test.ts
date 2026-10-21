import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { HABIT_MIX } from '../app/(app)/reports/weekday-habit';
import { PRESETS, contrast, isDark, mixHex, themeTokens } from '@/lib/color-theme';

/**
 * 色の型(デザインの課題 #5・#6・#11、ADR-131):主のボタンは強調色の塗り、押せないときは淡い面に読める
 * 濃さの文字。どのテーマでも文字は 4.5:1 以上。
 */
const css = readFileSync('app/globals.css', 'utf8');

/** セレクタのブロック(最初の閉じかっこまで)の CSS 変数。同じセレクタが複数あれば後ろが勝つ。 */
function vars(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  let from = 0;
  for (;;) {
    const start = css.indexOf(selector, from);
    if (start < 0) return out;
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    for (const m of css.slice(open + 1, close).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
      out[m[1]!] = m[2]!.trim();
    }
    from = close;
  }
}

/** rgba(255, 255, 255, a) は背景に重ねた色にする。 */
function solid(color: string, bg: string): string {
  const m = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (!m) return color;
  return mixHex(
    `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`,
    bg,
    Number(m[4]),
  );
}

function distance(a: string, b: string): number {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(...x.map((v, i) => v - y[i]!));
}

const light = { ...vars(':root {\n'), ...vars(':root {') };
const dark = { ...light, ...vars(":root:not([data-theme='light']) {") };

type Palette = { name: string; v: Record<string, string> };
const defaults: Palette[] = [
  { name: '既定(明るい)', v: light },
  { name: '既定(暗い)', v: dark },
];
const presets: Palette[] = PRESETS.map((p) => ({
  name: p.label,
  v: {
    ...(isDark(p.colors.plane) ? dark : light),
    ...themeTokens(p.colors),
  },
}));

describe('ボタンの色の型', () => {
  it.each([...defaults, ...presets].map((p) => [p.name, p] as const))(
    '%s:主のボタンの文字と、押せないボタンの文字は 4.5:1 以上',
    (_name, { v }) => {
      expect(contrast(v['--on-action']!, v['--action']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['--on-action-off']!, v['--action-off']!)).toBeGreaterThanOrEqual(4.5);
      // 押せるボタンと押せないボタンは、塗りが見分けられる(同じ灰色にしない)。淡い強調のテーマは明るさが
      // 近くても色で分かれるので、明るさの比ではなく色の距離で見る。
      expect(distance(v['--action']!, v['--action-off']!)).toBeGreaterThanOrEqual(60);
    },
  );

  it.each([...defaults, ...presets].map((p) => [p.name, p] as const))(
    '%s:曜日のくせのマスの数字は、どの濃さでも 4.5:1 以上',
    (_name, { v }) => {
      const note = v['--note']!;
      for (let lv = 1; lv < HABIT_MIX.length; lv++) {
        const cell = mixHex(v['--action']!, note, HABIT_MIX[lv]! / 100);
        const top = lv === HABIT_MIX.length - 1;
        const text = top ? v['--on-action']! : solid(v['--ink']!, cell);
        expect(contrast(text, cell), `段階 ${lv}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each([...defaults, ...presets].map((p) => [p.name, p] as const))(
    '%s:切り替え(目標/月のふりかえり)は、選んでいる面が溝より明るく、どちらの文字も 4.5:1 以上',
    (_name, { v }) => {
      const field = v['--field']!;
      const on = v['--segment-on']!;
      expect(contrast(on, '#000000')).toBeGreaterThan(contrast(field, '#000000'));
      expect(contrast(solid(v['--ink']!, on), on)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['--ink-secondary']!, field)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('主のボタンは btn-primary で書き、押せないときに塗りを薄めない', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.tsx')) files.push(p);
      }
    };
    walk('app');
    walk('src/components');
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toContain(
        "style={{ background: 'var(--action)', color: 'var(--on-action)' }}",
      );
      // 強調の塗りに白い文字を決め打ちしない(暗いテーマでは強調が明るい)
      expect(text, f).not.toMatch(/text-white[^"]*"\s*style=\{\{ background: 'var\(--action\)'/);
      for (const m of text.matchAll(/className="([^"]*btn-primary[^"]*)"/g)) {
        expect(m[1], f).not.toMatch(/disabled:opacity/);
      }
    }
  });
});
