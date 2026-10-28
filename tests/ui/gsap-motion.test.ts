/**
 * GSAP の動き(本人「GSAP導入」、ADR-140):金額の数字・保存したときの手応え・シートとグラフの出入り。
 * 動きそのものはブラウザで確かめる。ここでは、最初の表示・増えた行の見分け・視差効果を減らすときの扱いを固定する。
 */
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));
vi.mock('../../app/(app)/category-sheet-actions', () => ({
  loadCategorySheetAction: vi.fn(),
  saveCategoryTargetAction: vi.fn(),
}));
vi.mock('../../app/(app)/upcoming/actions', () => ({
  releaseCategoryFixedAction: vi.fn(),
  restoreCategoryFixedAction: vi.fn(),
}));
vi.mock('../../app/(app)/transactions/direct-record-editor', () => ({
  DirectRecordEditor: ({ children }: { children: React.ReactNode }) => h('button', {}, children),
}));

import { CategoryChart } from '../../app/(app)/category-sheet';
import { NewRows, addedRowIds } from '../../src/components/ui/new-rows';
import { RollingNumber } from '../../src/components/ui/rolling-number';
import type { CumulativeDay } from '../../src/features/category/pace';
import { GSAP_EASE } from '../../src/lib/gsap';

const read = (p: string) => readFileSync(p, 'utf8');
const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('金額の数字', () => {
  it('最初の表示はふつうの文字(0〜9 の列を作らない)。読み上げは最終の金額', () => {
    const html = visible(renderToString(h(RollingNumber, { value: 12279 })));
    expect(html).toContain('aria-label="12,279円"');
    expect(html).toContain('>12,279</span>');
    expect(html).not.toContain('data-roll');
    const minus = visible(renderToString(h(RollingNumber, { value: -300, unit: false })));
    expect(minus).toContain('aria-label="マイナス300"');
    expect(minus).toContain('−');
  });

  it('今日の残り・明細の合計・カテゴリの目標額で使う', () => {
    expect(read('app/(app)/_home/today-card.tsx')).toContain('<RollingNumber');
    expect(read('app/(app)/spending/month-summary.tsx')).toContain('<RollingNumber');
    expect(read('app/(app)/category-sheet.tsx')).toContain('<RollingNumber');
  });

  it('桁の回転は CSS ではなく GSAP。視差効果を減らすときは回さず、色の切り替えだけ', () => {
    expect(read('app/globals.css')).not.toMatch(/@keyframes digit-roll/);
    const src = read('src/components/ui/rolling-number.tsx');
    expect(src).toContain('useGSAP');
    expect(src).toContain('prefersReducedMotion()');
  });
});

describe('保存したときの手応え', () => {
  it('前になかった id だけを新しい行とする。最初の表示とたくさん増えたとき(読み込み直し)は動かさない', () => {
    expect(addedRowIds(null, ['a', 'b'])).toEqual([]);
    expect(addedRowIds(['a'], ['b', 'a'])).toEqual(['b']);
    expect(addedRowIds([], ['a'])).toEqual(['a']);
    expect(addedRowIds(['a', 'b'], ['a'])).toEqual([]);
    expect(addedRowIds([], ['a', 'b', 'c', 'd'])).toEqual([]);
  });

  it('子をそのまま出す(並びを変えない display: contents の箱)', () => {
    const html = renderToString(
      h(NewRows, { ids: ['a'], children: h('ul', {}, h('li', {}, '行')) }),
    );
    expect(html).toBe('<div class="contents"><ul><li>行</li></ul></div>');
  });

  it('今日の記録と明細の行に data-row-id があり、NewRows で包む', () => {
    const today = read('app/(app)/_home/recent-records.tsx');
    expect(today).toContain('<NewRows ids={todays.map((t) => t.id)}>');
    expect(today).toContain('data-row-id={t.id}');
    expect(read('app/(app)/spending/ledger-list.tsx')).toContain('<NewRows');
    expect(read('app/(app)/transactions/split-editor.tsx')).toContain(
      'data-row-id={transaction.id}',
    );
    // 視差効果を減らすときは高さを動かさない
    expect(read('src/components/ui/new-rows.tsx')).toMatch(/if \(!reduced\) \{[\s\S]*height: 0/);
  });
});

describe('シートとグラフの出入り', () => {
  const days = Array.from({ length: 10 }, (_, i) => ({
    index: i,
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    actualYen: i <= 5 ? (i + 1) * 1000 : null,
    forecastYen: i >= 5 ? 6000 + (i - 5) * 900 : null,
    forecastLowYen: i >= 5 ? 6000 : null,
    forecastHighYen: i >= 5 ? 6000 + (i - 5) * 1200 : null,
  })) as unknown as CumulativeDay[];

  it('使った額の線を描き、見込み・ペース・今日の点はそのあとに出す印を持つ', () => {
    const html = renderToString(
      h(CategoryChart, { days, target: 12000, name: '外食', endLabel: '10/10', p50: 10500 }),
    );
    expect(html.match(/data-reveal="draw"/g)).toHaveLength(1);
    expect(html.match(/data-reveal="later"/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('行き過ぎて跳ねる曲線は使わない(ADR-136)', () => {
    expect(GSAP_EASE).toBe('power3.out');
    for (const f of [
      'src/lib/gsap.ts',
      'src/components/ui/rolling-number.tsx',
      'src/components/ui/new-rows.tsx',
      'app/(app)/category-sheet.tsx',
    ]) {
      expect(read(f), f).not.toMatch(/back\.|elastic|bounce/);
    }
  });

  it('シートの中身とグラフは、視差効果を減らすときは透明度だけ', () => {
    const src = read('app/(app)/category-sheet.tsx');
    expect(src).toMatch(/\.\.\.\(reduced \? \{\} : \{ y: 8 \}\)/);
    expect(src).toMatch(/if \(prefersReducedMotion\(\)\) \{\s*gsap\.from\(svg, \{ opacity: 0/);
  });
});
