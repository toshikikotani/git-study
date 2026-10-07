/**
 * 「AIの窓口を1つにして、意見に応じて複数の設定をまとめて変える」(本人発案、
 * ADR-059)の純粋な部分。DBにもネットワークにも触れない。
 *
 * ── なぜ「実行」ではなく「計画」にしたか ──────────────────────
 * 以前(ADR-054)はモデルがツールを呼んだ瞬間に書き込んでいた。複数の設定を
 * まとめて変える窓口では、1つの誤解が複数の設定へ同時に波及する。そこで
 * モデルのツール呼び出しは「変更案(ProposedChange)」に変換するだけにし、
 * 本人がチャット内の確認カードで承認したものだけを別のリクエスト
 * (app/api/assistant/apply/route.ts)が実行する。変更案は承認時にもう一度
 * この planToolCall() を通す(クライアントから戻ってきた値を信用しない)。
 *
 * ── 致命的な変更をさせない(本人の条件) ──────────────────────
 * ①削除系のツールは1つも用意しない(明細・口座・ジャンル・目標の削除、
 *   目標の断念、ジャンルの統合はすべて対象外)。
 * ②秘匿情報(環境変数名の参照値、Gmail設定、認証)・口座残高・
 *   FR-21の検知ルールには触れるツールが無い(ADR-010/014)。
 * ③高リスク投資枠を使うか(is_high_risk_unlocked)は本人が投資画面で決める
 *   (FR-52、ADR-081)ので会話からは変えられない。
 * 貯金目標の貯まった額は収入 − 支出から自動で数える(ADR-081)ので、進捗を変える
 * ツールは無い。
 * ④金額・比率には上限を置く(桁の読み違いを承認カードに出す前に止める)。
 * ⑤1回の変更案は MAX_CHANGES_PER_PROPOSAL 件まで。
 */

import { resolveGenreByName } from '@/features/genre/chat-tools';
import type { Genre } from '@/features/genre/store';
import type { ReceiptItemInput } from '@/features/receipts/items-store';
import { parseAppSettingsPatch } from '@/features/settings/chat-tools';
import type { AppSettings, AppSettingsPatch } from '@/features/settings/store';
import { resolveTransactionById } from '@/features/transactions/chat-tools';
import type { StoredTransaction } from '@/features/transactions/types';
import { ChatToolError } from '@/lib/chat-tools';
import { assertDateOnly } from '@/lib/date';

export { ChatToolError };

/** 1回の変更案(確認カード1枚)に載せられる変更の上限。 */
export const MAX_CHANGES_PER_PROPOSAL = 10;
/** 円の金額の上限(1000万円)。桁を外した値を承認カードに出さないため。 */
export const MAX_AMOUNT_YEN = 10_000_000;
/** 目標金額の上限(1億円)。 */
export const MAX_GOAL_AMOUNT_YEN = 100_000_000;
/** 1回の品目の置き換えで受け付ける品目数の上限。 */
export const MAX_RECEIPT_ITEMS = 50;

export const WRITE_TOOL_NAMES = [
  'update_settings',
  'update_transaction',
  'update_receipt_items',
  'set_expense_subtype',
  'update_genre_budget',
  'set_genre_show_on_home',
  'create_genre',
  'create_goal',
  'update_plan_targets',
] as const;
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];

export function isWriteToolName(name: string): name is WriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

/** 本人に見せる変更案1件。承認時にそのままサーバーへ戻ってくる。 */
export type ProposedChange = {
  tool: WriteToolName;
  input: Record<string, unknown>;
  kind: 'created' | 'updated';
  /** 変更対象の名前(明細の摘要、ジャンル名、「設定」など)。 */
  target: string;
  /** 変更前→変更後が分かる短い日本語。 */
  detail: string;
};

export type GoalRef = { id: string; title: string };
export type PlanRef = {
  id: string;
  items: readonly { genreId: string; genreName: string; targetYen: number }[];
};

export type PlanContext = {
  genres: readonly Genre[];
  settings: AppSettings;
  transactions: readonly StoredTransaction[];
  goals: readonly GoalRef[];
  /** 直近に立てた支出目標。無ければ null。 */
  latestPlan: PlanRef | null;
};

