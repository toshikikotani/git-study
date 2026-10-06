import { describe, expect, it } from 'vitest';

import { parseChatMessages } from '@/lib/chat-tools';

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
