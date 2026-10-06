import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** G デザインシステム: トークンとソースの規則をテストで固定する(受け入れ基準 8・9 ほか)。 */
const css = readFileSync('app/globals.css', 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(p);
  }
  return out;
}
const sources = [...walk('app'), ...walk('src/components')].map((p) => ({
  path: p,
  text: readFileSync(p, 'utf8'),
}));

/** 指定したセレクタのブロックから CSS 変数を取る。 */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const open = css.indexOf('{', start);
  const close =
    css.indexOf('\n  }', open) > -1 && selector.includes('@media') ? -1 : css.indexOf('\n}', open);
  const body = css.slice(open + 1, close > 0 ? close : undefined);
  return Object.fromEntries(
    [...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}
const dark = block(":root[data-theme='dark']");
const light = block(':root {');

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const hue = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d / max < 0.3) return null; // ほぼ無彩色(スレート系の灰)
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const isBlue = (hex: string) => {
  // 濃紺(ほぼ黒)は「青」ではなく墨色として扱う
  if (lum(hex) < 0.02) return false;
  const h = hue(hex);
  return h !== null && h >= 200 && h <= 260;
};

describe('G 面の3段階と文字のコントラスト', () => {
  it('ダークの面は 背景 #0B0F17 / カード #121826 / 強調面 #1A2233', () => {
    expect(dark['--plane']).toBe('#0b0f17');
    expect(dark['--surface']).toBe('#121826');
    expect(dark['--surface-raised']).toBe('#1a2233');
  });

  it('補足テキスト(--ink-secondary・--ink-muted)は、どの面でもコントラスト 4.5:1 以上', () => {
    for (const theme of [dark, light]) {
      for (const surface of ['--plane', '--surface', '--surface-raised']) {
        for (const ink of ['--ink-secondary', '--ink-muted']) {
          expect(
            contrast(theme[ink]!, theme[surface]!),
            `${ink} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    expect(dark['--ink-secondary']).toBe('#a3adbd');
  });

  it('区切り線・金額の「円」・撮影ボタン・タップ領域がトークンで定義されている', () => {
    for (const t of [
      '--divider',
      '--yen-unit-scale',
      '--fab-size',
      '--fab-lift',
      '--tap-min',
      '--gutter',
    ]) {
      expect(css).toContain(`${t}:`);
    }
    expect(css).toMatch(/--yen-unit-scale:\s*0\.7/);
    expect(css).toMatch(/--fab-size:\s*56px/);
    expect(css).toMatch(/--gutter:\s*16px/);
  });
});

describe('G 青は主要な操作だけ(受け入れ基準8)', () => {
  it('中立の選択色(--accent)と状態色の「余裕」は、青ではない', () => {
    for (const theme of [dark, light]) {
      expect(isBlue(theme['--accent']!), '--accent').toBe(false);
      expect(isBlue(theme['--state-ok']!), '--state-ok').toBe(false);
    }
  });

  it('青(--action)を参照するのは、主要な操作の部品だけ', () => {
    const users = sources
      .filter((s) => s.path.endsWith('.tsx') && s.text.includes('var(--action)'))
      .map((s) => s.path);
    expect(users.length).toBeGreaterThan(0);
    // 主要な操作の部品が --action を使っている(保存・撮影・AIで作る 等)
    expect(users).toContain('src/components/ui/button.tsx');
    expect(users).toContain('src/components/ui/fab.tsx');
    // 選択チップ・リンク・バッジは --action を使わない
    for (const p of [
      'app/(app)/spending/genre-breakdown.tsx',
      'app/(app)/spending/ledger-list.tsx',
      'app/(app)/spending/calendar-heatmap.tsx',
      'src/components/ui/chip.tsx',
      'src/components/ui/genre-budget-row.tsx',
    ]) {
      expect(users, p).not.toContain(p);
    }
  });

  it('青いハードコード色(#2a78d6 系)が残っていない', () => {
    for (const s of sources.filter((x) => !x.path.endsWith('globals.css'))) {
      expect(s.text, s.path).not.toMatch(/#(2a78d6|3987e5|2b6cd4)/i);
    }
  });
});

describe('G 文字は5段階だけ(受け入れ基準9)+ Dynamic Type', () => {
  const ALLOWED = new Set([13, 15, 17, 34, 40]);
  /** 17px 基準の rem を px に直す(Dynamic Type: 文字は rem、基準は -apple-system-body)。 */
  const toPx = (v: string): number | null => {
    const calc = v.match(/^calc\((\d+)\s*\/\s*17\s*\*\s*1rem\)$/);
    if (calc) return Number(calc[1]);
    const rem = v.match(/^([\d.]+)rem$/);
    if (rem) return Math.round(Number(rem[1]) * 17);
    const px = v.match(/^(\d+)px$/);
    return px ? Number(px[1]) : null;
  };

  it('文字の大きさは rem のトークン(text-xs〜)だけで、text-[Npx] や px 直書きは無い', () => {
    const bad: string[] = [];
    for (const s of sources.filter((x) => x.path.endsWith('.tsx'))) {
      for (const m of s.text.matchAll(/text-\[(\d+)px\]/g)) bad.push(`${s.path}: ${m[0]}`);
      for (const m of s.text.matchAll(/fontSize:\s*(\d+)/g))
        bad.push(`${s.path}: fontSize ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });

  it('Tailwind の text-xs〜text-4xl は @theme で 13/15/17/34/40 のどれかに束ねてある', () => {
    const theme = Object.fromEntries(
      [...css.matchAll(/--text-([a-z0-9]+):\s*([^;]+);/g)].map((m) => [m[1]!, toPx(m[2]!.trim())]),
    );
    for (const k of ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl']) {
      expect(ALLOWED.has(theme[k]!), `text-${k}`).toBe(true);
    }
    for (const s of sources) expect(s.text, s.path).not.toMatch(/\btext-(5|6|7|8|9)xl\b/);
  });

  it('デザイントークン --font-* も5段階', () => {
    const sizes = [...css.matchAll(/--font-(title|amount|heading|body|caption):\s*([^;]+);/g)].map(
      (m) => toPx(m[2]!.trim()),
    );
    expect(new Set(sizes)).toEqual(ALLOWED);
  });

  it('CSS の font-size はトークン(または 1em 基準・html の基準17px)だけ', () => {
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    for (const v of sizes) {
      expect(v.startsWith('var(--font-') || v.startsWith('calc(1em') || v === '17px', v).toBe(true);
    }
  });

  it('Dynamic Type:html は -apple-system-body を受け、余白は px のまま', () => {
    expect(css).toContain('font: -apple-system-body');
    expect(css).toMatch(/--spacing:\s*4px/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('G 角丸と余白', () => {
  it('角丸は カード16 / 内側12 / 完全な丸 の3つだけ', () => {
    const radii = [...css.matchAll(/--radius-(xs|sm|md|lg|xl|2xl|3xl|4xl):\s*(\d+)px/g)].map((m) =>
      Number(m[2]),
    );
    expect(new Set(radii)).toEqual(new Set([12, 16]));
    expect(css).toMatch(/--radius-card:\s*16px/);
    expect(css).toMatch(/--radius-inner:\s*12px/);
  });

  it('余白のクラスは4の倍数(.5 刻みを使わない)', () => {
    const bad: string[] = [];
    for (const s of sources.filter((x) => x.path.endsWith('.tsx'))) {
      const m = s.text.match(
        /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-x|space-y)-\d+\.5\b/g,
      );
      if (m) bad.push(`${s.path}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it('余白のトークンは4の倍数', () => {
    for (const m of css.matchAll(/--space-\d+:\s*(\d+)px/g)) expect(Number(m[1]) % 4).toBe(0);
  });
});
