/**
 * 「ルールをAIに相談する」の純粋な部分(新機能、ADR-022)。
 *
 * DB にもネットワークにも触れない部分だけをここに集める
 * (`import/email.ts` や `import/receipt-ai.ts` と同じ考え方。テストしやすさのため)。
 * `app/api/rules/chat/route.ts` が Supabase・Anthropic の両方に触れる薄い層になる。
 */

export class ChatToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatToolError';
  }
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** 1通あたりの上限。長文を丸ごと送りつけられても費用が跳ねないようにする。 */
export const MAX_MESSAGE_CHARS = 2000;
/** 送り返す履歴の上限(直近分だけを見る。古い文脈は捨ててよい)。 */
export const MAX_HISTORY_MESSAGES = 20;

/**
 * リクエストボディの `messages` を検証する。
 * 形が不正なら null(呼び出し側が 400 を返す)。
 */
export function parseChatMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: ChatMessage[] = [];
  for (const item of value.slice(-MAX_HISTORY_MESSAGES)) {
    if (typeof item !== 'object' || item === null) return null;
    const role = (item as Record<string, unknown>).role;
    const content = (item as Record<string, unknown>).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    messages.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) });
  }
  return messages;
}

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
 * モデルに渡すシステムプロンプトを組み立てる。
 *
 * カテゴリ・ルールの現在値をそのまま埋め込む(list 用の tool を往復させない。
 * どちらも高々数十件なので、埋め込んだ方が速く・安く済む)。
 */
export function buildRuleChatSystemPrompt(
  categories: readonly NamedCategory[],
  rules: readonly RuleContext[],
): string {
  const categoryLines = categories.map((c) => `- ${c.name}`).join('\n');
  const ruleLines = rules
    .map((r) => {
      const protectedNote = r.isProtected
        ? '(変更不可・リボ/キャッシング/分割払いの検知に使用中)'
        : '';
      const target = r.categoryName ? `→ ${r.categoryName}` : '(カテゴリ未設定)';
      const state = r.isActive ? '有効' : '無効';
      return `- id=${r.id} 名前="${r.name}" 一致方式=${r.matchType} パターン=${JSON.stringify(r.pattern)} ${target} ${state} ${protectedNote}`;
    })
    .join('\n');

  return [
    'あなたは家計簿アプリの「分類ルール」を、会話を通じて整えるアシスタントです。',
    '分類ルールは、明細の摘要が特定の文字列に一致したら、自動でカテゴリを付ける仕組みです。',
    '',
    '### できること',
    '- 本人の自然な言葉(例:「スターバックスは浪費にして」「このルールを消して」)を、',
    '  create_rule / update_rule / delete_rule の呼び出しに翻訳して実行する。',
    '- 実行前にいちいち確認を取る必要はない。指示が具体的なら、そのまま実行してよい。',
    '- 対象が曖昧なとき(同名のカテゴリが無い、どのルールを指すか特定できない等)は、',
    '  ツールを呼ばずに質問して確認する。',
    '- 実行後は、日本語で短く何をしたか報告する。',
    '',
    '### してはいけないこと',
    '- 「変更不可」と書かれたルールを update_rule や delete_rule で操作しようとしない。',
    '  これらはリボ払い・キャッシング・分割払いの検知に使われており、見逃すと本人に実害がある。',
    '  求められても、理由を説明して断る(create_rule で新しいルールを作ることはできる)。',
    '- 下のカテゴリ一覧に無い名前を作り出さない。近い名前があれば提案し、無ければ確認する。',
    '- 不確かなことを断定しない。',
    '',
    '### 現在のカテゴリ一覧',
    categoryLines,
    '',
    '### 現在の分類ルール一覧',
    ruleLines === '' ? '(まだ1件もありません)' : ruleLines,
  ].join('\n');
}
