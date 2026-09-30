import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/spending/category/transport',
}));

import { CategoryChart } from '../../app/(app)/spending/category/[genreKey]/category-chart';
import { CategoryScreen } from '../../app/(app)/spending/category/[genreKey]/category-screen';
import type { CategoryDetailData } from '../../src/features/category/loader';
import { buildCategoryLines, type CategoryTx } from '../../src/features/category/model';
import { buildCumulative } from '../../src/features/category/pace';
import { buildSeries } from '../../src/features/category/series';
import { ledgerTx } from '../helpers/ledger';

const visible = (html: string) => html.replace(/<!-- -->/g, '');
const TODAY = '2026-09-29';
const tx = (o: Parameters<typeof ledgerTx>[0]): CategoryTx => ({ ...ledgerTx(o), items: [] });
const t = (id: string, date: string, yen: number, extra: Partial<CategoryTx> = {}) =>
  tx({
    id,
    occurredOn: date,
    genreId: 'transport',
    genreName: '交通・車両',
    amountYen: -yen,
    ...extra,
  });

const txs = [
  t('a', '2026-09-21', 900),
  t('b', '2026-09-27', 1600),
  t('s', '2026-09-30', 500, { status: 'scheduled' }),
];

const renderChart = (
  mode: 'cumulative' | 'daily',
  o: { allowance?: number | null; goal?: boolean; data?: CategoryTx[] } = {},
) => {
  const lines = buildCategoryLines(
    o.data ?? txs,
    'transport',
    { from: '2026-03-01', to: '2026-09-30' },
    TODAY,
  );
  const series = buildSeries({
    lines,
    unit: 'day',
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
    today: TODAY,
    dailyAllowanceYen: o.allowance ?? null,
  });
  return visible(
    renderToString(
      h(CategoryChart, {
        series,
        cumulative: buildCumulative({
          lines,
          monthStart: '2026-09-01',
          monthEnd: '2026-09-30',
          today: TODAY,
          recordStart: series.recordStart,
          goal: o.goal
            ? { range: { from: '2026-09-25', to: '2026-10-04' }, budgetYen: 5000 }
            : null,
        }),
        mode,
        onMode: () => {},
        genreName: '交通・車両',
        monthLabel: '9月',
        showPrevious: true,
        onShowPrevious: () => {},
        onUnit: () => {},
        onPick: () => {},
        selectedIndex: null,
      }),
    ),
  );
};

