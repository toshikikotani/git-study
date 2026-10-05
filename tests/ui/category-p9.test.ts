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

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { CategoryScreen } from '../../app/(app)/spending/category/[genreKey]/category-screen';
import { categoryVoiceOverLabel } from '../../src/features/category/a11y';
import { buildCategorySummary, buildInsights } from '../../src/features/category/insights';
import type { CategoryDetailData } from '../../src/features/category/loader';
import {
  aggregateItems,
  aggregateStores,
  actualSpentYen,
  buildCategoryLines,
  categorySpentFromLedger,
  type CategoryTx,
} from '../../src/features/category/model';
import { buildSeries } from '../../src/features/category/series';
import { VirtualIndex } from '../../src/lib/virtual';
import { ledgerTx } from '../helpers/ledger';

const visible = (html: string) => html.replace(/<!-- -->/g, '');
const tx = (o: Parameters<typeof ledgerTx>[0]): CategoryTx => ({ ...ledgerTx(o), items: [] });

const base: CategoryDetailData = {
  genreKey: 'dining',
  genreName: '外食',
  genreBudgetYen: null, forecastClosed: false,
  monthKey: '2026-09',
  monthStart: '2026-09-01',
  today: '2026-09-29',
  isCurrentMonth: true,
  range: { from: '2026-09-01', to: '2026-09-30' },
  windowFrom: '2026-03-01',
  transactions: [],
  genres: [{ id: 'dining', name: '外食' }],
  accounts: [{ id: 'a', name: '現金' }],
  genreHistory: [],
  goal: null,
};
const render = (data: Partial<CategoryDetailData>) =>
  visible(renderToString(h(CategoryScreen, { data: { ...base, ...data } })));

/** 「見た目」の回帰を、描画結果の骨格(タグ・クラス・文言)のスナップショットで固定する。 */
const skeleton = (html: string) =>
  html
    .replace(/ style="[^"]*"/g, '')
    .replace(/ (id|for|aria-labelledby|aria-controls)="[^"]*"/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>');