/** planToolCall() が返す、実行に必要な情報だけを持つデータ(副作用を持たない)。 */
export type Operation =
  | { op: 'update_settings'; patch: AppSettingsPatch }
  | {
      op: 'update_transaction';
      transactionId: string;
      /** ジャンル・金額・日付のいずれかを変えるときだけ持つ(メモだけなら null)。 */
      core: {
        genreId: string;
        amountAndDate: { amountYen: number; occurredOn: string } | null;
      } | null;
      memo: string | null;
    }
  | { op: 'replace_receipt_items'; transactionId: string; items: ReceiptItemInput[] }
  | { op: 'set_expense_subtype'; transactionId: string; subtype: string }
  | { op: 'update_genre_budget'; genreId: string; budgetYen: number | null }
  | { op: 'set_genre_show_on_home'; genreId: string; showOnHome: boolean }
  | { op: 'create_genre'; name: string }
  | {
      op: 'create_goal';
      title: string;
      targetAmountYen: number | null;
      targetDate: string | null;
    }
  | {
      op: 'update_plan_targets';
      planId: string;
      items: { genreId: string; targetYen: number }[];
    };

export type PlannedChange = { change: ProposedChange; operation: Operation };

export type AskUserQuestion = {
  question: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
};

function asRecord(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function yen(value: number): string {
  return `${value.toLocaleString('ja-JP')}円`;
}

function requireAmount(value: unknown, label: string, max: number): number {
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new ChatToolError(`${label}は0以上${yen(max)}以下の整数円で指定してください。`);
  }
  return n;
}

function describeSettingsChange(patch: AppSettingsPatch, current: AppSettings): string {
  const parts: string[] = [];
  if (patch.payday !== undefined) parts.push(`給料日: ${current.payday}日→${patch.payday}日`);
  if (patch.monthlySavingsTargetYen !== undefined) {
    parts.push(
      `毎月の貯金目標: ${yen(current.monthlySavingsTargetYen)}→${yen(patch.monthlySavingsTargetYen)}`,
    );
  }
  if (patch.investmentRatioOfSavings !== undefined) {
    parts.push(`投資比率: ${current.investmentRatioOfSavings}→${patch.investmentRatioOfSavings}`);
  }
  if (patch.highRiskAllocationRatio !== undefined) {
    parts.push(
      `高リスク投資枠の比率: ${current.highRiskAllocationRatio}→${patch.highRiskAllocationRatio}`,
    );
  }
  if (patch.sideIncomeSavingsRatio !== undefined) {
    parts.push(
      `副業収入の貯金比率: ${current.sideIncomeSavingsRatio}→${patch.sideIncomeSavingsRatio}`,
    );
  }
  return parts.join(' / ');
}

function planUpdateSettings(input: unknown, ctx: PlanContext): PlannedChange {
  const args = asRecord(input);
  if (args.is_high_risk_unlocked !== undefined) {
    throw new ChatToolError(
      '高リスク投資枠を使うかは、本人が投資画面で決める設定(FR-52)のため会話からは変更できません。',
    );
  }
  const { patch } = parseAppSettingsPatch(input);
  if (
    patch.monthlySavingsTargetYen !== undefined &&
    patch.monthlySavingsTargetYen > MAX_AMOUNT_YEN
  ) {
    throw new ChatToolError(`毎月の貯金目標は${yen(MAX_AMOUNT_YEN)}以下で指定してください。`);
  }
  return {
    change: {
      tool: 'update_settings',
      input: args,
      kind: 'updated',
      target: '設定',
      detail: describeSettingsChange(patch, ctx.settings),
    },
    operation: { op: 'update_settings', patch },
  };
}

