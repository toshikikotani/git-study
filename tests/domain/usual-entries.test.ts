import { describe, expect, it } from 'vitest';

import {
  isWeekendDay,
  suggestUsualEntries,
  timeSegmentOf,
  type UsualEntryHistoryRow,
} from '@/domain/usual-entries';

describe('timeSegmentOf', () => {
  it('5〜10時は朝', () => {
    expect(timeSegmentOf(5)).toBe('morning');
    expect(timeSegmentOf(10)).toBe('morning');
  });
  it('11〜16時は昼', () => {
    expect(timeSegmentOf(11)).toBe('afternoon');
    expect(timeSegmentOf(16)).toBe('afternoon');
  });
  it('17〜21時は夕方', () => {
    expect(timeSegmentOf(17)).toBe('evening');
    expect(timeSegmentOf(21)).toBe('evening');
  });
  it('22時〜4時は夜', () => {
    expect(timeSegmentOf(22)).toBe('night');
    expect(timeSegmentOf(0)).toBe('night');
    expect(timeSegmentOf(4)).toBe('night');
  });
});

describe('isWeekendDay', () => {
  it('日曜(0)・土曜(6)は休日', () => {
    expect(isWeekendDay(0)).toBe(true);
    expect(isWeekendDay(6)).toBe(true);
  });
  it('月〜金は平日', () => {
    for (const d of [1, 2, 3, 4, 5]) expect(isWeekendDay(d)).toBe(false);
  });
});

function row(overrides: Partial<UsualEntryHistoryRow>): UsualEntryHistoryRow {
  return {
    storeName: 'ココカラファイン',
    genreId: 'g-drink',
    genreName: 'カフェ・飲料',
    amountYen: 127,
    weekday: 2, // 火曜(平日)
    hour: 8, // 朝
    ...overrides,
  };
}

describe('suggestUsualEntries(N2本人要件「いつもの」予測)', () => {
  it('同じ曜日区分・時間帯の組み合わせを頻度順に最大3件出す', () => {
    const history: UsualEntryHistoryRow[] = [
      row({}),
      row({}),
      row({}),
      row({ storeName: 'セブンイレブン', genreId: 'g-food', genreName: '食費', amountYen: 300 }),
      row({ storeName: 'セブンイレブン', genreId: 'g-food', genreName: '食費', amountYen: 300 }),
      row({ storeName: 'スターバックス', genreId: 'g-drink', amountYen: 500, weekday: 3, hour: 9 }),
    ];
    const result = suggestUsualEntries(history, { weekday: 1, hour: 8 }, 3);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ storeName: 'ココカラファイン', occurrences: 3 });
    expect(result[1]).toMatchObject({ storeName: 'セブンイレブン', occurrences: 2 });
  });

  it('平日/休日で時間帯が同じでも曜日区分が違えば別枠として扱う', () => {
    const history: UsualEntryHistoryRow[] = [
      row({ weekday: 0 /* 休日 */ }), // 休日の朝
    ];
    // 平日の朝に問い合わせても、休日データは第1候補に混ざらない(件数不足で
    // fallback には出るが、区分が違う印として occurrences は同じ1のまま)。
    const result = suggestUsualEntries(history, { weekday: 2 /* 平日 */, hour: 8 }, 3);
    expect(result).toHaveLength(1);
    expect(result[0]?.storeName).toBe('ココカラファイン');
  });

  it('一致する時間帯の候補が足りない場合、全期間の頻度でも埋める', () => {
    const history: UsualEntryHistoryRow[] = [
      // 夜によく行く店(3回)
      row({ storeName: '夜の店', weekday: 2, hour: 23 }),
      row({ storeName: '夜の店', weekday: 2, hour: 23 }),
      row({ storeName: '夜の店', weekday: 2, hour: 23 }),
    ];
    // 朝に問い合わせても一致0件のため、fallback で夜の店が埋まる。
    const result = suggestUsualEntries(history, { weekday: 2, hour: 8 }, 3);
    expect(result).toHaveLength(1);
    expect(result[0]?.storeName).toBe('夜の店');
  });

  it('候補が無ければ空配列', () => {
    expect(suggestUsualEntries([], { weekday: 1, hour: 8 }, 3)).toEqual([]);
  });

  it('時刻が無い行(hour: null)は時間帯の一致判定には使わない', () => {
    const history: UsualEntryHistoryRow[] = [row({ hour: null })];
    const result = suggestUsualEntries(history, { weekday: 1, hour: 8 }, 3);
    // 一致対象には入らないが、fallback(全期間頻度)には含まれてよい。
    expect(result).toHaveLength(1);
  });
});
