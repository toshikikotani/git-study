/**
 * 期間つき支出目標のAI提案(本人発案、ADR-058)。
 *
 * 「まずAIから大体これぐらいと付けてもらい、そこから本人が変更する」ための
 * 提案で、課題のあるジャンルだけを徐々に削る方針。AIには判断(どのジャンルを
 * なぜどれだけ)と理由文だけを任せ、削る幅の上限・必須支出は削らない・実績より
 * 増やさない、は domain/spending-plan.ts の clampAiTarget が機械的に守る。
 * APIキーが無い・呼び出しに失敗したときは、決め打ち(fallbackTarget)で提案する。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import {
  PLAN_ROUNDING_YEN,
  clampAiTarget,
  fallbackTarget,
  rebalanceToTotal,
} from '@/domain/spending-plan';
import { formatYen } from '@/domain/money';
import { parseStructured } from '@/lib/anthropic';
import type { PlanContext, PlanGenreContext } from './context';

/** 提案に使うモデル。日付サフィックスは付けない。 */
export const SPENDING_PLAN_MODEL = 'claude-sonnet-5';

// 返答そのもの(22ジャンルぶんの金額と理由)は数百トークンだが、モデルの思考にも
// 出力枠が使われて 4096 では途中で切れた(本番で確認)。使った分だけの課金なので広く取る。
const MAX_OUTPUT_TOKENS = 16000;

export type PlanSuggestionItem = {
  genreId: string;
  genreName: string;
  baselineYen: number;
  suggestedYen: number;
  reason: string;
};

export type PlanSuggestion = {
  items: PlanSuggestionItem[];
  /** 全体の講評(1〜2文)。 */
  summary: string;
  warnings: string[];
  /** AIが提案した(false なら決め打ち)。 */
  usedAi: boolean;
};

type AiRow = { genre_name: string; target_yen: number; reason: string };

function buildSchema(genreNames: [string, ...string[]]) {
  return z.object({
    summary: z.string().describe('全体の講評。1〜2文。どのジャンルを中心に、なぜ今回そうしたか。'),
    targets: z
      .array(
        z.object({
          genre_name: z.enum(genreNames),
          target_yen: z.number().describe('この期間の目標額(円)。'),
          reason: z
            .string()
            .describe('40字程度。「課題 → 方針」の形で、削る場合はその理由を具体的に書く。'),
        }),
      )
      .describe('渡されたジャンルすべてについて1件ずつ返す。'),
  });
}

function buildSystemPrompt(stepPercent: number): string {
  return [
    'あなたは家計改善を手伝う、現実的で無理を勧めないアドバイザーです。',
    '本人が選んだ期間の、ジャンルごとの支出目標の案を作ります。',
    '',
    '守ること:',
    `- 徐々に改善する。削れるのは「課題のあるジャンル」だけで、削る幅は各ジャンルの`,
    `  「削れる部分(必須ラベルを除いた分)」の最大${stepPercent}%まで。一度に大きく削らない。`,
    '- 課題が無いジャンルは、期間の目安額のまま(現状維持)にする。',
    '- 必須ラベル(絶対払わざるを得ない支出)の部分は削らない。',
    '- 前回の目標が渡されたジャンルは、達成できていれば今回も同じ方向で少し削り、',
    '  未達なら無理に削らず据え置く(または目安どおり)。',
    '- 実績が無いジャンルは0円にする。',
    '- 目標額は「期間の目安額」を超えない。',
    '- reason は40字程度、「課題 → 方針」の形。ラベルの言い換えではなく、',
    '  実績の数字など根拠を短く書く。',
    '- 渡されたジャンルすべてに1件ずつ返す。',
  ].join('\n');
}

function describeGenre(g: PlanGenreContext): string {
  const parts = [
    `ジャンル=${g.genreName}`,
    `1日平均=${formatYen(g.dailyYen, { sign: 'never' })}`,
    `期間の目安額=${g.baselineYen}円`,
    g.budgetYen === null ? '月次予算なし' : `月次予算=${g.budgetYen}円`,
    `必須ラベルの割合=${Math.round(g.mustPayShare * 100)}%`,
  ];
  if (g.wasteShare !== null) parts.push(`浪費判定の割合=${Math.round(g.wasteShare * 100)}%`);
  if (g.trendRatio !== null)
    parts.push(`直近30日の傾向=前の期間の${Math.round(g.trendRatio * 100)}%`);
  parts.push(g.issueReasons.length > 0 ? `課題=${g.issueReasons.join('・')}` : '課題=なし');
  if (g.previous !== null) {
    parts.push(
      `前回の目標=${g.previous.targetYen}円→実績${g.previous.spentYen}円(${
        g.previous.met ? '達成' : '未達'
      })`,
    );
  }
  return parts.join(' ');
}