function planUpdateTransaction(input: unknown, ctx: PlanContext): PlannedChange {
  const args = asRecord(input);
  const current = resolveTransactionById(args.transaction_id, ctx.transactions);

  let genreId = current.genreId;
  let genreName = current.genreName;
  if (args.genre_name !== undefined) {
    const genre = resolveGenreByName(args.genre_name, ctx.genres);
    genreId = genre.id;
    genreName = genre.name;
  }

  const hasGenre = args.genre_name !== undefined;
  const hasAmount = args.amount_yen !== undefined;
  const hasDate = args.occurred_on !== undefined;
  const hasMemo = typeof args.memo === 'string';
  if (!hasGenre && !hasAmount && !hasDate && !hasMemo) {
    throw new ChatToolError('変更する項目がありません。');
  }

  let amountYen = current.amountYen;
  if (hasAmount) {
    const n = typeof args.amount_yen === 'number' ? Math.trunc(args.amount_yen) : NaN;
    if (!Number.isFinite(n) || n === 0 || Math.abs(n) > MAX_AMOUNT_YEN) {
      throw new ChatToolError(
        `金額は0以外で絶対値が${yen(MAX_AMOUNT_YEN)}以下の整数円で指定してください。`,
      );
    }
    amountYen = n;
  }
  let occurredOn: string = current.occurredOn;
  if (hasDate) {
    if (typeof args.occurred_on !== 'string') {
      throw new ChatToolError('日付はYYYY-MM-DD形式で指定してください。');
    }
    try {
      occurredOn = assertDateOnly(args.occurred_on);
    } catch {
      throw new ChatToolError('日付はYYYY-MM-DD形式で指定してください。');
    }
  }
  if ((hasGenre || hasAmount || hasDate) && genreId === null) {
    throw new ChatToolError(
      'この明細にはまだジャンルが無いため、genre_name も併せて指定してください。',
    );
  }

  const parts: string[] = [];
  if (hasGenre) parts.push(`ジャンル: ${current.genreName ?? '未分類'}→${genreName}`);
  if (hasAmount) parts.push(`金額: ${yen(current.amountYen)}→${yen(amountYen)}`);
  if (hasDate) parts.push(`日付: ${current.occurredOn}→${occurredOn}`);
  if (hasMemo) parts.push(`メモ: ${JSON.stringify(args.memo)}`);

  return {
    change: {
      tool: 'update_transaction',
      input: args,
      kind: 'updated',
      target: current.description,
      detail: parts.join(' / '),
    },
    operation: {
      op: 'update_transaction',
      transactionId: current.id,
      core:
        (hasGenre || hasAmount || hasDate) && genreId !== null
          ? { genreId, amountAndDate: hasAmount || hasDate ? { amountYen, occurredOn } : null }
          : null,
      memo: hasMemo ? (args.memo as string) : null,
    },
  };
}

function planReceiptItems(input: unknown, ctx: PlanContext): PlannedChange {
  const args = asRecord(input);
  const current = resolveTransactionById(args.transaction_id, ctx.transactions);
  const rawItems = Array.isArray(args.items) ? args.items : null;
  if (rawItems === null) throw new ChatToolError('items は配列で指定してください。');
  if (rawItems.length > MAX_RECEIPT_ITEMS) {
    throw new ChatToolError(`品目は${MAX_RECEIPT_ITEMS}件以下で指定してください。`);
  }

  const items: ReceiptItemInput[] = rawItems.map((raw) => {
    const item = asRecord(raw);
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const amountYen = typeof item.amount_yen === 'number' ? Math.trunc(item.amount_yen) : NaN;
    if (name === '' || !Number.isFinite(amountYen) || amountYen === 0) {
      throw new ChatToolError('品目には name と 0 以外の amount_yen が必要です。');
    }
    if (Math.abs(amountYen) > MAX_AMOUNT_YEN) {
      throw new ChatToolError(`品目の金額は絶対値が${yen(MAX_AMOUNT_YEN)}以下にしてください。`);
    }
    const genreId =
      item.genre_name !== undefined ? resolveGenreByName(item.genre_name, ctx.genres).id : null;
    return { name, amountYen, genreId };
  });

  return {
    change: {
      tool: 'update_receipt_items',
      input: args,
      kind: 'updated',
      target: current.description,
      detail: items.length > 0 ? `品目${items.length}件に置き換え` : '品目を空にする',
    },
    operation: { op: 'replace_receipt_items', transactionId: current.id, items },
  };
}

