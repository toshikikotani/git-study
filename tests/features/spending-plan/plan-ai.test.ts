import { describe, expect, it } from 'vitest';

import type { PlanContext, PlanGenreContext } from '@/features/spending-plan/context';
import {
  applyRefinement,
  mergeSuggestions,
  refinePlanAllocation,
  suggestPlanTargets,
  type RefineItem,
} from '@/features/spending-plan/plan-ai';

function genre(overrides: Partial<PlanGenreContext>): PlanGenreContext {
  return {
    genreId: 'g1',
    genreName: '外食',
    budgetYen: null,
    baselineYen: 30000,
    mustPayShare: 0,
    isIssue: true,
    issueReasons: ['直近30日で30%増加'],
    dailyYen: 1000,
    wasteShare: null,
    trendRatio: 1.3,
    previous: null,
    ...overrides,
  };
}

function context(genres: PlanGenreContext[]): PlanContext {
  return { periodDays: 30, lookbackDays: 60, genres, uncategorizedYen: 0 };
}

describe('mergeSuggestions', () => {
  it('AIの提案は範囲(実績を超えない・削る幅の上限)に収める', () => {
    const items = mergeSuggestions(
      context([genre({}), genre({ genreId: 'g2', genreName: '食料品', isIssue: false })]),
      [
        { genre_name: '外食', target_yen: 1000, reason: '増加傾向 → 10%削減' },
        { genre_name: '食料品', target_yen: 99999, reason: '課題なし → 現状維持' },
      ],
      10,
    );
    expect(items[0]).toMatchObject({ suggestedYen: 27000, reason: '増加傾向 → 10%削減' });
    expect(items[1]?.suggestedYen).toBe(30000);
  });

  it('AIの行が無いジャンルは決め打ちで埋める', () => {
    const items = mergeSuggestions(context([genre({})]), [], 10);
    expect(items[0]).toMatchObject({
      suggestedYen: 27000,
      reason: '直近30日で30%増加 → まず10%削減',
    });
  });

  it('課題が無いジャンルは現状維持、実績が無ければ0円', () => {
    const items = mergeSuggestions(
      context([
        genre({ isIssue: false, issueReasons: [] }),
        genre({ genreId: 'g2', genreName: '旅行', baselineYen: 0, isIssue: false }),
      ]),
      [],
      10,
    );
    expect(items[0]).toMatchObject({ suggestedYen: 30000, reason: '課題なし → 現状維持' });
    expect(items[1]).toMatchObject({ suggestedYen: 0, reason: '実績なし → 0円' });
  });
});

describe('suggestPlanTargets', () => {
  it('APIキーが無ければ決め打ちで提案し、その旨を警告する', async () => {
    const result = await suggestPlanTargets(null, context([genre({})]), 10);
    expect(result.usedAi).toBe(false);
    expect(result.items[0]?.suggestedYen).toBe(27000);
    expect(result.warnings[0]).toContain('APIキー');
  });
});

describe('applyRefinement', () => {
  const items: RefineItem[] = [
    { genreId: 'g1', genreName: '外食', currentYen: 30000, baselineYen: 30000, mustPayShare: 0 },
    { genreId: 'g2', genreName: '旅行', currentYen: 10000, baselineYen: 10000, mustPayShare: 0 },
  ];
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  it('AIの答えの合計がずれていても、総額にそろえる', () => {
    const result = applyRefinement(items, 40000, [
      { genre_name: '外食', target_yen: 20000 },
      { genre_name: '旅行', target_yen: 15000 },
    ]);
    expect(sum(result)).toBe(40000);
    expect(result.get('g1')! < 30000).toBe(true);
  });

  it('答えの無いジャンルは現状の額から始め、負にならない', () => {
    const result = applyRefinement(items, 40000, [{ genre_name: '外食', target_yen: -5000 }]);
    expect(sum(result)).toBe(40000);
    expect([...result.values()].every((x) => x >= 0)).toBe(true);
  });
});

describe('refinePlanAllocation', () => {
  it('APIキーが無ければ手動を案内して失敗を返す', async () => {
    const result = await refinePlanAllocation(null, {
      periodDays: 30,
      totalYen: 40000,
      items: [],
      instruction: '外食を減らしたい',
    });
    expect(result).toMatchObject({ ok: false });
  });
});
