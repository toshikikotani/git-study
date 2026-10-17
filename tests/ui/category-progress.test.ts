import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('../../app/(app)/reports/progress-actions', () => ({
  setTargetsFromOutlookAction: vi.fn(),
}));

import { CategoryProgress } from '../../app/(app)/reports/category-progress';
import { goalForecastArgs } from '@/features/forecast/goal';
import { ADDED_FROM_SPENDING } from '@/features/spending-plan/markers';

const visible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ');

/** 分析 › 目標の進み具合(デザイン v3-6、ADR-108)。 */
describe('カテゴリの進み具合:気をつけたい / 順調 / 目標なし', () => {
  const text = visible(
    renderToString(
      h(CategoryProgress, {
        rows: [
          {
            genreId: 'h',
            name: '娯楽・趣味',
            spentYen: 41590,
            targetYen: 33300,
            p50: 47590,
            fixed: false,
            tone: 'over',
          },
          {
            genreId: 'o',
            name: '外食',
            spentYen: 29452,
            targetYen: 42500,
            p50: 46000,
            fixed: false,
            tone: 'risk',
          },
          {
            genreId: 't',
            name: '交通・車両',
            spentYen: 15660,
            targetYen: 23400,
            p50: 22000,
            fixed: false,
            tone: 'ok',
          },
        ],
        untargeted: [
          { genreId: 'i', name: '保険・税金・手数料', spentYen: 32000, p50: 32000, fixed: true },
          { genreId: 'd', name: '日用品', spentYen: 1878, p50: 4600, fixed: false },
        ],
      }),
    ),
  );

  it('こえた・こえそうは「気をつけたい」、目標内は「順調」に分ける', () => {
    expect(text).toContain('気をつけたい');
    expect(text).toContain('こえた');
    expect(text).toContain('こえそう');
    expect(text).toContain('順調');
    expect(text).toContain('目標内の見込み');
    expect(text.indexOf('娯楽・趣味')).toBeLessThan(text.indexOf('交通・車両'));
  });

  it('「期間中の支出から追加」は目標なしとして、見込みだけを出し、目標をつけるボタン', () => {
    expect(text).toContain('目標なし');
    expect(text).toContain('見込みだけ表示');
    expect(text).toContain('保険・税金・手数料');
    expect(text).toContain('固定費');
    expect(text).toContain('見込み 約4,600円');
    expect(text).toContain('見込みに合わせて目標をつける');
  });
});

describe('目標なしの扱い(ADR-108)', () => {
  it('予測のカテゴリの目標には入れず、目標の合計には入れたまま', () => {
    const args = goalForecastArgs({
      id: 'p1',
      periodStart: '2026-10-01',
      periodEnd: '2026-11-05',
      items: [
        { genreId: 'h', genreName: '娯楽・趣味', targetYen: 33300, reason: null },
        { genreId: 'i', genreName: '保険', targetYen: 32000, reason: ADDED_FROM_SPENDING },
      ],
    } as never);
    expect(args?.budgetYen).toBe(65300);
    expect(args?.categoryTargets.map((t) => t.categoryId)).toEqual(['h']);
  });

  it('本人が額を決めたら印を外す(⑥で額を変えた・⑦で保存・見込みに合わせて目標をつける)', () => {
    const store = readFileSync('src/features/spending-plan/store.ts', 'utf8');
    expect(store).toContain(
      'row?.reason === ADDED_FROM_SPENDING && row.target_yen !== item.targetYen',
    );
    const actions = readFileSync('app/(app)/category-sheet-actions.ts', 'utf8');
    expect(actions).toContain('addPlanGenre(planId, genreId, targetYen, null)');
    const progress = readFileSync('app/(app)/reports/progress-actions.ts', 'utf8');
    expect(progress).toContain('markTargetsChosen(');
  });
});