function planExpenseSubtype(input: unknown, ctx: PlanContext): PlannedChange {
  const args = asRecord(input);
  const current = resolveTransactionById(args.transaction_id, ctx.transactions);
  const subtype = typeof args.subtype === 'string' ? args.subtype.trim() : '';
  if (subtype === '') throw new ChatToolError('subtype が空です。');
  return {
    change: {
      tool: 'set_expense_subtype',
      input: args,
      kind: 'updated',
      target: current.description,
      detail: `生活費の小分類: ${subtype}`,
    },
    operation: { op: 'set_expense_subtype', transactionId: current.id, subtype },
  };
}

function planGenreBudget(input: unknown, ctx: PlanContext): PlannedChange {
  const args = asRecord(input);
  const genre = resolveGenreByName(args.genre_name, ctx.genres);
  const budgetYen =
    args.budget_yen === null ? null : requireAmount(args.budget_yen, '予算', MAX_AMOUNT_YEN);
  const before = genre.budgetYen === null ? '無制限' : yen(genre.budgetYen);
  const after = budgetYen === null ? '無制限' : yen(budgetYen);
  return {
    change: {
      tool: 'update_genre_budget',
      input: args,
      kind: 'updated',
      target: genre.name,
      detail: `月次予算: ${before}→${after}`,
    },
    operation: { op: 'update_genre_budget', genreId: genre.id, budgetYen },
  };
}

function planGenreShowOnHome(input: unknown, ctx: PlanContext): PlannedChange {
  const args = asRecord(input);
  const genre = resolveGenreByName(args.genre_name, ctx.genres);
  if (typeof args.show_on_home !== 'boolean') {
    throw new ChatToolError('show_on_home は true/false で指定してください。');
  }
  return {
    change: {
      tool: 'set_genre_show_on_home',
      input: args,
      kind: 'updated',
      target: genre.name,
      detail: `ホームに残額を出す: ${genre.showOnHome ? '出す' : '出さない'}→${args.show_on_home ? '出す' : '出さない'}`,
    },
    operation: { op: 'set_genre_show_on_home', genreId: genre.id, showOnHome: args.show_on_home },
  };
}

function planCreateGenre(input: unknown, ctx: PlanContext): PlannedChange {
  const args = asRecord(input);
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (name === '' || name.length > 30) {
    throw new ChatToolError('ジャンル名は1〜30文字で指定してください。');
  }
  if (ctx.genres.some((g) => g.name.trim() === name)) {
    throw new ChatToolError(`「${name}」というジャンルは既にあります。`);
  }
  return {
    change: {
      tool: 'create_genre',
      input: args,
      kind: 'created',
      target: name,
      detail: 'ジャンルを追加',
    },
    operation: { op: 'create_genre', name },
  };
}

function planCreateGoal(input: unknown): PlannedChange {
  const args = asRecord(input);
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (title === '' || title.length > 60) {
    throw new ChatToolError('目標のタイトルは1〜60文字で指定してください。');
  }
  let targetAmountYen: number | null = null;
  if (args.target_amount_yen !== undefined && args.target_amount_yen !== null) {
    const n = typeof args.target_amount_yen === 'number' ? args.target_amount_yen : NaN;
    if (!Number.isInteger(n) || n <= 0 || n > MAX_GOAL_AMOUNT_YEN) {
      throw new ChatToolError(
        `目標金額は1以上${yen(MAX_GOAL_AMOUNT_YEN)}以下の整数円で指定してください。`,
      );
    }
    targetAmountYen = n;
  }
  let targetDate: string | null = null;
  if (args.target_date !== undefined && args.target_date !== null) {
    try {
      targetDate = assertDateOnly(String(args.target_date));
    } catch {
      throw new ChatToolError('期限はYYYY-MM-DD形式で指定してください。');
    }
  }
  const parts = [
    targetAmountYen !== null ? `目標金額 ${yen(targetAmountYen)}` : null,
    targetDate !== null ? `期限 ${targetDate}` : null,
  ].filter((p): p is string => p !== null);
  return {
    change: {
      tool: 'create_goal',
      input: args,
      kind: 'created',
      target: title,
      detail: parts.length > 0 ? parts.join(' / ') : '目標を追加',
    },
    operation: { op: 'create_goal', title, targetAmountYen, targetDate },
  };
}

