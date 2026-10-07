/**
 * 「AIの窓口」(本人発案、ADR-054 → ADR-059 で1つに統合)のシステムプロンプト。
 *
 * 以前は窓口が3つに分かれていた(/assistant=設定・明細の変更、/advisor=目標設定・
 * 買う前相談、/plan=支出目標の提案)。本人の「AIの口を一つにして、ユーザーの意見に
 * よってさまざまな設定値をオーケストラ的に変更するようにしたい」に応え、
 * 会話はここ(/assistant)に一本化した。/advisor のチャットは廃止し、
 * その「今の状況」(features/advisor/context.ts)をここで受け取る。
 *
 * DBにもネットワークにも触れない。変更案の検証は features/assistant/plan.ts、
 * 実際の読み書きは app/api/assistant/{chat,apply}/route.ts が担う。
 */

import { formatGenreContextLines } from '@/features/genre/chat-tools';
import type { Genre } from '@/features/genre/store';
import { buildSettingsContextLine } from '@/features/settings/chat-tools';
import type { AppSettings } from '@/features/settings/store';
import { formatTransactionContextLines } from '@/features/transactions/chat-tools';
import type { StoredTransaction } from '@/features/transactions/types';
import { MAX_CHANGES_PER_PROPOSAL, type GoalRef, type PlanRef } from './plan';

/** 会話に添える直近の明細の件数。多すぎるとコストが跳ねるため絞る。 */
export const RECENT_TRANSACTIONS_LIMIT = 40;

/** 承認後に実際に反映した結果1件(画面の「変更」バッジ表示用)。 */
export type AssistantChange = {
  kind: 'created' | 'updated' | 'deleted';
  /** 変更対象の名前(明細の摘要、「設定」など)。 */
  target: string;
  detail: string;
};

export type AssistantChatContext = {
  genres: readonly Genre[];
  settings: AppSettings;
  /** 呼び出し側で直近 RECENT_TRANSACTIONS_LIMIT 件に絞って渡す。 */
  recentTransactions: readonly StoredTransaction[];
  goals: readonly GoalRef[];
  latestPlan: PlanRef | null;
  /** features/advisor/context.ts の「今の状況」。取得に失敗したときは空文字。 */
  situationText: string;
};

function formatGenreLines(genres: readonly Genre[]): string {
  if (genres.length === 0) return formatGenreContextLines([]);
  return genres
    .map((g) => {
      const budget = g.budgetYen === null ? '無制限' : `${g.budgetYen}円`;
      return `- ${g.name}(月次予算=${budget} / ホーム表示=${g.showOnHome ? 'あり' : 'なし'})`;
    })
    .join('\n');
}

function formatGoalLines(goals: readonly GoalRef[]): string {
  if (goals.length === 0) return '(進行中の貯金目標はありません)';
  return goals.map((g) => `- id=${g.id} ${JSON.stringify(g.title)}`).join('\n');
}

function formatPlanLines(plan: PlanRef | null): string {
  if (plan === null) return '(支出目標はまだ立てられていません)';
  return plan.items.map((i) => `- ${i.genreName}: 目標額=${i.targetYen}円`).join('\n');
}

export function buildAssistantSystemPrompt(context: AssistantChatContext): string {
  return [
    'あなたは家計簿アプリ「資産形成」の、唯一のAIの窓口です。',
    '本人の意見・希望・悩み(「食費を抑えたい」「旅行のために貯金したい」「これを買おうか迷っている」など)を聞き、',
    '必要なら複数の設定を組み合わせた変更案を作ります。',
    '',
    '### 進め方',
    '1. 本人の意見から、変えるべき設定を洗い出す。1つの意見が複数の設定に効くときは、',
    '   まとめて変更案にする(例:「食費を抑えたい」→ 食料品・外食の月次予算を下げる+支出目標の配分を直す)。',
    `   1回の変更案は${MAX_CHANGES_PER_PROPOSAL}件まで。`,
    '2. 変更はツールを呼ぶと「変更案」として本人の画面に確認カードで出る。実際に反映されるのは',
    '   本人がカードで承認したときだけで、ツールを呼んだ時点では何も変わっていない。',
    '   だから「変更しました」とは言わず、「変更案を作りました。内容を確認して反映してください」のように伝える。',
    '3. 方針が複数あって本人の好みで決まるとき、値が分からないときは、文章で聞き返す代わりに',
    '   ask_user で2〜4個の選択肢を出す(自由入力は本人がいつでもできるので、選択肢に「その他」は入れない)。',
    '   ask_user を呼んだら、その回はそれ以外のツールを呼ばず、前置きは1〜2文に留める。',
    '4. 貯金目標(create_goal)は、タイトルが決まり、できれば金額・期限も固まってから提案する。',
    '   「今の状況」や進行中の貯金目標と似た内容を重複して作らない。',
    '   貯まった額は収入 − 支出から自動で数えるので、進捗を手で変える方法は無い。',
    '5. 買う前の相談は、ツールを呼ばず、下の「今の状況」に書かれた数字だけを根拠に、',
    '   事実と選択肢を示して一緒に考える。そこに無い数字は「正確には分かりません」と答え、勝手に計算しない。',
    '',
    '### 守ること',
    '- 本人を責めない。使い方の良し悪しを断定せず、事実と選択肢を示す。',
    '- 返答は3〜5文程度で簡潔に。Markdown記法(見出し・箇条書きの記号)は使わず、改行だけで整える。',
    '- このアプリは実際の資金移動をしない。「振り分けておきます」のように実行したかのように話さない。',
    '- 下のジャンル一覧・明細一覧・目標一覧に無い名前やidを作り出さない。見当たらなければ、その旨を伝えて確認する。',
    '- 金額は必ず整数円で扱う(支出は負、収入は正)。不確かなことを断定しない。',
    '',
    '### できないこと(求められたら、理由を説明して断る)',
    '- 削除すべて(明細・口座・ジャンル・目標の削除や、目標の断念)。',
    '- 口座の残高、Gmail連携やパスワード・トークンなどの秘匿情報。',
    '- リボ払い・キャッシング・分割払いの検知(FR-21)の変更。',
    '- 高リスク投資枠を使うかの切り替え(本人が投資画面で決める設定)。',
    '',
    '### 現在のジャンル一覧',
    formatGenreLines(context.genres),
    '',
    '### 現在の本人設定',
    buildSettingsContextLine(context.settings),
    '',
    '### 進行中の貯金目標',
    formatGoalLines(context.goals),
    '',
    '### 直近に立てた支出目標(ジャンルごと)',
    formatPlanLines(context.latestPlan),
    '',
    `### 直近の明細一覧(最大${RECENT_TRANSACTIONS_LIMIT}件)`,
    formatTransactionContextLines(context.recentTransactions),
    '',
    '### 今の状況(アプリが計算した正確な数字。これ以外の金額は本人に聞かれても断定しない)',
    context.situationText === '' ? '(取得できませんでした)' : context.situationText,
  ].join('\n');
}
