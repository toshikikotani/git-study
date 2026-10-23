/**
 * 保存前のレシートを確かめる画面(v5 変更3・変更5、ADR-133)の中身。画面から切り離した純粋関数。
 *
 *   - 最初の値:読み取った値と予測をそのまま入れる。カテゴリは「自信なし」のものだけ何も当てない
 *     (必ず選ぶ)。支払い(口座)は当てた口座か、いつもの口座。
 *   - 問い:項目ごとの自信と確かめる細かさから、聞くものと順番を決める(domain/receipt-questions.ts)。
 *     答えた(または自分で直した)項目は問いから外す。同じカテゴリが候補になった品目は1問にまとめる。
 *   - 保存できるか:「必ず聞く」が残っていない・カテゴリが空でない・口座と金額がある。
 *   - そろっている:問いが1つもなく、合計も合っていて、保存できる(一覧の「そろっている N件を保存」)。
 */

import {
  askFor,
  bandOf,
  orderQuestions,
  totalConfidence,
  type CheckLevel,
} from '@/domain/receipt-questions';
import {
  reconcileReceipt,
  type ReceiptDraft,
  type ReconcileResult,
} from '@/domain/receipt-reconcile';
import { addDays } from '@/lib/date';
import { withDraft, type ParsedReceiptTransaction } from './receipt-ai';
import { buildReceiptSavePlan, type ReceiptSavePlan } from './receipt-save';
import type { UnsavedReceipt } from './unsaved-receipts';

/** 品目のない(内訳の印字が無い)レシートのカテゴリは、明細そのものに付ける。 */
export const WHOLE = 'whole';

export type CheckState = {
  draft: ReceiptDraft | null;
  store: string;
  occurredOn: string;
  /** 下書きが無いとき(品目なし)の支払額(正の円)。 */
  amountYen: number;
  /** 品目(lineId)ごとのカテゴリ。品目のないレシートは WHOLE に置く。 */
  genreByLineId: ReadonlyMap<string, string | null>;
  accountId: string | null;
  memo: string;
  /** 答えた・自分で直した問い('store' 'date' 'total' 'account' 'line:<lineId>' 'item:<lineId>')。 */
  answered: ReadonlySet<string>;
  /** 「次から同じ品名はこのカテゴリにする」をオンにして選んだ品目(ふだんはオフ)。 */
  remember?: ReadonlySet<string>;
};

export type LineGuess = {
  lineId: string;
  name: string;
  amountYen: number;
  /** 予測したカテゴリ(無ければ null)。 */
  genreId: string | null;
  /** カテゴリの予測の自信(予測が無ければ 0)。 */
  confidence: number;
  /** 品目の読み取りの自信。 */
  readConfidence: number;
  yRatio: number | null;
};

/** 品目ごとのカテゴリの予測(品目がなければ明細そのもの1つ)。 */
export function lineGuesses(receipt: UnsavedReceipt): LineGuess[] {
  const byKey = new Map(receipt.classifications.map((c) => [c.key, c]));
  const { parsed } = receipt;
  if (parsed.items.length === 0) {
    const whole = byKey.get('0');
    const genreId = whole?.genreId ?? receipt.parentGenreId;
    return [
      {
        lineId: WHOLE,
        name: parsed.storeName ?? parsed.description,
        amountYen: Math.abs(parsed.amountYen),
        genreId,
        // お店の種類だけで決めたカテゴリは 0.6(自信なし)。
        confidence: whole?.confidence ?? (genreId === null ? 0 : 0.6),
        readConfidence: 1,
        yRatio: parsed.fieldY?.total ?? null,
      },
    ];
  }
  return parsed.items.map((item, j) => {
    const guess = byKey.get(`0:${j}`);
    return {
      lineId: item.lineId ?? `item-${j}`,
      name: item.description,
      amountYen: Math.abs(item.amountYen),
      genreId: guess?.genreId ?? null,
      confidence: guess?.confidence ?? 0,
      readConfidence: item.confidence ?? 1,
      yRatio: item.yRatio ?? null,
    };
  });
}

/** 最初の値。カテゴリは「自信なし」なら当てない(必ず選ぶ)。 */
export function initialCheckState(
  receipt: UnsavedReceipt,
  defaultAccountId: string | null,
): CheckState {
  const { parsed } = receipt;
  return {
    draft: parsed.draft ?? null,
    store: parsed.storeName ?? parsed.description,
    occurredOn: parsed.occurredOn,
    amountYen: Math.abs(parsed.amountYen),
    genreByLineId: new Map(
      lineGuesses(receipt).map((g) => [
        g.lineId,
        bandOf(g.confidence) === 'doubt' ? null : g.genreId,
      ]),
    ),
    accountId: receipt.accountGuess?.accountId ?? defaultAccountId,
    memo: '',
    answered: new Set(),
  };
}

