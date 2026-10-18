/**
 * 店名の表記ゆれを AI で見つける(本人の要望「ai使ってスキャン」、ADR-119)。
 *
 * これまでの決まった規則(domain/merchant-name-review.ts:全角半角・会社表記・知っているチェーンの別名)
 * では、カード明細の略し方(「ｱﾏｿﾞﾝ」「AMZN Mktp」)や、同じ店の別の書き方を拾いきれなかった。
 * 本人の明細の店名を重ならないように並べて AI に見せ、同じ店を指す書き方をまとめ、そろえる店名を
 * 提案させる。AI は提案するだけで、保存は今までどおり本人が確かめて押したものだけ(ADR-116)。
 *
 * 金額・日付・メモは送らない(店名と件数だけ)。店名なし・住所のような店名は送らない
 * (住所から店を推測しない、ADR-116)。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import {
  merchantLabelKind,
  merchantLabelOf,
  type MerchantNameReviewEntry,
  type MerchantNameReviewGroup,
} from '@/domain/merchant-name-review';
import { maskPii } from '@/lib/ai-gateway/privacy';
import { parseStructuredGated } from '@/lib/ai-gateway/gated';

/** 店名の見比べに使うモデル。日付サフィックスは付けない。 */
export const MERCHANT_NAME_MODEL = 'claude-opus-5-5';
/** AI に見せる店名の数(件数の多い順)。 */
export const MAX_AI_LABELS = 500;
/** 本人が押して待つ処理なので、10秒の既定より長く待つ。 */
const AI_TIMEOUT_MS = 90_000;

/** AI に見せる店名(同じ店名・支店は1つにまとめる)。 */
export type MerchantLabel = {
  index: number;
  name: string;
  branch: string | null;
  count: number;
};

const keyOf = (name: string, branch: string | null) => JSON.stringify([name, branch]);

