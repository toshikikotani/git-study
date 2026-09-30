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

import { CategoryChart } from '../../app/(app)/spending/category/[genreKey]/category-chart';
import { monthRange } from '@/domain/ledger';
import { buildCategoryLines, type CategoryTx } from '@/features/category/model';
import { buildCumulative } from '@/features/category/pace';
import { MAX_BARS, buildSeries, type ChartUnit } from '@/features/category/series';
import { ledgerTx } from '../helpers/ledger';

const visible = (html: string) => html.replace(/<!-- -->/g, '');
const TODAY = '2026-09-29';
const tx = (o: Parameters<typeof ledgerTx>[0]): CategoryTx => ({ ...ledgerTx(o), items: [] });
const lines = buildCategoryLines(
  [
    tx({ id: 'a', occurredOn: '2026-09-27', genreId: 'dining', amountYen: -2830 }),
    tx({ id: 'c', occurredOn: '2026-09-05', genreId: 'dining', amountYen: -1200 }),
    tx({
      id: 's',
      occurredOn: '2026-09-30',
      genreId: 'dining',
      amountYen: -5000,
      status: 'scheduled',
    }),
    tx({ id: 'p', occurredOn: '2026-08-05', genreId: 'dining', amountYen: -1000 }),
  ],
  'dining',
  { from: '2026-03-01', to: '2026-09-30' },
  TODAY,
);
const render = (
  unit: ChartUnit,
  allowance: number | null = null,
  showPrevious = true,
  mode: 'cumulative' | 'daily' = 'daily',
) => {
  const series = buildSeries({
    lines,
    unit,
    monthStart: '2026-09-01',
    monthEnd: monthRange('2026-09').to,
    today: TODAY,
    dailyAllowanceYen: allowance,
  });
  return visible(
    renderToString(
      h(CategoryChart, {
        series,
        cumulative: buildCumulative({
          lines,
          monthStart: '2026-09-01',
          monthEnd: monthRange('2026-09').to,
          today: TODAY,
          recordStart: series.recordStart,
          goal: null,
        }),
        mode,
        onMode: () => {},
        genreName: '外食',
        monthLabel: '9月',
        showPrevious,
        onShowPrevious: () => {},
        onUnit: () => {},
        onPick: () => {},
        selectedIndex: null,
      }),
    ),
  );
};

describe('P4 グラフの画面', () => {
  const html = render('day', 2300);

  it('日 / 週 / 月 の切り替えと、前期間と比べるスイッチ(どちらも44pt以上)', () => {
    for (const u of ['日', '週', '月']) expect(html).toContain(`>${u}</button>`);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('前期間と比べる');
    expect((html.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('1日平均(点線)と、目標期間中は1日の目安の線(破線)。目標が無いときは目安の線が無い', () => {
    expect(html).toContain('data-line="average"');
    expect(html).toContain('data-line="allowance"');
    expect(render('day')).not.toContain('data-line="allowance"');
  });

  it('予定のある日は、斜線の棒', () => {
    expect(html).toContain('repeating-linear-gradient(45deg');
  });

  it('棒は31本ぶんの部品を使い回す(単位を切り替えても本数が変わらず、滑らかに変形する)', () => {
    for (const u of ['day', 'week', 'month'] as const) {
      const bars = (render(u).match(/chart-bar absolute bottom-0/g) ?? []).length;
      expect(bars).toBe(MAX_BARS * 2); // 前期間の影 + 実績
    }
    expect(readCss()).toContain('.chart-bar');
    expect(readCss()).toMatch(/\.chart-bar\s*\{\s*transition:[^}]*var\(--motion-spring\)/);
  });

  it('前期間を重ねない設定では、影の棒の高さが0になる', () => {
    const on = render('day', null, true);
    const off = render('day', null, false);
    expect(on).toMatch(/height:[1-9][\d.]*%;background:color-mix\(in srgb, var\(--ink\) 12%/);
    expect(off).not.toMatch(/height:[1-9][\d.]*%;background:color-mix\(in srgb, var\(--ink\) 12%/);
  });

  it('VoiceOver:グラフの要約をラベルにし、区間ごとのボタン(金額・件数)がある。音で聞くボタンもある', () => {
    expect(html).toContain('aria-label="9月の外食、日別。最大は9月27日の2,830円');
    expect(render('day', null, true, 'cumulative')).toContain(
      'aria-label="9月の外食、累計。4,030円',
    );
    expect(html).toContain('<button type="button" class="min-h-11">9/27(日) 2,830円 1件</button>');
    expect(html).toContain('音で聞く');
    expect(html).toContain('長押ししてなぞると');
  });
});

import { readFileSync } from 'node:fs';
function readCss(): string {
  return readFileSync('app/globals.css', 'utf8');
}