/** いまの値で作った読み取り結果(品目の按分・照合は下書きから毎回作り直す)。 */
export function currentParsed(
  receipt: UnsavedReceipt,
  state: CheckState,
): ParsedReceiptTransaction {
  const original = receipt.parsed;
  const base = { ...original, storeName: state.store, occurredOn: state.occurredOn };
  if (state.draft === null) {
    return original.items.length === 0 ? { ...base, amountYen: -state.amountYen } : base;
  }
  const productTypes = new Map(original.items.map((i) => [i.lineId ?? '', i.productType]));
  return { ...base, ...withDraft(original, state.draft, productTypes) };
}

/** 品目の合計と合計の照合(品目が無ければ null)。 */
export function reconcileOf(state: CheckState): ReconcileResult | null {
  return state.draft !== null && state.draft.lines.some((l) => l.kind === 'item')
    ? reconcileReceipt(state.draft)
    : null;
}

export function paidYenOf(state: CheckState): number {
  return state.draft?.paidYen ?? state.amountYen;
}

/** いまの品目(lineId と名前・金額)。下書きの行のうち値引きでないもの。 */
export function itemLines(
  receipt: UnsavedReceipt,
  state: CheckState,
): {
  lineId: string;
  name: string;
  amountYen: number;
  confidence: number;
  yRatio: number | null;
}[] {
  if (state.draft === null) {
    return receipt.parsed.items.map((item, j) => ({
      lineId: item.lineId ?? `item-${j}`,
      name: item.description,
      amountYen: Math.abs(item.amountYen),
      confidence: item.confidence ?? 1,
      yRatio: item.yRatio ?? null,
    }));
  }
  return state.draft.lines
    .filter((l) => l.kind === 'item')
    .map((l) => ({
      lineId: l.id,
      name: l.name,
      amountYen: l.amountYen,
      confidence: l.confidence,
      yRatio: l.yRatio,
    }));
}

type Base = { id: string; confidence: number; ask: 'ask' | 'must'; yRatio: number | null };
export type CheckQuestion =
  | (Base & { field: 'store' })
  | (Base & { field: 'date'; candidates: string[] })
  | (Base & { field: 'total'; candidates: number[] })
  | (Base & { field: 'account' })
  | (Base & {
      field: 'category';
      lineIds: string[];
      names: string[];
      /** 候補(おすすめ)。何も当てていないときも、ボタンの先頭に出す。 */
      suggestedGenreId: string | null;
    })
  | (Base & { field: 'item'; lineId: string; name: string; amountYen: number });

export type CheckContext = {
  level: CheckLevel;
  /** 今期の目標の期間(目標が無ければ null)。日付の候補が期をまたぐかを見る。 */
  goalRange: { from: string; to: string } | null;
};

/** 日付の候補(読んだ日と、撮った日。同じ日なら前の日)。 */
export function dateCandidates(readDate: string, capturedOn: string): string[] {
  return readDate === capturedOn ? [readDate, addDays(readDate, -1)] : [readDate, capturedOn];
}

/** 合計の候補(読んだ額と、品目から出した額が違えばそれも)。 */
export function totalCandidates(paidYen: number, reconcile: ReconcileResult | null): number[] {
  if (reconcile === null || reconcile.status === 'ok') return [paidYen];
  return reconcile.expectedPaidYen > 0 && reconcile.expectedPaidYen !== paidYen
    ? [paidYen, reconcile.expectedPaidYen]
    : [paidYen];
}

const inRange = (date: string, range: { from: string; to: string }) =>
  date >= range.from && date <= range.to;

