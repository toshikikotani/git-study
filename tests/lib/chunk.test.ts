import { describe, expect, it } from 'vitest';

import { ID_QUERY_CHUNK, mapChunks } from '../../src/lib/chunk';

describe('id の大きな一覧を、URL に収まる大きさに分けて問い合わせる', () => {
  it('チャンクの大きさを超えず、順番のまま結果を返す', async () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => `id${i}`);
    const seen: number[] = [];
    const out = await mapChunks(ids, async (chunk) => {
      seen.push(chunk.length);
      await new Promise((r) => setTimeout(r, Math.random() * 2));
      return chunk[0];
    });
    expect(Math.max(...seen)).toBeLessThanOrEqual(ID_QUERY_CHUNK);
    expect(out).toHaveLength(Math.ceil(10_000 / ID_QUERY_CHUNK));
    expect(out[0]).toBe('id0');
    expect(out[1]).toBe(`id${ID_QUERY_CHUNK}`);
    expect(out.at(-1)).toBe(`id${(out.length - 1) * ID_QUERY_CHUNK}`);
  });

  it('空なら何も問い合わせない。1件でも動く', async () => {
    let calls = 0;
    expect(await mapChunks([], async () => (calls += 1))).toEqual([]);
    expect(calls).toBe(0);
    expect(await mapChunks(['a'], async (c) => c)).toEqual([['a']]);
  });

  it('同時に走る問い合わせの数を制限する', async () => {
    let running = 0;
    let peak = 0;
    await mapChunks(
      Array.from({ length: 500 }, (_, i) => i),
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 1));
        running -= 1;
      },
      10,
      4,
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('1件の失敗は全体の失敗になる(黙って欠けさせない)', async () => {
    await expect(
      mapChunks(
        ['a', 'b', 'c'],
        async (c) => {
          if (c[0] === 'b') throw new Error('boom');
          return c;
        },
        1,
      ),
    ).rejects.toThrow('boom');
  });
});
