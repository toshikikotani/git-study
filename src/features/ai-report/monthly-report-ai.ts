/**
 * AI月次レポートの生成(ADR-031)。1ヶ月分の実データから、浪費傾向のタイプ
 * (domain/persona.ts の固定6分類)・気づき・アドバイスを作る。
 *
 * 医学的な断定(体質・食事・ホルモン)はさせない。本人が明示的に外した領域で、
 * 支出データからは根拠が出せないため。
 *
 * N1(AIゲートウェイ)適用。プロンプトは src/prompts/monthly-report.ts
 * (バージョン付き)、呼び出しは parseStructuredGated(AI一括オフ・1回再試行)、
 * 結果は withAiCache(同一入力はキャッシュ)、personaReasoning/insights/advice の
 * 数値は verifyNumbersAgainstFacts で本文中の数字とだけ突き合わせる(N1本人要件)。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { SPENDING_PERSONA_TYPES, type SpendingPersonaType } from '@/domain/persona';
import { withAiCache } from '@/lib/ai-gateway/cache';
import { parseStructuredGated } from '@/lib/ai-gateway/gated';
import { extractNumbers, verifyNumbersAgainstFacts } from '@/lib/ai-gateway/numeric-verification';
import { MONTHLY_REPORT_PROMPT } from '@/prompts/monthly-report';

/** レポート生成に使うモデル(ADR-031)。日付サフィックスは付けない。 */
export const MONTHLY_REPORT_MODEL = 'claude-sonnet-5-5';

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
    return withAiCache(
      'monthly-report',
      input,
      async () => {
        const userContent = buildUserContent(input);
        const result = await parseStructuredGated({
          client: this.client,
          model: MONTHLY_REPORT_MODEL,
          maxTokens: MAX_OUTPUT_TOKENS,
          system: MONTHLY_REPORT_PROMPT.text,
          messages: [{ role: 'user', content: userContent }],
          schema: reportSchema,
          hints: { truncated: 'もう一度お試しください。' },
        });
        if (!result.ok) return { report: null, warnings: [result.message] };

        // N1: 出力の数値は本文(userContent)に登場した数字とだけ突き合わせる。
        const facts = extractNumbers(userContent);
        const verification = verifyNumbersAgainstFacts(
          [result.value.personaReasoning, ...result.value.insights, ...result.value.advice],
          facts,
        );
        if (!verification.ok) {
          return {
            report: null,
            warnings: ['AIの出力に台帳と一致しない数字があったため、今回は表示しません。'],
          };
        }

        return buildFromAiOutput(result.value);
      },
      { shouldCache: (outcome) => outcome.report !== null },
    );
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
