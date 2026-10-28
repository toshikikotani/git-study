/**
 * Impeccable で全画面を点検して直したところ(ADR-136)。
 * - 設定で選んだカテゴリの色が、マーク・帯・グラフに出る(以前は名前から決まる色のまま)
 * - 暗い画面で、赤い面に白い文字を置かない
 * - 本文のカードはほかのカードと同じ不透明な面、入力欄の例の文字は 4.5:1、跳ねる曲線を使わない
 * - 回数と1回の金額のグラフで、名前どうしを重ねない
 */
import { readFileSync } from 'node:fs';
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
  usePathname: () => '/settings/categories/dining',
}));
vi.mock('../../app/(app)/spending/category/actions', () => ({
  listRulesAction: vi.fn(async () => ({ error: null, rules: [] })),
  deleteRuleAction: vi.fn(),
  renameCategoryAction: vi.fn(),
  saveCategoryStyleAction: vi.fn(),
  updateCategoryBudgetAction: vi.fn(),
  updateRuleGenreAction: vi.fn(),
  setCategoryFixedAction: vi.fn(),
  setCategoryForecastClosedAction: vi.fn(),
  deleteCategoryAction: vi.fn(),
}));
vi.mock('../../app/(app)/plan/actions', () => ({
  updatePlanAllocationAction: vi.fn(),
  planLandingAction: vi.fn(),
}));

import NotFound from '../../app/not-found';
import { labeledBubbles, type BubblePoint } from '../../app/(app)/reports/bubble-chart';
import { SettingsBody } from '../../app/(app)/settings/categories/[genreId]/settings-body';
import { GenreBadge } from '../../src/components/ui/genre-badge';
import { GenreStyleProvider } from '../../src/components/ui/genre-style-context';
import { chosenColorIndex, genreBarColor, genreSwatch } from '../../src/domain/genre-style';
import type { CategorySettingsData } from '../../src/features/category/settings-loader';

const root = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const css = read('app/globals.css');
const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('カテゴリの色:設定で選んだ色がどこにも出る', () => {
  it('選んだ番号だけを「選んだ色」とする(範囲外・未設定は null)', () => {
    expect(chosenColorIndex({ colorIndex: 3 })).toBe(3);
    expect(chosenColorIndex({ colorIndex: null })).toBeNull();
    expect(chosenColorIndex({ colorIndex: 11 })).toBeNull();
    expect(chosenColorIndex({ icon: 'cafe' })).toBeNull();
    expect(chosenColorIndex(null)).toBeNull();
  });

  it('色を選んでいれば --genre-N、選んでいなければ名前から決まる系統の色', () => {
    expect(genreSwatch('外食', { colorIndex: 4 })).toBe('var(--genre-4)');
    expect(genreBarColor('外食', { colorIndex: 4 })).toBe('var(--genre-4)');
    expect(genreSwatch('外食')).toContain('light-dark');
    expect(genreSwatch('外食', { icon: 'cafe', colorIndex: null })).toContain('light-dark');
    expect(genreSwatch(null, { colorIndex: 4 })).toBe('var(--ink-muted)');
  });

  it('マークはコンテキストの選んだ色で描く', () => {
    const html = renderToString(
      h(GenreStyleProvider, {
        overrides: { 外食: { colorIndex: 2 } },
        children: h(GenreBadge, { name: '外食' }),
      }),
    );
    expect(html).toContain('var(--genre-2)');
  });

  const data: CategorySettingsData = {
    genreName: '外食',
    genreBudgetYen: 30000,
    forecastClosed: false,
    isFixed: false,
    genres: [
      { id: 'dining', name: '外食' },
      { id: 'cafe', name: 'カフェ' },
    ],
    goal: null,
  };

  it('設定の色の先頭は「名前から決まる色」。選んでいないときはそれが選択中', () => {
    const html = visible(renderToString(h(SettingsBody, { data, genreId: 'dining' })));
    expect(html).toContain('aria-label="名前から決まる色(選択中)"');
    // 名前から決まる番号(外食=2)を「選択中」と見せない(マークの色と合わなかった)。
    expect(html).not.toMatch(/aria-label="色\d+\(選択中\)"/);
    expect(html).toContain('いちばん左は、名前から決まる色です。');
  });

  it('色を選んでいれば、その色が選択中。ほかのカテゴリが選んだ色だけが使用中', () => {
    const html = visible(
      renderToString(
        h(GenreStyleProvider, {
          overrides: { 外食: { colorIndex: 5 }, カフェ: { colorIndex: 1 } },
          children: h(SettingsBody, { data, genreId: 'dining' }),
        }),
      ),
    );
    expect(html).toContain('aria-label="色5(選択中)"');
    expect(html).toContain('aria-label="名前から決まる色"');
    expect(html).toContain('aria-label="色1(使用中)"');
    // 名前からの既定の番号は使用中にしない(選んだ色だけ)。
    expect(html.match(/\(使用中\)/g)?.length).toBe(1);
  });
});

