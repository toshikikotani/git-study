/**
 * 読み取れたレシートを「保存前」として残す(v5 変更2、ADR-133)。読み取りの入口(/api/import/receipt)が、
 * 撮影のキューから呼ばれたときだけ使う。保存は本人が「保存」を押したときだけ。
 *
 * 支払い(口座)もここで当てておく(カードの末尾4けた → そのお店で使った口座 → いつもの口座、
 * domain/receipt-account.ts)。残せなかったとき(マイグレーション未適用など)は null を返し、
 * 画面はいままでどおり読み取り結果を画面の中だけに持つ。
 */

import { judgeReadResult, needsManualInput } from '@/domain/receipt-capture';
import { guessReceiptAccount, type AccountGuess } from '@/domain/receipt-account';
import { splitReadResult, type ReceiptGenreGuess } from '@/domain/unsaved-receipt';
import { comparableKey } from '@/domain/store-name';
import { getOrCreateDefaultAccount, listAccounts } from '@/features/accounts/store';
import type { ParsedReceiptTransaction } from '@/features/import/receipt-ai';
import { uploadReceiptImage } from '@/features/import/receipt-storage';
import { todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import { createReadyCaptures, replaceReadyCapture } from './store';

/** お店ごとの、前に使った口座(新しい順)。 */
async function storeAccountHistory(storeNames: readonly string[]): Promise<Map<string, string[]>> {
  const keys = new Set(storeNames.map(comparableKey).filter((k) => k !== ''));
  const out = new Map<string, string[]>();
  if (keys.size === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from('transactions')
    .select('merchant_name, description, account_id')
    .lt('amount_yen', 0)
    .neq('review_status', 'ignored')
    .order('occurred_on', { ascending: false })
    .limit(500);
  for (const row of data ?? []) {
    const key = comparableKey((row.merchant_name ?? '').trim() || row.description);
    if (!keys.has(key) || row.account_id === null) continue;
    const list = out.get(key) ?? [];
    if (!list.includes(row.account_id)) list.push(row.account_id);
    out.set(key, list);
  }
  return out;
}

export async function guessAccounts(
  transactions: readonly ParsedReceiptTransaction[],
): Promise<Record<number, AccountGuess>> {
  const [accounts, fallback] = await Promise.all([
    listAccounts(),
    getOrCreateDefaultAccount().catch(() => null),
  ]);
  const storeOf = (t: ParsedReceiptTransaction) => t.storeName ?? t.description;
  const history = await storeAccountHistory(transactions.map(storeOf)).catch(
    () => new Map<string, string[]>(),
  );
  return Object.fromEntries(
    transactions.map((t, i) => [
      i,
      guessReceiptAccount({
        cardLast4: t.cardLast4 ?? null,
        accounts,
        storeHistory: history.get(comparableKey(storeOf(t))) ?? [],
        defaultAccountId: fallback?.id ?? accounts[0]?.id ?? null,
      }),
    ]),
  );
}

/** 全部読めたレシートを保存前として残し、行の id を返す。残さなかった・残せなかったら null。 */
export async function keepReadyReceipts(input: {
  imageBase64: string;
  transactions: readonly ParsedReceiptTransaction[];
  warnings: readonly string[];
  classifications: readonly ReceiptGenreGuess[];
  parentGenreIds: Readonly<Record<number, string>>;
}): Promise<{ readyIds: string[]; accountGuesses: Record<number, AccountGuess> } | null> {
  if (input.transactions.length === 0) return null;
  if (needsManualInput(judgeReadResult(input.transactions).receiptStatus)) return null;
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;
    const accountGuesses = await guessAccounts(input.transactions).catch(() => ({}));
    const uploaded = await uploadReceiptImage(
      supabase,
      auth.user.id,
      input.imageBase64,
      'image/jpeg',
    );
    if (uploaded.path === null) return null;
    const readyIds = await createReadyCaptures({
      imagePath: uploaded.path,
      payloads: splitReadResult({ ...input, accountGuesses }),
      capturedOn: todayJst(),
    });
    return { readyIds, accountGuesses };
  } catch {
    return null;
  }
}

/** 保存前のレシートを、読み直した結果に差し替える(「次の画像とつなげる」)。1件めだけを使う。 */
export async function replaceReadyReceipt(
  id: string,
  input: {
    transactions: readonly ParsedReceiptTransaction[];
    warnings: readonly string[];
    classifications: readonly ReceiptGenreGuess[];
    parentGenreIds: Readonly<Record<number, string>>;
  },
): Promise<Record<number, AccountGuess> | null> {
  if (input.transactions.length === 0) return null;
  try {
    const accountGuesses = await guessAccounts(input.transactions.slice(0, 1)).catch(() => ({}));
    const [payload] = splitReadResult({ ...input, accountGuesses });
    if (!payload) return null;
    await replaceReadyCapture(id, payload);
    return accountGuesses;
  } catch {
    return null;
  }
}
