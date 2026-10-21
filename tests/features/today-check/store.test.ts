import { describe, expect, it } from 'vitest';

import {
  applyTodayCheck,
  confirmSureTodayCheck,
  listTodayCheck,
  undoTodayCheck,
} from '@/features/today-check/store';
import { fakeSupabase, type FakeTables } from '../../helpers/fake-supabase';

/** 今日の答え合わせの保存(v4-1、ADR-129)。「確認が必要」と同じ review_status を変える。 */

const today = '2026-10-21';
function tables(): FakeTables {
  const tx = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    user_id: 'me',
    occurred_on: today,
    created_at: '2026-10-21T03:00:00Z',
    merchant_name: 'まいばすけっと',
    description: 'VISA',
    branch_name: null,
    amount_yen: -580,
    genre_id: 'food',
    classified_by: 'rule',
    review_status: 'auto_ok',
    reviewed_at: null,
    source: 'gmail',
    source_ref: null,
    is_transfer: false,
    ...over,
  });
  return {
    transactions: [
      tx('a'),
      tx('b', { review_status: 'pending', genre_id: null, classified_by: 'unclassified' }),
      tx('hand', { source: 'manual' }),
      tx('other-user', { user_id: 'someone' }),
    ],
    genres: [
      { id: 'food', user_id: 'me', name: '食料品' },
      { id: 'daily', user_id: 'me', name: '日用品' },
      { id: 'theirs', user_id: 'someone', name: '他人のカテゴリ' },
    ],
    genre_memory: [],
    receipt_items: [],
    payment_merges: [],
  };
}

describe('答え合わせの対象', () => {
  it('本人の、自動で入った、まだ確かめていない記録だけ', async () => {
    const { client } = fakeSupabase(tables());
    const items = await listTodayCheck(client as never, 'me', today);
    expect(items.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(items.find((i) => i.id === 'a')!.genreName).toBe('食料品');
    expect(items.find((i) => i.id === 'b')!.unsure).toBe(true);
  });
});

describe('合ってる・直す・数えない・ひとつ戻る', () => {
  it('合ってる:confirmed にして、そのお店の自信を上げる', async () => {
    const t = tables();
    const { client } = fakeSupabase(t);
    await applyTodayCheck(client as never, 'me', { id: 'a', action: 'confirm' });
    const row = t.transactions!.find((r) => r.id === 'a')!;
    expect(row.review_status).toBe('confirmed');
    expect(row.reviewed_at).toEqual(expect.any(String));
    expect(t.genre_memory).toEqual([
      expect.objectContaining({
        store_key: 'まいばすけっと',
        item_key: '*',
        genre_id: 'food',
        pinned: false,
        hits: 1,
      }),
    ]);
  });

  it('直す:カテゴリを変え(corrected)、次から同じお店はそのカテゴリにする', async () => {
    const t = tables();
    const { client } = fakeSupabase(t);
    await applyTodayCheck(client as never, 'me', { id: 'b', action: 'correct', genreId: 'daily' });
    const row = t.transactions!.find((r) => r.id === 'b')!;
    expect(row).toMatchObject({
      review_status: 'corrected',
      genre_id: 'daily',
      classified_by: 'manual',
    });
    expect(t.genre_memory).toEqual([
      expect.objectContaining({ store_key: 'まいばすけっと', genre_id: 'daily', pinned: true }),
    ]);
  });

  it('数えない:ignored にする(お店は覚えない)', async () => {
    const t = tables();
    const { client } = fakeSupabase(t);
    await applyTodayCheck(client as never, 'me', { id: 'a', action: 'ignore' });
    expect(t.transactions!.find((r) => r.id === 'a')!.review_status).toBe('ignored');
    expect(t.genre_memory).toEqual([]);
  });

  it('ひとつ戻る:記録もお店の覚え方も、操作の前に戻す', async () => {
    const t = tables();
    const { client } = fakeSupabase(t);
    const undo = await applyTodayCheck(client as never, 'me', {
      id: 'b',
      action: 'correct',
      genreId: 'daily',
    });
    await undoTodayCheck(client as never, 'me', undo);
    expect(t.transactions!.find((r) => r.id === 'b')).toMatchObject({
      review_status: 'pending',
      genre_id: null,
      classified_by: 'unclassified',
      reviewed_at: null,
    });
    expect(t.genre_memory).toEqual([]);
  });

  it('他人の記録・他人のカテゴリ・確かめ済みの記録は変えない', async () => {
    const t = tables();
    const { client } = fakeSupabase(t);
    await expect(
      applyTodayCheck(client as never, 'me', { id: 'other-user', action: 'confirm' }),
    ).rejects.toThrow('見つかりませんでした');
    await expect(
      applyTodayCheck(client as never, 'me', { id: 'a', action: 'correct', genreId: 'theirs' }),
    ).rejects.toThrow('カテゴリを選んでください');
    await applyTodayCheck(client as never, 'me', { id: 'a', action: 'confirm' });
    await expect(
      applyTodayCheck(client as never, 'me', { id: 'a', action: 'ignore' }),
    ).rejects.toThrow('もう確かめてあります');
  });

  it('まとめて合ってる(LINE):自信のあるものだけ確定し、残りを返す', async () => {
    const t = tables();
    const { client } = fakeSupabase(t);
    const result = await confirmSureTodayCheck(client as never, 'me', today);
    expect(result.confirmed).toBe(1);
    expect(result.remaining.map((i) => i.id)).toEqual(['b']);
    expect(t.transactions!.find((r) => r.id === 'a')!.review_status).toBe('confirmed');
    expect(t.transactions!.find((r) => r.id === 'b')!.review_status).toBe('pending');
  });
});