/** 聞くもの(並べた順)。答えた・直したものは出さない。 */
export function checkQuestions(
  receipt: UnsavedReceipt,
  state: CheckState,
  ctx: CheckContext,
): CheckQuestion[] {
  const { parsed } = receipt;
  const conf = parsed.fieldConfidence;
  const y = parsed.fieldY;
  const reconcile = reconcileOf(state);
  const mismatch = reconcile?.status === 'mismatch';
  const dates = dateCandidates(parsed.occurredOn, receipt.capturedOn);
  const crossesPeriod =
    ctx.goalRange !== null &&
    dates.some((d) => inRange(d, ctx.goalRange!)) &&
    dates.some((d) => !inRange(d, ctx.goalRange!));

  const inputs: CheckQuestion[] = [];
  const open = (id: string) => !state.answered.has(id);
  const base = (id: string, confidence: number, yRatio: number | null | undefined) => ({
    id,
    confidence,
    yRatio: yRatio ?? null,
    ask: 'ask' as const,
  });

  if (open('store')) inputs.push({ ...base('store', conf?.store ?? 1, y?.store), field: 'store' });
  if (open('date')) {
    inputs.push({ ...base('date', conf?.date ?? 1, y?.date), field: 'date', candidates: dates });
  }
  if (open('total')) {
    inputs.push({
      ...base('total', totalConfidence(conf?.total, reconcile?.status === 'ok'), y?.total),
      field: 'total',
      candidates: totalCandidates(paidYenOf(state), reconcile),
    });
  }
  if (open('account')) {
    inputs.push({
      ...base('account', receipt.accountGuess?.confidence ?? 0.4, null),
      field: 'account',
    });
  }

  // カテゴリ:まだ答えていない品目を、候補のカテゴリごとに1問にまとめる。
  const guesses = lineGuesses(receipt);
  const present = new Set(genreLineIds(receipt, state));
  const groups = new Map<string, LineGuess[]>();
  for (const g of guesses) {
    if (!present.has(g.lineId) || !open(`line:${g.lineId}`)) continue;
    // 聞かない品目(自信あり)は、同じ候補でも問いに混ぜない。
    if (askFor('category', bandOf(g.confidence), ctx.level) === 'skip') continue;
    const key = g.genreId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  for (const [key, lines] of groups) {
    const confidence = Math.min(...lines.map((l) => l.confidence));
    inputs.push({
      ...base(`category:${key}`, confidence, lines[0]!.yRatio),
      field: 'category',
      lineIds: lines.map((l) => l.lineId),
      names: lines.map((l) => l.name),
      suggestedGenreId: key === '' ? null : key,
    });
  }

  // 品目の名前・金額:合計と合わないときだけ、自信のない品目を聞く。
  for (const line of itemLines(receipt, state)) {
    if (!open(`item:${line.lineId}`)) continue;
    inputs.push({
      ...base(`item:${line.lineId}`, line.confidence, line.yRatio),
      field: 'item',
      lineId: line.lineId,
      name: line.name,
      amountYen: line.amountYen,
    });
  }

  return orderQuestions(
    inputs.map((q) => ({
      ...q,
      ctx: { crossesPeriod: q.field === 'date' && crossesPeriod, itemsMismatch: mismatch },
    })),
    ctx.level,
  ).map((q) => {
    const { ctx: omitted, ...rest } = q;
    void omitted;
    return rest as CheckQuestion;
  });
}

/** カテゴリを付ける先:品目(下書きの行)。品目が1つもなければ明細そのもの(WHOLE)。 */
export function genreLineIds(receipt: UnsavedReceipt, state: CheckState): string[] {
  const lines = itemLines(receipt, state).map((l) => l.lineId);
  return lines.length > 0 ? lines : [WHOLE];
}

/** カテゴリが空の品目(必ず選ぶ)。 */
export function emptyGenreLines(receipt: UnsavedReceipt, state: CheckState): string[] {
  return genreLineIds(receipt, state).filter(
    (id) => (state.genreByLineId.get(id) ?? null) === null,
  );
}

export type SaveBlock = 'must' | 'genre' | 'account' | 'amount' | null;

/** 保存できないわけ(保存できれば null)。 */
export function saveBlock(
  receipt: UnsavedReceipt,
  state: CheckState,
  questions: readonly CheckQuestion[],
): SaveBlock {
  if (questions.some((q) => q.ask === 'must')) return 'must';
  if (emptyGenreLines(receipt, state).length > 0) return 'genre';
  if (!state.accountId) return 'account';
  if (paidYenOf(state) <= 0) return 'amount';
  return null;
}

/** 問いが1つもなく、合計も合っていて、そのまま保存できる。 */
export function isComplete(receipt: UnsavedReceipt, state: CheckState, ctx: CheckContext): boolean {
  const questions = checkQuestions(receipt, state, ctx);
  const reconcile = reconcileOf(state);
  return (
    questions.length === 0 &&
    (reconcile === null || reconcile.status === 'ok') &&
    saveBlock(receipt, state, questions) === null
  );
}

/** 保存する形。品目のないレシートは明細そのものに WHOLE のカテゴリを付ける。 */
export function checkSavePlan(
  receipt: UnsavedReceipt,
  state: CheckState,
  sourceRef: string,
): ReceiptSavePlan {
  const parsed = currentParsed(receipt, state);
  const hasItems = parsed.items.length > 0;
  const plan = buildReceiptSavePlan({
    parsed,
    accountId: state.accountId ?? '',
    parentGenreId: hasItems ? null : (state.genreByLineId.get(WHOLE) ?? null),
    genreByLineId: state.genreByLineId,
    kind: 'normal',
    sourceRef,
  });
  if (state.memo.trim() !== '') plan.transaction.memo = state.memo.trim();
  return plan;
}

/** 本人が直したカテゴリ(予測と違うもの)。履歴に入れて、次から同じ品名のおすすめに出す。 */
export function genreCorrections(
  receipt: UnsavedReceipt,
  state: CheckState,
): { itemName: string; genreId: string; pin: boolean }[] {
  const guessed = new Map(lineGuesses(receipt).map((g) => [g.lineId, g]));
  const lines =
    state.draft === null
      ? [...guessed.values()].map((g) => ({ lineId: g.lineId, name: g.name }))
      : state.draft.lines
          .filter((l) => l.kind === 'item')
          .map((l) => ({ lineId: l.id, name: l.name }));
  return lines.flatMap(({ lineId, name }) => {
    if (lineId === WHOLE) return [];
    const now = state.genreByLineId.get(lineId) ?? null;
    const pin = state.remember?.has(lineId) ?? false;
    // 予測と違うカテゴリにしたか、「次から同じ品名は」をオンにして選んだものだけ。
    if (now === null || (!pin && now === (guessed.get(lineId)?.genreId ?? null))) return [];
    return [{ itemName: name, genreId: now, pin }];
  });
}
