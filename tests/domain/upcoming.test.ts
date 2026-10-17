import { describe, expect, it } from 'vitest';

import { buildUpcoming, type UpcomingRow } from '@/domain/upcoming';

/** これからの支払い(デザイン v3-7、ADR-108)。 */

const row = (
  id: string,
  occurredOn: string,
  label: string,
  amountYen: number,
  extra: Partial<UpcomingRow> = {},
): UpcomingRow => ({
  id,
  occurredOn,
  label,
  description: label,
  genreId: 'g-hobby',
  genreName: '娯楽・趣味',
  amountYen,
  mustPay: false,
  ...extra,
});

const ROWS: UpcomingRow[] = [
  row('a', '2026-10-05', '車保険', -32000, { genreId: 'g-ins', genreName: '保険', mustPay: true }),
  row('b', '2026-10-10', '通信費', -2370, { genreId: 'g-tel', genreName: '通信費' }),
  row('c', '2026-10-12', 'ライブ', -41590),
  row('d', '2026-10-23', 'ハンブレッターズ', -6000),
  row('e', '2026-11-03', 'スーパー', -3000, { genreId: 'g-food', genreName: '食料品' }),
  row('f', '2026-11-20', '先すぎる予定', -1000, { genreId: 'g-food', genreName: '食料品' }),
  row('g', '2026-10-25', '給料', 275000, { genreId: null, genreName: null }),
];

function view() {
  return buildUpcoming({
    rows: ROWS,
    today: '2026-10-17',
    until: '2026-11-05',
    month: { from: '2026-10-01', to: '2026-10-31' },
    categoryFixedIds: new Set(['g-hobby']),
    fixedKeys: new Set(['通信費:-2370']),
    detected: [
      {
        key: '通信費:-2370',
        label: '通信費',
        amountYen: 2370,
        occurrenceCount: 3,
        lastOccurredOn: '2026-10-10',
        nextExpectedOn: '2026-11-10',
      },
      {
        key: 'netflix:-1490',
        label: 'Netflix',
        amountYen: 1490,
        occurrenceCount: 2,
        lastOccurredOn: '2026-10-02',
        nextExpectedOn: '2026-11-02',
      },
    ],
  });
}

describe('buildUpcoming', () => {
  it('予定は今日より先〜今期の終わりまでの支出を近い順(収入・先すぎる予定は入れない)', () => {
    expect(view().scheduled.map((p) => p.name)).toEqual(['ハンブレッターズ', 'スーパー']);
  });

  it('毎月の固定費は、記録の印か固定費の確認がある支払い(払った日・予定の日を持つ)', () => {
    const items = view().fixedItems;
    expect(items.map((f) => f.name)).toEqual(['車保険', '通信費']);
    expect(items[0]).toMatchObject({ amountYen: 32000, paidOn: '2026-10-05', dueOn: null });
  });

  it('カテゴリごと固定費は、店・額のちがう支払いが入っていれば「毎月ちがう出費」として聞く', () => {
    const v = view();
    expect(v.categoryFixed).toEqual([
      { genreId: 'g-hobby', genreName: '娯楽・趣味', amountYen: 47590, mixed: true },
    ]);
    expect(v.fixedTotalYen).toBe(32000 + 2370 + 47590);
  });

  it('見つけた定期支払いは、まだ固定費にしていないものだけ', () => {
    expect(view().detected.map((d) => d.label)).toEqual(['Netflix']);
  });
});
