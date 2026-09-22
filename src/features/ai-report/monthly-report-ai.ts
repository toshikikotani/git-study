/**
 * AI月次レポートの生成(ADR-031)。1ヶ月分の実データから、浪費傾向のタイプ
 * (domain/persona.ts の固定6分類)・気づき・アドバイスを作る。
 *
 * 医学的な断定(体質・食事・ホルモン)はさせない。本人が明示的に外した領域で、
 * 支出データからは根拠が出せないため。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { SPENDING_PERSONA_TYPES, type SpendingPersonaType } from '@/domain/persona';
import { parseStructured } from '@/lib/anthropic';

/** レポート生成に使うモデル(ADR-031)。日付サフィックスは付けない。 */
export const MONTHLY_REPORT_MODEL = 'claude-sonnet-5';

const MAX_OUTPUT_TOKENS = 2048;

/** AIへ渡す明細例の上限。件数が多い月でも1件ずつ全部渡すと入力が肥大化する
 * ため、代表例だけに絞る(app/(app)/spending の一覧表示自体は全件表示する
 * P10-23 とは別の話——ここはAIへの入力サイズの都合)。 */
export const MAX_ITEMS_PER_LIST = 10;

export type MonthlyReportItem = {
  label: string;
  amountYen: number;
  reasoning: string;
};

export type MonthlyReportCategory = {
  name: string;
  spentYen: number;
  budgetYen: number | null;
};

export type MonthlyReportInput = {
  monthKey: string;
  totalSpentYen: number;
  totalIncomeYen: number;
  wasteYen: number;
  necessaryYen: number;
  wasteRatio: number | null;
  undiagnosedCount: number;
  categoryBreakdown: readonly MonthlyReportCategory[];
  topWasteItems: readonly MonthlyReportItem[];
  topNecessaryItems: readonly MonthlyReportItem[];
  wasteRatioTrend: readonly { monthKey: string; wasteRatio: number | null }[];
  payoff: {
    remainingYen: number;
    progressRatio: number;
    reducedThisMonthYen: number;
    daysRemaining: number | null;
  };
};

export type MonthlyReportResult = {
  personaType: SpendingPersonaType;
  personaReasoning: string;
  insights: string[];
  advice: string[];
};

export type GenerateMonthlyReportOutcome =
  { report: MonthlyReportResult; warnings: string[] } | { report: null; warnings: string[] };

const reportSchema = z.object({
  personaType: z
    .enum(SPENDING_PERSONA_TYPES as [SpendingPersonaType, ...SpendingPersonaType[]])
    .describe('渡された6分類の中から最も近いものを1つ選ぶ。新しい分類を作らない。'),
  personaReasoning: z
    .string()
    .describe('1〜2文。なぜそのタイプと判断したか、渡された実際の数字を根拠にする。'),
  insights: z
    .array(z.string())
    .describe(
      '3〜5件。渡された実データの数字を具体的に引用した気づき(例:「食費が予算を12,000円超過」)。' +
        '数字を独自に作らない。',
    ),
  advice: z
    .array(z.string())
    .describe(
      '3〜5件。支出行動を変えるための一般的な工夫(例:「衝動買いが多い時間帯は買い物アプリを閉じておく」)。' +
        '体質・性格を断定する言い方や医学的な助言(食事・栄養・ホルモン等)は書かない。',
    ),
});

type ReportRow = z.infer<typeof reportSchema>;

const SYSTEM_PROMPT = [
  'あなたは本人の家計データだけを見て月次レポートを書くファイナンシャルアドバイザーです。',
  '',
  '厳守事項:',
  '- personaType は必ず渡された6分類から選ぶ(impulsive/steady/social/goal_oriented/frugal/balanced)。',
  '  それ以外の分類名を作らない。',
  '- persona・insights・advice はすべて渡された数字だけを根拠にする。渡されていない',
  '  情報(食事・睡眠・ホルモン・血液検査・生年月日から推測する性格等)を作り出さない。',
  '- 医学的な診断、体質の断定、食事・サプリ・栄養に関する助言は一切書かない。本人から',
  '  「そういう身体的な話は要らない」と明示されている。',
  '- advice はあくまで支出行動(買い物のタイミング・記録の習慣・予算の見直し等)に関する',
  '  一般的な工夫に限る。',
  '- insights は数字を引用する(円・%・件数など)。「浪費が多い」のような曖昧な言い方だけで',
  '  終わらせない。',
].join('\n');

