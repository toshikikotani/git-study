/**
 * AI日次レポートの生成(ADR-032)。今日の支出を今月の平均と比べて気づきと
 * アドバイスを作る。
 *
 * 浪費傾向のタイプ判定は持たない——1日分ではその日の偏りで判定がぶれるため、
 * 月次レポート(ADR-031)に一本化している。
 *
 * N1(AIゲートウェイ)適用第1号。プロンプトは src/prompts/daily-report.ts
 * (バージョン付き)、呼び出しは parseStructuredGated(AI一括オフ・1回再試行)、
 * 結果は withAiCache(同一入力はキャッシュ)、insights/advice の数値は
 * verifyNumbersAgainstFacts で本文中の数字とだけ突き合わせ、一致しない数値が
 * 混じっていれば出力ごと破棄する(N1本人要件)。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { withAiCache } from '@/lib/ai-gateway/cache';
import { parseStructuredGated } from '@/lib/ai-gateway/gated';
import { extractNumbers, verifyNumbersAgainstFacts } from '@/lib/ai-gateway/numeric-verification';
import { DAILY_REPORT_PROMPT } from '@/prompts/daily-report';

/** レポート生成に使うモデル(ADR-032)。日付サフィックスは付けない。 */
export const DAILY_REPORT_MODEL = 'claude-sonnet-5-5';

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
  /** 今月の着地の見込み(確率予測 v2)。作れなければ null。 */
  monthLanding: {
    p10: number;
    p50: number;
    p90: number;
    remainingPerDayYen: number | null;
  } | null;
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
    return withAiCache(
      'daily-report',
      input,
      async () => {
        const userContent = buildUserContent(input);
        const result = await parseStructuredGated({
          client: this.client,
          model: DAILY_REPORT_MODEL,
          maxTokens: MAX_OUTPUT_TOKENS,
          system: DAILY_REPORT_PROMPT.text,
          messages: [{ role: 'user', content: userContent }],
          schema: reportSchema,
          hints: { truncated: 'もう一度お試しください。' },
        });
        if (!result.ok) return { report: null, warnings: [result.message] };

        // N1: 出力の数値は本文(userContent)に登場した数字とだけ突き合わせる。
        // 台帳に無い数字が1つでも混じっていれば、出力ごと破棄して代替表示にする。
        const facts = extractNumbers(userContent);
        const keep = (lines: string[]) =>
          lines.filter((line) => verifyNumbersAgainstFacts([line], facts).ok);
        return buildFromAiOutput({
          ...result.value,
          insights: keep(result.value.insights),
          advice: keep(result.value.advice),
        });
      },
      { shouldCache: (outcome) => outcome.report !== null },
    );
  }
}

function buildUserContent(input: DailyReportInput): string {
  const lines: string[] = [
    `${input.dateKey} の家計データ:`,
    '',
    `今日の支出: ${input.totalSpentYen}円(${input.transactionCount}件) / 今月のここまでの1日あたり平均: ${input.averageDailySpendYen}円`,
    '',
  ];

  if (input.monthLanding !== null) {
    const m = input.monthLanding;
    lines.push(
      `今月の着地の見込み(統計): 中央 ${m.p50}円 ・ 下振れ ${m.p10}円 〜 上振れ ${m.p90}円(10回中8回)` +
        (m.remainingPerDayYen !== null
          ? ` ・ 残りの1日あたりの見込み ${m.remainingPerDayYen}円`
          : ''),
      '',
    );
  }

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
