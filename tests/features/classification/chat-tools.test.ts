import { describe, expect, it } from 'vitest';

import {
  ChatToolError,
  describeRuleUpdate,
  formatCategoryContextLines,
  formatRuleContextLines,
  isMatchType,
  resolveCategoryByName,
} from '@/features/classification/chat-tools';

/**
 * 「分類ルール」を扱うAIチャット機能の純粋な部分(ADR-022)。
 * DB にもネットワークにも触れない検証・組み立てだけを試す
 * (実行そのものは app/api/assistant/chat/route.ts の責務で、他の route と
 * 同じく実際の Supabase プロジェクトに対して手動で検証する)。
 * 会話履歴の検証(parseChatMessages)は @/lib/chat-tools 側でテストする。
 */

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

describe('formatCategoryContextLines', () => {
  it('カテゴリ一覧を箇条書きにする', () => {
    expect(formatCategoryContextLines([{ id: 'c1', name: '浪費' }])).toBe('- 浪費');
  });

  it('1件も無ければその旨を書く', () => {
    expect(formatCategoryContextLines([])).toBe('(まだ1件もありません)');
  });
});

describe('formatRuleContextLines', () => {
  it('ルール一覧を箇条書きにする', () => {
    const lines = formatRuleContextLines([
      {
        id: 'r1',
        name: '学習: スタバ',
        matchType: 'keyword',
        pattern: 'スタバ',
        categoryName: '浪費',
        isActive: true,
        isProtected: false,
      },
    ]);
    expect(lines).toContain('id=r1');
    expect(lines).toContain('スタバ');
    // 指示文には常に「変更不可」の語が出るため、行ごとの注記が付かないことで確認する
    expect(lines).not.toContain('(変更不可・リボ/キャッシング/分割払いの検知に使用中)');
  });

  it('保護対象のルールには行ごとに変更不可の注記を付ける', () => {
    const lines = formatRuleContextLines([
      {
        id: 'd1',
        name: 'リボ払いの検知',
        matchType: 'regex',
        pattern: 'リボ',
        categoryName: null,
        isActive: true,
        isProtected: true,
      },
    ]);
    expect(lines).toContain('id=d1');
    expect(lines).toContain('(変更不可・リボ/キャッシング/分割払いの検知に使用中)');
  });

  it('1件も無ければその旨を書く', () => {
    expect(formatRuleContextLines([])).toBe('(まだ1件もありません)');
  });
});