describe('暗い画面の読みやすさ', () => {
  it('赤い面(--over)の上は --on-accent(暗い画面では濃い色)。白に決め打ちしない', () => {
    const files = [
      'app/(app)/spending/category/[genreKey]/edit-sheet.tsx',
      'app/(app)/assistant/assistant-chat.tsx',
    ];
    for (const f of files) {
      const src = read(f);
      expect(src).not.toMatch(/var\(--over\)'[^}]*'#fff'/);
      expect(src).not.toMatch(/speech\.listening \? '#fff'/);
    }
  });

  it('収入の緑は、薄い緑の面の上で 4.5:1 以上の濃さ', () => {
    expect(css).toMatch(/--income:\s*#2b774b/);
  });

  it('入力欄の例の文字は、補足の文字より少し濃い色(不透明)', () => {
    expect(css).toMatch(
      /::placeholder\s*\{\s*color:\s*color-mix\(in srgb, var\(--ink-muted\) 80%, var\(--ink\)\);\s*opacity:\s*1;/,
    );
  });

  it('キーボードの選択の輪はアプリの文字色(入力欄は対象にしない)', () => {
    const rule = css.match(/:where\(([^)]*)\):focus-visible\s*\{([^}]*)\}/);
    expect(rule?.[1]).toContain('button');
    expect(rule?.[1]).not.toContain('input');
    expect(rule?.[2]).toContain('outline: 2px solid var(--ink)');
  });
});

describe('カードと動きの型', () => {
  it('本文のカード(.glass)は不透明な面で、ぼかし・白い縁を使わない', () => {
    const glass = css.match(/\.glass\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(glass).toContain('background: var(--surface) !important');
    expect(glass).not.toContain('backdrop-filter');
    expect(glass).not.toContain('white 42%');
  });

  it('Card の既定は主要な画面と同じく影なし(--card-shadow)', () => {
    expect(read('src/components/ui/card.tsx')).toContain(
      "elevated: { background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }",
    );
    expect(read('src/components/ui/stat-tile.tsx')).toContain("boxShadow: 'var(--card-shadow)'");
  });

  it('スプリングは行き過ぎて跳ねない標準の曲線にそろえる', () => {
    expect(css).toMatch(/--ease-spring:\s*var\(--motion-spring\);/);
    // 宣言として使っていない(説明の注記には残る)。
    expect(css).not.toMatch(/:\s*cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/);
  });

  it('記号(✦)をアイコンの代わりに使わない', () => {
    for (const f of [
      'app/(app)/_home/ai-insight-line.tsx',
      'app/(app)/reports/month/ai-report-link.tsx',
      'app/(app)/spending/classify-button.tsx',
    ]) {
      expect(read(f)).not.toContain('✦');
      expect(read(f)).toContain('<AiIcon');
    }
  });
});

describe('回数と1回の金額のグラフ', () => {
  const p = (name: string, frequency: number, avgYen: number, totalYen: number): BubblePoint => ({
    genreId: name,
    name,
    frequency,
    avgYen,
    totalYen,
  });

  it('近くに集まった円は、合計の大きいものだけ名前を出す', () => {
    const labeled = labeledBubbles([
      p('食料品', 17, 1000, 17000),
      p('日用品', 3, 1500, 4500),
      p('交通', 3, 1300, 3900),
      p('未分類', 1, 1100, 1100),
      p('光熱費', 1, 9200, 9200),
    ]);
    expect(labeled.has('食料品')).toBe(true);
    expect(labeled.has('光熱費')).toBe(true);
    expect(labeled.has('日用品')).toBe(true);
    // 日用品のすぐ近くの交通・未分類は名前を省く(押すと出る)。
    expect(labeled.has('交通')).toBe(false);
    expect(labeled.has('未分類')).toBe(false);
  });

  it('離れていれば、すべてに名前を出す', () => {
    const labeled = labeledBubbles([p('A', 1, 100, 100), p('B', 20, 9000, 180000)]);
    expect(labeled.size).toBe(2);
  });
});

describe('見つからない画面', () => {
  it('日本語で知らせ、今日へ戻るボタンを出す', () => {
    const html = visible(renderToString(h(NotFound)));
    expect(html).toContain('画面が見つかりません');
    expect(html).toContain('href="/"');
    expect(html).toContain('今日へ戻る');
  });
});