function buildUserContent(context: PlanContext, stepPercent: number): string {
  return [
    `期間は${context.periodDays}日間です。過去${context.lookbackDays}日の実績から出した期間の目安額を基準に、`,
    `改善の強さは最大${stepPercent}%です。次のジャンルそれぞれの目標額を提案してください。`,
    ...context.genres.map(describeGenre),
  ].join('\n');
}

/** 決め打ちの理由文(AIを使えなかったジャンル・行が欠けたジャンル用)。 */
function fallbackReason(g: PlanGenreContext, stepPercent: number): string {
  if (g.baselineYen <= 0) return '実績なし → 0円';
  if (!g.isIssue) return '課題なし → 現状維持';
  return `${g.issueReasons.join('・')} → まず${stepPercent}%削減`;
}

/**
 * AIの返答(または無し)から提案を組み立てる。AIの行が無い・ジャンル名が
 * 重複しているジャンルは決め打ちで埋め、どの場合も範囲に収める。
 */
export function mergeSuggestions(
  context: PlanContext,
  aiRows: readonly AiRow[],
  stepPercent: number,
): PlanSuggestionItem[] {
  const byName = new Map<string, AiRow>();
  for (const row of aiRows) if (!byName.has(row.genre_name)) byName.set(row.genre_name, row);

  return context.genres.map((g) => {
    const row = byName.get(g.genreName);
    const reason = row?.reason.trim();
    return {
      genreId: g.genreId,
      genreName: g.genreName,
      baselineYen: g.baselineYen,
      suggestedYen:
        row === undefined
          ? fallbackTarget(g, stepPercent)
          : clampAiTarget(row.target_yen, g, stepPercent),
      reason: reason ? reason : fallbackReason(g, stepPercent),
    };
  });
}

export async function suggestPlanTargets(
  apiKey: string | null,
  context: PlanContext,
  stepPercent: number,
  client?: Anthropic,
): Promise<PlanSuggestion> {
  const fallback = (warnings: string[]): PlanSuggestion => ({
    items: mergeSuggestions(context, [], stepPercent),
    summary: '課題のあるジャンルだけを、少しずつ削る案です。',
    warnings,
    usedAi: false,
  });

  if (apiKey === null) {
    return fallback(['AIのAPIキーが設定されていないため、決め打ちの案を出しています。']);
  }
  if (context.genres.length === 0) return fallback([]);

  const result = await parseStructured({
    client: client ?? new Anthropic({ apiKey }),
    model: SPENDING_PLAN_MODEL,
    maxTokens: MAX_OUTPUT_TOKENS,
    system: buildSystemPrompt(stepPercent),
    messages: [{ role: 'user', content: buildUserContent(context, stepPercent) }],
    schema: buildSchema(context.genres.map((g) => g.genreName) as [string, ...string[]]),
    hints: { truncated: 'ジャンル数が多いため、もう一度お試しください。' },
  });
  if (!result.ok) {
    return fallback([`${result.message} 決め打ちの案を出しています。`]);
  }

  return {
    items: mergeSuggestions(context, result.value.targets, stepPercent),
    summary: result.value.summary.trim(),
    warnings: [],
    usedAi: true,
  };
}

export type RefineItem = {
  genreId: string;
  genreName: string;
  /** いまの目標額(本人が直している途中の値)。 */
  currentYen: number;
  /** 過去実績から出した、この期間の目安額。 */
  baselineYen: number;
  mustPayShare: number;
};

export type RefineResult =
  { ok: true; amounts: Map<string, number>; summary: string } | { ok: false; message: string };

const MAX_INSTRUCTION_CHARS = 200;