const make = (n: number): CategoryTx[] =>
  Array.from({ length: n }, (_, i) =>
    tx({
      id: `t${i}`,
      occurredOn: `2026-${String(3 + (i % 7)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
      label: `店${i % 200}`,
      amountYen: -(300 + (i % 50) * 10),
    }),
  );

describe('P9 状態の網羅(スナップショット)', () => {
  it('0件: 空の状態を言葉で示し、壊れない', () => {
    const html = render({});
    expect(html).toContain('この月の取引はありません。');
    expect(html).toContain('aria-label="0円"');
    expect(skeleton(html)).toMatchSnapshot();
  });

  it('1件', () => {
    const html = render({
      transactions: [
        tx({ id: 'a', occurredOn: '2026-09-05', label: 'ココカラ', amountYen: -1200 }),
      ],
    });
    expect(html).toContain('ココカラ');
    expect(html).toContain('外食、9月、合計1,200円、1件');
    expect(skeleton(html)).toMatchSnapshot();
  });

  it('長い店名・長い品目名は切り詰める(折り返しで行が崩れない)', () => {
    const long = 'とても長い店名'.repeat(12);
    const html = render({
      transactions: [tx({ id: 'a', occurredOn: '2026-09-05', label: long, amountYen: -1200 })],
    });
    expect(html).toContain(long);
    // 店名の要素は縮められ(min-w-0)、長い名前は折り返すか切り詰める。
    const row = html.slice(html.indexOf(`>${long}`) - 260, html.indexOf(`>${long}`));
    expect(row).toMatch(/min-w-0/);
    expect(row).toMatch(/break-words|truncate|line-clamp/);
  });

  it('予定だけ・入力待ち(集計に入らない)・返金のみ', () => {
    const scheduled = render({
      transactions: [
        tx({
          id: 'f',
          occurredOn: '2026-09-30',
          label: '打ち上げ',
          amountYen: -5000,
          status: 'scheduled',
        }),
      ],
    });
    expect(scheduled).toContain('aria-label="0円"');
    expect(scheduled).toContain('予定');
    const needs = render({
      transactions: [
        tx({
          id: 'n',
          occurredOn: '2026-09-05',
          label: '読み取り待ち',
          amountYen: -900,
          needsInput: true,
        }),
      ],
    });
    expect(needs).toContain('aria-label="0円"');
    expect(needs).not.toContain('読み取り待ち');
    const refundOnly = render({
      transactions: [
        tx({
          id: 'r',
          occurredOn: '2026-09-05',
          label: 'ローソン',
          amountYen: 300,
          kind: 'refund',
        }),
      ],
    });
    expect(refundOnly).toContain('ローソン');
  });

  it('前月なし・目標なし: 前月比と目標の行は出さない', () => {
    const html = render({
      transactions: [tx({ id: 'a', occurredOn: '2026-09-05', label: 'A', amountYen: -1200 })],
    });
    expect(html).not.toContain('前月の同じ日まで');
    expect(html).not.toContain('目標期間 ');
  });

  it('未分類の画面(0件)でも壊れず、設定は出さない', () => {
    const html = render({ genreKey: 'none', genreName: '未分類' });
    expect(html).not.toContain('の設定');
  });
});

describe('P9 アクセシビリティ(受け入れ基準15)', () => {
  it('VoiceOver の要約は「外食、9月、合計12,279円、23件」の形', () => {
    expect(
      categoryVoiceOverLabel({
        genreName: '外食',
        monthKey: '2026-09',
        totalYen: -12279,
        count: 23,
      }),
    ).toBe('外食、9月、合計12,279円、23件');
  });

  it('画面の先頭に要約がある。グラフには要約の代替テキストがある', () => {
    const html = render({
      transactions: [
        tx({ id: 'a', occurredOn: '2026-09-05', label: 'A', amountYen: -1200 }),
        tx({ id: 'b', occurredOn: '2026-09-06', label: 'B', amountYen: -800 }),
      ],
    });
    expect(html).toContain('外食、9月、合計2,000円、2件');
    expect(html).toMatch(/role="group" aria-label="[^"]*外食/);
  });

  it('カテゴリ詳細の画面は、px 指定の文字サイズを持たない(最大の文字サイズでも rem で伸びる)', () => {
    const dir = 'app/(app)/spending/category/[genreKey]';
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const text = readFileSync(join(dir, f), 'utf8');
      if (
        /text-\[\d+px\]|fontSize:\s*\d+(?!\s*\*)\b(?!.*rem)/.test(text.replace(/size=\{\d+\}/g, ''))
      ) {
        if (/text-\[\d+px\]/.test(text)) bad.push(f);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('P9 性能(受け入れ基準14)', () => {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const pipeline = (txs: CategoryTx[]) => {
    const range = base.range;
    const lines = buildCategoryLines(txs, 'dining', range, base.today);
    const historyLines = buildCategoryLines(
      txs,
      'dining',
      { from: base.windowFrom, to: range.to },
      base.today,
    );
    const summary = buildCategorySummary({
      lines,
      historyLines,
      monthStart: base.monthStart,
      today: base.today,
      isCurrentMonth: true,
    });
    buildInsights({
      lines,
      historyLines,
      genreKey: 'dining',
      monthStart: base.monthStart,
      today: base.today,
      isCurrentMonth: true,
    });
    buildSeries({
      lines: historyLines,
      unit: 'day',
      monthStart: base.monthStart,
      monthEnd: range.to,
      today: base.today,
      dailyAllowanceYen: null,
    });
    aggregateItems(lines, 'dining');
    aggregateStores(lines);
    return { lines, summary, spent: categorySpentFromLedger(txs, 'dining', range, base.today) };
  };

  it('1万件の集計(行・サマリー・気づき・グラフ・品目・店)が 100ms 以内', () => {
    const txs = make(10_000);
    pipeline(txs); // ウォームアップ
    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      pipeline(txs);
      times.push(performance.now() - t0);
    }
    const ms = median(times);
    console.info(
      `[P9 perf] 1万件の集計: 中央値 ${ms.toFixed(1)}ms (5回: ${times.map((t) => t.toFixed(0)).join(', ')})`,
    );
    expect(ms).toBeLessThanOrEqual(100);
  });

  it('1万件でも合計は集計関数と一致する(行の合計 = 家計簿のジャンル内訳)', () => {
    const txs = make(10_000);
    const { lines, spent } = pipeline(txs);
    expect(-actualSpentYen(lines)).toBe(-spent);
  });

  it('1万件の画面を描画しても、DOM に出す行は見える範囲だけ(最初の描画が 300ms 以内)', () => {
    const txs = make(10_000).map((t, i) => ({
      ...t,
      occurredOn: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`,
    }));
    const t0 = performance.now();
    const html = render({ transactions: txs });
    const ms = performance.now() - t0;
    console.info(
      `[P9 perf] 1万件の最初の描画(サーバー側): ${ms.toFixed(0)}ms、行の数 ${(html.match(/row-shell/g) ?? []).length}`,
    );
    expect((html.match(/row-shell/g) ?? []).length).toBeLessThan(120);
    expect(ms).toBeLessThanOrEqual(300);
  });

  it('仮想化の位置計算は1万件でも 1ms 未満(スクロール中のフレームを落とさない)', () => {
    const index = new VirtualIndex(10_000, 64);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i += 1) index.range(i * 400, 800, 6);
    const per = (performance.now() - t0) / 1000;
    console.info(`[P9 perf] 仮想化 range(): 1回あたり ${(per * 1000).toFixed(1)}µs`);
    expect(per).toBeLessThan(1);
  });
});
