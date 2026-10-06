import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; op: string; args: unknown[]; eq: unknown[][] };
const calls: Call[] = [];
let current: unknown = { name: '外食', icon_key: null, color_index: null };
let updateError: { code?: string; message: string } | null = null;

function builder(table: string) {
  let last: Call | null = null;
  const proxy: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: last?.op === 'update' ? updateError : null });
      }
      if (prop === 'maybeSingle') return async () => ({ data: current, error: null });
      return (...args: unknown[]) => {
        const name = String(prop);
        if (name === 'update') {
          last = { table, op: name, args, eq: [] };
          calls.push(last);
        } else if (name === 'eq' && last) last.eq.push(args);
        return proxy;
      };
    },
  });
  return proxy;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
}));

import {
  renameGenre,
  saveGenreStyle,
  validateGenreName,
} from '../../../src/features/genre/style-store';

beforeEach(() => {
  calls.length = 0;
  current = { name: '外食', icon_key: null, color_index: null };
  updateError = null;
});

describe('P8 名前の変更', () => {
  it('空・長すぎ・「未分類」は受け付けない', () => {
    expect(() => validateGenreName('  ')).toThrow('入力してください');
    expect(() => validateGenreName('あ'.repeat(21))).toThrow('20文字');
    expect(() => validateGenreName('未分類')).toThrow('使えない');
    expect(validateGenreName(' 外食費 ')).toBe('外食費');
  });

  it('名前を変える前に、いまの見た目を書き留める(既定の見た目が名前と一緒に変わらない)', async () => {
    await renameGenre('g1', '外食費');
    expect(calls[0]!.args[0]).toEqual({ icon_key: 'restaurant', color_index: 2 });
    expect(calls[1]!.args[0]).toEqual({ name: '外食費' });
  });

  it('同じ名前は不可(重複は分かりやすい言葉で返す)', async () => {
    updateError = { code: '23505', message: 'dup' };
    await expect(renameGenre('g1', '日用品')).rejects.toThrow('同じ名前');
  });

  it('名前が変わらないときは何も書かない', async () => {
    await renameGenre('g1', '外食');
    expect(calls).toEqual([]);
  });
});

describe('P8 見た目の保存', () => {
  it('アイコンと色を保存する。選べない色・アイコンは拒否する', async () => {
    await saveGenreStyle('g1', { icon: 'cafe', colorIndex: 1 });
    expect(calls[0]!.args[0]).toEqual({ icon_key: 'cafe', color_index: 1 });
    await expect(saveGenreStyle('g1', { icon: 'nope', colorIndex: 1 })).rejects.toThrow('アイコン');
    await expect(saveGenreStyle('g1', { icon: 'cafe', colorIndex: 0 })).rejects.toThrow('色');
    await expect(saveGenreStyle('g1', { icon: 'cafe', colorIndex: 11 })).rejects.toThrow('色');
  });
});
