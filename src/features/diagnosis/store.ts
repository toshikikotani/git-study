/**
 * 支出診断(transaction_diagnoses)のデータアクセス(本人発案、ADR-030)。
 *
 * `transaction_diagnoses` は本番 Supabase へのマイグレーション適用手段が
 * このセッションに無く(T-25/T-26/B-7/B-10/B-12 と同じ制約)未適用のため、
 * 毎回無条件に読む loadSpendingDiagnosisView() はテーブル未作成のエラー
 * (PGRST205)を「診断はまだ無い」として握り潰す(goals・transaction_splits
 * と同じ考え方。適用後は自動的に効き始める)。一方 saveDiagnoses() は
 * 本人の明示的な操作(診断ボタン)の結果なので握り潰さず、分かりやすい
 * メッセージにしてそのままエラーとして返す。
 */

import type { PostgrestError } from '@supabase/supabase-js';

import { isCountable } from '@/domain/budget';
import {
  summarizeDiagnoses,
  summarizeDiagnosesByMonth,
  type DiagnosedTransaction,
  type DiagnosisSummary,
  type MonthlyDiagnosisSummary,
  type SpendingVerdict,
} from '@/domain/diagnosis';
import { monthStartJst, todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

export class DiagnosisStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagnosisStoreError';
  }
}

function isMissingTableError(error: Pick<PostgrestError, 'code'>): boolean {
  return error.code === 'PGRST205';
}

/** 1回の「診断する」で処理する上限。診断1件ごとに理由文を書かせるため、
 * 増やしすぎると出力が長くなり max_tokens に達しやすい
 * (diagnosis-ai.ts の MAX_OUTPUT_TOKENS と揃える)。上限を超えた分は
 * 次回の「診断する」で拾える。 */
const MAX_BATCH_SIZE = 30;

/** 推移表示の対象月数(本人発案:「蓄積して...月ごとの浪費傾向の推移」)。 */
const TREND_MONTHS_BACK = 6;

export type DiagnosisTarget = {
  id: string;
  label: string;
  amountYen: number;
  occurredOn: string;
  categoryName: string | null;
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
      'id, description, merchant_name, amount_yen, occurred_on, is_transfer, review_status, category_id',
    )
    .gte('occurred_on', monthStart)
    .lte('occurred_on', today)
    .lt('amount_yen', 0)
    .order('occurred_on', { ascending: false });
  if (error) throw new DiagnosisStoreError(`明細を取得できませんでした: ${error.message}`);

  const countable = rows.filter((r) =>
    isCountable({
      categoryId: r.category_id,
      amountYen: r.amount_yen,
      isTransfer: r.is_transfer,
      reviewStatus: r.review_status,
    }),
  );
  if (countable.length === 0) return [];

  const { data: diagnosed, error: diagError } = await supabase
    .from('transaction_diagnoses')
    .select('transaction_id')
    .in(
      'transaction_id',
      countable.map((r) => r.id),
    );
  if (diagError && !isMissingTableError(diagError)) {
    throw new DiagnosisStoreError(`診断状況を取得できませんでした: ${diagError.message}`);
  }
  const diagnosedIds = new Set((diagnosed ?? []).map((d) => d.transaction_id));

  const undiagnosed = countable.filter((r) => !diagnosedIds.has(r.id)).slice(0, MAX_BATCH_SIZE);
  if (undiagnosed.length === 0) return [];

  const categoryIds = [
    ...new Set(undiagnosed.map((r) => r.category_id).filter((id): id is string => id !== null)),
  ];
  const categoryNameById = new Map<string, string>();
  if (categoryIds.length > 0) {
    const { data: categories, error: catError } = await supabase
      .from('categories')
      .select('id, name')
      .in('id', categoryIds);
    if (catError)
      throw new DiagnosisStoreError(`カテゴリを取得できませんでした: ${catError.message}`);
    for (const c of categories) categoryNameById.set(c.id, c.name);
  }

  return undiagnosed.map((r) => ({
    id: r.id,
    label: r.merchant_name ?? r.description,
    amountYen: r.amount_yen,
    occurredOn: r.occurred_on,
    categoryName: r.category_id ? (categoryNameById.get(r.category_id) ?? null) : null,
  }));
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
    /** 今月「浪費」と診断された明細、金額の大きい順(高々5件)。 */
    wasteItems: readonly DiagnosedItem[];
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
      'id, description, merchant_name, amount_yen, occurred_on, is_transfer, review_status, category_id',
    )
    .gte('occurred_on', rangeStart)
    .lte('occurred_on', today)
    .lt('amount_yen', 0)
    .order('occurred_on', { ascending: false });
  if (error) throw new DiagnosisStoreError(`明細を取得できませんでした: ${error.message}`);

  const countable = rows.filter((r) =>
    isCountable({
      categoryId: r.category_id,
      amountYen: r.amount_yen,
      isTransfer: r.is_transfer,
      reviewStatus: r.review_status,
    }),
  );

  const emptyView: SpendingDiagnosisView = {
    currentMonth: { summary: summarizeDiagnoses([]), wasteItems: [], undiagnosedCount: 0 },
    trend: { monthKeys, rows: summarizeDiagnosesByMonth([], monthKeys) },
  };
  if (countable.length === 0) return emptyView;

  const { data: diagnoses, error: diagError } = await supabase
    .from('transaction_diagnoses')
    .select('transaction_id, verdict, reasoning')
    .in(
      'transaction_id',
      countable.map((r) => r.id),
    );
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
  let undiagnosedCount = 0;

  for (const r of countable) {
    const diagnosis = diagnosisById.get(r.id);
    const isThisMonth = r.occurred_on >= monthStart;
    if (!diagnosis) {
      if (isThisMonth) undiagnosedCount += 1;
      continue;
    }
    diagnosedAll.push({
      categoryId: r.category_id,
      amountYen: r.amount_yen,
      isTransfer: r.is_transfer,
      reviewStatus: r.review_status,
      occurredOn: r.occurred_on,
      verdict: diagnosis.verdict,
    });
    if (isThisMonth && diagnosis.verdict === 'waste') {
      wasteItems.push({
        id: r.id,
        occurredOn: r.occurred_on,
        label: r.merchant_name ?? r.description,
        amountYen: r.amount_yen,
        reasoning: diagnosis.reasoning,
      });
    }
  }
  wasteItems.sort((a, b) => a.amountYen - b.amountYen);

  const thisMonthDiagnosed = diagnosedAll.filter((tx) => tx.occurredOn >= monthStart);

  return {
    currentMonth: {
      summary: summarizeDiagnoses(thisMonthDiagnosed),
      wasteItems: wasteItems.slice(0, 5),
      undiagnosedCount,
    },
    trend: {
      monthKeys,
      rows: summarizeDiagnosesByMonth(diagnosedAll, monthKeys),
    },
  };
}
