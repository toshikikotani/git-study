/**
 * AI とつなぐ(MCP)の書く道具の中身(ADR-144)。記録する・レシートを入れる・カテゴリを直す・目標を変える・
 * 取り消す。本人がチャットで内容を見て「使っていい」を押したときに呼ばれる(ChatGPT・Claude は書く道具の前に
 * 許可を聞く。道具の説明でも、内容を見せてから呼ぶよう AI に頼む)。
 *
 * 保存は画面と同じ関数(importTransactions・buildReceiptSavePlan・updateTransaction・updatePlanTargets)。
 * 同じ日・近い金額の記録が先にあれば、保存せずに「同じ支払いかも」を返す(本人がチャットで決めて
 * allowDuplicate で呼び直す)。入れた記録は source_ref が mcp- で始まり、undo_record で消せる(ほかは消せない)。
 * 本人のセッションの中で呼ぶ。
 */
import 'server-only';

import { randomUUID } from 'node:crypto';

import { findReceiptDuplicates } from '@/domain/receipt-duplicate';
import { comparableKey } from '@/domain/store-name';
import { getOrCreateDefaultAccount, listAccounts } from '@/features/accounts/store';
import { loadCategoryOutlooks } from '@/features/goals/category-outlook';
import { loadClassificationMemory, recordCorrection } from '@/features/genre/memory-store';
import { classifyReceiptPipeline } from '@/features/genre/receipt-classify';
import { listGenres } from '@/features/genre/store';
import type { ParsedReceiptTransaction } from '@/features/import/receipt-ai';
import { buildReceiptSavePlan } from '@/features/import/receipt-save';
import { replaceReceiptItems } from '@/features/receipts/items-store';
import { addPlanGenre } from '@/features/spending-plan/membership';
import { getCurrentPlan, updatePlanTargets } from '@/features/spending-plan/store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { replaceSplits } from '@/features/transactions/splits-store';
import { importTransactions, updateTransaction } from '@/features/transactions/store';
import { fingerprintOf, type StoredTransaction } from '@/features/transactions/types';
import { todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

/** MCP から入れた記録の source_ref の頭(取り消せるのはこれだけ)。 */
export const MCP_REF_PREFIX = 'mcp-';
/** 1件の上限(円)。 */
export const MAX_YEN = 10_000_000;

type Genre = { id: string; name: string };

/** カテゴリの名前から1つ決める(全部一致 → 部分一致が1つだけ)。決まらなければ候補を付けて断る。 */
export function resolveGenre(genres: readonly Genre[], name: string): Genre {
  const key = comparableKey(name);
  const exact = genres.find((g) => comparableKey(g.name) === key);
  if (exact) return exact;
  const partial = genres.filter(
    (g) => comparableKey(g.name).includes(key) || key.includes(comparableKey(g.name)),
  );
  if (partial.length === 1) return partial[0]!;
  const list = (partial.length > 1 ? partial : genres).map((g) => g.name).join('、');
  throw new Error(
    partial.length > 1
      ? `カテゴリ「${name}」がどれか決められません。次から選んでください:${list}`
      : `カテゴリ「${name}」はありません。次から選んでください:${list}`,
  );
}

function assertYen(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_YEN) {
    throw new Error(
      `${label}は1円以上${MAX_YEN.toLocaleString('ja-JP')}円以下の整数にしてください。`,
    );
  }
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error('日付は YYYY-MM-DD で指定してください。');
  }
}

async function accountOf(name: string | undefined): Promise<{ id: string; name: string }> {
  if (name === undefined || name.trim() === '') {
    const account = await getOrCreateDefaultAccount();
    return { id: account.id, name: account.name };
  }
  const accounts = await listAccounts();
  const key = comparableKey(name);
  const hit =
    accounts.find((a) => comparableKey(a.name) === key) ??
    accounts.find((a) => comparableKey(a.name).includes(key));
  if (!hit) {
    throw new Error(
      `支払い「${name}」の口座がありません。次から選んでください:${accounts.map((a) => a.name).join('、')}`,
    );
  }
  return { id: hit.id, name: hit.name };
}

export type DuplicateCandidate = { id: string; date: string; store: string; yen: number };

