import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { RollingNumber } from '../src/components/ui/rolling-number';
import { SharedElement, sharedName } from '../src/components/ui/shared-element';
import { HAPTIC_FOR_ACTION, HAPTIC_PATTERNS, haptic, hapticFor } from '../src/lib/haptics';
import {
  MOTION,
  digitColumns,
  prefersReducedMotion,
  springDurationSec,
  springEasing,
  springValue,
} from '../src/lib/motion';

const css = readFileSync('app/globals.css', 'utf8');
const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('P1 モーションのトークン', () => {
  it('スプリング:応答0.35秒・減衰0.85。0から始まり、少し行き過ぎて1に収まる', () => {
    expect(MOTION.spring).toEqual({ responseSec: 0.35, dampingFraction: 0.85 });
    expect(springValue(0)).toBeCloseTo(0, 5);
    const d = springDurationSec();
    expect(d).toBeGreaterThan(0.3);
    expect(d).toBeLessThan(0.6);
    expect(springValue(d)).toBeCloseTo(1, 2);
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => springValue((d * i) / 199)));
    expect(peak).toBeGreaterThan(1); // ζ<1 なので少しだけ行き過ぎる
    expect(peak).toBeLessThan(1.02); // 減衰0.85は行き過ぎが小さい(2%未満)
  });

  it('CSS のスプリング(--motion-spring)は、生成関数の値と一致する', () => {
    const m = css.match(/--motion-spring:\s*(linear\([^)]*\));/);
    // prettier が折り返すので、空白を正規化して比べる
    expect(
      m?.[1]
        ?.replace(/\s+/g, ' ')
        .replace('( ', '(')
        .replace(' )', ')')
        .replace(/,\s*\)/, ')'),
    ).toBe(springEasing(24));
    const dur = css.match(/--motion-spring-duration:\s*(\d+)ms/);
    expect(Number(dur?.[1])).toBe(Math.round(springDurationSec() * 1000));
  });

  it('小さな状態変化250ms・金額の変化400ms・行の出入り250ms が、CSS と JS で一致する', () => {
    expect(css).toMatch(new RegExp(`--motion-small:\\s*${MOTION.smallMs}ms`));
    expect(css).toMatch(new RegExp(`--motion-number:\\s*${MOTION.numberMs}ms`));
    expect(css).toMatch(new RegExp(`--motion-row:\\s*${MOTION.rowMs}ms`));
    expect(css).toMatch(/--motion-ease-out:\s*cubic-bezier\(0, 0, 0\.2, 1\)/);
  });
});

describe('P1 視差効果を減らす(受け入れ基準12)', () => {
  it('動きのクラスは、reduce のとき すべてクロスフェード(位置・大きさを動かさない)に置き換わる', () => {
    const blocks = [
      ...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g),
    ].map((m) => m[1]!);
    const joined = blocks.join('\n');
    // 新しい動きのクラスがクロスフェードに置き換わる
    for (const cls of [
      '.rise',
      '.pop-in',
      '.row-flash',
      '.row-insert',
      '.bar-grow',
      '.digit-roll',
    ]) {
      expect(joined, cls).toContain(cls);
    }
    expect(joined).toContain('animation: motion-fade var(--motion-small)');
    // 共有要素の遷移:位置の移動は 0s、見た目の切り替えだけクロスフェード
    expect(joined).toContain('::view-transition-group(*)');
    expect(joined).toMatch(/::view-transition-group\(\*\)\s*\{\s*animation-duration:\s*0s/);
    expect(joined).toContain('::view-transition-old(*)');
    // 行の出入りは高さを動かさず、透明度だけ
    expect(joined).toMatch(/\.row-shell\s*\{\s*transition:\s*opacity/);
  });

  it('prefersReducedMotion は matchMedia の結果を返す', () => {
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: true }) } as never)).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) } as never)).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(false);
  });
});

