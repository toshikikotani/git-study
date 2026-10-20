import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { NextResponse } from 'next/server';

import { loadPlanContext } from '@/features/assistant/apply';
import { buildAssistantSystemPrompt } from '@/features/assistant/chat-tools';
import { buildAdvisorContextText } from '@/features/advisor/context';
import {
  isWriteToolName,
  MAX_CHANGES_PER_PROPOSAL,
  parseAskUser,
  planToolCall,
  type AskUserQuestion,
  type PlanContext,
  type ProposedChange,
} from '@/features/assistant/plan';
import { withStoreCandidates } from '@/features/assistant/store-candidates';
import {
  simulateSpendCard,
  whatIfToolText,
  type WhatIfCard,
} from '@/features/assistant/what-if-tool';
import {
  ASSISTANT_SCREEN_KEYS,
  MAX_SCREEN_LINKS,
  screenLinkOf,
  type ScreenLink,
} from '@/features/assistant/screens';
import { apiKeyMissingMessage, describeAnthropicError } from '@/lib/anthropic';
import { ChatToolError, parseChatMessages, toAlternatingTurns } from '@/lib/chat-tools';
import { todayJst } from '@/lib/date';
import { readAnthropicApiKey } from '@/lib/env';
import { describeUserError } from '@/lib/errors';

/**
 * AIの窓口(本人発案、ADR-054 → ADR-059 で唯一の窓口に統合)。
 *
 * 本人の意見から、複数の設定をまとめて変える「変更案」を作る。モデルの
 * ツール呼び出しはここでは実行せず、検証(features/assistant/plan.ts)を通した
 * 変更案として返すだけ——実際の反映は、本人がチャット内の確認カードで承認した
 * あとに app/api/assistant/apply/route.ts が行う。
 *
 * ── ask_user(選択肢を出すツール) ─────────────────────────────
 * 方針が複数ある・値が分からないときは、文章で聞き返す代わりにモデルが
 * ask_user を呼ぶ。ここでは実行せず、選択肢をそのまま画面へ返す(画面が
 * チップとして描画し、選ばれた文言が次の発言としてこのAPIへ戻ってくる)。
 *
 * ── 会話は保存しない ────────────────────────────────────────
 * 旧実装と同じ理由(新しいテーブルを増やさない、本番へ新規マイグレーションを
 * 適用する手段がこのセッションに無い制約)。
 */

export const runtime = 'nodejs';

/**
 * 複数の設定を組み合わせる判断が要るため、旧 /assistant の Haiku ではなく、
 * 旧 /advisor(目標設定・買う前相談)と同じ Sonnet を使う(会話の質を優先)。
 */
const MODEL = 'claude-sonnet-5-5';
const MAX_OUTPUT_TOKENS = 2048;
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