/** 同じ日に、同じお店で近い金額か、どのお店でも同じ金額の記録(カードの知らせなど)。 */
export async function findPossibleDuplicates(
  date: string,
  store: string,
  signedYen: number,
): Promise<DuplicateCandidate[]> {
  const { transactions } = await loadLedgerTransactions({ from: date, to: date }, todayJst());
  const existing = transactions
    .filter((t) => !t.isTransfer && t.reviewStatus !== 'ignored' && !t.needsInput)
    .map((t) => ({
      id: t.id,
      storeName: t.label,
      occurredOn: t.occurredOn,
      amountYen: t.amountYen,
    }));
  const near = new Set(
    findReceiptDuplicates(
      { storeName: store, occurredOn: date, amountYen: signedYen },
      existing,
    ).map((e) => e.id),
  );
  return existing
    .filter((e) => near.has(e.id) || e.amountYen === signedYen)
    .map((e) => ({ id: e.id, date: e.occurredOn, store: e.storeName, yen: Math.abs(e.amountYen) }));
}

type Saved = {
  status: 'recorded';
  record: {
    id: string;
    date: string;
    store: string;
    yen: number;
    type: string;
    category: string | null;
  };
  note: string;
};
type Held = {
  status: 'not_recorded_possible_duplicate';
  candidates: DuplicateCandidate[];
  note: string;
};

const heldNote =
  '同じ日に近い金額の記録があるので、まだ記録していません。本人に「同じ支払いか」を聞き、別の支払いなら allowDuplicate: true で呼び直してください。';
const savedNote = (id: string) =>
  `記録しました。間違いなら undo_record に id「${id}」を渡すと取り消せます。`;

async function insert(
  preview: StoredTransaction,
  accountId: string,
): Promise<{ id: string } | { duplicate: true }> {
  const result = await importTransactions([preview], {
    fileName: 'AI(MCP)',
    source: 'manual',
    accountId,
    failedCount: 0,
  });
  const inserted = result.insertedTransactions.find((t) => t.sourceRef === preview.sourceRef);
  return inserted ? { id: inserted.id } : { duplicate: true };
}

export type AddRecordInput = {
  type: 'expense' | 'income' | 'refund';
  amountYen: number;
  date?: string | undefined;
  store?: string | undefined;
  category?: string | undefined;
  memo?: string | undefined;
  account?: string | undefined;
  allowDuplicate?: boolean | undefined;
};

/** 手で言った記録(「ランチ 1200円」)を1件入れる。 */
export async function addRecord(input: AddRecordInput): Promise<Saved | Held> {
  assertYen(input.amountYen, '金額');
  const date = input.date ?? todayJst();
  assertDate(date);
  const genres = await listGenres();
  const genre =
    input.category !== undefined && input.category.trim() !== ''
      ? resolveGenre(genres, input.category)
      : null;
  if (input.type !== 'income' && genre === null) {
    throw new Error(
      `支出と返金はカテゴリが要ります。次から選んでください:${genres.map((g) => g.name).join('、')}`,
    );
  }
  const label =
    input.store?.trim() ||
    (input.type === 'income'
      ? '収入'
      : input.type === 'refund'
        ? `${genre!.name}の返金`
        : genre!.name);
  const signed = input.type === 'expense' ? -input.amountYen : input.amountYen;
  if (!input.allowDuplicate && input.type === 'expense') {
    const candidates = await findPossibleDuplicates(date, label, signed);
    if (candidates.length > 0) {
      return { status: 'not_recorded_possible_duplicate', candidates, note: heldNote };
    }
  }
  const accountId = (await accountOf(input.account)).id;
  const memo = input.memo?.trim() ? input.memo.trim().slice(0, 200) : null;
  const preview: StoredTransaction = {
    id: 'mcp-0',
    accountId,
    occurredOn: date,
    description: label,
    merchantName: label,
    amountYen: signed,
    paymentMethod: 'one_time',
    genreId: genre?.id ?? null,
    genreName: genre?.name ?? null,
    classifiedBy: genre ? 'manual' : 'unclassified',
    confidence: null,
    reviewStatus: 'auto_ok',
    mustPay: false,
    kind: input.type === 'refund' ? 'refund' : 'normal',
    source: 'manual',
    fingerprint: fingerprintOf({ occurredOn: date, amountYen: signed, description: label }),
    batchId: null,
    sourceRef: `${MCP_REF_PREFIX}${randomUUID()}`,
    memo,
  };
  const saved = await insert(preview, accountId);
  if ('duplicate' in saved) throw new Error('同じ記録がもうあります(日付・金額・名前が同じ)。');
  return {
    status: 'recorded',
    record: {
      id: saved.id,
      date,
      store: label,
      yen: input.amountYen,
      type: input.type,
      category: genre?.name ?? null,
    },
    note: savedNote(saved.id),
  };
}

