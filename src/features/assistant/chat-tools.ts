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
import { formatStoreLines, STORES_IN_PROMPT, type StoreSummary } from './store-candidates';

/** 会話に添える直近の明細の件数。多すぎるとコストが跳ねるため絞る。 */
export const RECENT_TRANSACTIONS_LIMIT = 40;
/** そのうち、これからの予定(今日より先)に使う件数の上限と、見る先の日数。 */
const UPCOMING_LIMIT = 10;
const UPCOMING_DAYS = 31;

/**
 * 会話に添える明細を選ぶ(ADR-106)。日付の新しい順に並んだ明細から、今日と今日までの記録を優先し、
 * これからの予定は31日先までを10件まで入れる。先の予定が多くても、今日の記録が押し出されないように。
 * 並びは日付の新しい順のまま。
 */
export function pickRecentTransactions(
  transactions: readonly StoredTransaction[],
  today: string,
): StoredTransaction[] {
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + UPCOMING_DAYS);
  const horizon = until.toISOString().slice(0, 10);
  const upcoming = transactions
    .filter((t) => t.occurredOn > today && t.occurredOn <= horizon)
    .slice(-UPCOMING_LIMIT);
  const past = transactions
    .filter((t) => t.occurredOn <= today)
    .slice(0, RECENT_TRANSACTIONS_LIMIT - upcoming.length);
  return [...upcoming, ...past];
}

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
  /** よく使うお店(過去1年の記録から、ADR-107)。 */
  stores?: readonly StoreSummary[];
  /** features/advisor/context.ts の「今の状況」。取得に失敗したときは空文字。 */
  situationText: string;
  /** 今日の日付(YYYY-MM-DD)。「昨日」「先週の金曜」を日付に直すため。 */
  today?: string;
};

function formatGenreLines(genres: readonly Genre[]): string {
  if (genres.length === 0) return formatGenreContextLines([]);
  return genres
    .map((g) => {
      const budget = g.budgetYen === null ? '無制限' : `${g.budgetYen}円`;
      return `- ${g.name}(月次予算=${budget})`;
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
    'あなたは家計簿アプリ「資産形成」の、唯一のAIの窓口です(画面の下のAIボタンから、どの画面でも開ける)。',
    '記録・質問への答え・設定の変更・画面の案内まで、本人の頼みをこの会話で引き受けます。',
    '本人の意見・希望・悩み(「食費を抑えたい」「旅行のために貯金したい」「これを買おうか迷っている」など)を聞き、',
    '必要なら複数の設定を組み合わせた変更案を作ります。本人は声で話しかけることもある(言い間違い・',
    '聞き間違いがありうるので、金額・日付は確認カードで見せる)。',
    ...(context.today ? [`今日は ${context.today} です。`] : []),
    '',
    '### 記録・答え・画面の案内',
    '- 記録したい(「コンビニで500円」「昨日ランチ1200円」「給料25万入った」)と言われたら、add_transaction で',
    '  記録の案を作る。登録は必ず確認カードで本人が承認してから(ツールを呼んだ時点では記録されていない)。',
    '  何件かまとめて言われたら、1件ずつ add_transaction を呼ぶ。',
    '  「コンビニで500円」「セブンで300円」のようにお店がおおまかなら、下の「よく使うお店」から一番ありそうな',
    '  お店を store_name に、ほかに当てはまりそうなお店を store_candidates に入れる(本人が確認カードのボタンで',
    '  選び直せる)。カテゴリは、そのお店でいつも使うものにする。一覧に無いお店の名前は作らない。',
    '- 数字や記録のことを聞かれたら、下の「今の状況」「直近の明細一覧」で答えられるなら、その数字で答える。',
    '  これらは本人が発言するたびにアプリが明細から計算し直した最新の値。会話の前のほうに出た数字',
    '  (あなたの前の返事を含む)は古いことがあるので使わず、必ず下の値を使う。',
    '- 「使っても大丈夫？」「やばい？」には、ホームと同じ「今日使える目安」「今期の見通し」(予算・着地見込み・',
    '  予算内に収まる確率)「月末に残る見込み」を根拠にする。「今月これまで」の貯金は今日までの収入 − 支出で、',
    '  月末の見込みではないので、それだけで大丈夫とは言わない。',
    '- これから使う額の話(「あと3,000円使ったら？」「飲み会で5,000円、やばい？」)は、simulate_spend で',
    '  アプリの予測を計算し、その前→後の数字で答える(自分で足し算しない)。すでに記録してある支出は足さない',
    '  (「同窓会の5,000円はもう記録されているので、二重に入れなくて大丈夫です」のように伝える)。',
    '  本人の画面にはカードと「予定に入れる」「金額を変えて試す」のボタンが出るので、記録するかは本人に任せる。',
    '- 本人には「予算」ではなく「目標」と言う(画面の言葉にそろえる)。',
    '- 答えられないとき・画面で見るほうが分かりやすいとき・会話ではできない操作(削除など)は、',
    '  show_screen でその画面へのボタンを出し、「ここで見られます」のように案内する。',
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
    '### できないこと(求められたら、理由を説明して断り、できる画面があれば show_screen でボタンを出す)',
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
    `### よく使うお店(過去1年の記録から、回数の多い順に最大${STORES_IN_PROMPT}件)`,
    formatStoreLines(context.stores ?? []),
    '',
    `### 直近の明細一覧(最大${RECENT_TRANSACTIONS_LIMIT}件。今日より先の日付は予定)`,
    formatTransactionContextLines(context.recentTransactions),
    '',
    '### 今の状況(この発言を受け取ったときにアプリが計算し直した数字。これ以外の金額は本人に聞かれても断定しない)',
    context.situationText === '' ? '(取得できませんでした)' : context.situationText,
  ].join('\n');
}
