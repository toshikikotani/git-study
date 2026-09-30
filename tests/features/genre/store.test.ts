import { describe, expect, it, vi } from 'vitest';

import { chain, type MockResult } from '../../helpers/supabase-mock';

/**
 * quick_entry_order・hidden_in_quick_entry 列が本番にまだ適用されていない
 * (マイグレーション未適用)ときに、手入力の格子(/transactions/new)が
 * 落ちずに頻度順へフォールバックすることを確認する回帰テスト。
 * (マージ後に発覚した、isMissingColumnError を見ていなかった不具合)
 */
let genresResult: () => MockResult;
let transactionsResult: MockResult;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === 'genres') return chain(genresResult());
      if (table === 'transactions') return chain(transactionsResult);
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { fetchQuickEntryGenres } from '@/features/genre/store';

describe('fetchQuickEntryGenres', () => {
  it('列がすべて揃っていれば、そのまま並び順に使う', async () => {
    genresResult = () => ({
      data: [
        { id: 'a', name: '外食', quick_entry_order: null, hidden_in_quick_entry: false },
        { id: 'b', name: '日用品', quick_entry_order: 10, hidden_in_quick_entry: false },
      ],
      error: null,
    });
    transactionsResult = { data: [], error: null };
    const genres = await fetchQuickEntryGenres();
    expect(genres.map((g) => g.id)).toEqual(['b', 'a']);
  });

  it('quick_entry_order・hidden_in_quick_entry が未適用(42703)でも、2列を外して再取得し落ちない', async () => {
    let call = 0;
    genresResult = () => {
      call += 1;
      if (call === 1) return { data: null, error: { code: '42703', message: 'column missing' } };
      return {
        data: [
          { id: 'a', name: '外食' },
          { id: 'b', name: '日用品' },
        ],
        error: null,
      };
    };
    transactionsResult = { data: [], error: null };
    const genres = await fetchQuickEntryGenres();
    expect(genres.map((g) => g.id).sort()).toEqual(['a', 'b']);
  });

  it('genres テーブル自体が無ければ空で返す(画面全体を落とさない)', async () => {
    genresResult = () => ({ data: null, error: { code: 'PGRST205', message: 'no table' } });
    transactionsResult = { data: [], error: null };
    expect(await fetchQuickEntryGenres()).toEqual([]);
  });
});