/** 明細から、AI に見せる店名を重ならないように並べる(件数の多い順、店名なし・住所は除く)。 */
export function distinctMerchantLabels(
  entries: readonly MerchantNameReviewEntry[],
  limit = MAX_AI_LABELS,
): MerchantLabel[] {
  const counts = new Map<string, { name: string; branch: string | null; count: number }>();
  for (const entry of entries) {
    const name = merchantLabelOf(entry);
    if (merchantLabelKind(name) !== 'name') continue;
    const key = keyOf(name, entry.branchName);
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { name, branch: entry.branchName, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'))
    .slice(0, limit)
    .map((label, index) => ({ index, ...label }));
}

const schema = z.object({
  groups: z
    .array(
      z.object({
        labels: z
          .array(z.number().int())
          .describe('同じ店を指す店名の番号(#の後ろの数字)。番号は入力にあるものだけ'),
        name: z.string().describe('そろえる店名(いちばん自然で一般的な表記。支店名は入れない)'),
        branch: z
          .string()
          .nullable()
          .describe('支店名(「豊津店」など)。全部の番号が同じ支店のときだけ。違えば null'),
      }),
    )
    .describe('直すべきものだけ。直すものが無ければ空の配列'),
});

export type MerchantNameAiGroup = z.infer<typeof schema>['groups'][number];

export const MERCHANT_NAME_SYSTEM_PROMPT = [
  'あなたは家計簿アプリで、明細の店名の表記ゆれをそろえる担当です。',
  '本人の明細に出てくる店名の一覧(番号・店名・支店・件数)を見て、同じ店を指しているのに書き方が',
  '違うものをまとめ、そろえる店名を1つ決めてください。',
  '',
  '表記ゆれの例:',
  '- 全角と半角、カタカナとローマ字、大文字と小文字(「ｾﾌﾞﾝｲﾚﾌﾞﾝ」「SEVEN-ELEVEN」「セブンイレブン」)',
  '- カード明細の略し方や決済の前置き(「AMZN Mktp JP」「ｱﾏｿﾞﾝ」→「Amazon」)',
  '- 会社の形(株式会社・(株))や、店名の後ろの記号・番号',
  '- 店名に支店名がくっついているもの(「スギ薬局豊津店」→ 店名「スギ薬局」、支店「豊津店」)',
  '',
  '守ること:',
  '- 本当に同じ店・同じチェーンだと言えるものだけをまとめる。迷うものはまとめない',
  '- 別の店をまとめない(「セブン-イレブン」と「セブン銀行」は別)',
  '- そろえる店名は、ふだん目にする正式な表記にする。支店名は name に入れず branch に分ける',
  '- 書き方がすでにそろっていて直す必要がないものは出さない',
  '- 1つしかない店名でも、カード明細の略し方などで直したほうがよいものは、1つで出してよい',
  '- 番号は入力にあるものだけを使う。存在しない番号を作らない',
].join('\n');

function buildUserContent(labels: readonly MerchantLabel[]): string {
  const lines = labels.map(
    (l) =>
      `#${l.index} 店名=${maskPii(l.name)}${l.branch ? ` 支店=${maskPii(l.branch)}` : ''} 件数=${l.count}`,
  );
  return ['店名の一覧です。表記ゆれをまとめてください。', ...lines].join('\n');
}

/**
 * AI のまとめを、確認画面のグループにする(AI の返事を信用しきらない:無い番号・空の店名は捨てる。
 * 1つの店名が2つのまとめに入っていたら、先のほうだけを使う)。すでに提案どおりの明細は外す。
 */
export function aiGroupsToReview(
  aiGroups: readonly MerchantNameAiGroup[],
  labels: readonly MerchantLabel[],
  entries: readonly MerchantNameReviewEntry[],
): MerchantNameReviewGroup[] {
  const byIndex = new Map(labels.map((l) => [l.index, l]));
  const entriesByKey = new Map<string, MerchantNameReviewEntry[]>();
  for (const entry of entries) {
    const key = keyOf(merchantLabelOf(entry), entry.branchName);
    const list = entriesByKey.get(key);
    if (list) list.push(entry);
    else entriesByKey.set(key, [entry]);
  }
  const used = new Set<number>();
  const groups: MerchantNameReviewGroup[] = [];
  aiGroups.forEach((group, i) => {
    const name = group.name.trim();
    const branch = group.branch?.trim() || null;
    if (name === '') return;
    const members = [...new Set(group.labels)]
      .filter((index) => byIndex.has(index) && !used.has(index))
      .map((index) => byIndex.get(index)!);
    if (members.length === 0) return;
    for (const m of members) used.add(m.index);
    const targets = members
      .flatMap((m) => entriesByKey.get(keyOf(m.name, m.branch)) ?? [])
      .filter((e) => !(e.merchantName?.trim() === name && (e.branchName ?? null) === branch));
    if (targets.length === 0) return;
    const shown = [...new Set(members.map((m) => m.name))];
    groups.push({
      key: `ai:${i}`,
      label: shown.length > 3 ? `${shown.slice(0, 3).join(' / ')} ほか` : shown.join(' / '),
      branchName: null,
      reasons: ['ai'],
      suggestedName: name,
      suggestedBranch: branch,
      entries: targets,
    });
  });
  return groups;
}

/** AI で表記ゆれを探す。失敗したら groups は空で、理由を warning に入れる(画面は止めない)。 */
export async function findMerchantNameVariantsWithAi(
  entries: readonly MerchantNameReviewEntry[],
  apiKey: string,
  client?: Anthropic,
): Promise<{ groups: MerchantNameReviewGroup[]; warning: string | null }> {
  const labels = distinctMerchantLabels(entries);
  if (labels.length === 0) return { groups: [], warning: null };
  const result = await parseStructuredGated({
    client: client ?? new Anthropic({ apiKey }),
    model: MERCHANT_NAME_MODEL,
    maxTokens: 16_000,
    system: MERCHANT_NAME_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserContent(labels) }],
    schema,
    effort: 'low',
    fallbacks: 'default',
    timeoutMs: AI_TIMEOUT_MS,
    hints: {
      truncated: '店名が多すぎました。',
      rateLimit: 'しばらくしてからもう一度お試しください。',
    },
  });
  if (!result.ok) return { groups: [], warning: result.message };
  return { groups: aiGroupsToReview(result.value.groups, labels, entries), warning: null };
}
