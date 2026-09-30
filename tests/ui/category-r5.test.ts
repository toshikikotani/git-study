import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/spending/category/dining',
}));

import { CategoryScreen } from '../../app/(app)/spending/category/[genreKey]/category-screen';
import type { CategoryDetailData } from '../../src/features/category/loader';
import { CHROME_THRESHOLD_PX, nextChromeCompact } from '../../src/lib/chrome';

const css = readFileSync('app/globals.css', 'utf8');
const visible = (html: string) => html.replace(/<!-- -->/g, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(n)) out.push(p);
  }
  return out;
}

describe('R5 スクロールでタブバーが縮む', () => {
  it('下へ(しきい値より大きく)スクロールで縮み、上へで戻り、一番上では必ず元に戻る', () => {
    expect(nextChromeCompact(false, 100, 0)).toBe(true);
    expect(nextChromeCompact(true, 60, 100)).toBe(false);
    expect(nextChromeCompact(true, 0, 100)).toBe(false);
    expect(nextChromeCompact(true, -30, 100)).toBe(false);
  });

  it('小さな揺れでは切り替えない(ちらつき防止)', () => {
    const d = CHROME_THRESHOLD_PX;
    expect(nextChromeCompact(false, 100 + d, 100)).toBe(false);
    expect(nextChromeCompact(true, 100 - d, 100)).toBe(true);
  });

  it('タブバーは data-compact で縮み(幅・余白)、押せる高さは縮めない。視差軽減では動かさない', () => {
    const shell = readFileSync('app/(app)/app-shell.tsx', 'utf8');
    expect(shell).toContain('data-compact={compact}');
    expect(shell).toContain('nextChromeCompact');
    expect(css).toMatch(/\.tabbar\[data-compact='true'\]\s*\{\s*max-width:/);
    expect(css).not.toMatch(/\.tabbar[^{]*\{[^}]*transform:\s*scale/);
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.tabbar,\s*\.tabbar-pill\s*\{\s*transition:\s*none/,
    );
  });

  it('スクロール領域の下端に、タブバー+安全領域ぶんの余白がある(どの要素も隠れない)', () => {
    const shell = readFileSync('app/(app)/app-shell.tsx', 'utf8');
    expect(shell).toContain('pb-[calc(9rem+env(safe-area-inset-bottom))]');
    // 9rem = 144px。タブバー(44pt のタブ+余白+浮く撮影ボタン)より大きい。
    expect(9 * 16).toBeGreaterThanOrEqual(44 + 16 + 16 + 56);
  });
});

describe('R5 「取引 / 品目 / 店」はヘッダーの直下に固定される', () => {
  const base: CategoryDetailData = {
    genreKey: 'dining',
    genreName: '外食',
    genreBudgetYen: null,
    monthKey: '2026-09',
    monthStart: '2026-09-01',
    today: '2026-09-29',
    isCurrentMonth: true,
    range: { from: '2026-09-01', to: '2026-09-30' },
    windowFrom: '2026-03-01',
    transactions: [],
    genres: [{ id: 'dining', name: '外食' }],
    accounts: [],
    genreHistory: [],
    goal: null,
  };
  const html = visible(renderToString(h(CategoryScreen, { data: base })));

  it('帯は sticky で、上部の小さなヘッダー(44pt)の下に留まり、不透明の面(ガラスではない)', () => {
    const i = html.indexOf('aria-label="見方の切り替え"');
    expect(i).toBeGreaterThan(0);
    const before = html.slice(Math.max(0, i - 400), i);
    expect(before).toContain('sticky z-20');
    expect(before).toContain('top:calc(var(--sticky-top) + var(--compact-header-h, 44px))');
    expect(before).toContain('background:var(--plane)');
  });
});

describe('R5 Liquid Glass(半透明の素材)はナビゲーションの層だけ(受け入れ基準9)', () => {
  // ナビゲーションの層:タブバー・ナビゲーションバー・浮かぶ操作ボタン・シート・メニュー・浮かぶ通知。
  const ALLOWED = new Set([
    'app/(app)/app-shell.tsx', // タブバー・撮影ボタン
    'app/(app)/spending/category/[genreKey]/category-header.tsx', // 上部に固定される小さなナビゲーションバー
    'src/components/ui/bottom-sheet.tsx', // シート
    'src/components/ui/expandable-sheet.tsx', // シート
    'src/components/ui/more-menu.tsx', // メニュー
    'src/components/ui/undo-toast.tsx', // 浮かぶ通知
    'src/components/ui/pull-to-refresh.tsx', // 引っ張って更新のインジケーター(浮かぶ丸)
  ]);

  it('backdrop-filter・ガラスのトークンを使うのは、許可した部品だけ(カード・リスト・グラフ・ボタンには使わない)', () => {
    const offenders: string[] = [];
    for (const f of [...walk('app'), ...walk('src')]) {
      const text = readFileSync(f, 'utf8');
      if (
        /backdropFilter|backdrop-filter|--glass-blur|--glass-tint/.test(text) &&
        !ALLOWED.has(f)
      ) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('グラフ・カード・リストの行にガラスは使わない(不透明の面)', () => {
    for (const f of [
      'app/(app)/spending/category/[genreKey]/category-chart.tsx',
      'app/(app)/spending/category/[genreKey]/summary-section.tsx',
      'app/(app)/spending/category/[genreKey]/transaction-row.tsx',
      'src/components/ui/card.tsx',
      'src/components/ui/button.tsx',
    ]) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/--glass-(tint|blur)|backdrop/);
    }
  });

  it('ガラスを重ねない:1つの部品の中に、ガラスの面を入れ子にしない', () => {
    const sheet = readFileSync('src/components/ui/bottom-sheet.tsx', 'utf8');
    expect((sheet.match(/backdropFilter/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it('「透明度を下げる」がオンのときは、ガラスのトークンを不透明の面に置き換える', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-transparency: reduce)'));
    expect(block).toContain('--glass-tint: var(--surface)');
    expect(block).toContain('--glass-tint-strong: var(--surface)');
    expect(block).toContain('--glass-blur: none');
  });
});

describe('R5 角丸は入れ子の関係を保つ(外側 = 内側 + 余白)', () => {
  it('カードの角丸(16)= 内側の角丸(12)+ 余白の単位(4)', () => {
    const card = Number(/--radius-card:\s*(\d+)px/.exec(css)![1]);
    const inner = Number(/--radius-inner:\s*(\d+)px/.exec(css)![1]);
    const unit = Number(/--spacing:\s*(\d+)px/.exec(css)![1]);
    expect(card).toBe(inner + unit);
  });

  it('セグメントの溝(内側の角丸)の中の選択面は、溝の角丸 − 溝の余白(4px)', () => {
    const seg = readFileSync('src/components/ui/segmented.tsx', 'utf8');
    expect(seg).toContain('p-1');
    expect(seg).toContain('calc(var(--radius-inner) - 4px)');
  });
});

describe('R5 画面左端の「❯」', () => {
  it('アプリの部品ではない(コードのどこにも無い)。アプリ内ブラウザ側の部品で、アプリからは消せない', () => {
    for (const f of [...walk('app'), ...walk('src')]) {
      expect(readFileSync(f, 'utf8').includes('❯'), f).toBe(false);
    }
  });
});