const TOOLS: Tool[] = [
  {
    name: 'add_transaction',
    description:
      '記録(支出・収入・返金)を1件作る案を出す。本人が確認カードで承認してから記録される。' +
      '「コンビニで500円」「昨日ランチ1200円」のような話から作る。日付が無ければ今日。' +
      'カテゴリはジャンル一覧から最も近いものを選ぶ(無理に選ばなくてよい)。',
    input_schema: {
      type: 'object',
      properties: {
        occurred_on: { type: 'string', description: '日付(YYYY-MM-DD)。先の日付は予定になる' },
        amount_yen: { type: 'number', description: '金額(円の正の整数)' },
        kind: {
          type: 'string',
          enum: ['expense', 'income', 'refund'],
          description: '支出 / 収入 / 返金。既定は支出',
        },
        store_name: {
          type: 'string',
          description:
            '店名・内容(レシート名)。「コンビニ」「セブン」のようにおおまかなら、「よく使うお店」から一番ありそうな1つ。無ければ省く',
        },
        store_candidates: {
          type: 'array',
          items: { type: 'string' },
          description:
            '「よく使うお店」の一覧から、ほかに当てはまりそうなお店(最大4つ、よく使う順)。本人がボタンで選び直せる。一覧に無い名前は入れない',
        },
        genre_name: { type: 'string', description: 'ジャンル一覧にあるジャンル名。返金では必須' },
        memo: { type: 'string', description: 'メモ(任意)' },
      },
      required: ['occurred_on', 'amount_yen'],
    },
  },
  {
    name: 'simulate_spend',
    description:
      '「今日あと3,000円使ったら？」「飲み会で5,000円使う予定、やばい？」のように、これから使う額で見通しが' +
      'どう変わるかを、アプリの予測(今日の画面と同じ)で計算する。読むだけで何も記録しない。' +
      '結果(着地見込み・目標内の確率・明日からの目安・月末の貯金の前→後)は本人の画面にもカードで出る。' +
      'すでに記録してある支出は足さない(二重に数えない)。',
    input_schema: {
      type: 'object',
      properties: {
        amount_yen: { type: 'number', description: 'これから使う額(円の正の整数)' },
        genre_name: { type: 'string', description: 'ジャンル一覧にあるジャンル名(分かれば)' },
      },
      required: ['amount_yen'],
    },
  },
  {
    name: 'show_screen',
    description:
      'アプリの画面へ移るボタンを本人に出す。会話で答えられない・画面で見るほうが分かりやすい・' +
      '会話ではできない操作(削除など)のときに使う。1回の返事で3つまで。',
    input_schema: {
      type: 'object',
      properties: {
        screen: {
          type: 'string',
          enum: [...ASSISTANT_SCREEN_KEYS],
          description: '行き先の画面',
        },
      },
      required: ['screen'],
    },
  },
  {
    name: 'update_settings',
    description:
      '本人設定の変更案を作る。渡した項目だけを変更する(渡さなかった項目はそのまま)。少なくとも1項目は指定すること。',
    input_schema: {
      type: 'object',
      properties: {
        payday: { type: 'number', description: '給料日(1〜31)' },
        monthly_savings_target_yen: { type: 'number', description: '毎月の貯金目標(円)' },
        investment_ratio_of_savings: {
          type: 'number',
          description: '毎月の貯金目標に対する投資額の比率(0〜1)',
        },
        high_risk_allocation_ratio: {
          type: 'number',
          description: '投資総額のうち高リスク枠に回す比率(0〜1)',
        },
        side_income_savings_ratio: {
          type: 'number',
          description: '副業収入のうち貯金に回す比率(0〜1)',
        },
      },
    },
  },
  {
    name: 'update_transaction',
    description:
      '既存の明細のジャンル・金額・日付・メモのいずれかを変更する案を作る。少なくとも1項目は指定すること。' +
      '金額は支出なら負、収入なら正の整数円で指定する。',
    input_schema: {
      type: 'object',
      properties: {
        transaction_id: { type: 'string', description: '会話に添えた明細一覧の id' },
        genre_name: { type: 'string' },
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
      '明細(レシート)の品目一覧を丸ごと置き換える案を作る。空配列を渡すと品目を無くす。' +
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
              genre_name: { type: 'string', description: '省略可' },
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
      '生活費明細の小分類を設定する案を作る(例:食費・日用品など、決まったカテゴリではない自由記述)。',
    input_schema: {
      type: 'object',
      properties: {
        transaction_id: { type: 'string', description: '会話に添えた明細一覧の id' },
        subtype: { type: 'string' },
      },
      required: ['transaction_id', 'subtype'],
    },
  },
  {
    name: 'update_genre_budget',
    description:
      'ジャンルの月次予算を変更する案を作る。無制限に戻すときは budget_yen に null を渡す。',
    input_schema: {
      type: 'object',
      properties: {
        genre_name: { type: 'string', description: '現在のジャンル一覧にある名前' },
        budget_yen: { type: ['number', 'null'], description: '月次予算(円)。null で無制限' },
      },
      required: ['genre_name', 'budget_yen'],
    },
  },
  {
    name: 'create_genre',
    description:
      '新しいジャンルを追加する案を作る。既存のジャンルで足りるときは作らない。' +
      '追加したジャンルを使う別の変更は、承認後の次のやり取りで頼むこと(同じ変更案には入れない)。',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: '1〜30文字' } },
      required: ['name'],
    },
  },
  {
    name: 'create_goal',
    description:
      '新しい貯金目標を追加する案を作る。タイトルが決まり、できれば金額・期限も固まってから使う。' +
      '貯まった額は収入 − 支出から自動で数える。',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '目標の短いタイトル(例:旅行費用を貯める)' },
        target_amount_yen: { type: ['number', 'null'], description: '目標金額(円)。無ければ null' },
        target_date: {
          type: ['string', 'null'],
          description: 'YYYY-MM-DD形式の期限。無ければ null',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_plan_targets',
    description:
      '直近に立てた支出目標のジャンルごとの目標額を調整する案を作る(合計を変える・配分を直すなど)。' +
      '直近の目標に含まれるジャンルだけ指定できる。',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              genre_name: { type: 'string' },
              target_yen: { type: 'number', description: '目標額(円)' },
            },
            required: ['genre_name', 'target_yen'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'ask_user',
    description:
      '本人に選択肢を出して選んでもらう。方針が複数あって本人の好みで決まるとき、値が分からないときに、' +
      '文章で聞き返す代わりに使う。選択肢は2〜4個。「その他」は入れない(自由入力は常にできる)。',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '本人への質問文(1文)' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: '選択肢の短い名前(選ばれるとそのまま発言になる)',
              },
              description: { type: 'string', description: 'その選択肢を選ぶと何が起きるか' },
            },
            required: ['label', 'description'],
          },
        },
        multi_select: { type: 'boolean', description: '複数選べるようにするか。既定 false' },
      },
      required: ['question', 'options'],
    },
  },
];

