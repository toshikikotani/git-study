import { describe, expect, it } from 'vitest';

import {
  buildRuleChatSystemPrompt,
  ChatToolError,
  describeRuleUpdate,
  isMatchType,
  parseChatMessages,
  resolveCategoryByName,
} from '@/features/classification/chat-tools';

/**
 * 「ルールをAIに相談する」の純粋な部分(ADR-022)。
 * DB にもネットワークにも触れない検証・組み立てだけを試す
 * (実行そのものは app/api/rules/chat/route.ts の責務で、他の route と
 * 同じく実際の Supabase プロジェクトに対して手動で検証する)。
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

describe('isMatchType', () => {
  it('keyword/regex/exact のみ true', () => {
    expect(isMatchType('keyword')).toBe(true);
    expect(isMatchType('regex')).toBe(true);
    expect(isMatchType('exact')).toBe(true);
    expect(isMatchType('amount_range')).toBe(false);
    expect(isMatchType(undefined)).toBe(false);
    expect(isMatchType(123)).toBe(false);
  });
});

describe('resolveCategoryByName', () => {
  const categories = [
    { id: 'c1', name: '生活費' },
    { id: 'c2', name: '浪費' },
  ];

  it('完全一致するカテゴリを返す', () => {
    expect(resolveCategoryByName('浪費', categories)).toEqual({ id: 'c2', name: '浪費' });
  });

  it('前後の空白は無視する', () => {
    expect(resolveCategoryByName('  浪費  ', categories)).toEqual({ id: 'c2', name: '浪費' });
  });

  it('存在しない名前は候補を添えて拒む', () => {
    expect(() => resolveCategoryByName('娯楽', categories)).toThrow(ChatToolError);
    try {
      resolveCategoryByName('娯楽', categories);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ChatToolError);
      expect((error as Error).message).toContain('生活費');
      expect((error as Error).message).toContain('浪費');
    }
  });

  it('空文字・非文字列は拒む', () => {
    expect(() => resolveCategoryByName('', categories)).toThrow(ChatToolError);
    expect(() => resolveCategoryByName(undefined, categories)).toThrow(ChatToolError);
  });
});

describe('describeRuleUpdate', () => {
  it('パターン・カテゴリ・有効化のすべてが変わったことを説明する', () => {
    const before = { pattern: '旧', isActive: false };
    const after = { pattern: '新', isActive: true };
    expect(describeRuleUpdate(before, after, '浪費')).toBe(
      'パターン: 新 / カテゴリ: 浪費 / 有効化',
    );
  });

  it('無効化のみのときはそれだけを説明する', () => {
    const before = { pattern: '同じ', isActive: true };
    const after = { pattern: '同じ', isActive: false };
    expect(describeRuleUpdate(before, after, undefined)).toBe('無効化');
  });

  it('何も変わっていなければ「更新」とだけ言う', () => {
    const same = { pattern: '同じ', isActive: true };
    expect(describeRuleUpdate(same, same, undefined)).toBe('更新');
  });
});

describe('buildRuleChatSystemPrompt', () => {
  it('カテゴリ一覧とルール一覧を埋め込む', () => {
    const prompt = buildRuleChatSystemPrompt(
      [{ id: 'c1', name: '浪費' }],
      [
        {
          id: 'r1',
          name: '学習: スタバ',
          matchType: 'keyword',
          pattern: 'スタバ',
          categoryName: '浪費',
          isActive: true,
          isProtected: false,
        },
      ],
    );
    expect(prompt).toContain('- 浪費');
    expect(prompt).toContain('id=r1');
    expect(prompt).toContain('スタバ');
    // 指示文には常に「変更不可」の語が出るため、行ごとの注記が付かないことで確認する
    expect(prompt).not.toContain('(変更不可・リボ/キャッシング/分割払いの検知に使用中)');
  });

  it('保護対象のルールには行ごとに変更不可の注記を付ける', () => {
    const prompt = buildRuleChatSystemPrompt(
      [],
      [
        {
          id: 'd1',
          name: 'リボ払いの検知',
          matchType: 'regex',
          pattern: 'リボ',
          categoryName: null,
          isActive: true,
          isProtected: true,
        },
      ],
    );
    expect(prompt).toContain('id=d1');
    expect(prompt).toContain('(変更不可・リボ/キャッシング/分割払いの検知に使用中)');
  });

  it('ルールが1件も無ければその旨を書く', () => {
    const prompt = buildRuleChatSystemPrompt([], []);
    expect(prompt).toContain('まだ1件もありません');
  });
});
