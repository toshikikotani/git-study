import { describe, expect, it } from 'vitest';

import { checkSourceOf, jstTime, pickCheckItems, type CheckRow } from '@/domain/today-check';

/** 今日の答え合わせに出すもの(v4-1、ADR-129)。 */

const row = (over: Partial<CheckRow>): CheckRow => ({
  id: 'x',
  occurredOn: '2026-10-21',
  createdAt: '2026-10-21T03:15:00Z',
  merchantName: 'セブン-イレブン',
  description: 'VISA利用',
  branchName: null,
  amountYen: -453,
  genreId: 'food',
  reviewStatus: 'auto_ok',
  source: 'gmail',
  sourceRef: null,
  isTransfer: false,
  ...over,
});
const today = '2026-10-21';
const names = { genreNameById: new Map([['food', '食料品']]) };

describe('出すもの', () => {
  it('自動で入った記録だけ(Gmail・CSV・LINEのレシート・LINEの文字)。手入力とアプリのレシートは出さない', () => {
    expect(checkSourceOf('gmail', null)).toBe('gmail');
    expect(checkSourceOf('csv', 'abc')).toBe('csv');
    expect(checkSourceOf('manual', 'line-123-0')).toBe('line_receipt');
    expect(checkSourceOf('manual', 'line-text-999')).toBe('line_text');
    expect(checkSourceOf('manual', null)).toBeNull();
    expect(checkSourceOf('manual', 'receipt-uuid')).toBeNull();
    expect(checkSourceOf('manual', 'capture-uuid')).toBeNull();
    const items = pickCheckItems(
      [
        row({ id: 'mail' }),
        row({ id: 'hand', source: 'manual', sourceRef: null }),
        row({ id: 'app', source: 'manual', sourceRef: 'receipt-1' }),
        row({ id: 'line', source: 'manual', sourceRef: 'line-1-0' }),
      ],
      today,
      names,
    );
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining(['mail', 'line']));
    expect(items).toHaveLength(2);
  });

  it('確かめ済み・数えない・振替・0円は出さない', () => {
    const items = pickCheckItems(
      [
        row({ id: 'ok' }),
        row({ id: 'pending', reviewStatus: 'pending' }),
        row({ id: 'done', reviewStatus: 'confirmed' }),
        row({ id: 'fixed', reviewStatus: 'corrected' }),
        row({ id: 'ignored', reviewStatus: 'ignored' }),
        row({ id: 'transfer', isTransfer: true }),
        row({ id: 'zero', amountYen: 0 }),
      ],
      today,
      names,
    );
    expect(items.map((i) => i.id).sort()).toEqual(['ok', 'pending']);
  });

  it('カテゴリの確認待ちは、7日より前でも・手入力やアプリのレシートでも出す(確認待ちを答え合わせに含める、ADR-131)', () => {
    const items = pickCheckItems(
      [
        row({ id: 'old-pending', occurredOn: '2026-09-01', reviewStatus: 'pending' }),
        row({ id: 'old-ok', occurredOn: '2026-09-01' }),
        row({
          id: 'hand-pending',
          source: 'manual',
          sourceRef: 'receipt-1',
          reviewStatus: 'pending',
        }),
        row({ id: 'future-pending', occurredOn: '2026-10-25', reviewStatus: 'pending' }),
      ],
      today,
      names,
    );
    expect(items.map((i) => i.id)).toEqual(['hand-pending', 'old-pending']);
    expect(items[0]).toMatchObject({ source: 'app', sourceLabel: 'アプリ', unsure: true });
  });

  it('今日の分を先に、前の日(直近7日)の片づけ残しをあとに続ける', () => {
    const items = pickCheckItems(
      [
        row({ id: 'old', occurredOn: '2026-10-14' }),
        row({ id: 'y', occurredOn: '2026-10-20' }),
        row({ id: 'w', occurredOn: '2026-10-15' }),
        row({ id: 't1', createdAt: '2026-10-21T01:00:00Z' }),
        row({ id: 't2', createdAt: '2026-10-21T09:00:00Z' }),
      ],
      today,
      names,
    );
    expect(items.map((i) => i.id)).toEqual(['t2', 't1', 'y', 'w']);
    expect(items[2]!.isToday).toBe(false);
  });

  it('カードに載せるもの:店名・支店か最初の品目・時刻・金額・カテゴリ・取り込み元・自信・まとめた説明', () => {
    const [item] = pickCheckItems(
      [row({ id: 'a', reviewStatus: 'pending', branchName: null })],
      today,
      {
        ...names,
        firstItemById: new Map([['a', 'おにぎり 鮭']]),
        mergedNoteById: new Map([
          ['a', 'カードの通知メールの453円と同じ支払いなので、1件にまとめました'],
        ]),
      },
    );
    expect(item).toMatchObject({
      storeName: 'セブン-イレブン',
      detail: 'おにぎり 鮭',
      time: '12:15',
      amountYen: 453,
      genreName: '食料品',
      sourceLabel: 'カードの通知メール',
      unsure: true,
      mergedNote: 'カードの通知メールの453円と同じ支払いなので、1件にまとめました',
    });
    expect(jstTime('2026-10-21T15:30:00Z')).toBe('00:30');
  });
});
