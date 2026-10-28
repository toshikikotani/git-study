/**
 * 曜日のくせ:曜日ごとの合計と1日平均(本人「曜日ごとに合計と平均を知りたい」、ADR-137)。
 */
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WeekdayHabit } from '../../app/(app)/reports/weekday-habit';
import { weekdayAverage, weekdayHabit } from '../../app/(app)/reports/weekday-habit-data';
import type { LedgerTransaction } from '../../src/features/spending/ledger-types';

const tx = (occurredOn: string, yen: number, genreName: string | null, extra = {}) =>
  ({
    occurredOn,
    amountYen: -yen,
    genreName,
    isTransfer: false,
    reviewStatus: 'auto_ok',
    needsInput: false,
    status: 'actual',
    ...extra,
  }) as unknown as LedgerTransaction;

const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('曜日ごとの合計と日数', () => {
  // 2026-10-25 は日曜。
  const range = { from: '2026-10-25', to: '2026-11-07' };

  it('合計は表に出さないカテゴリも入れる。日数は範囲の中のその曜日の数', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const data = weekdayHabit(
      [
        ...names.map((n, i) => tx('2026-10-26', 1000 * (i + 1), n)), // 月曜に7カテゴリ
        tx('2026-11-02', 500, 'A'), // 次の月曜
        tx('2026-10-27', 300, null), // 火曜・未分類
      ],
      range,
    );
    expect(data.rows).toHaveLength(6);
    expect(data.rows.map((r) => r.name)).not.toContain('A'); // いちばん少ない A(1,500円)は表から外れる
    expect(data.totals[1]).toBe(28000 + 500);
    expect(data.totals[2]).toBe(300);
    expect(data.dayCounts).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(weekdayAverage(data, 1)).toBe(14250);
    expect(weekdayAverage(data, 3)).toBe(0);
  });

  it('予定・振替・対象外・入力待ち・範囲の外は数えない', () => {
    const data = weekdayHabit(
      [
        tx('2026-10-26', 1000, 'A'),
        tx('2026-10-26', 9000, 'A', { status: 'scheduled' }),
        tx('2026-10-26', 9000, 'A', { isTransfer: true }),
        tx('2026-10-26', 9000, 'A', { reviewStatus: 'ignored' }),
        tx('2026-10-26', 9000, 'A', { needsInput: true }),
        tx('2026-10-24', 9000, 'A'),
      ],
      range,
    );
    expect(data.totals[1]).toBe(1000);
  });

  it('まだ来ていない曜日の平均は無し(null)', () => {
    const data = weekdayHabit([tx('2026-10-26', 700, 'A')], {
      from: '2026-10-25',
      to: '2026-10-27',
    });
    expect(data.dayCounts).toEqual([1, 1, 1, 0, 0, 0, 0]);
    expect(weekdayAverage(data, 1)).toBe(700);
    expect(weekdayAverage(data, 4)).toBeNull();
  });
});

describe('図の下の合計と1日平均の行', () => {
  const data = weekdayHabit(
    [
      tx('2026-10-25', 1200, '食料品'),
      tx('2026-10-26', 3400, '外食'),
      tx('2026-10-27', 25000, '日用品'),
      tx('2026-11-01', 800, '食料品'),
    ],
    { from: '2026-10-25', to: '2026-11-01' },
  );
  const html = visible(renderToString(h(WeekdayHabit, { data })));

  it('合計と1日平均の行が、曜日ごとに出る', () => {
    expect(html).toContain('>合計</span>');
    expect(html).toContain('>1日平均</span>');
    // 日曜:合計 2,000円・2日 → 1日平均 1,000円。火曜:2.5万。
    expect(html).toContain('aria-label="日曜の合計 2,000円"');
    expect(html).toContain('aria-label="日曜の1日平均 1,000円"');
    expect(html).toContain('>2,000</span>');
    expect(html).toContain('>2.5万</span>');
    expect(html).toContain('aria-label="火曜の1日平均 25,000円"');
  });

  it('いちばん多い曜日(1日平均)を太字で示し、文もその曜日にする', () => {
    expect(html).toMatch(/aria-label="火曜の1日平均 25,000円" class="[^"]*font-bold/);
    expect(html).toContain('火曜の日用品がいちばん多め');
  });

  it('日数の注記(記録のない日も入れる)', () => {
    expect(html).toContain(
      '合計はすべてのカテゴリ。1日平均は、その曜日1日あたり(今期のこれまで1〜2日。記録のない日も入れる)。',
    );
  });

  it('まだ来ていない曜日は「—」', () => {
    const early = weekdayHabit([tx('2026-10-26', 700, 'A')], {
      from: '2026-10-25',
      to: '2026-10-27',
    });
    const out = visible(renderToString(h(WeekdayHabit, { data: early })));
    expect(out).toContain('aria-label="木曜 まだありません"');
    expect(out).toContain('>—</span>');
    // まだ来ていない曜日は日数に数えない(「0〜1日」としない)。
    expect(out).toContain('今期のこれまで各1日。');
  });
});