export type AddReceiptInput = {
  store: string;
  /** 省くと今日。 */
  date?: string | undefined;
  totalYen: number;
  items?: { name: string; yen: number; category?: string | undefined }[] | undefined;
  category?: string | undefined;
  account?: string | undefined;
  allowDuplicate?: boolean | undefined;
};

/** 品目の合計と支払った額の差がこれ以内なら、差を「調整(税・値引き)」の行にする。 */
const ADJUST_RATIO = 0.2;

type ReceiptLine = { name: string; yen: number; genre: Genre | null; guessed: boolean };

/** 保存の前に決めたレシート(確かめの画面に出すものと、保存するもの)。DB には書かない。 */
type PreparedReceipt = {
  store: string;
  date: string;
  totalYen: number;
  account: { id: string; name: string };
  parentGenre: Genre | null;
  parentGuessed: boolean;
  /** 品目(差があれば最後に「調整」の行)。 */
  lines: ReceiptLine[];
  genres: Genre[];
};

/** 名前から決める。決まらなければ null(アプリが当てる)。 */
function genreOrNull(genres: readonly Genre[], name: string | undefined): Genre | null {
  if (name === undefined || name.trim() === '') return null;
  try {
    return resolveGenre(genres, name);
  } catch {
    return null;
  }
}

/**
 * AI が読んだレシートを確かめ、カテゴリを決める。AI がカテゴリを言わなかったか、無い名前だったところは、
 * 写真で撮ったときと同じ当て方(本人のルール → 履歴 → 品目の辞書 → お店の種類)で当てる(AI には聞かない)。
 */
async function prepareReceipt(input: AddReceiptInput): Promise<PreparedReceipt> {
  assertYen(input.totalYen, '合計');
  const date = input.date ?? todayJst();
  assertDate(date);
  const store = input.store.trim().slice(0, 60);
  if (store === '') throw new Error('お店の名前が要ります。');
  const genres = await listGenres();
  let parentGenre = genreOrNull(genres, input.category);
  let parentGuessed = false;

  const lines: ReceiptLine[] = (input.items ?? []).map((item) => {
    assertYen(item.yen, `品目「${item.name}」の金額`);
    return {
      name: item.name.trim().slice(0, 60) || '品目',
      yen: item.yen,
      genre: genreOrNull(genres, item.category),
      guessed: false,
    };
  });
  const sum = lines.reduce((n, i) => n + i.yen, 0);

  const undecided = lines.length === 0 ? parentGenre === null : lines.some((l) => !l.genre);
  if (undecided) {
    const memory = await loadClassificationMemory().catch(() => new Map());
    const outcome = await classifyReceiptPipeline(
      null,
      [parsedOf(store, date, input.totalYen, lines)],
      genres,
      memory,
    );
    const guessed = new Map(outcome.classifications.map((c) => [c.key, c.genreId]));
    const byId = (id: string | undefined) => genres.find((g) => g.id === id) ?? null;
    lines.forEach((line, j) => {
      if (line.genre) return;
      line.genre = byId(guessed.get(`0:${j}`));
      line.guessed = line.genre !== null;
    });
    if (parentGenre === null) {
      parentGenre = byId(
        (lines.length === 0 ? guessed.get('0') : undefined) ?? outcome.parentGenreIds.get(0),
      );
      parentGuessed = parentGenre !== null;
    }
  }

  if (lines.length > 0 && sum !== input.totalYen) {
    const diff = input.totalYen - sum;
    if (Math.abs(diff) > input.totalYen * ADJUST_RATIO) {
      throw new Error(
        `品目の合計(${sum.toLocaleString('ja-JP')}円)と合計(${input.totalYen.toLocaleString('ja-JP')}円)が合いません。品目を確かめてください。`,
      );
    }
    // 全体のカテゴリが無ければ、いちばん大きい品目のカテゴリに入れる(「未分類」を作らない)。
    const largest = [...lines].sort((a, b) => b.yen - a.yen).find((l) => l.genre);
    lines.push({
      name: diff > 0 ? '調整(税など)' : '調整(値引きなど)',
      yen: diff,
      genre: parentGenre ? null : (largest?.genre ?? null),
      guessed: false,
    });
  }
  if (parentGenre === null && !lines.some((l) => l.genre !== null)) {
    // 当てられなければ「その他」に入れる(画面に「推定」と出て、本人が直せる)。
    parentGenre = genres.find((g) => g.name === 'その他') ?? null;
    parentGuessed = parentGenre !== null;
  }
  if (parentGenre === null && !lines.some((l) => l.genre !== null)) {
    throw new Error(
      `カテゴリが要ります(レシート全体か品目ごと)。次から選んでください:${genres.map((g) => g.name).join('、')}`,
    );
  }
  const account = await accountOf(input.account);
  return {
    store,
    date,
    totalYen: input.totalYen,
    account,
    parentGenre,
    parentGuessed,
    lines,
    genres,
  };
}

