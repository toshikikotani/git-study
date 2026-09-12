/**
 * 列マッピング(import_adapters)の保存・再利用(T-6, T-9)。
 *
 * `ImportAdapter`(TS、CSV解析の設定値)と `import_adapters`(DB)の対応を
 * ここに集約する。DB 側の列名・型が変わればこのファイルの変換がコンパイル
 * エラーになるため、2箇所を手で揃え続ける必要がなくなる(T-6)。
 *
 * 1口座につき1件だけ保持する(同じ口座は毎回同じ形式の CSV という前提。
 * ADR-007 の名前付きアダプタと違い、本人が選んだ列対応をそのまま
 * 上書き保存するだけの単純な仕組みにしてある)。DB に一意制約は無いため、
 * 既存行の有無を先に確認してから insert/update を分ける
 * (M7-2 の upsertInvestmentSnapshot() と同じ、単一ユーザーのアプリでは
 * TOCTOU の実害が無いという判断)。
 */

import { GENERIC_ADAPTER, type AmountSign, type ImportAdapter } from '@/features/import/adapters';
import type { CsvEncoding } from '@/features/import/encoding';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export class ImportAdapterStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportAdapterStoreError';
  }
}

type ImportAdapterRow = Database['public']['Tables']['import_adapters']['Row'];

function fromRow(row: ImportAdapterRow): ImportAdapter {
  return {
    name: row.name,
    encoding: row.encoding as CsvEncoding,
    delimiter: row.delimiter,
    skipRows: row.skip_rows,
    hasHeader: row.has_header,
    dateColumn: row.date_column,
    descriptionColumn: row.description_column,
    amountColumn: row.amount_column ?? undefined,
    amountOutColumn: row.amount_out_column ?? undefined,
    amountInColumn: row.amount_in_column ?? undefined,
    balanceColumn: row.balance_column ?? undefined,
    paymentMethodColumn: row.payment_method_column ?? undefined,
    amountSign: row.amount_sign as AmountSign,
    dateFormats: row.date_formats,
  };
}

/**
 * 口座に紐づく保存済みマッピングを1件返す。保存が無ければ null
 * (呼び出し側は `guessMapping()` にフォールバックする、T-9)。
 */
export async function getImportAdapterForAccount(accountId: string): Promise<ImportAdapter | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('import_adapters')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new ImportAdapterStoreError(`保存済みの列対応を取得できませんでした: ${error.message}`);
  }
  return data ? fromRow(data) : null;
}

/** 口座に紐づくマッピングを保存する(既存があれば上書き)。 */
export async function saveImportAdapterForAccount(
  accountId: string,
  adapter: ImportAdapter,
): Promise<void> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new ImportAdapterStoreError('ログイン状態を確認できませんでした');
  }

  const row = {
    user_id: auth.user.id,
    account_id: accountId,
    name: adapter.name || GENERIC_ADAPTER.name,
    encoding: adapter.encoding,
    delimiter: adapter.delimiter,
    skip_rows: adapter.skipRows,
    has_header: adapter.hasHeader,
    date_column: adapter.dateColumn,
    description_column: adapter.descriptionColumn,
    amount_column: adapter.amountColumn ?? null,
    amount_out_column: adapter.amountOutColumn ?? null,
    amount_in_column: adapter.amountInColumn ?? null,
    balance_column: adapter.balanceColumn ?? null,
    payment_method_column: adapter.paymentMethodColumn ?? null,
    amount_sign: adapter.amountSign,
    date_formats: [...adapter.dateFormats],
  };

  const { data: existing, error: existingError } = await supabase
    .from('import_adapters')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (existingError) {
    throw new ImportAdapterStoreError(
      `既存の列対応を確認できませんでした: ${existingError.message}`,
    );
  }

  if (existing) {
    const { error } = await supabase.from('import_adapters').update(row).eq('id', existing.id);
    if (error) throw new ImportAdapterStoreError(`列対応を更新できませんでした: ${error.message}`);
  } else {
    const { error } = await supabase.from('import_adapters').insert(row);
    if (error) throw new ImportAdapterStoreError(`列対応を保存できませんでした: ${error.message}`);
  }
}
