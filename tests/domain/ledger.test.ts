import { describe, expect, it } from 'vitest';

import {
  entryStatus,
  expandLedger,
  monthRange,
  summarizeLedger,
  type LedgerEntry,
} from '@/domain/ledger';

const TODAY = '2026-09-29';
const RANGE = { from: '2026-09-01', to: '2026-09-30' };

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 'e',
    occurredOn: '2026-09-10',
    amountYen: -1000,
    categoryId: 'food',
    isTransfer: false,
    reviewStatus: 'auto_ok',
    kind: 'normal',
    ...overrides,
  };
}

describe('entryStatus', () => {
  it('今日までは実績、明日以降は予定', () => {
    expect(entryStatus('2026-09-28', TODAY)).toBe('actual');
    expect(entryStatus('2026-09-29', TODAY)).toBe('actual');
    expect(entryStatus('2026-09-30', TODAY)).toBe('scheduled');
  });
});

describe('summarizeLedger', () => {
  it('実績の支出・収入・ジャンル別・日別を出す', () => {
    const s = summarizeLedger(
      [
        entry({ id: 'a', amountYen: -1200, occurredOn: '2026-09-10' }),
        entry({ id: 'b', amountYen: -800, categoryId: 'cafe', occurredOn: '2026-09-10' }),
        entry({ id: 'c', amountYen: 300000, categoryId: null, occurredOn: '2026-09-25' }),
        entry({ id: 'd', amountYen: -500, categoryId: null, occurredOn: '2026-09-11' }),
      ],
      RANGE,
      TODAY,
    );
    expect(s.spentYen).toBe(2500);
    expect(s.incomeYen).toBe(300000);
    expect(s.byGenre.get('food')).toBe(1200);
    expect(s.byGenre.get('cafe')).toBe(800);
    expect(s.uncategorizedYen).toBe(500);
    expect(s.byDay.get('2026-09-10')).toBe(2000);
  });

  it('未来日の取引は実績に含めず、予定として別に持つ', () => {
    const s = summarizeLedger(
      [
        entry({ id: 'a', amountYen: -1000, occurredOn: '2026-09-29' }),
        entry({ id: 'b', amountYen: -26540, occurredOn: '2026-10-03', kind: 'special' }),
        entry({ id: 'c', amountYen: -700, occurredOn: '2026-09-30' }),
      ],
      { from: '2026-09-01', to: '2026-10-31' },
      TODAY,
    );
    expect(s.spentYen).toBe(1000);
    expect(s.scheduledYen).toBe(27240);
    expect(s.byDay.has('2026-10-03')).toBe(false);
    expect(s.scheduledByDay.get('2026-10-03')).toBe(26540);
  });

  it('特別費も使った額とペース計算に入る', () => {
    const s = summarizeLedger(
      [
        entry({ id: 'a', amountYen: -1000 }),
        entry({ id: 'b', amountYen: -30000, categoryId: 'event', kind: 'special' }),
      ],
      RANGE,
      TODAY,
    );
    expect(s.spentYen).toBe(31000);
    expect(s.specialYen).toBe(0);
    expect(s.paceSpentYen).toBe(31000);
    expect(s.byGenre.get('event')).toBe(30000);
    expect(s.byGenrePace.get('event')).toBe(30000);
  });

  it('振替・対象外・範囲外は数えない', () => {
    const s = summarizeLedger(
      [
        entry({ id: 'a', amountYen: -1000, isTransfer: true }),
        entry({ id: 'b', amountYen: -2000, reviewStatus: 'ignored' }),
        entry({ id: 'c', amountYen: -3000, occurredOn: '2026-08-31' }),
        entry({ id: 'd', amountYen: -400 }),
      ],
      RANGE,
      TODAY,
    );
    expect(s.spentYen).toBe(400);
  });

  it('金額が整数でなければ例外(浮動小数点を混ぜない)', () => {
    expect(() => summarizeLedger([entry({ amountYen: -100.5 })], RANGE, TODAY)).toThrow();
  });
});

describe('expandLedger(分割の子)', () => {
  const parent = entry({ id: 'p', amountYen: -3000, categoryId: 'drug' });

  it('分割が無ければそのまま', () => {
    expect(expandLedger([parent], new Map())).toEqual([parent]);
  });

  it('子のジャンルが未設定なら親のジャンルを引き継ぎ、個別に付けたものは活かす', () => {
    const children = expandLedger(
      [parent],
      new Map([
        [
          'p',
          [
            { genreId: null, amountYen: -1000 },
            { genreId: 'cafe', amountYen: -2000 },
          ],
        ],
      ]),
    );
    expect(children.map((c) => [c.categoryId, c.amountYen])).toEqual([
      ['drug', -1000],
      ['cafe', -2000],
    ]);
  });

  it('子の合計は親と一致するので、展開しても合計は変わらない', () => {
    const splits = new Map([
      [
        'p',
        [
          { genreId: null, amountYen: -1000 },
          { genreId: 'cafe', amountYen: -2000 },
        ],
      ],
    ]);
    const total = (entries: LedgerEntry[]) => summarizeLedger(entries, RANGE, TODAY).spentYen;
    expect(total(expandLedger([parent], splits))).toBe(total([parent]));
  });
});

describe('monthRange', () => {
  it('月初〜月末', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});
