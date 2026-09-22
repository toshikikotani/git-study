/**
 * AI相談(目標設定・買う前相談)のチャット呼び出し(本人発案)。
 *
 * ── 役割分担(ADR-010/019/021 と同じ考え方) ──────────────────
 * AI がやること   会話に応じた返答文と、目標が固まったときの構造化した提案
 * AI がやらないこと 具体的な金額計算(与えたコンテキスト以外の数字を作らない)
 *                   目標の保存(提案するだけ。保存は本人の確認操作を経る)
 *
 * classification/ai.ts・receipt-ai.ts と同じ `messages.parse` +
 * `zodOutputFormat` を使う。会話の自然な返答(reply)と、目標の提案
 * (goalProposal、任意)を1回の呼び出しで同時に得られるため、
 * ツール呼び出し(tool use)の往復を増やさずに済む。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { parseStructured } from '@/lib/anthropic';
import { AppError } from '@/lib/errors';

/**
 * 会話の質が重要なため、分類・抽出系(ADR-010/019/021)の Haiku ではなく
 * Sonnet を使う(本人と直接やり取りする低頻度な機能のため、費用より対話の
 * 質を優先する判断。詳細は docs/decisions.md の ADR)。
 */
export const ADVISOR_MODEL = 'claude-sonnet-5';

const MAX_OUTPUT_TOKENS = 1024;
/** 一度に送る会話の往復上限。古い発言はこの数を超えたら呼び出し側が切る。 */
export const MAX_HISTORY_MESSAGES = 40;

export type AdvisorRole = 'user' | 'assistant';
export type AdvisorMessage = { role: AdvisorRole; content: string };

export type GoalProposal = {
  title: string;
  targetAmountYen: number | null;
  /** 'YYYY-MM-DD' または null。 */
  targetDate: string | null;
};

export type AdvisorReply = {
  reply: string;
  goalProposal: GoalProposal | null;
};

const goalProposalSchema = z.object({
  title: z.string().describe('目標の短いタイトル(例:旅行費用を貯める)'),
  targetAmountYen: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('目標金額(円)。金額を目標にしていなければ null'),
  targetDate: z.string().nullable().describe("目標の期限。'YYYY-MM-DD' 形式。期限が無ければ null"),
});

const chatResponseSchema = z.object({
  reply: z
    .string()
    .describe(
      '本人への返答本文。3〜5文程度の自然な会話文。Markdown記法(見出し・箇条書きの記号)は使わず改行だけで整える',
    ),
  goalProposal: goalProposalSchema
    .nullable()
    .describe(
      '会話の中で具体的な目標(タイトルが決まり、できれば金額・期限も)が固まったときだけ設定する。世間話や、まだ何も定まっていない相談は null のままにする',
    ),
});

const SYSTEM_PROMPT_HEADER = [
  'あなたは家計簿アプリの中にいるAI相談相手です。次の2つに対応します。',
  '',
  '1. 目標設定:本人が次に目指すことを、対話を通じて一緒に明確にする',
  '2. 買う前相談:買おうか迷っている物について、今の家計の状況を踏まえて一緒に考える',
  '',
  '守ること:',
  '- 本人を責めない。使い方の良し悪しを断定せず、事実と選択肢を示す',
  '- 断定的な金額計算をしない。金額の見積もりが必要なときは、後述する',
  '  「今の状況」に書かれている数字だけを根拠にする。そこに無い数字は',
  '  「正確には分かりません」と答え、勝手に計算しない',
  '- 返答は3〜5文程度で簡潔に。丁寧だが事務的にならない、自然な会話文で',
  '- Markdown記法(見出し・箇条書きの記号等)は使わない。改行だけで整える',
  '- このアプリは実際の資金移動をしない。「振り分けておきます」のように',
  '  実行したかのように話さない(本人が自分の口座で操作する前提)',
  '- 具体的な目標(タイトルは必須、できれば金額・期限)が対話の中で固まった',
  '  ときだけ goalProposal を設定する。設定したときは返答の中で',
  '  「この内容で目標として保存できます」のように一言添える',
  '  (保存の実行はしない。本人が確認して保存するボタンを押す)',
  '- 「今の状況」に既に載っている目標と似た内容を、重複して提案しない',
].join('\n');

export class AdvisorChatError extends AppError {}

export class AdvisorChat {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async reply(
    messages: readonly AdvisorMessage[],
    contextText: string,
    model: string = ADVISOR_MODEL,
  ): Promise<AdvisorReply> {
    if (messages.length === 0) {
      throw new AdvisorChatError('会話が空です');
    }

    const result = await parseStructured({
      client: this.client,
      model,
      maxTokens: MAX_OUTPUT_TOKENS,
      system: buildSystemPrompt(contextText),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      schema: chatResponseSchema,
      hints: {
        truncated: 'もう一度短く聞いてみてください。',
        rateLimit: '少し時間を置いてから試してください。',
      },
    });
    if (!result.ok) throw new AdvisorChatError(result.message);

    return { reply: result.value.reply, goalProposal: result.value.goalProposal };
  }
}

function buildSystemPrompt(contextText: string): string {
  return [
    SYSTEM_PROMPT_HEADER,
    '',
    '今の状況(正確な計算結果。これ以外の金額は本人に聞かれても断定しない):',
    contextText,
  ].join('\n');
}