function planPlanTargets(input: unknown, ctx: PlanContext): PlannedChange {
  const args = asRecord(input);
  if (ctx.latestPlan === null) {
    throw new ChatToolError('支出目標がまだ立てられていません(「目標」タブで先に立ててください)。');
  }
  const rawItems = Array.isArray(args.items) ? args.items : null;
  if (rawItems === null || rawItems.length === 0) {
    throw new ChatToolError('items は1件以上の配列で指定してください。');
  }
  const items: { genreId: string; targetYen: number }[] = [];
  const parts: string[] = [];
  for (const raw of rawItems) {
    const item = asRecord(raw);
    const wanted = typeof item.genre_name === 'string' ? item.genre_name.trim() : '';
    const planItem = ctx.latestPlan.items.find((i) => i.genreName.trim() === wanted);
    if (!planItem) {
      const available = ctx.latestPlan.items.map((i) => i.genreName).join('、');
      throw new ChatToolError(
        `「${wanted}」は直近の目標に含まれていません。含まれるジャンル: ${available}`,
      );
    }
    const targetYen = requireAmount(item.target_yen, '目標額', MAX_AMOUNT_YEN);
    items.push({ genreId: planItem.genreId, targetYen });
    parts.push(`${planItem.genreName}: ${yen(planItem.targetYen)}→${yen(targetYen)}`);
  }
  const changed = new Map(items.map((i) => [i.genreId, i.targetYen]));
  const totalBefore = ctx.latestPlan.items.reduce((sum, i) => sum + i.targetYen, 0);
  const totalAfter = ctx.latestPlan.items.reduce(
    (sum, i) => sum + (changed.get(i.genreId) ?? i.targetYen),
    0,
  );
  parts.push(`合計: ${yen(totalBefore)}→${yen(totalAfter)}`);
  return {
    change: {
      tool: 'update_plan_targets',
      input: args,
      kind: 'updated',
      target: '支出目標',
      detail: parts.join(' / '),
    },
    operation: { op: 'update_plan_targets', planId: ctx.latestPlan.id, items },
  };
}

/**
 * モデルのツール呼び出し(または承認時にクライアントから戻ってきた変更案)を
 * 検証し、実行に必要なデータへ変換する。不正なら ChatToolError。
 * 未知のツール名(=削除系を含む用意していない操作)は必ず拒む。
 */
export function planToolCall(name: string, input: unknown, ctx: PlanContext): PlannedChange {
  switch (name) {
    case 'update_settings':
      return planUpdateSettings(input, ctx);
    case 'update_transaction':
      return planUpdateTransaction(input, ctx);
    case 'update_receipt_items':
      return planReceiptItems(input, ctx);
    case 'set_expense_subtype':
      return planExpenseSubtype(input, ctx);
    case 'update_genre_budget':
      return planGenreBudget(input, ctx);
    case 'set_genre_show_on_home':
      return planGenreShowOnHome(input, ctx);
    case 'create_genre':
      return planCreateGenre(input, ctx);
    case 'create_goal':
      return planCreateGoal(input);
    case 'update_plan_targets':
      return planPlanTargets(input, ctx);
    default:
      throw new ChatToolError(`「${name}」は会話から実行できない操作です。`);
  }
}

/** ask_user ツールの入力を検証する(選択肢は2〜4個)。 */
export function parseAskUser(input: unknown): AskUserQuestion {
  const args = asRecord(input);
  const question = typeof args.question === 'string' ? args.question.trim() : '';
  if (question === '') throw new ChatToolError('question が空です。');
  const rawOptions = Array.isArray(args.options) ? args.options : [];
  const options = rawOptions
    .map((raw) => {
      const o = asRecord(raw);
      const label = typeof o.label === 'string' ? o.label.trim() : '';
      const description = typeof o.description === 'string' ? o.description.trim() : '';
      return { label, description };
    })
    .filter((o) => o.label !== '');
  if (options.length < 2 || options.length > 4) {
    throw new ChatToolError('options は2〜4個で指定してください。');
  }
  return { question, options, multiSelect: args.multi_select === true };
}
