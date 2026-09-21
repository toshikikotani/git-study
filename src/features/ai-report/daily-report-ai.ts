/**
 * AI日次レポートの生成(本人発案「日次レポートと月次レポートどっちも出力
 * できるように」、ADR-032)。
 *
 * ── なぜ persona_type(浪費傾向のタイプ)を持たないか ──────────────
 * ai_monthly_reports(ADR-031)は1ヶ月分の蓄積データからタイプを判定する。
 * 1日分のデータだけでタイプ判定をすると、たまたまその日に外食が重なった
 * だけで「衝動買い型」に振れる等、判定がぶれやすくノイズが大きい。タイプ
 * 判定は月次レポートに一本化し、日次レポートは今日の気づきとアドバイスに
 * 絞る。
 *
 * ── なぜ本人操作でだけ呼ぶのか ──────────────────────────────────
 * monthly-report-ai.ts と同じ考え方。
 *
 * ── モデルは Sonnet ────────────────────────────────────────────
 * 今日の支出を月内の典型的な1日と比べて意味のある気づきを書く必要があり、
 * 単純な分類ではなく推論寄りのタスクのため monthly-report-ai.ts と同じ
 * 判断で Sonnet を使う(呼び出し自体は本人操作でしか発生しないため、
 * 頻度によるコスト増はボタン連打を除けば無い)。
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

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
    let parsed: ReportRow | null;
    try {
      const response = await this.client.messages.parse({
        model: DAILY_REPORT_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserContent(input) }],
        output_config: { format: zodOutputFormat(reportSchema) },
      });

      if (response.stop_reason === 'max_tokens') {
        return {
          report: null,
          warnings: ['AI の出力が長すぎて途中で切れました。もう一度お試しください。'],
        };
      }
      parsed = response.parsed_output;
    } catch (error) {
      return { report: null, warnings: [describeError(error)] };
    }

    if (parsed === null) {
      return { report: null, warnings: ['AI の返答を解釈できませんでした。'] };
    }

    return buildFromAiOutput(parsed);
  }
}

function buildUserContent(input: DailyReportInput): string {
  const lines: string[] = [
    `${input.dateKey} の家計データ:`,
    '',
    `今日の支出: ${input.totalSpentYen}円(${input.transactionCount}件) / 今月のここまでの1日あたり平均: ${Math.round(input.averageDailySpendYen)}円`,
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

/** 失敗の理由を本人に見える言葉にする(monthly-report-ai.ts の describeError() と同じ)。 */
function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'AI の API キーが無効です。ANTHROPIC_API_KEY を確認してください。';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'AI の利用上限に達しました。しばらくしてから再試行してください。';
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `AI への要求が受け付けられませんでした: ${error.message}`;
  }
  if (error instanceof Anthropic.APIError) {
    return `AI の呼び出しに失敗しました(${error.status}): ${error.message}`;
  }
  return `AI の呼び出しに失敗しました: ${error instanceof Error ? error.message : String(error)}`;
}