export interface MonthlyReportAnalyzer {
  generate(input: MonthlyReportInput): Promise<GenerateMonthlyReportOutcome>;
}

/** Claude を使う実装。サーバー側でのみ生成すること(API キーがブラウザへ渡ることは無い、NFR-04)。 */
export class ClaudeMonthlyReportAnalyzer implements MonthlyReportAnalyzer {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async generate(input: MonthlyReportInput): Promise<GenerateMonthlyReportOutcome> {
    const result = await parseStructured({
      client: this.client,
      model: MONTHLY_REPORT_MODEL,
      maxTokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent(input) }],
      schema: reportSchema,
      hints: { truncated: 'もう一度お試しください。' },
    });
    if (!result.ok) return { report: null, warnings: [result.message] };

    return buildFromAiOutput(result.value);
  }
}

function buildUserContent(input: MonthlyReportInput): string {
  const lines: string[] = [`${input.monthKey} の家計データ:`, ''];

  lines.push(
    `総支出: ${input.totalSpentYen}円 / 総収入: ${input.totalIncomeYen}円`,
    input.wasteRatio === null
      ? '浪費/必要経費の診断: まだ無い'
      : `浪費 ${input.wasteYen}円 ・ 必要経費 ${input.necessaryYen}円(浪費比率 ${Math.round(input.wasteRatio * 100)}%)`,
    `今月まだ診断していない支出: ${input.undiagnosedCount}件`,
    '',
  );

  if (input.categoryBreakdown.length > 0) {
    lines.push('カテゴリ別支出(多い順):');
    for (const c of input.categoryBreakdown) {
      lines.push(
        `- ${c.name}: ${c.spentYen}円${c.budgetYen !== null ? `(予算${c.budgetYen}円)` : ''}`,
      );
    }
    lines.push('');
  }

  if (input.topWasteItems.length > 0) {
    lines.push('浪費と診断された明細(一部):');
    for (const item of input.topWasteItems) {
      lines.push(`- ${item.label} ${Math.abs(item.amountYen)}円: ${item.reasoning}`);
    }
    lines.push('');
  }

  if (input.topNecessaryItems.length > 0) {
    lines.push('必要経費と診断された明細(一部):');
    for (const item of input.topNecessaryItems) {
      lines.push(`- ${item.label} ${Math.abs(item.amountYen)}円: ${item.reasoning}`);
    }
    lines.push('');
  }

  const diagnosedTrend = input.wasteRatioTrend.filter((row) => row.wasteRatio !== null);
  if (diagnosedTrend.length > 0) {
    lines.push('直近の浪費比率の推移:');
    for (const row of diagnosedTrend) {
      lines.push(`- ${row.monthKey}: ${Math.round((row.wasteRatio ?? 0) * 100)}%`);
    }
    lines.push('');
  }

  lines.push(
    '負債返済の状況:',
    `残債 ${input.payoff.remainingYen}円 ・ 進捗率 ${Math.round(input.payoff.progressRatio * 100)}%` +
      ` ・ 今月の返済実績 ${input.payoff.reducedThisMonthYen}円` +
      (input.payoff.daysRemaining !== null
        ? ` ・ 完済まで残り${input.payoff.daysRemaining}日`
        : ''),
  );

  return lines.join('\n');
}

/**
 * モデルの返答を検証する(receipt-ai.ts・diagnosis-ai.ts の buildFromAiRows() と
 * 同じ「モデルの出力を信用しきらない」考え方)。空文字の項目は捨て、想定より
 * 多く返ってきても表示側の見た目が壊れないよう件数を切る。
 */
export function buildFromAiOutput(row: ReportRow): GenerateMonthlyReportOutcome {
  const personaReasoning = row.personaReasoning.trim();
  const insights = row.insights.map((s) => s.trim()).filter((s) => s !== '');
  const advice = row.advice.map((s) => s.trim()).filter((s) => s !== '');

  if (personaReasoning === '' || insights.length === 0 || advice.length === 0) {
    return { report: null, warnings: ['AI の返答が不十分でした。もう一度お試しください。'] };
  }

  return {
    report: {
      personaType: row.personaType,
      personaReasoning,
      insights: insights.slice(0, 5),
      advice: advice.slice(0, 5),
    },
    warnings: [],
  };
}
