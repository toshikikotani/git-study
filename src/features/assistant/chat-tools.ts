/**
 * 「AIに変更を頼む」(本人発案、ADR-054)の純粋な部分。
 *
 * 以前は分類ルールだけを扱う「ルールをAIに相談する」(ADR-024)だった。
 * 本人から「登録編集系のものは全てこの仕組みで会話から操作したい」と
 * 要望があり、分類ルール・本人設定・明細・レシート品目・生活費の小分類を
 * 1つの会話窓口へ統合した(app/api/rules/chat/route.ts・
 * app/(app)/rules/chat/page.tsx は廃止し、ここへ置き換える)。
 *
 * ここでは各ドメインの純粋な部分(features/classification・settings・
 * transactions それぞれの chat-tools.ts)を束ね、会話1回分のシステム
 * プロンプトを組み立てるだけ。DBにもネットワークにも触れない
 * (app/api/assistant/chat/route.ts が実際の読み書きを担う薄い層になる)。
 *
 * ── スコープについて ─────────────────────────────────────────
 * 「登録編集系を全て」は文字どおりには、口座・負債・投資・副業・転職準備の
 * 編集も含みうる。ただしそれらは既に専用の画面(それぞれのフォーム)で
 * 完結しており、本人が例に挙げたのは給料日(設定)とレシートの内容
 * (明細・品目)だった。まずはこの一群(分類ルール・設定・明細・レシート)を
 * 会話から扱えるようにし、他のドメインは同じ仕組み(1つのツール定義を
 * TOOLS 配列へ足すだけ)で後から広げられる形にしてある——最初から全domain
 * を一度に対応するより、実際に使われる範囲を早く届ける方針(本セッションの
 * 他機能と同じ反復開発の考え方)。
 */

import {
  formatCategoryContextLines,
  formatRuleContextLines,
  type NamedCategory,
  type RuleContext,
} from '@/features/classification/chat-tools';
import { buildSettingsContextLine } from '@/features/settings/chat-tools';
import type { AppSettings } from '@/features/settings/store';
import { formatTransactionContextLines } from '@/features/transactions/chat-tools';
import type { StoredTransaction } from '@/features/transactions/types';

/** 会話に添える直近の明細の件数。多すぎるとコストが跳ねるため絞る。 */
export const RECENT_TRANSACTIONS_LIMIT = 40;

export type AssistantChange = {
  kind: 'created' | 'updated' | 'deleted';
  /** 変更対象の名前(ルール名、明細の摘要、「設定」など)。 */
  target: string;
  detail: string;
};

export type AssistantChatContext = {
  categories: readonly NamedCategory[];
  rules: readonly RuleContext[];
  settings: AppSettings;
  /** 呼び出し側で直近 RECENT_TRANSACTIONS_LIMIT 件に絞って渡す。 */
  recentTransactions: readonly StoredTransaction[];
};

export function buildAssistantSystemPrompt(context: AssistantChatContext): string {
  return [
    'あなたは家計簿アプリ「資産形成」の中身を、会話を通じて操作するアシスタントです。',
    '本人の自然な言葉から、対応するツールを呼んで実際にデータベースの値を変更します。',
    '',
    '### できること',
    '- 分類ルールの作成・変更・削除(create_rule / update_rule / delete_rule)。',
    '- 本人設定の変更。例:給料日・返済目標額・返済戦略・投資比率(update_settings)。',
    '- 既存の明細のカテゴリ・金額・日付・メモの変更(update_transaction)。',
    '- レシートの品目一覧の登録・置き換え(update_receipt_items)。',
    '- 生活費明細の小分類の設定。例:食費・日用品など自由記述(set_expense_subtype)。',
    '- 実行前にいちいち確認を取る必要はない。指示が具体的なら、そのまま実行してよい。',
    '- 対象が曖昧なとき(同名のカテゴリが無い、どのルール・どの明細を指すか',
    '  特定できない等)は、ツールを呼ばずに質問して確認する。',
    '- 実行後は、日本語で短く何をしたかを報告する。',
    '',
    '### してはいけないこと',
    '- 「変更不可」と書かれたルールを update_rule や delete_rule で操作しようとしない',
    '  (リボ払い・キャッシング・分割払いの検知に使われており、見逃すと本人に実害がある)。',
    '  求められても、理由を説明して断る(create_rule で新しいルールを作ることはできる)。',
    '- 下のカテゴリ一覧に無い名前を作り出さない。近い名前があれば提案し、無ければ確認する。',
    '- 下の明細一覧に無いidを作り出さない。該当する明細が見当たらなければ、その旨を伝える。',
    '- 金額は必ず整数円で扱う(支出は負、収入は正)。',
    '- 不確かなことを断定しない。',
    '',
    '### 現在のカテゴリ一覧',
    formatCategoryContextLines(context.categories),
    '',
    '### 現在の分類ルール一覧',
    formatRuleContextLines(context.rules),
    '',
    '### 現在の本人設定',
    buildSettingsContextLine(context.settings),
    '',
    `### 直近の明細一覧(最大${RECENT_TRANSACTIONS_LIMIT}件)`,
    formatTransactionContextLines(context.recentTransactions),
  ].join('\n');
}