function parsedOf(
  store: string,
  date: string,
  totalYen: number,
  lines: readonly { name: string; yen: number }[],
): ParsedReceiptTransaction {
  return {
    occurredOn: date,
    description: store,
    storeName: store,
    amountYen: -totalYen,
    paymentMethod: 'one_time',
    items: lines.map((line, i) => ({
      description: line.name,
      amountYen: -line.yen,
      productType: null,
      lineId: `l${i}`,
    })),
    expenseSubtype: null,
  } as ParsedReceiptTransaction;
}

export type ReceiptPreview = {
  status: 'ready' | 'possible_duplicate';
  receipt: {
    store: string;
    date: string;
    totalYen: number;
    account: string;
    category: string | null;
    /** カテゴリごとの合計(多い順)。 */
    byCategory: { category: string; yen: number }[];
    items: { name: string; yen: number; category: string | null; guessed: boolean }[];
    /** アプリが当てたカテゴリがある。 */
    guessed: boolean;
  };
  candidates: DuplicateCandidate[];
  /** 「はい」で save_receipt にそのまま渡す内容(当てたカテゴリも決めた名前で入れてある)。 */
  saveInput: AddReceiptInput;
  note: string;
};

const previewNote =
  'まだ登録していません。本人に「これでいいですか」の画面(はい・やめる)を出しました。本人が「はい」を押すと登録されます。画面が出ていない場合は、この内容を本人に見せて聞き、「はい」と言われたら add_receipt を saveInput の内容で呼んでください。';

/** 登録する前に、確かめの画面に出す内容を作る(保存しない)。 */
export async function previewReceipt(input: AddReceiptInput): Promise<ReceiptPreview> {
  const p = await prepareReceipt(input);
  const candidates = await findPossibleDuplicates(p.date, p.store, -p.totalYen);
  const fallback = p.parentGenre?.name ?? null;
  const items = p.lines.map((l) => ({
    name: l.name,
    yen: l.yen,
    category: l.genre?.name ?? fallback,
    guessed: l.guessed || (l.genre === null && p.parentGuessed),
  }));
  const totals = new Map<string, number>();
  for (const item of items.length > 0 ? items : [{ category: fallback, yen: p.totalYen }]) {
    const key = item.category ?? '未分類';
    totals.set(key, (totals.get(key) ?? 0) + item.yen);
  }
  const adjusted = p.lines.at(-1)?.name.startsWith('調整') === true;
  return {
    status: candidates.length > 0 ? 'possible_duplicate' : 'ready',
    receipt: {
      store: p.store,
      date: p.date,
      totalYen: p.totalYen,
      account: p.account.name,
      category: fallback,
      byCategory: [...totals]
        .map(([category, yen]) => ({ category, yen }))
        .sort((a, b) => b.yen - a.yen),
      items,
      guessed: p.parentGuessed || p.lines.some((l) => l.guessed),
    },
    candidates,
    saveInput: {
      store: p.store,
      date: p.date,
      totalYen: p.totalYen,
      ...(p.parentGenre ? { category: p.parentGenre.name } : {}),
      account: p.account.name,
      ...(p.lines.length > 0
        ? {
            items: (adjusted ? p.lines.slice(0, -1) : p.lines).map((l) => ({
              name: l.name,
              yen: l.yen,
              ...(l.genre ? { category: l.genre.name } : {}),
            })),
          }
        : {}),
    },
    note: previewNote,
  };
}

