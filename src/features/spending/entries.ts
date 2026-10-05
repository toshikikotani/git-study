/**
 * 家計簿の明細を読む唯一の入口(DB → LedgerTransaction)。
 *
 * ヘッダー・内訳・カレンダー・目標・AI診断はどれもここで読んだ明細を
 * domain/ledger.ts の summarizeLedger() に通す。読み方(分割の展開・親の
 * ジャンルの引き継ぎ・予定の扱い)を画面ごとに持たない。
 *
 * `status` / `kind` 列は本番未適用の間がある(supabase/apply-pending.sql)。
 * 列が無ければ status は日付から、kind は 'normal' として読み進める。
 */

import { entryStatus, type EntryKind } from '@/domain/ledger';
import { resolveItemGenres } from '@/features/genre/item-genres';
import type { PaymentMethod } from '@/features/import/adapters';
import { listSplitsForTransactionIds } from '@/features/transactions/splits-store';
import type { DateOnly } from '@/lib/date';
import { isMissingColumnError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import type { LedgerSplit, LedgerTransaction } from './ledger-types';

export class LedgerLoadError extends Error {}

const BASE_COLUMNS =
  'id, occurred_on, description, merchant_name, amount_yen, genre_id, is_transfer, review_status, account_id, payment_method, must_pay, note, import_batch_id';
const SPLIT_ID_CHUNK = 50;

export type LedgerGenre = { id: string; name: string; budget_yen: number | null };

/** 分割の合計が明細の金額と合わないデータは、集計がずれるため分割として扱わない。 */
function usableSplits(
  amountYen: number,
  splits: readonly { genreId: string | null; amountYen: number; note: string | null }[] | undefined,
): readonly { genreId: string | null; amountYen: number; note: string | null }[] {
  if (!splits || splits.length === 0) return [];
  const sum = splits.reduce((acc, s) => acc + s.amountYen, 0);
  return sum === amountYen ? splits : [];
}

type RawRow = {
  id: string;
  occurred_on: string;
  description: string;
  merchant_name: string | null;
  amount_yen: number;
  genre_id: string | null;
  is_transfer: boolean;
  review_status: LedgerTransaction['reviewStatus'];
  account_id: string;
  payment_method: PaymentMethod;
  must_pay: boolean;
  note: string | null;
  import_batch_id: string | null;
  kind?: string | null;
  branch_name?: string | null;
  reconcile_diff_yen?: number | null;
};

/** 範囲 [from, to](両端を含む)の明細を、未来日(予定)も含めて読む。 */
export async function loadLedgerTransactions(
  range: { from: DateOnly; to: DateOnly },
  today: DateOnly,
): Promise<{
  genres: LedgerGenre[];
  transactions: LedgerTransaction[];
  /** 取り込み単位(レシート画像の引き当て用)。 */
  batchIdByTransactionId: Map<string, string>;
}> {
  const supabase = await createClient();

  const query = (columns: string) =>
    supabase
      .from('transactions')
      .select(columns)
      .gte('occurred_on', range.from)
      .lte('occurred_on', range.to)
      .order('occurred_on', { ascending: false });

  const [genresResult, withKind] = await Promise.all([
    supabase.from('genres').select('id, name, budget_yen').order('sort_order'),
    query(`${BASE_COLUMNS}, kind, branch_name, reconcile_diff_yen`),
  ]);
  if (genresResult.error) {
    throw new LedgerLoadError(`ジャンルを取得できませんでした: ${genresResult.error.message}`);
  }
  let rows = withKind.data as unknown as RawRow[] | null;
  if (withKind.error) {
    if (!isMissingColumnError(withKind.error)) {
      throw new LedgerLoadError(`明細を取得できませんでした: ${withKind.error.message}`);
    }
    const fallback = await query(BASE_COLUMNS);
    if (fallback.error) {
      throw new LedgerLoadError(`明細を取得できませんでした: ${fallback.error.message}`);
    }
    rows = fallback.data as unknown as RawRow[];
  }
  const txRows = rows ?? [];
  const genres = genresResult.data;
  const nameById = new Map(genres.map((g) => [g.id, g.name]));

  const splitsById = new Map<
    string,
    { genreId: string | null; amountYen: number; note: string | null }[]
  >();
  const splitChunks = [];
  for (let i = 0; i < txRows.length; i += SPLIT_ID_CHUNK) {
    splitChunks.push(
      listSplitsForTransactionIds(
        supabase,
        txRows.slice(i, i + SPLIT_ID_CHUNK).map((r) => r.id),
      ),
    );
  }
  for (const chunk of await Promise.all(splitChunks)) {
    for (const [id, list] of chunk) splitsById.set(id, list);
  }

  // 分割の無い明細で、本体のジャンルが空なら品目から決めた代表ジャンルを使う。
  const itemGenre = await resolveItemGenres(
    txRows.filter((r) => !splitsById.has(r.id)).map((r) => ({ ...r })),
  );

  const transactions = txRows.map((row): LedgerTransaction => {
    const genreId = row.genre_id ?? itemGenre.get(row.id) ?? null;
    const splits: LedgerSplit[] = usableSplits(row.amount_yen, splitsById.get(row.id)).map(
      (s, i) => {
        // 子のジャンルが未設定なら親を引き継ぐ(「(未分類)」の子を作らない)。
        const childGenreId = s.genreId ?? genreId;
        return {
          id: `${row.id}:${i}`,
          note: s.note,
          genreId: childGenreId,
          genreName: childGenreId === null ? null : (nameById.get(childGenreId) ?? null),
          amountYen: s.amountYen,
        };
      },
    );
    return {
      id: row.id,
      occurredOn: row.occurred_on,
      label: row.merchant_name ?? row.description,
      description: row.description,
      memo: row.note,
      thumbnailUrl: null,
      genreId,
      genreName: genreId === null ? null : (nameById.get(genreId) ?? null),
      amountYen: row.amount_yen,
      accountId: row.account_id,
      paymentMethod: row.payment_method,
      branchName: row.branch_name ?? null,
      reconcileDiffYen: row.reconcile_diff_yen ?? null,
      mustPay: row.must_pay,
      needsInput: false,
      isTransfer: row.is_transfer,
      reviewStatus: row.review_status,
      status: entryStatus(row.occurred_on, today),
      kind: (row.kind === 'special' || row.kind === 'refund'
        ? row.kind
        : 'normal') satisfies EntryKind,
      splits,
    };
  });

  const batchIdByTransactionId = new Map<string, string>();
  for (const row of txRows) {
    if (row.import_batch_id) batchIdByTransactionId.set(row.id, row.import_batch_id);
  }
  return { genres, transactions, batchIdByTransactionId };
}