export type AssistantReply = {
  reply: string;
  proposal: { changes: ProposedChange[] } | null;
  question: AskUserQuestion | null;
  /** 画面へ移るボタン(show_screen、ADR-103)。 */
  links?: ScreenLink[];
  /** もし使ったらの前 → 後(simulate_spend、ADR-108)。 */
  whatIf?: WhatIfCard | null;
};

export async function POST(request: Request): Promise<NextResponse> {
  let payload: { messages?: unknown };
  try {
    payload = (await request.json()) as { messages?: unknown };
  } catch {
    return NextResponse.json({ error: 'JSON として読めませんでした' }, { status: 400 });
  }

  const parsed = parseChatMessages(payload.messages);
  if (parsed === null) {
    return NextResponse.json({ error: '会話の形式が正しくありません' }, { status: 400 });
  }
  const messages = toAlternatingTurns(parsed);
  if (messages.length === 0) {
    return NextResponse.json({ error: 'メッセージがありません' }, { status: 400 });
  }

  const apiKey = readAnthropicApiKey();
  if (apiKey === null) {
    return NextResponse.json({
      reply: apiKeyMissingMessage('AIの窓口'),
      proposal: null,
      question: null,
    } satisfies AssistantReply);
  }
  // 混み合い・読み込みの失敗・AIの呼び出しの失敗は、返事ではなく「送れなかった」として返す。
  // 画面はその発言に「もう一度送る」を出す(失敗の文が会話に混ざって次の文脈にならない、ADR-105)。
  if (!takeAiCallSlot()) {
    return NextResponse.json(
      { error: 'AIの呼び出しが混み合っています。少し時間をおいて、もう一度送ってください。' },
      { status: 429 },
    );
  }

  let planContext: PlanContext;
  let situationText: string;
  try {
    [planContext, situationText] = await Promise.all([
      loadPlanContext(),
      // 買う前相談の根拠になる正確な数字。取得に失敗しても変更案づくりは続ける。
      buildAdvisorContextText().catch(() => ''),
    ]);
  } catch (error) {
    return NextResponse.json(
      { error: describeUserError(error, '読み込みに失敗しました。') },
      { status: 503 },
    );
  }

  const client = new Anthropic({ apiKey });
  const anthropicMessages: MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const system = buildAssistantSystemPrompt({
    genres: planContext.genres,
    settings: planContext.settings,
    recentTransactions: planContext.transactions,
    goals: planContext.goals,
    latestPlan: planContext.latestPlan,
    stores: planContext.stores ?? [],
    situationText,
    today: todayJst(),
  });

  const proposed: ProposedChange[] = [];
  const links: ScreenLink[] = [];
  const found: { whatIf: WhatIfCard | null } = { whatIf: null };
  let question: AskUserQuestion | null = null;
  let finalText = '';

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        // Sonnet 5 は既定で高強度に考え、その分も max_tokens に数えられる。
        // 変更案づくりは低強度で足りるため、遅さと途中切れを避ける。
        output_config: { effort: 'low' },
        system,
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
        const outcome = await handleToolUse(toolUse, planContext, proposed, links, found);
        if (outcome.question !== null) question = outcome.question;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: outcome.message,
          is_error: outcome.isError,
        });
      }
      if (question !== null) break;
      anthropicMessages.push({ role: 'user', content: toolResults });
    }
  } catch (error) {
    // 途中まで案ができていれば、それは出す(作った案を捨てない)。何もできていなければ送れなかった扱い。
    if (proposed.length === 0 && links.length === 0 && found.whatIf === null) {
      return NextResponse.json({ error: describeAnthropicError(error) }, { status: 502 });
    }
    return NextResponse.json({
      reply: describeAnthropicError(error),
      proposal: proposed.length > 0 ? { changes: proposed } : null,
      question: null,
      links,
      whatIf: found.whatIf,
    } satisfies AssistantReply);
  }

  const fallback =
    question !== null
      ? '選んでください。'
      : proposed.length > 0
        ? '案を作りました。内容を確かめて、よければ反映してください。'
        : links.length > 0
          ? 'この画面で見られます。'
          : found.whatIf !== null
            ? found.whatIf.verdict
            : '完了しました。';
  return NextResponse.json({
    reply: finalText !== '' ? finalText : fallback,
    proposal: proposed.length > 0 ? { changes: proposed } : null,
    question,
    links,
    whatIf: found.whatIf,
  } satisfies AssistantReply);
}

