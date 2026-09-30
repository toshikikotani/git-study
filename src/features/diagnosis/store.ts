/**
 * 支出診断(transaction_diagnoses)のデータアクセス(ADR-030)。
 *
 * `transaction_diagnoses` は本番未適用(B-13)。未適用時の扱いは lib/supabase/errors.ts。
 */

import { mapChunks } from '@/lib/chunk';
import { isCountable } from '@/domain/budget';
import {
  summarizeDiagnoses,
  summarizeDiagnosesByMonth,
  type DiagnosedTransaction,
  type DiagnosisSummary,
  type MonthlyDiagnosisSummary,
  type SpendingVerdict,
} from '@/domain/diagnosis';
import { summarizeLedger } from '@/domain/ledger';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { toLedgerEntries } from '@/features/spending/views';
import { monthStartJst, todayJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { resolveItemGenres } from '@/features/genre/item-genres';
import { createClient } from '@/lib/supabase/server';

export class DiagnosisStoreError extends AppError {}

/** 1回の「診断する」で処理する上限。診断1件ごとに理由文を書かせるため、
 * 増やしすぎると出力が長くなり max_tokens に達しやすい
 * (diagnosis-ai.ts の MAX_OUTPUT_TOKENS と揃える)。上限を超えた分は
 * 次回の「診断する」で拾える。 */
const MAX_BATCH_SIZE = 30;

/** 1明細あたり診断に渡す品名の上限(プロンプトの肥大化を防ぐ)。 */
const MAX_ITEM_NAMES = 8;

/** 推移表示の対象月数(本人発案:「蓄積して...月ごとの浪費傾向の推移」)。 */
const TREND_MONTHS_BACK = 6;

export type DiagnosisTarget = {
  id: string;
  label: string;
  amountYen: number;
  occurredOn: string;
  genreName: string | null;
  mustPay: boolean;
  genreMonthSpentYen: number | null;
  genreBudgetYen: number | null;
  itemNames: string[];
};

/**
 * 今月、まだ診断していない支出(収入・振替・対象外は除く、domain/budget.ts の
 * isCountable() と同じ定義)。多くても MAX_BATCH_SIZE 件——本人の1回の
 * 操作で無制限に課金が膨らまないようにする歯止め(receipt/route.ts の
 * AI_CALL_LIMIT_PER_HOUR と同種の考え方)。
 */
export async function listUndiagnosedTransactions(
  now: Date = new Date(),
): Promise<DiagnosisTarget[]> {
  const supabase = await createClient();
  const monthStart = monthStartJst(0, now);
  const today = todayJst(now);

  const { data: rows, error } = await supabase
    .from('transactions')
    .select(
      'id, description, merchant_name, amount_yen, occurred_on, is_transfer, review_status, genre_id, must_pay',
    )
    .gte('occurred_on', monthStart)
    .lte('occurred_on', today)
    .lt('amount_yen', 0)
    .order('occurred_on', { ascending: false });
  if (error) throw new DiagnosisStoreError(`明細を取得できませんでした: ${error.message}`);

  const countable = rows.filter((r) =>
    isCountable({
      categoryId: r.genre_id,
      amountYen: r.amount_yen,
      isTransfer: r.is_transfer,
      reviewStatus: r.review_status,
    }),
  );
  if (countable.length === 0) return [];

  // 数百件を超える id は URL に載らないため、分けて問い合わせる。
  const diagnosedParts = await mapChunks(
    countable.map((r) => r.id),
    (ids) =>
      supabase.from('transaction_diagnoses').select('transaction_id').in('transaction_id', ids),
  );
  const diagError = diagnosedParts.find((p) => p.error)?.error ?? null;
  const diagnosed = diagnosedParts.flatMap((p) => p.data ?? []);
  if (diagError && !isMissingTableError(diagError)) {
    throw new DiagnosisStoreError(`診断状況を取得できませんでした: ${diagError.message}`);
  }
  const diagnosedIds = new Set((diagnosed ?? []).map((d) => d.transaction_id));

  const undiagnosed = countable.filter((r) => !diagnosedIds.has(r.id)).slice(0, MAX_BATCH_SIZE);
  if (undiagnosed.length === 0) return [];

  // 品目ごとに分類した明細は、品目から決めた代表ジャンルで扱う(明細本体の
  // ジャンルが空でも、家計簿・分類と同じ見え方にそろえる)。
  const itemGenreByTransactionId = await resolveItemGenres(rows);
  const effectiveGenreId = (r: (typeof rows)[number]): string | null =>
    r.genre_id ?? itemGenreByTransactionId.get(r.id) ?? null;

  const { data: genres, error: genresError } = await supabase
    .from('genres')
    .select('id, name, budget_yen');
  if (genresError) {
    throw new DiagnosisStoreError(`ジャンルを取得できませんでした: ${genresError.message}`);
  }
  const genreById = new Map(genres.map((g) => [g.id, g]));

  // 診断の根拠に「そのジャンルを今月どれだけ使っているか」を添える。数字は
  // 家計簿と同じ集計(domain/ledger.ts の summarizeLedger)から取る。
  const ledger = await loadLedgerTransactions({ from: monthStart, to: today }, today);
  const monthSummary = summarizeLedger(
    toLedgerEntries(ledger.transactions),
    { from: monthStart, to: today },
    today,
  );
  const monthSpentByGenre = monthSummary.byGenre;

  const itemParts = await mapChunks(
    undiagnosed.map((r) => r.id),
    (ids) =>
      supabase.from('receipt_items').select('transaction_id, name').in('transaction_id', ids),
  );
  const itemsError = itemParts.find((p) => p.error)?.error ?? null;
  const items = itemParts.flatMap((p) => p.data ?? []);
  if (itemsError && !isMissingTableError(itemsError)) {
    throw new DiagnosisStoreError(`品目を取得できませんでした: ${itemsError.message}`);
  }
  const itemNamesByTransaction = new Map<string, string[]>();
  for (const item of items ?? []) {
    const list = itemNamesByTransaction.get(item.transaction_id) ?? [];
    list.push(item.name);
    itemNamesByTransaction.set(item.transaction_id, list);
  }

  return undiagnosed.map((r) => {
    const genreId = effectiveGenreId(r);
    const genre = genreId === null ? undefined : genreById.get(genreId);
    return {
      id: r.id,
      label: r.merchant_name ?? r.description,
      amountYen: r.amount_yen,
      occurredOn: r.occurred_on,
      genreName: genre?.name ?? null,
      mustPay: r.must_pay,
      genreMonthSpentYen: genreId === null ? null : (monthSpentByGenre.get(genreId) ?? null),
      genreBudgetYen: genre?.budget_yen ?? null,
      itemNames: (itemNamesByTransaction.get(r.id) ?? []).slice(0, MAX_ITEM_NAMES),
    };
  });
}

/** 診断結果を保存する。1明細1行(再診断は upsert で上書き)。 */
export async function saveDiagnoses(
  results: readonly { transactionId: string; verdict: SpendingVerdict; reasoning: string }[],
): Promise<void> {
  if (results.length === 0) return;

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new DiagnosisStoreError('ログイン状態を確認できませんでした');
  }

  const { error } = await supabase.from('transaction_diagnoses').upsert(
    results.map((r) => ({
      user_id: auth.user.id,
      transaction_id: r.transactionId,
      verdict: r.verdict,
      reasoning: r.reasoning,
    })),
    { onConflict: 'transaction_id' },
  );
  if (error) {
    if (isMissingTableError(error)) throw new DiagnosisStoreError('診断機能はまだ利用できません');
    throw new DiagnosisStoreError(`診断結果を保存できませんでした: ${error.message}`);
  }
}

