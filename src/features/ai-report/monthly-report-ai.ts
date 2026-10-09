/**
 * AI月次レポートの生成(ADR-031)。1ヶ月分の実データから、浪費傾向のタイプ
 * (domain/persona.ts の固定6分類)・気づき・アドバイスを作る。
 *
 * 着地の見込み(確率予測 v2)も渡し、AIの読み(ADR-072)を返させる:明細のメモ・品目、
 * これからの予定、暦の事情、過去のAIの読みの当たり外れから、残りの支出を決まった選択肢
 * (AI_ADJUST_CHOICES)のどれだけ動かすかを選ぶ。金額の計算はアプリがする。
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

import { AI_ADJUST_CHOICES, type AiTrust, type ScoredRead } from '@/domain/ai-forecast-read';
import type { CalendarContext } from '@/domain/forecast/calendar';
import { SPENDING_PERSONA_TYPES, type SpendingPersonaType } from '@/domain/persona';
import { withAiCache } from '@/lib/ai-gateway/cache';
import { parseStructuredGated } from '@/lib/ai-gateway/gated';
import { extractNumbers, verifyNumbersAgainstFacts } from '@/lib/ai-gateway/numeric-verification';
import { MONTHLY_REPORT_PROMPT } from '@/prompts/monthly-report';

/** レポート生成に使うモデル(ADR-031)。日付サフィックスは付けない。 */
export const MONTHLY_REPORT_MODEL = 'claude-sonnet-5-5';

const MAX_OUTPUT_TOKENS = 4096;

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
  /** 貯金(収入 − 支出の自動の数え方、ADR-081)。 */
  savings: {
    totalYen: number;
    thisMonthYen: number;
    /** いつものペース(直近の月の平均)。 */
    paceYen: number | null;
    /** 次の貯金目標(無ければ null)。 */
    nextGoal: {
      title: string;
      targetAmountYen: number | null;
      remainingYen: number | null;
      targetDate: string | null;
      /** 0〜1。金額の無い目標は null。 */
      progressRatio: number | null;
    } | null;
  };
  /** 確率予測(v2)の着地の見込み。作れなければ null(そのときAIの読みは出さない)。 */
  forecast: MonthlyReportForecast | null;
  /** AIの読みの根拠に使ってよい事実。 */
  evidence: MonthlyReportEvidence;
};

export type MonthlyReportForecast = {
  asOf: string;
  remainingDays: number;
  /** すでに決まっている額(実績 + 予定 + 固定費)。補正はこれより上の部分にだけ掛ける。 */
  knownYen: number;
  p10: number;
  p50: number;
  p90: number;
  /** 残りの期間の見込みの内訳。 */
  unrecordedYen: number;
  billsYen: number;
  visitsYen: number;
  specialYen: number;
  remainingPerDayYen: number | null;
  recentPerDayYen: number | null;
  /** 検証できた月が3か月未満なら true(統計の数字は目安)。 */
  provisional: boolean;
  categories: readonly { name: string; actualYen: number; p50: number }[];
};

export type MonthlyReportEvidence = {
  /** 今月の目立つ明細(金額の大きいもの・メモのあるもの)。 */
  notable: readonly {
    date: string;
    label: string;
    amountYen: number;
    genre: string;
    memo: string | null;
    items: readonly string[];
  }[];
  /** これからの予定(今日より先の日付の明細)。 */
  scheduled: readonly { date: string; label: string; amountYen: number; genre: string }[];
  calendar: CalendarContext | null;
  /** 過去のAIの読みと、その月の実際の着地。 */
  pastReads: readonly ScoredRead[];
  trust: AiTrust;
};

export type ForecastReadResult = { percent: number; reason: string; evidence: string[] };

