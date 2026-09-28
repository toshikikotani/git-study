/**
 * 「分類ルール」を扱うAIチャット機能の純粋な部分(ADR-024)。
 *
 * DB にもネットワークにも触れない部分だけをここに集める
 * (`import/email.ts` や `import/receipt-ai.ts` と同じ考え方。テストしやすさのため)。
 * 会話の履歴検証など、ルールに限らない汎用部分は `@/lib/chat-tools` へ
 * 移した(ADR-054、「AIに変更を頼む」統合チャットとの共用)。
 * `app/api/assistant/chat/route.ts` が Supabase・Anthropic の両方に触れる薄い層になる。
 */

import { ChatToolError } from '@/lib/chat-tools';

export { ChatToolError };

export function isMatchType(value: unknown): value is 'keyword' | 'regex' | 'exact' {
  return value === 'keyword' || value === 'regex' || value === 'exact';
}

export type NamedCategory = { id: string; name: string };

/**
 * モデルが返したカテゴリ名を、実在のカテゴリに解決する。
 * 存在しない名前は勝手に読み替えず、候補を添えて拒む(本人の知らないカテゴリを
 * 作らせないため)。
 */
export function resolveCategoryByName<C extends NamedCategory>(
  name: unknown,
  categories: readonly C[],
): C {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ChatToolError('カテゴリ名が指定されていません。');
  }
  const wanted = name.trim();
  const found = categories.find((c) => c.name.trim() === wanted);
  if (!found) {
    const available = categories.map((c) => c.name).join('、');
    throw new ChatToolError(
      `「${wanted}」というカテゴリは見つかりません。既存のカテゴリ: ${available}`,
    );
  }
  return found;
}

/** ルール更新の前後を比べ、本人に見せる短い説明文にする。 */
export function describeRuleUpdate(
  before: { pattern: string | null; isActive: boolean },
  after: { pattern: string | null; isActive: boolean },
  categoryName: string | undefined,
): string {
  const parts: string[] = [];
  if (before.pattern !== after.pattern) parts.push(`パターン: ${after.pattern}`);
  if (categoryName) parts.push(`カテゴリ: ${categoryName}`);
  if (before.isActive !== after.isActive) parts.push(after.isActive ? '有効化' : '無効化');
  return parts.length > 0 ? parts.join(' / ') : '更新';
}

export type RuleContext = {
  id: string;
  name: string;
  matchType: string;
  pattern: string | null;
  categoryName: string | null;
  isActive: boolean;
  /** FR-21 の検知に使われているか。true なら会話からの変更・削除を拒む対象。 */
  isProtected: boolean;
};

/**
 * システムプロンプトに埋め込むカテゴリ・ルールの現在値を整形する
 * (list 用の tool を往復させない。どちらも高々数十件なので、埋め込んだ方が
 * 速く・安く済む)。統合チャット(ADR-054、`features/assistant/chat-tools.ts`)が
 * これらを他ドメインのセクションと組み合わせてシステムプロンプト全体を作る。
 */
export function formatCategoryContextLines(categories: readonly NamedCategory[]): string {
  const lines = categories.map((c) => `- ${c.name}`).join('\n');
  return lines === '' ? '(まだ1件もありません)' : lines;
}

export function formatRuleContextLines(rules: readonly RuleContext[]): string {
  const lines = rules
    .map((r) => {
      const protectedNote = r.isProtected
        ? '(変更不可・リボ/キャッシング/分割払いの検知に使用中)'
        : '';
      const target = r.categoryName ? `→ ${r.categoryName}` : '(カテゴリ未設定)';
      const state = r.isActive ? '有効' : '無効';
      return `- id=${r.id} 名前="${r.name}" 一致方式=${r.matchType} パターン=${JSON.stringify(r.pattern)} ${target} ${state} ${protectedNote}`;
    })
    .join('\n');
  return lines === '' ? '(まだ1件もありません)' : lines;
}
