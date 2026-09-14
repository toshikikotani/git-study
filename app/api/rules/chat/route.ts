import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { NextResponse } from 'next/server';

import {
  buildRuleChatSystemPrompt,
  ChatToolError,
  isMatchType,
  parseChatMessages,
  resolveCategoryByName,
  describeRuleUpdate,
  type RuleContext,
} from '@/features/classification/chat-tools';
import {
  createClassificationRule,
  listCategoryOptions,
  listClassificationRules,
  updateClassificationRule,
  deleteClassificationRule,
  ClassificationStoreError,
  type ClassificationRuleSummary,
  type CategoryOption,
} from '@/features/classification/store';

/**
 * 「ルールをAIに相談する」(新機能、ADR-024)。
 *
 * ── 何をするか ──────────────────────────────────────────────
 * 分類ルールの一覧編集(/rules)は「見て・選んで・直す」画面だった。
 * ここは「言葉で頼む」経路を足すもので、本人が「スタバは浪費にして」の
 * ように話すと、対応する create_rule / update_rule / delete_rule を
 * モデル自身が呼び、実際の分類ルールを変更する。純粋な部分(プロンプト組み立て・
 * 検証)は `features/classification/chat-tools.ts` に分離してある。
 *
 * ── 何をさせないか(ADR-010 を会話にも適用する) ───────────────
 * FR-21(リボ・キャッシング・分割払い)の検知ルールは、見逃しが致命的なため
 * 確率的な判断に晒さない。会話からの操作(update_rule/delete_rule)は、
 * 対象ルールが `setPaymentMethod` を持たないことを実行直前に必ず再確認し、
 * 持っていれば例外にして拒む。システムプロンプトで頼まないよう伝えるだけでは
 * 「指示すれば作業してしまう」経路を塞ぎきれないため、二重で守る。
 *
 * ── 会話は保存しない ────────────────────────────────────────
 * 新しいテーブルを増やさずに済ませるため、会話履歴はブラウザ側だけが持つ
 * (毎回のリクエストで全文を送り直す、ステートレスな設計)。本番 Supabase へ
 * 新規マイグレーションを適用する手段がこのセッションに無い制約とも合う
 * (T-25/T-26 と同種)。
 */

export const runtime = 'nodejs';

const MODEL = 'claude-haiku-4-5';
const MAX_OUTPUT_TOKENS = 1024;
/** 1回の相談で許す tool 呼び出しの往復上限。青天井の課金を防ぐ。 */
const MAX_TOOL_ROUNDS = 4;
/** 認証が入るまでの歯止め(email/receipt の各 route と同じ考え方)。 */
const AI_CALL_LIMIT_PER_HOUR = 30;

let aiCallWindowStartedAt = 0;
let aiCallsInWindow = 0;

function takeAiCallSlot(): boolean {
  const now = Date.now();
  if (now - aiCallWindowStartedAt > 60 * 60 * 1000) {
    aiCallWindowStartedAt = now;
    aiCallsInWindow = 0;
  }
  if (aiCallsInWindow >= AI_CALL_LIMIT_PER_HOUR) return false;
  aiCallsInWindow += 1;
  return true;
}

export type RuleChange = {
  kind: 'created' | 'updated' | 'deleted';
  ruleName: string;
  detail: string;
};

