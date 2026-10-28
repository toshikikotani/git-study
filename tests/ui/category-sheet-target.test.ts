/**
 * カテゴリのシートの見通し:「目標」は今の目標、変えている途中の額は「変更後」(本人「目標の位置違う」、ADR-139)。
 */
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

import { CategoryChart, CategorySheetBody } from '../../app/(app)/category-sheet';
import type { CategorySheetData } from '../../app/(app)/category-sheet-actions';
import type { CumulativeDay } from '../../src/features/category/pace';

const visible = (html: string) => html.replace(/<!-- -->/g, '');

/** 10/1〜11/5 の36日。28日めまでの実績が 45,975円、その先は見込み。 */
function days(spent: number, p50: number): CumulativeDay[] {
  const n = 36;
  const today = 27;
  return Array.from({ length: n }, (_, i) => {
    const actual = i <= today ? Math.round((spent * (i + 1)) / (today + 1)) : null;
    const forecast =
      i < today ? null : Math.round(spent + ((p50 - spent) * (i - today)) / (n - 1 - today));
    return {
      index: i,
      date: `2026-${i < 31 ? '10' : '11'}-${String(i < 31 ? i + 1 : i - 30).padStart(2, '0')}`,
      actualYen: actual,
      forecastYen: forecast,
      forecastLowYen: forecast === null ? null : forecast - 1000,
      forecastHighYen: forecast === null ? null : forecast + 3000,
    } as unknown as CumulativeDay;
  });
}

/** 目標の線(stroke が --ink の横線)の y。 */
function lineY(html: string, stroke: string): number | null {
  const m = html.match(new RegExp(`<line x1="8" y1="([\\d.]+)"[^>]*stroke="var\\(${stroke}\\)"`));
  return m ? Number(m[1]) : null;
}

describe('見通しのグラフの目標', () => {
  it('こえているとき、「目標」の線は使った額より下(今の目標の高さ)', () => {
    const html = renderToString(
      h(CategoryChart, {
        days: days(45975, 49000),
        target: 43108,
        draft: 49000,
        name: '外食',
        endLabel: '11/5',
        p50: 49000,
      }),
    );
    const target = lineY(html, '--ink');
    const draft = lineY(html, '--accent');
    expect(target).not.toBeNull();
    expect(draft).not.toBeNull();
    // SVG は下へいくほど y が大きい。目標(43,108円)は変更後(49,000円)より下。
    expect(target!).toBeGreaterThan(draft!);
    expect(html).toContain('>目標</text>');
    expect(html).toContain('>変更後</text>');
    expect(html).toContain('目標は43,108円。変更後は49,000円。');
  });

  it('変えていなければ「変更後」は出さない', () => {
    const html = renderToString(
      h(CategoryChart, {
        days: days(20000, 30000),
        target: 40000,
        name: '外食',
        endLabel: '11/5',
        p50: 30000,
      }),
    );
    expect(html).toContain('>目標</text>');
    expect(html).not.toContain('変更後');
  });
});

describe('こえているときのシート', () => {
  const data: CategorySheetData = {
    outlook: {
      genreId: 'dining',
      name: '外食',
      targetYen: 43108,
      untargeted: false,
      spentYen: 45975,
      scheduledYen: 0,
      lastMonthYen: 11266,
      p10: 47000,
      p50: 49000,
      p90: 53000,
      caution: null,
      fixed: false,
      sub: null,
      days: days(45975, 49000),
    },
    planId: 'p1',
    periodStart: '2026-10-01',
    periodEnd: '2026-11-05',
    today: '2026-10-28',
    remainingDays: 9,
    isFixed: false,
    planTotalYen: 120000,
  };
  const html = visible(
    renderToString(h(CategorySheetBody, { data, onCancel: () => {}, onDone: () => {} })),
  );

  it('「収まりそう」と言わない。今の目標で「こえそう」と言う', () => {
    expect(html).toContain('目標 43,108円を 2,867円 こえています');
    expect(html).not.toContain('このペースなら収まりそう');
    expect(html).toContain('このままだと');
    expect(html).toContain('こえそう');
  });

  it('見直しの案は「変更後」の線で、目標の線とは別に出す', () => {
    expect(html).toContain('>目標</text>');
    expect(html).toContain('>変更後</text>');
  });
});