describe('R2 累計モード(受け入れ基準5・6)', () => {
  const html = renderChart('cumulative', { goal: true });

  it('実線(累計)・点線(理想ペース)・予測の帯・予定の白抜きの段差・先端の点', () => {
    expect(html).toContain('data-actual');
    expect(html).toContain('data-ideal');
    expect(html).toContain('data-forecast-band');
    expect(html).toContain('data-scheduled-step');
  });

  it('先端の横に「理想より○円少ない / 多い」', () => {
    // 9/25〜10/4、予算5,000円、9/24までの実績 900円。9/29:実際 2,500、理想 900+2,500=3,400 → 900円少ない
    expect(html).toContain('理想より900円少ない');
  });

  it('横軸は記録開始日から(左端に「9/21 記録開始」)。ラベルは折り返さない(nowrap)・最大5個', () => {
    expect(html).toContain('9/21 記録開始');
    const axis = html.slice(html.indexOf('tabular relative mt-1 h-4'));
    const labels = axis.slice(0, axis.indexOf('</ul>') > 0 ? axis.indexOf('sr-only') : undefined);
    const count = (labels.match(/whitespace-nowrap/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(5);
  });

  it('日別のタブは累計のときは出さない(単位の切り替えは日別だけ)', () => {
    expect(html).not.toContain('>週</button>');
    expect(html).toContain('>累計</button>');
    expect(html).toContain('>日別</button>');
  });
});

describe('R2 日別モード', () => {
  it('棒の上端は4pt・幅は最大12pt', () => {
    const html = renderChart('daily', { allowance: 663 });
    expect(html).toContain('border-radius:4px 4px 0 0');
    expect(html).toContain('max-width:12px');
  });

  it('その日の目安を超えた部分だけを注意の色に塗り分ける', () => {
    const html = renderChart('daily', { allowance: 663 });
    // 9/21(900円)と 9/27(1,600円)は目安 663円を超える
    expect((html.match(/data-over-allowance/g) ?? []).length).toBe(2);
    expect(html).toContain('background:var(--state-caution)');
    expect(renderChart('daily')).not.toContain('data-over-allowance');
  });

  it('予定の支出の日は斜線の棒', () => {
    expect(renderChart('daily')).toContain('repeating-linear-gradient(45deg');
  });
});

describe('R2 画面の初期表示は「累計」', () => {
  it('セグメントで累計が選ばれている', () => {
    const data = {
      genreKey: 'transport',
      genreName: '交通・車両',
      genreBudgetYen: null,
      monthKey: '2026-09',
      monthStart: '2026-09-01',
      today: TODAY,
      isCurrentMonth: true,
      range: { from: '2026-09-01', to: '2026-09-30' },
      windowFrom: '2026-03-01',
      transactions: txs,
      genres: [{ id: 'transport', name: '交通・車両' }],
      accounts: [{ id: 'a', name: '現金' }],
      genreHistory: [],
      goal: null,
    } as CategoryDetailData;
    const html = visible(renderToString(h(CategoryScreen, { data })));
    expect(html).toMatch(/aria-selected="true"[^>]*>累計</);
    expect(html).toContain('data-actual');
  });
});

describe('R3 補助線とラベル', () => {
  const html = renderChart('daily', { allowance: 663 });

  it('目安(破線・濃い)と平均(点線・薄い)は、線の種類と濃さが違う', () => {
    expect(html).toMatch(
      /data-line="allowance"[^>]*border-top:1\.5px dashed var\(--ink-secondary\)/,
    );
    expect(html).toMatch(/data-line="average"[^>]*border-top:1\.5px dotted color-mix/);
  });

  it('「目安」「平均」のタグは、描画領域の外(右の余白)に置く', () => {
    // 描画領域(ref=plot の div)の中にタグの文言が入っていない
    const plotStart = html.indexOf('relative h-full w-full touch-pan-y');
    const gutterStart = html.indexOf('pointer-events-none absolute inset-y-0 right-0');
    expect(gutterStart).toBeGreaterThan(plotStart);
    const inPlot = html.slice(plotStart, gutterStart);
    expect(inPlot).not.toContain('>目安<');
    expect(inPlot).not.toContain('>平均<');
    const gutter = html.slice(gutterStart);
    expect(gutter).toContain('>目安<');
    expect(gutter).toContain('>平均<');
  });

  it('補助線は2本(半分と上限)+基準線。基準線だけ少し濃く、どれも1pxの細い線。縦の補助線は無い', () => {
    expect(
      (html.match(/border-top:1px solid color-mix\(in srgb, var\(--ink\) 10%/g) ?? []).length,
    ).toBe(2);
    expect(html).toContain('border-top:1px solid color-mix(in srgb, var(--ink) 22%');
    expect(html).not.toMatch(/border-left:1px solid color-mix\(in srgb, var\(--ink\) 10%/);
  });

  it('金額の目盛りは右の余白に短く(1,000 / 2,500 など)', () => {
    const gutter = html.slice(html.indexOf('pointer-events-none absolute inset-y-0 right-0'));
    expect(gutter).toMatch(/>1,000</);
    expect(gutter).toMatch(/>2,000</);
  });

  it('1日平均には対象期間(9/21〜)を添える', () => {
    expect(html).toContain('1日平均(9/21〜)');
  });

  it('吹き出しの置き場はグラフの上部に固定(位置が動かない)。なぞっていないときは空', () => {
    expect(html).toContain('flex min-h-8 items-center');
    expect(html).not.toContain('role="status"');
  });
});
