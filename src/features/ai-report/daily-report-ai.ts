/**
 * AI日次レポートの生成(ADR-032)。今日の支出を今月の平均と比べて気づきと
 * アドバイスを作る。
 *
 * 浪費傾向のタイプ判定は持たない——1日分ではその日の偏りで判定がぶれるため、
 * 月次レポート(ADR-031)に一本化している。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { parseStructured } from '@/lib/anthropic';

/** レポート生成に使うモデル(ADR-032)。日付サフィックスは付けない。 */
export const DAILY_REPORT_MODEL = 'claude-sonnet-5';

const MAX_OUTPUT_TOKENS = 1536;

export type DailyReportItem = {
  label: string;
  amountYen: number;
  reasoning: string;
};

export type DailyReportCategory = {
  name: string;
  amountYen: number;
};

export type DailyReportInput = {
  dateKey: string;
  totalSpentYen: number;
  transactionCount: number;
  categoryBreakdown: readonly DailyReportCategory[];
  /** この月のここまでの1日あたり平均支出(比較の基準)。 */
  averageDailySpendYen: number;
  wasteItems: readonly DailyReportItem[];
  necessaryItems: readonly DailyReportItem[];
};

export type DailyReportResult = {
  insights: string[];
  advice: string[];
};

export type GenerateDailyReportOutcome =
  { report: DailyReportResult; warnings: string[] } | { report: null; warnings: string[] };

const reportSchema = z.object({
  insights: z
    .array(z.string())
    .describe(
      '2〜4件。今日の実データの数字を具体的に引用した気づき(例:「今日の外食は今月の平均日額の2倍」)。' +
        '数字を独自に作らない。今日の取引が無ければ「今日はまだ支出の記録がありません」等、事実だけ書く。',
    ),
  advice: z
    .array(z.string())
    .describe(
      '2〜4件。明日以降の支出行動に関する一般的な工夫。体質・性格を断定する言い方や' +
        '医学的な助言(食事・栄養・ホルモン等)は書かない。',
    ),
});

type ReportRow = z.infer<typeof reportSchema>;

const SYSTEM_PROMPT = [
  'あなたは本人の家計データだけを見て日次レポートを書くファイナンシャルアドバイザーです。',
  '',
  '厳守事項:',
  '- insights・advice はすべて渡された数字だけを根拠にする。渡されていない情報',
  '  (食事・睡眠・ホルモン・血液検査等)を作り出さない。',
  '- 医学的な診断、体質の断定、食事・サプリ・栄養に関する助言は一切書かない。本人から',
  '  「そういう身体的な話は要らない」と明示されている。',
  '- 1日分のデータだけで性格や浪費傾向のタイプを断定しない(それは月次レポートの役割)。',
  '- advice はあくまで支出行動(買い物のタイミング・記録の習慣等)に関する一般的な工夫に限る。',
  '- insights は数字を引用する(円・件数・比率など)。「使いすぎ」のような曖昧な言い方だけで',
  '  終わらせない。',
].join('\n');

export interface DailyReportAnalyzer {
  generate(input: DailyReportInput): Promise<GenerateDailyReportOutcome>;
}

/** Claude を使う実装。サーバー側でのみ生成すること(API キーがブラウザへ渡ることは無い、NFR-04)。 */
export class ClaudeDailyReportAnalyzer implements DailyReportAnalyzer {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async generate(input: DailyReportInput): Promise<GenerateDailyReportOutcome> {
    const result = await parseStructured({
      client: this.client,
      model: DAILY_REPORT_MODEL,
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

function buildUserContent(input: DailyReportInput): string {
  const lines: string[] = [
    `${input.dateKey} の家計データ:`,
    '',
    `今日の支出: ${input.totalSpentYen}円(${input.transactionCount}件) / 今月のここまでの1日あたり平均: ${input.averageDailySpendYen}円`,
    '',
  ];

  if (input.categoryBreakdown.length > 0) {
    lines.push('今日のカテゴリ別支出:');
    for (const c of input.categoryBreakdown) {
      lines.push(`- ${c.name}: ${c.amountYen}円`);
    }
    lines.push('');
  }

  if (input.wasteItems.length > 0) {
    lines.push('今日、浪費と診断された明細:');
    for (const item of input.wasteItems) {
      lines.push(`- ${item.label} ${Math.abs(item.amountYen)}円: ${item.reasoning}`);
    }
    lines.push('');
  }

  if (input.necessaryItems.length > 0) {
    lines.push('今日、必要経費と診断された明細:');
    for (const item of input.necessaryItems) {
      lines.push(`- ${item.label} ${Math.abs(item.amountYen)}円: ${item.reasoning}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * モデルの返答を検証する(monthly-report-ai.ts の buildFromAiOutput() と
 * 同じ「モデルの出力を信用しきらない」考え方)。
 */
export function buildFromAiOutput(row: ReportRow): GenerateDailyReportOutcome {
  const insights = row.insights.map((s) => s.trim()).filter((s) => s !== '');
  const advice = row.advice.map((s) => s.trim()).filter((s) => s !== '');

  if (insights.length === 0 || advice.length === 0) {
    return { report: null, warnings: ['AI の返答が不十分でした。もう一度お試しください。'] };
  }

  return {
    report: {
      insights: insights.slice(0, 4),
      advice: advice.slice(0, 4),
    },
    warnings: [],
  };
}