describe('P1 金額の変化:数字が桁ごとに回転', () => {
  it('旧値と新値を桁ごとに比べ、変わった桁だけ回転する(カンマは動かない)', () => {
    expect(digitColumns(12279, 12656)).toEqual([
      { kind: 'digit', from: 1, to: 1, changed: false },
      { kind: 'digit', from: 2, to: 2, changed: false },
      { kind: 'static', char: ',' },
      { kind: 'digit', from: 2, to: 6, changed: true },
      { kind: 'digit', from: 7, to: 5, changed: true },
      { kind: 'digit', from: 9, to: 6, changed: true },
    ]);
  });

  it('桁が増えたときは、増えた桁だけ 0 から回る。最初の表示は回転しない', () => {
    const cols = digitColumns(999, 1200);
    expect(cols[0]).toEqual({ kind: 'digit', from: 0, to: 1, changed: true });
    expect(digitColumns(null, 300).every((c) => c.kind === 'static' || !c.changed)).toBe(true);
  });

  it('読み上げは最終の金額だけ(途中の数字は aria-hidden)。「円」は小さく', () => {
    const html = visible(renderToString(h(RollingNumber, { value: 12279 })));
    expect(html).toContain('aria-label="12,279円"');
    expect(html).toContain('yen-unit');
    expect(html).not.toContain('−');
    expect(visible(renderToString(h(RollingNumber, { value: -300 })))).toContain('マイナス300円');
  });
});

describe('P1 ハプティクスの対応表', () => {
  it('操作 → 触覚の対応が、選択/軽い衝撃/成功/警告 で統一されている', () => {
    expect(HAPTIC_FOR_ACTION).toEqual({
      tabChange: 'selection',
      chartScrub: 'selection',
      filterChange: 'selection',
      categoryMove: 'impact',
      save: 'impact',
      genreConfirm: 'impact',
      bulkComplete: 'success',
      ruleSaved: 'success',
      deleteConfirm: 'warning',
    });
  });

  it('触覚の強さは 選択 < 衝撃 < 成功 < 警告 の順で、Vibration API へ渡す', () => {
    const vibrate = vi.fn(() => true);
    expect(haptic('selection', { vibrate })).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.selection);
    haptic('warning', { vibrate });
    expect(vibrate).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.warning);
    const total = (p: number | number[]) => (Array.isArray(p) ? p.reduce((a, b) => a + b, 0) : p);
    expect(total(HAPTIC_PATTERNS.selection)).toBeLessThan(total(HAPTIC_PATTERNS.impact));
    expect(total(HAPTIC_PATTERNS.impact)).toBeLessThan(total(HAPTIC_PATTERNS.success));
    expect(total(HAPTIC_PATTERNS.success)).toBeLessThan(total(HAPTIC_PATTERNS.warning));
  });

  it('Vibration API が無い環境では、iOS の switch 方式を試し、それも無ければ何もしない', () => {
    expect(haptic('impact', {}, undefined)).toBe(false);
    const click = vi.fn();
    const remove = vi.fn();
    const doc = {
      body: { appendChild: vi.fn() },
      createElement: () => ({
        style: {},
        appendChild: vi.fn(),
        setAttribute: vi.fn(),
        click,
        remove,
      }),
    };
    expect(haptic('impact', {}, doc as never)).toBe(true);
    expect(click).toHaveBeenCalled();
    expect(typeof hapticFor).toBe('function');
  });

  it('画面のコードは navigator.vibrate を直接呼ばない(対応表を通す)', () => {
    const files = ['app/(app)/transactions/split-editor.tsx', 'app/(app)/spending/ledger-list.tsx'];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toContain('navigator.vibrate');
  });
});

describe('P1 共有要素', () => {
  it('ViewTransition が無い環境でも、子をそのまま出す(名前は行とヘッダーで同じ)', () => {
    const html = renderToString(
      h(SharedElement, { name: sharedName.icon('dining'), children: h('b', null, 'x') }),
    );
    expect(html).toContain('<b>x</b>');
    expect(sharedName.icon('dining')).toBe('category-icon-dining');
    expect(sharedName.title('dining')).toBe('category-title-dining');
    expect(sharedName.amount('dining')).toBe('category-amount-dining');
  });

  it('共有要素のモーフは、スプリングで動く', () => {
    expect(css).toMatch(
      /::view-transition-group\(\.morph\)\s*\{\s*animation-duration:\s*var\(--motion-spring-duration\);\s*animation-timing-function:\s*var\(--motion-spring\)/,
    );
  });
});
