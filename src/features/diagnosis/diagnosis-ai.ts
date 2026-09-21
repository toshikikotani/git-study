/**
 * 支出の「浪費 か 必要経費 か」のAI診断(本人発案、ADR-030)。
 *
 * ── なぜAIによる主観的判断が要るのか ────────────────────────────
 * category_kind(浪費/生活費/聖域...、ADR-010)はカテゴリ単位の静的な分類で、
 * 「リボ・キャッシングの検知」のような確定的な判定(FR-21)ではなく、そもそも
 * 主観に属する。ここは ADR-010 の役割分担(確定的な判定は正規表現、主観的な
 * 判断はAI)のうち、後者に正面から取り組む機能——本人発案「AIの分析が弱い。
 * もっと客観視した分析が必要。投資家目線で今のが浪費か必要経費なのか判断する
 * 機構」に応える。
 *
 * ── なぜ本人操作でだけ呼ぶのか ──────────────────────────────
 * 貼り付け画面・レシート画面と同じ考え方(ADR-019/021)。取り込みのたびに
 * 自動で呼ぶと、明細が増えるほど課金が積み上がる。診断は本人が明示的に
 * ボタンを押した時だけ実行する(features/diagnosis/store.ts の
 * listUndiagnosedTransactionsForDiagnosis() 参照)。
 *
 * ── モデルは Haiku ではなく Sonnet ────────────────────────────
 * 分類(ADR-010)は「どのカテゴリに当てはまるか」という比較的機械的な作業
 * だが、ここは「投資家として妥当な判断か」という踏み込んだ評価を本人が
 * 求めている(「分析が弱い」という指摘そのもの)。/advisor(ADR-023)と
 * 同じ判断で、コストより分析の質を優先し Sonnet を使う。
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type { DateOnly } from '@/lib/date';

/** 診断に使うモデル(ADR-030)。日付サフィックスは付けない。 */
export const SPENDING_DIAGNOSIS_MODEL = 'claude-sonnet-5';

/** 1回のリクエストに含める明細数の上限。理由は診断1件ごとに文章を書かせる
 * ため、件数が増えると出力が長くなり max_tokens に達しやすくなるため
 * (features/diagnosis/store.ts の MAX_BATCH_SIZE と揃える)。 */
const MAX_OUTPUT_TOKENS = 4096;

export type SpendingVerdict = 'waste' | 'necessary';

export type SpendingDiagnosisInput = {
  id: string;
  /** 店名(無ければ摘要)。 */
  label: string;
  /** 支出が負(ADR-008)。 */
  amountYen: number;
  occurredOn: DateOnly;
  categoryName: string | null;
};

export type SpendingDiagnosisResult = {
  id: string;
  verdict: SpendingVerdict;
  reasoning: string;
};

export type DiagnoseSpendingOutcome = {
  results: SpendingDiagnosisResult[];
  warnings: string[];
};

const rowSchema = z.object({
  id: z.string().describe('渡された明細の id をそのまま返す。存在しない id を作らない。'),
  verdict: z
    .enum(['waste', 'necessary'])
    .describe('waste=浪費(無くても生活・仕事に支障が無い支出)、necessary=必要経費。'),
  reasoning: z
    .string()
    .describe(
      '1文・40字程度で、なぜそう判断したかを具体的に書く。' +
        '「高額な外食」のような曖昧な理由ではなく、何と比較してそう言えるかを書く。',
    ),
});

const diagnosisSchema = z.object({
  diagnoses: z.array(rowSchema),
});

type DiagnosisRow = z.infer<typeof rowSchema>;

