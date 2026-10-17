import { describe, expect, it } from 'vitest';

import { parseChatMessages, toAlternatingTurns } from '@/lib/chat-tools';

/**
 * AIチャットでDBを操作する機能に共通する、会話履歴の検証(ADR-033)。
 * 個々のドメイン(ルール・設定・明細)からは独立している。
 */

describe('parseChatMessages', () => {
  it('正しい形の配列をそのまま返す', () => {
    const result = parseChatMessages([
      { role: 'user', content: 'スタバは浪費にして' },
      { role: 'assistant', content: '変更しました。' },
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'スタバは浪費にして' },
      { role: 'assistant', content: '変更しました。' },
    ]);
  });

  it('配列でなければ null', () => {
    expect(parseChatMessages('not an array')).toBeNull();
    expect(parseChatMessages(null)).toBeNull();
    expect(parseChatMessages(undefined)).toBeNull();
  });

  it('role が user/assistant 以外の要素があれば null', () => {
    expect(parseChatMessages([{ role: 'system', content: 'x' }])).toBeNull();
  });

  it('content が文字列でない要素があれば null', () => {
    expect(parseChatMessages([{ role: 'user', content: 123 }])).toBeNull();
  });

  it('直近20件だけを残す', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `msg-${i}`,
    }));
    const result = parseChatMessages(many);
    expect(result).toHaveLength(20);
    expect(result![0]!.content).toBe('msg-5');
    expect(result![19]!.content).toBe('msg-24');
  });

  it('1通あたりの文字数を切り詰める', () => {
    const long = 'あ'.repeat(3000);
    const result = parseChatMessages([{ role: 'user', content: long }]);
    expect(result![0]!.content.length).toBe(2000);
  });
});

describe('toAlternatingTurns(送れなかった発言のあとに続けて送っても、AIに渡せる形にする、ADR-105)', () => {
  it('本人の発言が続いたら1つにまとめる(送れなかった発言も落とさない)', () => {
    expect(
      toAlternatingTurns([
        { role: 'user', content: 'コンビニで500円' },
        { role: 'user', content: 'あと昼に1000円' },
      ]),
    ).toEqual([{ role: 'user', content: 'コンビニで500円\nあと昼に1000円' }]);
  });

  it('AIの発言から始まっていたら捨て、空の発言は捨てる。AIの発言が続いたらまとめる', () => {
    expect(
      toAlternatingTurns([
        { role: 'assistant', content: '案を作りました。' },
        { role: 'user', content: '食費をへらしたい' },
        { role: 'assistant', content: '案を作りました。' },
        { role: 'assistant', content: '1件を反映しました。' },
        { role: 'user', content: '  ' },
        { role: 'user', content: 'ありがとう' },
      ]),
    ).toEqual([
      { role: 'user', content: '食費をへらしたい' },
      { role: 'assistant', content: '案を作りました。\n1件を反映しました。' },
      { role: 'user', content: 'ありがとう' },
    ]);
  });
});
