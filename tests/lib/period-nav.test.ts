import { describe, expect, it } from 'vitest';

import { EMPTY_FILTER } from '@/features/spending/views';
import { categoryHref, monthHref } from '@/lib/category-nav';
import {
  monthReviewHref,
  resolveCalendarMonthStart,
  safeInternalHref,
  validMonthKey,
} from '@/lib/period-nav';
import { parseViewState, serializeViewState, viewStateKey } from '@/lib/scroll';

describe('選択月と戻り先の継承', () => {
  it('通常カテゴリも月単位で開き、元の分析へ戻れるURLを持つ', () => {
    const returnTo = monthReviewHref('2026-09-01');
    const href = categoryHref('dining', '2026-09-01', { period: 'month', returnTo });
    const url = new URL(href, 'https://example.test');
    expect(url.pathname).toBe('/spending/category/dining');
    expect(url.searchParams.get('month')).toBe('2026-09');
    expect(url.searchParams.get('period')).toBe('month');
    expect(url.searchParams.get('returnTo')).toBe('/reports/month?month=2026-09');
    expect(monthHref('dining', '2026-08', { period: 'month', returnTo })).toContain(
      'returnTo=%2Freports%2Fmonth%3Fmonth%3D2026-09',
    );
  });

  it('月の値を検証し、月切替の範囲外や不正な月は今月に戻す', () => {
    expect(validMonthKey(['2026-09', '2026-10'])).toBe('2026-09');
    for (const value of ['2026-13', '2026-00', '2026-09x', '2026-09-01', '//example.test']) {
      expect(validMonthKey(value)).toBeNull();
      expect(resolveCalendarMonthStart(value, '2026-10-01')).toBe('2026-10-01');
    }
    expect(resolveCalendarMonthStart('2016-10', '2026-10-01')).toBe('2016-10-01');
    expect(resolveCalendarMonthStart('2016-09', '2026-10-01')).toBe('2026-10-01');
    expect(resolveCalendarMonthStart('2028-10', '2026-10-01')).toBe('2028-10-01');
    expect(resolveCalendarMonthStart('2028-11', '2026-10-01')).toBe('2026-10-01');
  });

  it('戻り先からアプリ外へ出るURLを渡さない', () => {
    const fallback = '/reports/month';
    for (const value of ['https://example.test', '//example.test', '/\\example.test', '/\n/x']) {
      expect(safeInternalHref(value, fallback)).toBe(fallback);
    }
    expect(safeInternalHref('/reports/month?month=2026-09', fallback)).toBe(
      '/reports/month?month=2026-09',
    );
  });
});

describe('表示月・絞り込み・位置の復元', () => {
  it('過去月の条件と位置を一緒に保存し、明細と分析は互いを上書きしない', () => {
    const state = {
      monthStart: '2026-09-01',
      filter: { ...EMPTY_FILTER, genreId: 'dining', date: '2026-09-14' },
      scrollY: 620,
      savedAt: 1_000,
    };
    expect(parseViewState(serializeViewState(state), 2_000)).toEqual(state);
    expect(viewStateKey('/spending')).toBe('spending:view-state');
    expect(viewStateKey('/reports/month')).not.toBe(viewStateKey('/spending'));
  });

  it('旧保存データも読め、壊れた表示月は条件の復元を妨げない', () => {
    const state = { filter: EMPTY_FILTER, scrollY: 42, savedAt: 1_000 };
    expect(parseViewState(serializeViewState(state), 2_000)).toEqual(state);
    expect(
      parseViewState(serializeViewState({ ...state, monthStart: '2026-09-99' }), 2_000),
    ).toEqual(state);
  });
});