const SYSTEM_PROMPT = [
  'あなたは辛口だが公正な個人投資家として、本人の支出を1件ずつ評価します。',
  '',
  '判断基準:',
  '- 「必要経費」とは、生活の維持・健康・仕事や収入を得る力の維持に必須の支出、',
  '  または将来の資産形成・負債返済に直接つながる支出。',
  '- 「浪費」とは、それが無くても生活・仕事に支障が出ない、気晴らしや欲求を',
  '  満たすためだけの支出。金額の大小だけでは判断しない(少額でも繰り返せば',
  '  浪費たり得るし、高額でも仕事の投資なら必要経費たり得る)。',
  '- カテゴリ名は参考程度に留め、店名・金額・日付など実際の内容から判断する。',
  '- 迷う場合は「必要経費」側に倒さない。本人は甘い判断ではなく客観的な評価を',
  '  求めている。',
  '- reasoning は1文・40字程度。ラベルの言い換えではなく、判断の根拠を書く。',
  '- 渡された明細すべてに1件ずつ判断を返す。除外しない。',
].join('\n');

export interface SpendingDiagnosisAnalyzer {
  diagnose(transactions: readonly SpendingDiagnosisInput[]): Promise<DiagnoseSpendingOutcome>;
}

/**
 * Claude を使う実装。サーバー側でのみ生成すること(API キーがブラウザへ
 * 渡ることは無い、NFR-04)。
 */
export class ClaudeSpendingDiagnosisAnalyzer implements SpendingDiagnosisAnalyzer {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async diagnose(
    transactions: readonly SpendingDiagnosisInput[],
  ): Promise<DiagnoseSpendingOutcome> {
    if (transactions.length === 0) return { results: [], warnings: [] };

    let parsed: z.infer<typeof diagnosisSchema> | null;
    try {
      const response = await this.client.messages.parse({
        model: SPENDING_DIAGNOSIS_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserContent(transactions) }],
        output_config: { format: zodOutputFormat(diagnosisSchema) },
      });

      if (response.stop_reason === 'max_tokens') {
        return {
          results: [],
          warnings: ['AI の出力が長すぎて途中で切れました。件数を減らしてもう一度お試しください。'],
        };
      }
      parsed = response.parsed_output;
    } catch (error) {
      return { results: [], warnings: [describeError(error)] };
    }

    if (parsed === null) {
      return { results: [], warnings: ['AI の返答を解釈できませんでした。'] };
    }

    return buildFromAiRows(parsed.diagnoses, transactions);
  }
}

function buildUserContent(transactions: readonly SpendingDiagnosisInput[]): string {
  const lines = transactions.map(
    (t) =>
      `id=${t.id} 日付=${t.occurredOn} 店=${t.label} 金額=${Math.abs(t.amountYen)}円 カテゴリ=${
        t.categoryName ?? '未分類'
      }`,
  );
  return ['以下の明細それぞれについて、浪費か必要経費かを判断してください。', ...lines].join('\n');
}

/**
 * モデルの返答を検証する。存在しない id・重複した id・空の理由文はここで捨てる
 * (receipt-ai.ts の buildFromAiRows() と同じ「モデルの出力を信用しきらない」
 * 考え方)。要求した件数より少なく返ってきても、届いた分だけ保存して残りは
 * 次回の「診断する」で拾えるようにする(全滅させて本人の操作を無駄にしない)。
 */
export function buildFromAiRows(
  rows: readonly DiagnosisRow[],
  requested: readonly SpendingDiagnosisInput[],
): DiagnoseSpendingOutcome {
  const requestedIds = new Set(requested.map((t) => t.id));
  const seen = new Set<string>();
  const results: SpendingDiagnosisResult[] = [];

  for (const row of rows) {
    if (!requestedIds.has(row.id) || seen.has(row.id)) continue;
    const reasoning = row.reasoning.trim();
    if (reasoning === '') continue;
    seen.add(row.id);
    results.push({ id: row.id, verdict: row.verdict, reasoning });
  }

  const warnings: string[] = [];
  const missing = requested.length - results.length;
  if (missing > 0) {
    warnings.push(
      `${missing}件は判断結果を受け取れませんでした。もう一度「診断する」を押すと拾えることがあります。`,
    );
  }

  return { results, warnings };
}

/**
 * 失敗の理由を本人に見える言葉にする(receipt-ai.ts の describeError() と同じ)。
 */
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
