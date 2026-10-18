/**
 * レシートの品目の読み取りミスを AI で見つける(本人の要望「明細のレシート内容もできたらチェックして」、
 * ADR-120)。
 *
 * 最近のレシートの品目(店名・支払額・品名・金額)を並べて AI に見せ、読み違えた品名・品目ではない行・
 * 桁を読み違えた金額を、直し方つきで出させる。AI は提案するだけで、保存は本人が選んで押したものだけ
 * (domain/receipt-check.ts)。日付・メモ・カテゴリは送らない。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import type { ReceiptCheckEntry, ReceiptFix, ReceiptFixKind } from '@/domain/receipt-check';
import { maskPii } from '@/lib/ai-gateway/privacy';
import { parseStructuredGated } from '@/lib/ai-gateway/gated';

/** 品目の読み直しに使うモデル。日付サフィックスは付けない。 */
export const RECEIPT_CHECK_MODEL = 'claude-opus-5-5';
/** AI に見せるレシートの数(最近のものから)。 */
export const MAX_AI_RECEIPTS = 100;
/** 本人が押して待つ処理なので、10秒の既定より長く待つ。 */
const AI_TIMEOUT_MS = 90_000;
const MAX_NAME_LENGTH = 100;
const MAX_AMOUNT_YEN = 10_000_000;

const schema = z.object({
  issues: z
    .array(
      z.object({
        receipt: z.number().int().describe('レシートの番号(#R の後ろの数字)'),
        item: z.number().int().describe('そのレシートの中の品目の番号(行の先頭の数字)'),
        kind: z
          .enum(['rename', 'remove', 'amount'])
          .describe('rename:品名を直す。remove:品目ではない行を消す。amount:金額を直す'),
        name: z.string().nullable().describe('rename のときの正しい品名。ほかは null'),
        amountYen: z
          .number()
          .int()
          .nullable()
          .describe('amount のときの正しい金額(円、正の整数)。ほかは null'),
        reason: z.string().describe('本人に見せる短い理由(30字ほど)'),
      }),
    )
    .describe('読み取りミスだと言えるものだけ。無ければ空の配列'),
});

export type ReceiptAiIssue = z.infer<typeof schema>['issues'][number];

export const RECEIPT_CHECK_SYSTEM_PROMPT = [
  'あなたは家計簿アプリで、レシートから読み取った品目の読み取りミスを見つける担当です。',
  '本人の最近のレシート(店名・支払額・品目と金額)を見て、読み取りのミスだけを直し方つきで出してください。',
  '',
  '見つけるもの:',
  '- 品名の読み違い・文字化け(「牛孚L」→「牛乳」、漢字の「卜」が混じった「卜マト」→「トマト」など)→ rename',
  '- 品目ではない行(小計・合計・お預り・お釣り・税の行・支払方法・ポイント利用など)→ remove',
  '- 桁や数字を読み違えたとしか思えない金額(おにぎりが3円、ガムが12,000円など)→ amount',
  '',
  '守ること:',
  '- 金額は、税・値引きを含めて支払額に按分した値です。印字の値段と数円〜数十円ちがうのはふつうなので出さない',
  '- レシートらしい略し方・半角カナ・型番(「ｷﾞｭｳﾆｭｳ」「BOXティッシュ5P」)は読み取りミスではないので出さない',
  '- 同じ品目が2行あっても、2つ買うことはよくあるので出さない',
  '- レジ袋・送料・手数料・割引券のように、お金を払った品目は消さない',
  '- 照合のずれがあるレシートは、どこかを読み違えている可能性が高い。ただし確かなものだけを出す',
  '- 迷うものは出さない。直す必要がないものは出さない',
  '- rename の name は、店で売っていそうな自然な品名にする。正しい名前が分からないなら出さない',
  '- amount の金額は、ほかの品目と合わせて支払額に近くなるようにする',
  '- 番号は入力にあるものだけを使う。存在しない番号を作らない',
].join('\n');

const yen = (value: number) => `${Math.abs(value).toLocaleString('ja-JP')}円`;

function buildUserContent(entries: readonly ReceiptCheckEntry[]): string {
  const lines = entries.flatMap((entry, r) => [
    `#R${r} 店=${maskPii(entry.storeName)} 支払=${yen(entry.amountYen)}` +
      (entry.reconcileDiffYen ? ` 照合のずれ=${yen(entry.reconcileDiffYen)}` : ''),
    ...entry.items.map((item, i) => `  ${i}: ${maskPii(item.name)} ${yen(item.amountYen)}`),
  ]);
  return ['最近のレシートの品目です。読み取りミスを見つけてください。', ...lines].join('\n');
}

const DEFAULT_REASON: Record<ReceiptFixKind, string> = {
  rename: '品名を読み違えているようです',
  remove: '品目ではない行のようです',
  amount: '金額を読み違えているようです',
};

/**
 * AI の返事を候補にする(AI を信用しきらない:無いレシート・品目の番号、空や長すぎる品名、
 * 今と同じ品名・金額、ありえない金額は捨てる)。
 */
export function aiIssuesToFixes(
  issues: readonly ReceiptAiIssue[],
  entries: readonly ReceiptCheckEntry[],
): ReceiptFix[] {
  const fixes: ReceiptFix[] = [];
  for (const issue of issues) {
    const entry = entries[issue.receipt];
    const item = entry?.items[issue.item];
    if (!entry || !item) continue;
    let name: string | null = null;
    let amountYen: number | null = null;
    if (issue.kind === 'rename') {
      name = issue.name?.trim() ?? '';
      if (
        name === '' ||
        name.length > MAX_NAME_LENGTH ||
        /[\p{Cc}\p{Cf}]/u.test(name) ||
        name === item.name.trim()
      )
        continue;
    } else if (issue.kind === 'amount') {
      amountYen = issue.amountYen;
      if (
        amountYen === null ||
        !Number.isInteger(amountYen) ||
        amountYen <= 0 ||
        amountYen > MAX_AMOUNT_YEN ||
        amountYen === Math.abs(item.amountYen)
      )
        continue;
    }
    const reason = issue.reason.trim().slice(0, 80) || DEFAULT_REASON[issue.kind];
    fixes.push({
      key: `ai:${entry.transactionId}:${item.id}:${issue.kind}`,
      transactionId: entry.transactionId,
      itemId: item.id,
      kind: issue.kind,
      name,
      amountYen,
      reason,
      source: 'ai',
    });
  }
  return fixes;
}

/** AI で読み取りミスを探す。失敗したら候補は空で、理由を warning に入れる(画面は止めない)。 */
export async function findReceiptMistakesWithAi(
  entries: readonly ReceiptCheckEntry[],
  apiKey: string,
  client?: Anthropic,
): Promise<{ fixes: ReceiptFix[]; warning: string | null }> {
  const shown = entries.slice(0, MAX_AI_RECEIPTS);
  if (shown.length === 0) return { fixes: [], warning: null };
  const result = await parseStructuredGated({
    client: client ?? new Anthropic({ apiKey }),
    model: RECEIPT_CHECK_MODEL,
    maxTokens: 16_000,
    system: RECEIPT_CHECK_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserContent(shown) }],
    schema,
    effort: 'low',
    fallbacks: 'default',
    timeoutMs: AI_TIMEOUT_MS,
    hints: {
      truncated: 'レシートが多すぎました。',
      rateLimit: 'しばらくしてからもう一度お試しください。',
    },
  });
  if (!result.ok) return { fixes: [], warning: result.message };
  return { fixes: aiIssuesToFixes(result.value.issues, shown), warning: null };
}