export type MonthlyReportResult = {
  personaType: SpendingPersonaType;
  personaReasoning: string;
  insights: string[];
  advice: string[];
  /** AIの読み(着地の見込みへの補正)。予測が無い・返答が不十分なら null。 */
  forecastRead: ForecastReadResult | null;
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
      '6〜8件。各文に金額と、総支出に占める割合か予算との差を入れる。渡された数字だけを使う。',
    ),
  advice: z
    .array(z.string())
    .describe('4〜6件。各文に、減らす・確保する金額を入れる。診断や未診断には触れない。'),
  forecastRead: z
    .object({
      percent: z
        .enum(AI_ADJUST_CHOICES.map(String) as [string, ...string[]])
        .describe(
          '統計の見込みの「残りの支出」を何%動かすか。決まった選択肢から1つ。根拠が弱ければ "0"。',
        ),
      reason: z
        .string()
        .describe(
          '1〜2文。なぜその補正にしたか。統計が見ていない事情を、渡した事実だけで説明する。',
        ),
      evidence: z
        .array(z.string())
        .describe('1〜3件。根拠にした事実(明細・予定・暦・過去の読み)を、渡した表記のまま短く。'),
    })
    .describe('着地の見込みへのAIの読み。統計の見込みが渡されていなければ percent は "0"。'),
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
          disableThinking: true,
          effort: 'low',
          timeoutMs: 45_000,
        });
        if (!result.ok) return { report: null, warnings: [result.message] };

        // N1: 出力の数値は本文(userContent)に登場した数字とだけ突き合わせる。
        const facts = extractNumbers(userContent);
        const verification = verifyNumbersAgainstFacts(
          [
            result.value.personaReasoning,
            ...result.value.insights,
            ...result.value.advice,
            result.value.forecastRead.reason,
            ...result.value.forecastRead.evidence,
          ],
          facts,
        );
        if (!verification.ok) {
          return {
            report: null,
            warnings: ['AIの出力に台帳と一致しない数字があったため、今回は表示しません。'],
          };
        }

        return buildFromAiOutput(result.value, { hasForecast: input.forecast !== null });
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
      ? '見直し候補の比率: まだ無い'
      : `浪費 ${input.wasteYen}円 ・ 必要経費 ${input.necessaryYen}円(浪費比率 ${Math.round(input.wasteRatio * 100)}%)`,
    '',
  );

  if (input.categoryBreakdown.length > 0) {
    lines.push('カテゴリ別支出(多い順):');
    for (const c of input.categoryBreakdown) {
      const share =
        input.totalSpentYen > 0 ? Math.round((c.spentYen / input.totalSpentYen) * 100) : 0;
      const diff = c.budgetYen !== null ? c.spentYen - c.budgetYen : null;
      lines.push(
        `- ${c.name}: ${c.spentYen}円(総支出の${share}%)${c.budgetYen !== null ? ` 予算${c.budgetYen}円 差${diff}円` : ''}`,
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

  const s = input.savings;
  lines.push(
    '貯金の状況(収入 − 支出):',
    `今月 ${s.thisMonthYen}円` +
      (s.paceYen !== null ? ` ・ いつもの月 ${s.paceYen}円` : '') +
      (s.nextGoal !== null ? ` ・ 貯まった合計 ${s.totalYen}円` : ''),
  );
  if (s.nextGoal !== null) {
    const g = s.nextGoal;
    lines.push(
      `次の貯金目標: ${g.title}` +
        (g.targetAmountYen !== null ? ` ${g.targetAmountYen}円` : '') +
        (g.remainingYen !== null ? ` ・ あと${g.remainingYen}円` : '') +
        (g.targetDate !== null ? ` ・ 期限${g.targetDate}` : ''),
    );
  }

  appendForecastSection(lines, input);

  return lines.join('\n');
}

const yenOf = (n: number) => `${n}円`;

/** 着地の見込みと、AIの読みの根拠に使ってよい事実。 */
function appendForecastSection(lines: string[], input: MonthlyReportInput): void {
  const f = input.forecast;
  lines.push('');
  if (f === null) {
    lines.push('着地の見込み(統計): 今回は計算できなかった。forecastRead.percent は "0" にする。');
    return;
  }
  lines.push(
    `着地の見込み(統計、${f.asOf}時点、残り${f.remainingDays}日):` +
      ` 中央 ${yenOf(f.p50)} ・ 下振れ ${yenOf(f.p10)} 〜 上振れ ${yenOf(f.p90)}(10回中8回)` +
      (f.provisional ? ' ・ 過去の月での確認が3か月未満なので目安' : ''),
    `すでに決まっている額(実績・予定・固定費): ${yenOf(f.knownYen)}`,
    `残りの内訳の見込み: まだ記録されていない支出 ${yenOf(f.unrecordedYen)} ・ 月払いの請求 ${yenOf(f.billsYen)}` +
      ` ・ 規則的な来店 ${yenOf(f.visitsYen)} ・ 特別費 ${yenOf(f.specialYen)}`,
  );
  if (f.remainingPerDayYen !== null) {
    lines.push(
      `残りの1日あたりの見込み: ${yenOf(f.remainingPerDayYen)}` +
        (f.recentPerDayYen !== null ? ` ・ 直近14日の1日あたり: ${yenOf(f.recentPerDayYen)}` : ''),
    );
  }
  if (f.categories.length > 0) {
    lines.push('ジャンル別の着地の見込み(中央、多い順):');
    for (const c of f.categories) {
      lines.push(`- ${c.name}: ${yenOf(c.p50)}(ここまで ${yenOf(c.actualYen)})`);
    }
  }

  const e = input.evidence;
  if (e.notable.length > 0) {
    lines.push('', '今月の目立つ明細(金額の大きいもの・メモのあるもの):');
    for (const n of e.notable) {
      const items = n.items.length > 0 ? ` 品目: ${n.items.join('、')}` : '';
      const memo = n.memo ? ` メモ: ${n.memo}` : '';
      lines.push(`- ${n.date} ${n.label} ${yenOf(n.amountYen)}(${n.genre})${memo}${items}`);
    }
  }
  lines.push('', 'これからの予定:');
  if (e.scheduled.length === 0) lines.push('- 日付の入った予定は無い');
  for (const s of e.scheduled) {
    lines.push(`- ${s.date} ${s.label} ${yenOf(s.amountYen)}(${s.genre})`);
  }
  if (e.calendar !== null) {
    const c = e.calendar;
    lines.push(
      '',
      `残りの日の暦: 休み(土日祝)${c.dayOffs}日、うち平日の祝日${c.weekdayHolidays}日` +
        (c.longestBreak
          ? ` ・ ${c.longestBreak.from}〜${c.longestBreak.to}に${c.longestBreak.days}連休`
          : '') +
        (c.payday ? ` ・ 給料日 ${c.payday}` : '') +
        (c.seasons.length > 0 ? ` ・ 時期: ${c.seasons.join('、')}` : ''),
    );
  }
  lines.push('', '過去のAIの読みの当たり外れ(月末の実際の着地と比べたもの):');
  if (e.pastReads.length === 0) lines.push('- まだ無い');
  for (const r of e.pastReads) {
    const better =
      Math.abs(r.adjustedP50Yen - r.actualYen) < Math.abs(r.statP50Yen - r.actualYen)
        ? 'AIの読みが近かった'
        : '統計が近かった';
    lines.push(
      `- ${r.month}: 補正 ${r.percent}% ・ 統計 ${yenOf(r.statP50Yen)} ・ AIの読み ${yenOf(r.adjustedP50Yen)} ・ 実際 ${yenOf(r.actualYen)}(${better})`,
    );
  }
  lines.push(
    '',
    `forecastRead.percent の選択肢: ${AI_ADJUST_CHOICES.join(', ')}(%、統計の「残りの支出」に対して)`,
  );
}

/**
 * モデルの返答を検証する(receipt-ai.ts・diagnosis-ai.ts の buildFromAiRows() と
 * 同じ「モデルの出力を信用しきらない」考え方)。空文字の項目は捨て、想定より
 * 多く返ってきても表示側の見た目が壊れないよう件数を切る。
 */
export function buildFromAiOutput(
  row: ReportRow,
  options: { hasForecast: boolean } = { hasForecast: true },
): GenerateMonthlyReportOutcome {
  const personaReasoning = row.personaReasoning.trim();
  const insights = row.insights.map((s) => s.trim()).filter((s) => s !== '');
  const advice = row.advice.map((s) => s.trim()).filter((s) => s !== '');

  if (personaReasoning === '' || insights.length === 0 || advice.length === 0) {
    return { report: null, warnings: ['AI の返答が不十分でした。もう一度お試しください。'] };
  }

  // AIの読みは、予測があって、選択肢の中の値で、理由が書かれているときだけ採る。
  const percent = Number(row.forecastRead.percent);
  const reason = row.forecastRead.reason.trim();
  const evidence = row.forecastRead.evidence.map((s) => s.trim()).filter((s) => s !== '');
  const forecastRead =
    options.hasForecast &&
    (AI_ADJUST_CHOICES as readonly number[]).includes(percent) &&
    reason !== ''
      ? { percent, reason, evidence: evidence.slice(0, 3) }
      : null;

  return {
    report: {
      personaType: row.personaType,
      personaReasoning,
      insights: insights.slice(0, 5),
      advice: advice.slice(0, 5),
      forecastRead,
    },
    warnings: [],
  };
}