const TOOLS: Tool[] = [
  {
    name: 'create_rule',
    description:
      '新しい分類ルールを作る。摘要が pattern に一致する明細を、指定したカテゴリへ自動的に分類するようになる。' +
      'リボ払い・キャッシング・分割払いの検知には使えない(このツールでは支払方法を設定できない)。',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '摘要と照合する文字列(店名やキーワードなど)' },
        match_type: {
          type: 'string',
          enum: ['keyword', 'regex', 'exact'],
          description:
            '一致方式。摘要にこの文字列が含まれれば良いなら keyword、完全一致なら exact、それ以外は regex',
        },
        category_name: {
          type: 'string',
          description:
            '割り当てるカテゴリの名前。会話に添えたカテゴリ一覧の名前と完全に一致させること',
        },
        rule_name: {
          type: 'string',
          description: 'ルールの表示名(省略可)。省略時は自動生成する',
        },
      },
      required: ['pattern', 'match_type', 'category_name'],
    },
  },
  {
    name: 'update_rule',
    description:
      '既存の分類ルールを変更する(パターン・一致方式・カテゴリ・有効/無効のいずれか)。' +
      '会話に添えたルール一覧のうち「変更不可」と書かれていないものだけを対象にできる。',
    input_schema: {
      type: 'object',
      properties: {
        rule_id: { type: 'string', description: '会話に添えたルール一覧の id' },
        pattern: { type: 'string' },
        match_type: { type: 'string', enum: ['keyword', 'regex', 'exact'] },
        category_name: { type: 'string' },
        is_active: { type: 'boolean' },
      },
      required: ['rule_id'],
    },
  },
  {
    name: 'delete_rule',
    description:
      '既存の分類ルールを削除する。会話に添えたルール一覧のうち「変更不可」と書かれていないものだけを対象にできる。',
    input_schema: {
      type: 'object',
      properties: { rule_id: { type: 'string', description: '会話に添えたルール一覧の id' } },
      required: ['rule_id'],
    },
  },
];

export async function POST(request: Request): Promise<NextResponse> {
  let payload: { messages?: unknown };
  try {
    payload = (await request.json()) as { messages?: unknown };
  } catch {
    return NextResponse.json({ error: 'JSON として読めませんでした' }, { status: 400 });
  }

  const messages = parseChatMessages(payload.messages);
  if (messages === null) {
    return NextResponse.json({ error: '会話の形式が正しくありません' }, { status: 400 });
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: 'メッセージがありません' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    return NextResponse.json({
      reply: 'AIによるルール変更は設定されていません(ANTHROPIC_API_KEY が未設定)。',
      changes: [],
    });
  }
  if (!takeAiCallSlot()) {
    return NextResponse.json({
      reply: 'AIの呼び出しが混み合っています。時間をおいて試してください。',
      changes: [],
    });
  }

  let categories: CategoryOption[];
  let rules: ClassificationRuleSummary[];
  try {
    [categories, rules] = await Promise.all([listCategoryOptions(), listClassificationRules()]);
  } catch (error) {
    return NextResponse.json({
      reply: error instanceof ClassificationStoreError ? error.message : '読み込みに失敗しました。',
      changes: [],
    });
  }

  const client = new Anthropic({ apiKey });
  const anthropicMessages: MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const changes: RuleChange[] = [];
  let finalText = '';

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: buildRuleChatSystemPrompt(categories, toRuleContexts(rules)),
        tools: TOOLS,
        messages: anthropicMessages,
      });

      const toolUses = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use',
      );
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      if (text !== '') finalText = text;

      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) break;

      anthropicMessages.push({ role: 'assistant', content: response.content });

      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const outcome = await executeTool(toolUse, categories, changes);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: outcome.message,
          is_error: outcome.isError,
        });
      }
      anthropicMessages.push({ role: 'user', content: toolResults });
    }
  } catch (error) {
    return NextResponse.json({ reply: describeError(error), changes });
  }

  return NextResponse.json({
    reply: finalText !== '' ? finalText : '完了しました。',
    changes,
  });
}

function toRuleContexts(rules: readonly ClassificationRuleSummary[]): RuleContext[] {
  return rules.map((r) => ({
    id: r.id,
    name: r.name,
    matchType: r.matchType,
    pattern: r.pattern,
    categoryName: r.categoryName,
    isActive: r.isActive,
    isProtected: r.setPaymentMethod !== null,
  }));
}

type ToolOutcome = { message: string; isError: boolean };

async function executeTool(
  toolUse: ToolUseBlock,
  categories: readonly CategoryOption[],
  changes: RuleChange[],
): Promise<ToolOutcome> {
  try {
    switch (toolUse.name) {
      case 'create_rule':
        return await runCreateRule(toolUse.input, categories, changes);
      case 'update_rule':
        return await runUpdateRule(toolUse.input, categories, changes);
      case 'delete_rule':
        return await runDeleteRule(toolUse.input, changes);
      default:
        return { message: `未知のツールです: ${toolUse.name}`, isError: true };
    }
  } catch (error) {
    const message =
      error instanceof ChatToolError || error instanceof ClassificationStoreError
        ? error.message
        : '実行に失敗しました。';
    return { message, isError: true };
  }
}