export type DiagnosedItem = {
  id: string;
  occurredOn: string;
  label: string;
  /** 支出が負(ADR-008)。 */
  amountYen: number;
  reasoning: string;
};

export type SpendingDiagnosisView = {
  currentMonth: {
    summary: DiagnosisSummary;
    /** 今月「浪費」と診断された明細、金額の大きい順、全件。 */
    wasteItems: readonly DiagnosedItem[];
    /** 今月「必要経費」と診断された明細、金額の大きい順、全件。理由も添える。 */
    necessaryItems: readonly DiagnosedItem[];
    /** 今月、まだ診断していない支出の件数。0 なら「診断する」ボタンは不要。 */
    undiagnosedCount: number;
  };
  trend: {
    /** 古い→新しいの順。 */
    monthKeys: readonly string[];
    rows: readonly MonthlyDiagnosisSummary[];
  };
};

/**
 * 家計簿(/spending)の「AI家計診断」カード向けのビュー。今月のスナップショット
 * (診断済みの内訳・浪費上位)と直近6ヶ月の推移を1回の呼び出しでまとめて返す
 * (features/spending/store.ts の loadMonthlyLedger() と同じ、画面1つ分の
 * データをまとめて返す方針)。
 */
export async function loadSpendingDiagnosisView(
  now: Date = new Date(),
): Promise<SpendingDiagnosisView> {
  const monthStart = monthStartJst(0, now);
  const today = todayJst(now);
  const rangeStart = monthStartJst(-(TREND_MONTHS_BACK - 1), now);
  const monthKeys = Array.from({ length: TREND_MONTHS_BACK }, (_, i) =>
    monthStartJst(-(TREND_MONTHS_BACK - 1) + i, now).slice(0, 7),
  );

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('transactions')
    .select(
      'id, description, merchant_name, amount_yen, occurred_on, is_transfer, review_status, genre_id',
    )
    .gte('occurred_on', rangeStart)
    .lte('occurred_on', today)
    .lt('amount_yen', 0)
    .order('occurred_on', { ascending: false });
  if (error) throw new DiagnosisStoreError(`明細を取得できませんでした: ${error.message}`);

  const countable = rows.filter((r) =>
    isCountable({
      categoryId: r.genre_id,
      amountYen: r.amount_yen,
      isTransfer: r.is_transfer,
      reviewStatus: r.review_status,
    }),
  );

  const emptyView: SpendingDiagnosisView = {
    currentMonth: {
      summary: summarizeDiagnoses([]),
      wasteItems: [],
      necessaryItems: [],
      undiagnosedCount: 0,
    },
    trend: { monthKeys, rows: summarizeDiagnosesByMonth([], monthKeys) },
  };
  if (countable.length === 0) return emptyView;

  const diagnosisParts = await mapChunks(
    countable.map((r) => r.id),
    (ids) =>
      supabase
        .from('transaction_diagnoses')
        .select('transaction_id, verdict, reasoning')
        .in('transaction_id', ids),
  );
  const diagError = diagnosisParts.find((p) => p.error)?.error ?? null;
  const diagnoses = diagnosisParts.flatMap((p) => p.data ?? []);
  if (diagError) {
    if (isMissingTableError(diagError)) {
      return {
        ...emptyView,
        currentMonth: {
          ...emptyView.currentMonth,
          undiagnosedCount: countable.filter((r) => r.occurred_on >= monthStart).length,
        },
      };
    }
    throw new DiagnosisStoreError(`診断結果を取得できませんでした: ${diagError.message}`);
  }

  const diagnosisById = new Map(diagnoses.map((d) => [d.transaction_id, d]));

  const diagnosedAll: DiagnosedTransaction[] = [];
  const wasteItems: DiagnosedItem[] = [];
  const necessaryItems: DiagnosedItem[] = [];
  let undiagnosedCount = 0;

  for (const r of countable) {
    const diagnosis = diagnosisById.get(r.id);
    const isThisMonth = r.occurred_on >= monthStart;
    if (!diagnosis) {
      if (isThisMonth) undiagnosedCount += 1;
      continue;
    }
    diagnosedAll.push({
      categoryId: r.genre_id,
      amountYen: r.amount_yen,
      isTransfer: r.is_transfer,
      reviewStatus: r.review_status,
      occurredOn: r.occurred_on,
      verdict: diagnosis.verdict,
    });
    if (isThisMonth) {
      const item: DiagnosedItem = {
        id: r.id,
        occurredOn: r.occurred_on,
        label: r.merchant_name ?? r.description,
        amountYen: r.amount_yen,
        reasoning: diagnosis.reasoning,
      };
      if (diagnosis.verdict === 'waste') {
        wasteItems.push(item);
      } else {
        necessaryItems.push(item);
      }
    }
  }
  wasteItems.sort((a, b) => a.amountYen - b.amountYen);
  necessaryItems.sort((a, b) => a.amountYen - b.amountYen);

  const thisMonthDiagnosed = diagnosedAll.filter((tx) => tx.occurredOn >= monthStart);

  return {
    currentMonth: {
      summary: summarizeDiagnoses(thisMonthDiagnosed),
      wasteItems,
      necessaryItems,
      undiagnosedCount,
    },
    trend: {
      monthKeys,
      rows: summarizeDiagnosesByMonth(diagnosedAll, monthKeys),
    },
  };
}