/** AI が読んだレシート(お店・日付・合計・品目)を1件入れる。品目が2つ以上ならカテゴリごとに分ける。 */
export async function addReceipt(input: AddReceiptInput): Promise<Saved | Held> {
  const p = await prepareReceipt(input);
  const signed = -p.totalYen;
  if (!input.allowDuplicate) {
    const candidates = await findPossibleDuplicates(p.date, p.store, signed);
    if (candidates.length > 0) {
      return { status: 'not_recorded_possible_duplicate', candidates, note: heldNote };
    }
  }

  const sourceRef = `${MCP_REF_PREFIX}${randomUUID()}`;
  const plan = buildReceiptSavePlan({
    parsed: parsedOf(p.store, p.date, p.totalYen, p.lines),
    accountId: p.account.id,
    parentGenreId: p.parentGenre?.id ?? null,
    genreByLineId: new Map(p.lines.map((line, i) => [`l${i}`, line.genre?.id ?? null])),
    kind: 'normal',
    sourceRef,
  });
  const saved = await insert({ ...plan.transaction, sourceRef }, p.account.id);
  if ('duplicate' in saved) throw new Error('同じ記録がもうあります(日付・金額・お店が同じ)。');
  const warnings: string[] = [];
  if (plan.splits)
    await replaceSplits(saved.id, plan.splits).catch(() =>
      warnings.push('カテゴリごとの分け方を保存できませんでした。'),
    );
  if (plan.items.length > 0)
    await replaceReceiptItems(saved.id, plan.items).catch(() =>
      warnings.push('品目を保存できませんでした。'),
    );
  const categoryId = plan.transaction.genreId;
  return {
    status: 'recorded',
    record: {
      id: saved.id,
      date: p.date,
      store: p.store,
      yen: p.totalYen,
      type: 'expense',
      category: p.genres.find((g) => g.id === categoryId)?.name ?? null,
    },
    note: [savedNote(saved.id), ...warnings].join(' '),
  };
}

/** 明細のカテゴリを直す(次から同じお店は、そのカテゴリになりやすくする)。 */
export async function setCategory(input: { id: string; category: string }) {
  const genres = await listGenres();
  const genre = resolveGenre(genres, input.category);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('transactions')
    .select('id, occurred_on, merchant_name, description, amount_yen')
    .eq('id', input.id)
    .maybeSingle();
  if (error || !data)
    throw new Error('その明細が見つかりません。search_transactions の id を渡してください。');
  await updateTransaction(input.id, genre.id);
  const store = (data.merchant_name ?? '').trim() || data.description;
  await recordCorrection({ storeName: store, itemName: store, genreId: genre.id }).catch(() => {});
  return {
    status: 'updated',
    record: {
      id: data.id,
      date: data.occurred_on,
      store,
      yen: Math.abs(data.amount_yen),
      category: genre.name,
    },
  };
}

/** 今期の目標の、カテゴリの目標額を変える(使った額と予定の合計より下にはできない)。 */
export async function setTarget(input: { category: string; targetYen: number }) {
  if (!Number.isInteger(input.targetYen) || input.targetYen < 0 || input.targetYen > MAX_YEN) {
    throw new Error('目標額は0円以上の整数にしてください。');
  }
  const today = todayJst();
  const plan = await getCurrentPlan(today);
  if (plan === null)
    throw new Error('今期の目標がまだありません。アプリの「今期の目標」で作ってください。');
  const genres = await listGenres();
  const genre = resolveGenre(genres, input.category);
  const { outlooks } = await loadCategoryOutlooks({ plan, today, genreIds: [genre.id] });
  const outlook = outlooks[0];
  const floor = (outlook?.spentYen ?? 0) + (outlook?.scheduledYen ?? 0);
  if (input.targetYen < floor) {
    throw new Error(
      `${genre.name}は使った額と予定の合計が${floor.toLocaleString('ja-JP')}円なので、それより下にはできません。`,
    );
  }
  const item = plan.items.find((i) => i.genreId === genre.id);
  if (item) await updatePlanTargets(plan.id, [{ genreId: genre.id, targetYen: input.targetYen }]);
  else await addPlanGenre(plan.id, genre.id, input.targetYen, null);
  return {
    status: 'updated',
    period: { from: plan.periodStart, to: plan.periodEnd },
    category: genre.name,
    previousTargetYen: item?.targetYen ?? null,
    targetYen: input.targetYen,
    spentAndScheduledYen: floor,
  };
}

/** MCP から入れた記録を取り消す(ほかの記録は消さない)。 */
export async function undoRecord(input: { id: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('transactions')
    .select('id, source_ref, occurred_on, merchant_name, description, amount_yen')
    .eq('id', input.id)
    .maybeSingle();
  if (error || !data) throw new Error('その記録が見つかりません。');
  if (!data.source_ref?.startsWith(MCP_REF_PREFIX)) {
    throw new Error('AI から入れた記録だけ取り消せます。ほかの記録はアプリで消してください。');
  }
  const { error: deleteError } = await supabase.from('transactions').delete().eq('id', input.id);
  if (deleteError) throw new Error('取り消せませんでした。');
  return {
    status: 'deleted',
    record: {
      id: data.id,
      date: data.occurred_on,
      store: (data.merchant_name ?? '').trim() || data.description,
      yen: Math.abs(data.amount_yen),
    },
  };
}
