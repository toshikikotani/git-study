import { describe, expect, it } from 'vitest';

import { countReading, newJob, queueReducer } from '@/features/import/receipt-queue';

describe('queueReducer(撮影をブロックしない読み取りキュー)', () => {
  const a = newJob('a', 'blob:a', 1);
  const b = newJob('b', 'blob:b', 2);

  it('撮影直後は「読み取り中」の仮の行として積まれ、次の撮影を待たせない', () => {
    const s = queueReducer(queueReducer([], { type: 'add', job: a }), { type: 'add', job: b });
    expect(s.map((j) => j.status)).toEqual(['reading', 'reading']);
    expect(countReading(s)).toBe(2);
  });

  it('読み取りが終わったジョブだけ ready になる(他は読み取り中のまま)', () => {
    const s = queueReducer([a, b], {
      type: 'ready',
      id: 'a',
      imageBase64: 'x',
      parsed: [{ description: '店' } as never],
      warnings: [],
      classifications: [],
      parentGenreIds: {},
    });
    expect(s.map((j) => j.status)).toEqual(['ready', 'reading']);
  });

  it('何も読み取れなかったら理由つきのエラーにする', () => {
    const s = queueReducer([a], {
      type: 'ready',
      id: 'a',
      imageBase64: 'x',
      parsed: [],
      warnings: ['認識できませんでした'],
      classifications: [],
      parentGenreIds: {},
    });
    expect(s[0]).toMatchObject({ status: 'error', error: '認識できませんでした' });
  });

  it('失敗・取り消し', () => {
    expect(queueReducer([a], { type: 'fail', id: 'a', error: 'x' })[0]!.status).toBe('error');
    expect(queueReducer([a, b], { type: 'remove', id: 'a' }).map((j) => j.id)).toEqual(['b']);
  });
});