async function runCreateRule(
  input: unknown,
  categories: readonly CategoryOption[],
  changes: RuleChange[],
): Promise<ToolOutcome> {
  const args = input as Record<string, unknown>;
  const pattern = typeof args.pattern === 'string' ? args.pattern : '';
  const matchType = isMatchType(args.match_type) ? args.match_type : null;
  if (pattern.trim() === '' || matchType === null) {
    return { message: 'pattern と match_type は必須です。', isError: true };
  }
  const category = resolveCategoryByName(args.category_name, categories);
  const name =
    typeof args.rule_name === 'string' && args.rule_name.trim() !== ''
      ? args.rule_name.trim()
      : `チャットで作成: ${pattern}`;

  const created = await createClassificationRule({
    name,
    matchType,
    pattern,
    categoryId: category.id,
  });
  changes.push({
    kind: 'created',
    ruleName: created.name,
    detail: `「${pattern}」→ ${category.name}`,
  });
  return { message: `ルール「${created.name}」(id=${created.id})を作成しました。`, isError: false };
}

/** 保護対象(FR-21の検知)かどうかを、実行直前に必ず取り直して確認する。 */
async function assertNotProtected(ruleId: string): Promise<ClassificationRuleSummary> {
  const rules = await listClassificationRules();
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) {
    throw new ChatToolError(`id=${ruleId} のルールが見つかりません。`);
  }
  if (rule.setPaymentMethod !== null) {
    throw new ChatToolError(
      `「${rule.name}」はリボ払い・キャッシング・分割払いの検知に使われているため、会話からは変更・削除できません。`,
    );
  }
  return rule;
}

async function runUpdateRule(
  input: unknown,
  categories: readonly CategoryOption[],
  changes: RuleChange[],
): Promise<ToolOutcome> {
  const args = input as Record<string, unknown>;
  const ruleId = typeof args.rule_id === 'string' ? args.rule_id : '';
  if (ruleId === '') {
    return { message: 'rule_id は必須です。', isError: true };
  }
  const before = await assertNotProtected(ruleId);

  const updates: Parameters<typeof updateClassificationRule>[1] = {};
  if (typeof args.pattern === 'string') updates.pattern = args.pattern;
  if (isMatchType(args.match_type)) updates.matchType = args.match_type;
  if (typeof args.is_active === 'boolean') updates.isActive = args.is_active;
  let categoryName: string | undefined;
  if (args.category_name !== undefined) {
    const category = resolveCategoryByName(args.category_name, categories);
    updates.categoryId = category.id;
    categoryName = category.name;
  }
  if (Object.keys(updates).length === 0) {
    return { message: '変更する項目がありません。', isError: true };
  }

  const updated = await updateClassificationRule(ruleId, updates);
  changes.push({
    kind: 'updated',
    ruleName: updated.name,
    detail: describeRuleUpdate(before, updated, categoryName),
  });
  return { message: `ルール「${updated.name}」を変更しました。`, isError: false };
}

async function runDeleteRule(input: unknown, changes: RuleChange[]): Promise<ToolOutcome> {
  const args = input as Record<string, unknown>;
  const ruleId = typeof args.rule_id === 'string' ? args.rule_id : '';
  if (ruleId === '') {
    return { message: 'rule_id は必須です。', isError: true };
  }
  const before = await assertNotProtected(ruleId);
  await deleteClassificationRule(ruleId);
  changes.push({ kind: 'deleted', ruleName: before.name, detail: before.pattern ?? '' });
  return { message: `ルール「${before.name}」を削除しました。`, isError: false };
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'AI の API キーが無効です。ANTHROPIC_API_KEY を確認してください。';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'AI の利用上限に達しました。しばらくしてから再試行してください。';
  }
  if (error instanceof Anthropic.APIError) {
    return `AI の呼び出しに失敗しました(${error.status}): ${error.message}`;
  }
  return `AI の呼び出しに失敗しました: ${error instanceof Error ? error.message : String(error)}`;
}
