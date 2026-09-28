import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { NextResponse } from 'next/server';

import {
  isMatchType,
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
  type ClassificationRuleSummary,
  type CategoryOption,
} from '@/features/classification/store';
import { setExpenseSubtype } from '@/features/receipts/expense-subtype-store';
import { replaceReceiptItems, type ReceiptItemInput } from '@/features/receipts/items-store';
import { parseAppSettingsPatch } from '@/features/settings/chat-tools';
import { getAppSettings, updateAppSettings, type AppSettings } from '@/features/settings/store';
import { resolveTransactionById } from '@/features/transactions/chat-tools';
import {
  listTransactions,
  updateTransaction,
  updateTransactionMemo,
} from '@/features/transactions/store';
import type { StoredTransaction } from '@/features/transactions/types';
import {
  buildAssistantSystemPrompt,
  RECENT_TRANSACTIONS_LIMIT,
  type AssistantChange,
} from '@/features/assistant/chat-tools';
import { apiKeyMissingMessage, describeAnthropicError } from '@/lib/anthropic';
import { ChatToolError, parseChatMessages } from '@/lib/chat-tools';
import { readAnthropicApiKey } from '@/lib/env';
import { describeUserError } from '@/lib/errors';

/**
 * 「AIに変更を頼む」(本人発案、ADR-054)。
 *
 * 「ルールをAIに相談する」(ADR-024、app/api/rules/chat/route.ts、廃止)を
 * 汎用化したもの。本人が話した内容から、分類ルール・本人設定・明細・
 * レシート品目・生活費の小分類のいずれかを実際に変更する。アーキテクチャ
 * (tool-use のループ、レート制限、会話を保存しないステートレス設計)は
 * 旧実装からそのまま引き継ぐ。各ドメインの純粋な部分は
 * features/{classification,settings,transactions}/chat-tools.ts に、
 * それらを束ねてシステムプロンプトを作る部分は features/assistant/chat-tools.ts に
 * 分離してある。
 *
 * ── 何をさせないか(ADR-010 を会話にも適用する) ───────────────
 * FR-21(リボ・キャッシング・分割払い)の検知ルールは、見逃しが致命的なため
 * 確率的な判断に晒さない。旧実装と同じく、対象ルールが `setPaymentMethod` を
 * 持たないことを実行直前に必ず再確認する(二重で守る)。
 *
 * ── 設定の変更はシークレットに触れない(ADR-014) ─────────────
 * update_settings が触れるのは `AppSettings`(業務パラメータ)の列だけ。
 * シークレット(env変数名の参照値)を保持する列はこのテーブルに存在せず、
 * `AppSettingsPatch` 自体がそれ以外を受け付けない型になっている。
 *
 * ── 会話は保存しない ────────────────────────────────────────
 * 旧実装と同じ理由(新しいテーブルを増やさない、本番へ新規マイグレーションを
 * 適用する手段がこのセッションに無い制約)。
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

export type { AssistantChange };

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
  {
    name: 'update_settings',
    description:
      '本人設定を変更する。渡した項目だけを変更する(渡さなかった項目はそのまま)。少なくとも1項目は指定すること。',
    input_schema: {
      type: 'object',
      properties: {
        payday: { type: 'number', description: '給料日(1〜31)' },
        monthly_repayment_target_yen: { type: 'number', description: '月々の返済目標額(円)' },
        repayment_strategy: {
          type: 'string',
          enum: ['avalanche', 'snowball', 'minimum', 'custom'],
        },
        investment_ratio_of_repayment: {
          type: 'number',
          description: '返済目標額に対する投資額の比率(0〜1)',
        },
        is_high_risk_unlocked: { type: 'boolean', description: '高リスク投資枠を解禁するか' },
        high_risk_allocation_ratio: {
          type: 'number',
          description: '投資総額のうち高リスク枠に回す比率(0〜1)',
        },
        side_income_repayment_ratio: {
          type: 'number',
          description: '副業収入のうち返済に回す比率(0〜1)',
        },
      },
    },
  },
  {
    name: 'update_transaction',
    description:
      '既存の明細のカテゴリ・金額・日付・メモのいずれかを変更する。少なくとも1項目は指定すること。' +
      '金額は支出なら負、収入なら正の整数円で指定する。',
    input_schema: {
      type: 'object',
      properties: {
        transaction_id: { type: 'string', description: '会話に添えた明細一覧の id' },
        category_name: { type: 'string' },
        amount_yen: { type: 'number' },
        occurred_on: { type: 'string', description: 'YYYY-MM-DD形式' },
        memo: { type: 'string' },
      },
      required: ['transaction_id'],
    },
  },
  {
    name: 'update_receipt_items',
    description:
      '明細(レシート)の品目一覧を丸ごと置き換える。空配列を渡すと品目を無くす。' +
      '合計が明細の金額と一致する必要はない。',
    input_schema: {
      type: 'object',
      properties: {
        transaction_id: { type: 'string', description: '会話に添えた明細一覧の id' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              amount_yen: { type: 'number', description: '0以外の整数円' },
              category_name: { type: 'string', description: '省略可' },
            },
            required: ['name', 'amount_yen'],
          },
        },
      },
      required: ['transaction_id', 'items'],
    },
  },
  {
    name: 'set_expense_subtype',
    description:
      '生活費明細の小分類を設定する(例:食費・日用品など、決まったカテゴリではない自由記述)。',
    input_schema: {
      type: 'object',
      properties: {
        transaction_id: { type: 'string', description: '会話に添えた明細一覧の id' },
        subtype: { type: 'string' },
      },
      required: ['transaction_id', 'subtype'],
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

  const apiKey = readAnthropicApiKey();
  if (apiKey === null) {
    return NextResponse.json({
      reply: apiKeyMissingMessage('AIに変更を頼む機能'),
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
  let currentSettings: AppSettings;
  let recentTransactions: StoredTransaction[];
  try {
    let transactions: StoredTransaction[];
    [categories, rules, currentSettings, transactions] = await Promise.all([
      listCategoryOptions(),
      listClassificationRules(),
      getAppSettings(),
      listTransactions(),
    ]);
    recentTransactions = transactions.slice(0, RECENT_TRANSACTIONS_LIMIT);
  } catch (error) {
    return NextResponse.json({
      reply: describeUserError(error, '読み込みに失敗しました。'),
      changes: [],
    });
  }

  const client = new Anthropic({ apiKey });
  const anthropicMessages: MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const changes: AssistantChange[] = [];
  let finalText = '';

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: buildAssistantSystemPrompt({
          categories,
          rules: toRuleContexts(rules),
          settings: currentSettings,
          recentTransactions,
        }),
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
        const outcome = await executeTool(toolUse, categories, recentTransactions, changes);
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
    return NextResponse.json({ reply: describeAnthropicError(error), changes });
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
  transactions: readonly StoredTransaction[],
  changes: AssistantChange[],
): Promise<ToolOutcome> {
  try {
    switch (toolUse.name) {
      case 'create_rule':
        return await runCreateRule(toolUse.input, categories, changes);
      case 'update_rule':
        return await runUpdateRule(toolUse.input, categories, changes);
      case 'delete_rule':
        return await runDeleteRule(toolUse.input, changes);
      case 'update_settings':
        return await runUpdateSettings(toolUse.input, changes);
      case 'update_transaction':
        return await runUpdateTransaction(toolUse.input, categories, transactions, changes);
      case 'update_receipt_items':
        return await runUpdateReceiptItems(toolUse.input, categories, transactions, changes);
      case 'set_expense_subtype':
        return await runSetExpenseSubtype(toolUse.input, transactions, changes);
      default:
        return { message: `未知のツールです: ${toolUse.name}`, isError: true };
    }
  } catch (error) {
    return { message: describeUserError(error, '実行に失敗しました。'), isError: true };
  }
}

async function runCreateRule(
  input: unknown,
  categories: readonly CategoryOption[],
  changes: AssistantChange[],
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
    target: created.name,
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
  changes: AssistantChange[],
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
    target: updated.name,
    detail: describeRuleUpdate(before, updated, categoryName),
  });
  return { message: `ルール「${updated.name}」を変更しました。`, isError: false };
}

async function runDeleteRule(input: unknown, changes: AssistantChange[]): Promise<ToolOutcome> {
  const args = input as Record<string, unknown>;
  const ruleId = typeof args.rule_id === 'string' ? args.rule_id : '';
  if (ruleId === '') {
    return { message: 'rule_id は必須です。', isError: true };
  }
  const before = await assertNotProtected(ruleId);
  await deleteClassificationRule(ruleId);
  changes.push({ kind: 'deleted', target: before.name, detail: before.pattern ?? '' });
  return { message: `ルール「${before.name}」を削除しました。`, isError: false };
}

async function runUpdateSettings(input: unknown, changes: AssistantChange[]): Promise<ToolOutcome> {
  const { patch, descriptions } = parseAppSettingsPatch(input);
  await updateAppSettings(patch);
  const detail = descriptions.join(' / ');
  changes.push({ kind: 'updated', target: '設定', detail });
  return { message: `設定を変更しました(${detail})。`, isError: false };
}

async function runUpdateTransaction(
  input: unknown,
  categories: readonly CategoryOption[],
  transactions: readonly StoredTransaction[],
  changes: AssistantChange[],
): Promise<ToolOutcome> {
  const args = input as Record<string, unknown>;
  const current = resolveTransactionById(args.transaction_id, transactions);

  let categoryId = current.categoryId;
  let categoryName = current.categoryName;
  if (args.category_name !== undefined) {
    const category = resolveCategoryByName(args.category_name, categories);
    categoryId = category.id;
    categoryName = category.name;
  }

  const hasAmountOrDate = args.amount_yen !== undefined || args.occurred_on !== undefined;
  const changingCategoryOrAmountOrDate = args.category_name !== undefined || hasAmountOrDate;
  const hasMemo = typeof args.memo === 'string';

  if (!changingCategoryOrAmountOrDate && !hasMemo) {
    return { message: '変更する項目がありません。', isError: true };
  }

  if (changingCategoryOrAmountOrDate) {
    if (categoryId === null) {
      throw new ChatToolError(
        'この明細にはまだカテゴリが無いため、category_name も併せて指定してください。',
      );
    }
    const amountYen =
      typeof args.amount_yen === 'number' ? Math.trunc(args.amount_yen) : current.amountYen;
    const occurredOn = typeof args.occurred_on === 'string' ? args.occurred_on : current.occurredOn;
    await updateTransaction(
      current.id,
      categoryId,
      hasAmountOrDate ? { amountYen, occurredOn } : undefined,
    );
  }
  if (hasMemo) {
    await updateTransactionMemo(current.id, args.memo as string);
  }

  const detailParts: string[] = [];
  if (args.category_name !== undefined) detailParts.push(`カテゴリ: ${categoryName}`);
  if (typeof args.amount_yen === 'number')
    detailParts.push(`金額: ${Math.trunc(args.amount_yen)}円`);
  if (typeof args.occurred_on === 'string') detailParts.push(`日付: ${args.occurred_on}`);
  if (hasMemo) detailParts.push(`メモ: ${args.memo}`);

  changes.push({ kind: 'updated', target: current.description, detail: detailParts.join(' / ') });
  return { message: `明細「${current.description}」を変更しました。`, isError: false };
}

async function runUpdateReceiptItems(
  input: unknown,
  categories: readonly CategoryOption[],
  transactions: readonly StoredTransaction[],
  changes: AssistantChange[],
): Promise<ToolOutcome> {
  const args = input as Record<string, unknown>;
  const current = resolveTransactionById(args.transaction_id, transactions);
  const rawItems = Array.isArray(args.items) ? args.items : null;
  if (rawItems === null) {
    throw new ChatToolError('items は配列で指定してください。');
  }

  const items: ReceiptItemInput[] = rawItems.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const amountYen = typeof item.amount_yen === 'number' ? Math.trunc(item.amount_yen) : NaN;
    if (name === '' || !Number.isFinite(amountYen) || amountYen === 0) {
      throw new ChatToolError('品目には name と 0 以外の amount_yen が必要です。');
    }
    const categoryId =
      item.category_name !== undefined
        ? resolveCategoryByName(item.category_name, categories).id
        : null;
    return { name, amountYen, categoryId };
  });

  await replaceReceiptItems(current.id, items);
  const detail = items.length > 0 ? `品目${items.length}件を登録` : '品目を削除';
  changes.push({ kind: 'updated', target: current.description, detail });
  return {
    message: `明細「${current.description}」の${detail}しました。`,
    isError: false,
  };
}

async function runSetExpenseSubtype(
  input: unknown,
  transactions: readonly StoredTransaction[],
  changes: AssistantChange[],
): Promise<ToolOutcome> {
  const args = input as Record<string, unknown>;
  const current = resolveTransactionById(args.transaction_id, transactions);
  const subtype = typeof args.subtype === 'string' ? args.subtype.trim() : '';
  if (subtype === '') {
    throw new ChatToolError('subtype が空です。');
  }
  await setExpenseSubtype(current.id, subtype);
  changes.push({
    kind: 'updated',
    target: current.description,
    detail: `生活費の小分類: ${subtype}`,
  });
  return {
    message: `明細「${current.description}」の小分類を「${subtype}」にしました。`,
    isError: false,
  };
}