type ToolOutcome = { message: string; isError: boolean; question: AskUserQuestion | null };

async function handleToolUse(
  toolUse: ToolUseBlock,
  planContext: PlanContext,
  proposed: ProposedChange[],
  links: ScreenLink[],
  found: { whatIf: WhatIfCard | null },
): Promise<ToolOutcome> {
  try {
    if (toolUse.name === 'simulate_spend') {
      const card = await simulateSpendCard(toolUse.input, planContext);
      found.whatIf = card;
      return {
        message: whatIfToolText(card),
        isError: false,
        question: null,
      };
    }
    if (toolUse.name === 'show_screen') {
      const link = screenLinkOf((toolUse.input as { screen?: unknown } | null)?.screen);
      if (link === null) {
        return {
          message: '知らない画面です。一覧から選んでください。',
          isError: true,
          question: null,
        };
      }
      if (links.length >= MAX_SCREEN_LINKS) {
        return { message: 'ボタンは1回3つまでです。', isError: true, question: null };
      }
      if (!links.some((l) => l.href === link.href)) links.push(link);
      return {
        message: `「${link.label}」へのボタンを本人に出しました。`,
        isError: false,
        question: null,
      };
    }
    if (toolUse.name === 'ask_user') {
      const question = parseAskUser(toolUse.input);
      return { message: '選択肢を本人に表示しました。', isError: false, question };
    }
    if (!isWriteToolName(toolUse.name)) {
      return { message: `未知のツールです: ${toolUse.name}`, isError: true, question: null };
    }
    if (proposed.length >= MAX_CHANGES_PER_PROPOSAL) {
      return {
        message: `1回の変更案は${MAX_CHANGES_PER_PROPOSAL}件までです。残りは承認後に改めて提案してください。`,
        isError: true,
        question: null,
      };
    }
    const planned = planToolCall(toolUse.name, toolUse.input, planContext).change;
    // 記録の案には、よく行くお店の候補をつける(いちばんありそうなお店で作り、ほかはボタンで、ADR-107)。
    const change =
      toolUse.name === 'add_transaction'
        ? withStoreCandidates(planned, toolUse.input, planContext, todayJst())
        : planned;
    proposed.push(change);
    return {
      message: `変更案として受け付けました(${change.target}: ${change.detail})。本人が承認するまで反映されません。`,
      isError: false,
      question: null,
    };
  } catch (error) {
    if (error instanceof ChatToolError) {
      return { message: error.message, isError: true, question: null };
    }
    return {
      message: describeUserError(error, '変更案を作れませんでした。'),
      isError: true,
      question: null,
    };
  }
}