function buildRefineSchema(genreNames: [string, ...string[]]) {
  return z.object({
    summary: z.string().describe('どう配分を動かしたかの説明。1〜2文。'),
    targets: z
      .array(z.object({ genre_name: z.enum(genreNames), target_yen: z.number() }))
      .describe('渡されたジャンルすべてについて1件ずつ返す。'),
  });
}

/**
 * AIの返答(または無し)から、総額に一致する配分を組み立てる。AIの行が無い
 * ジャンルは現状の額のまま、100円単位に丸め、最後に rebalanceToTotal で
 * 合計を総額にそろえる(AIの足し算を信用しない)。
 */
export function applyRefinement(
  items: readonly RefineItem[],
  totalYen: number,
  aiRows: readonly { genre_name: string; target_yen: number }[],
): Map<string, number> {
  const byName = new Map<string, number>();
  for (const row of aiRows)
    if (!byName.has(row.genre_name)) byName.set(row.genre_name, row.target_yen);

  const proposed = items.map((item) => {
    const yen = byName.get(item.genreName);
    return yen === undefined || !Number.isFinite(yen)
      ? item.currentYen
      : Math.max(Math.round(yen / PLAN_ROUNDING_YEN) * PLAN_ROUNDING_YEN, 0);
  });
  const balanced = rebalanceToTotal(proposed, totalYen, proposed);
  return new Map(items.map((item, i) => [item.genreId, balanced[i]!]));
}

/**
 * 目標の総額は固定のまま、ジャンルごとの配分を本人の指示に沿って微調整する
 * (本人発案、ADR-058)。指示が無ければ、実績と必須ラベルを踏まえた見直し案を出す。
 */
export async function refinePlanAllocation(
  apiKey: string | null,
  input: {
    periodDays: number;
    totalYen: number;
    items: readonly RefineItem[];
    instruction: string;
  },
  client?: Anthropic,
): Promise<RefineResult> {
  if (apiKey === null) {
    return { ok: false, message: 'AIのAPIキーが設定されていません。手動で調整できます。' };
  }
  if (input.items.length === 0) return { ok: false, message: '調整するジャンルがありません。' };

  const instruction = input.instruction.trim().slice(0, MAX_INSTRUCTION_CHARS);
  const lines = input.items.map(
    (item) =>
      `ジャンル=${item.genreName} いまの目標=${item.currentYen}円 期間の目安額(実績ペース)=${item.baselineYen}円 必須ラベルの割合=${Math.round(
        item.mustPayShare * 100,
      )}%`,
  );
  const result = await parseStructured({
    client: client ?? new Anthropic({ apiKey }),
    model: SPENDING_PLAN_MODEL,
    maxTokens: MAX_OUTPUT_TOKENS,
    system: [
      'あなたは家計改善を手伝う、現実的で無理を勧めないアドバイザーです。',
      '支出目標の総額は固定です。総額を変えずに、ジャンルごとの配分だけを本人の指示に沿って',
      '微調整します。',
      '',
      '守ること:',
      `- 全ジャンルの目標額の合計を、必ず総額(${input.totalYen}円)にそろえる。`,
      '- 指示に書かれたジャンルは指示どおりに動かし、その分を他のジャンルへ回す(または他から回す)。',
      '  回す先・元は、実績の大きさと、必須ラベルの割合が低い(=調整の余地がある)ジャンルを優先する。',
      '- 必須ラベルの割合が高いジャンルは、実績ペースを大きく下回る額にしない。',
      '- 指示が無い場合は、実績と必須ラベルを踏まえて、無理のある配分を1〜2か所だけ見直す。',
      '- 目標額は100円単位にする。',
      '- 渡されたジャンルすべてに1件ずつ返す。',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `期間は${input.periodDays}日間、総額は${input.totalYen}円で固定です。`,
          `本人の指示: ${instruction === '' ? '(なし。見直し案をお願いします)' : instruction}`,
          ...lines,
        ].join('\n'),
      },
    ],
    schema: buildRefineSchema(input.items.map((i) => i.genreName) as [string, ...string[]]),
    hints: { truncated: 'ジャンル数が多いため、もう一度お試しください。' },
  });
  if (!result.ok) return { ok: false, message: result.message };

  return {
    ok: true,
    amounts: applyRefinement(input.items, input.totalYen, result.value.targets),
    summary: result.value.summary.trim(),
  };
}
