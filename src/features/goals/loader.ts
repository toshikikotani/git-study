/**
 * 目標の読み込み。家計簿の全列・サムネイル・品目ジャンルは取らない。
 * 目標が使うのは日付、金額、ジャンル、名前、振替、対象外、特別費、分割だけ。
 */

import { entryStatus, type EntryKind } from '@/domain/ledger';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { toLedgerEntries } from '@/features/spending/views';
import { getCurrentPlan, type SpendingPlan } from '@/features/spending-plan/store';
import { listSplitsForTransactionIds } from '@/features/transactions/splits-store';
import { todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import { buildGoalView, type GoalView } from './view';

const GOAL_COLUMNS =
  'id, occurred_on, description, merchant_name, amount_yen, genre_id, is_transfer, review_status, kind';

export async function loadGoalView(
  now: Date = new Date(),
): Promise<{ plan: SpendingPlan; view: GoalView } | null> {
  const today = todayJst(now);
  const plan = await getCurrentPlan(today);
  if (plan === null) return null;
  const supabase = await createClient();
  const [rowsResult, genresResult] = await Promise.all([
    supabase
      .from('transactions')
      .select(GOAL_COLUMNS)
      .gte('occurred_on', plan.periodStart)
      .lte('occurred_on', plan.periodEnd),
    supabase.from('genres').select('id, name'),
  ]);
  if (rowsResult.error) throw new Error(`明細を取得できませんでした: ${rowsResult.error.message}`);
  if (genresResult.error)
    throw new Error(`ジャンルを取得できませんでした: ${genresResult.error.message}`);

  const rows = rowsResult.data ?? [];
  const nameById = new Map(genresResult.data.map((g) => [g.id, g.name]));
  const ids = rows.map((r) => r.id);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 80) chunks.push(ids.slice(i, i + 80));
  const splitsById = new Map<
    string,
    { genreId: string | null; amountYen: number; note: string | null }[]
  >();
  for (const part of await Promise.all(
    chunks.map((ids) => listSplitsForTransactionIds(supabase, ids)),
  )) {
    for (const [id, list] of part) splitsById.set(id, list);
  }

  const transactions: LedgerTransaction[] = rows.map((row) => {
    const genreId = row.genre_id;
    const splits = (splitsById.get(row.id) ?? []).map((s, i) => ({
      id: `${row.id}:${i}`,
      note: s.note,
      genreId: s.genreId ?? genreId,
      genreName:
        (s.genreId ?? genreId) === null ? null : (nameById.get(s.genreId ?? genreId!) ?? null),
      amountYen: s.amountYen,
    }));
    return {
      id: row.id,
      occurredOn: row.occurred_on,
      label: row.merchant_name ?? row.description,
      description: row.description,
      memo: null,
      thumbnailUrl: null,
      genreId,
      genreName: genreId === null ? null : (nameById.get(genreId) ?? null),
      amountYen: row.amount_yen,
      accountId: '',
      paymentMethod: 'unknown',
      branchName: null,
      reconcileDiffYen: null,
      mustPay: false,
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

  return {
    plan,
    view: buildGoalView({
      plan,
      entries: toLedgerEntries(transactions),
      genreNames: nameById,
      today,
      transactions,
    }),
  };
}
