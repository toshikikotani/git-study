/**
 * Google スプレッドシートへの月次バックアップ(本人発案)。
 *
 * ── いつ動くか ──────────────────────────────────────────────
 * 月末だけ(P6-3 の net_worth_snapshots と同じ isLastDayOfMonth() 判定)。
 * 月の途中で何度呼ばれても書き込みは月末の1回だけ。
 *
 * ── バックアップ先の管理 ────────────────────────────────────
 * 初回だけ新しいスプレッドシートを作り、その id を
 * `app_settings.google_backup_spreadsheet_id`(参照名、秘密情報ではない
 * ためDBに置いてよい、ADR-014)に記録する。以降は同じシートへ、月ごとに
 * 新しいタブ(例 "2026-09")を足していく。
 *
 * ── マイグレーション未適用のときの振る舞い ───────────────────
 * この列は本番へ適用手段がこのセッションに無い(B-7/B-9 と同種の制約)。
 * 列が無いあいだは id を覚えられないため、**バックアップ自体を諦める**
 * (P9-3 の receipt_image_path と違い、ここは「保存できないだけ」では済ま
 * ない——id を持てないまま実行すると、毎月末に新しいスプレッドシートを
 * 際限なく作り続けてしまう。それよりは何もしない方が安全)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { isLastDayOfMonth } from '@/domain/alerts';
import { addDays, monthStartJst, todayJst } from '@/lib/date';
import type { GoogleEnv } from '@/lib/env';
import { refreshGoogleAccessToken } from '@/lib/google-auth';
import { createSpreadsheet, ensureSheetTab, writeSheetValues } from '@/lib/google-sheets';
import type { Database } from '@/lib/supabase/types';

export class GoogleSheetsBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsBackupError';
  }
}

const BACKUP_SPREADSHEET_TITLE = '家計簿バックアップ';
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204', 'PGRST205']);

export type BackupResult =
  | { backedUp: true; spreadsheetUrl: string }
  | { backedUp: false; reason: 'not_last_day_of_month' | 'schema_not_migrated' };

/** 月末に、その月の明細をスプレッドシートへ書き出す(cron 向け、管理クライアント版)。 */
export async function backupTransactionsToSheetAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  google: GoogleEnv,
  now: Date = new Date(),
): Promise<BackupResult> {
  const today = todayJst(now);
  if (!isLastDayOfMonth(today, addDays(today, 1))) {
    return { backedUp: false, reason: 'not_last_day_of_month' };
  }

  const existingId = await loadBackupSpreadsheetId(client, userId);
  if (existingId === 'schema_not_migrated') {
    return { backedUp: false, reason: 'schema_not_migrated' };
  }

  const accessToken = await refreshGoogleAccessToken(
    google.GOOGLE_CLIENT_ID,
    google.GOOGLE_CLIENT_SECRET,
    google.GOOGLE_REFRESH_TOKEN,
  );

  let spreadsheetId = existingId;
  let spreadsheetUrl = existingId ? spreadsheetUrlFor(existingId) : '';
  if (!spreadsheetId) {
    const created = await createSpreadsheet(accessToken, BACKUP_SPREADSHEET_TITLE);
    spreadsheetId = created.spreadsheetId;
    spreadsheetUrl = created.url;
    await saveBackupSpreadsheetId(client, userId, spreadsheetId);
  }

  const tabTitle = today.slice(0, 7); // YYYY-MM
  await ensureSheetTab(accessToken, spreadsheetId, tabTitle);

  const rows = await loadMonthTransactionRows(client, userId, now);
  await writeSheetValues(accessToken, spreadsheetId, `${tabTitle}!A1`, rows);

  return { backedUp: true, spreadsheetUrl };
}

function spreadsheetUrlFor(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}

async function loadBackupSpreadsheetId(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<string | null | 'schema_not_migrated'> {
  const { data, error } = await client
    .from('app_settings')
    .select('google_backup_spreadsheet_id')
    .eq('user_id', userId)
    .single();
  if (error) {
    if (MISSING_COLUMN_CODES.has(error.code)) return 'schema_not_migrated';
    throw new GoogleSheetsBackupError(`設定を取得できませんでした: ${error.message}`);
  }
  return data.google_backup_spreadsheet_id;
}

async function saveBackupSpreadsheetId(
  client: SupabaseClient<Database>,
  userId: string,
  spreadsheetId: string,
): Promise<void> {
  const { error } = await client
    .from('app_settings')
    .update({ google_backup_spreadsheet_id: spreadsheetId })
    .eq('user_id', userId);
  // 直前の読み取りで列の存在は確認済みのため、ここで失敗するのは本当の異常のみ。
  if (error) {
    throw new GoogleSheetsBackupError(`バックアップ先の記録に失敗しました: ${error.message}`);
  }
}

async function loadMonthTransactionRows(
  client: SupabaseClient<Database>,
  userId: string,
  now: Date,
): Promise<(string | number)[][]> {
  const monthStart = monthStartJst(0, now);

  const [
    { data: rows, error },
    { data: categories, error: categoriesError },
    { data: accounts, error: accountsError },
  ] = await Promise.all([
    client
      .from('transactions')
      .select(
        'occurred_on, description, merchant_name, amount_yen, category_id, account_id, review_status',
      )
      .eq('user_id', userId)
      .gte('occurred_on', monthStart)
      .order('occurred_on', { ascending: true }),
    client.from('categories').select('id, name').eq('user_id', userId),
    client.from('accounts').select('id, name').eq('user_id', userId),
  ]);
  if (error) throw new GoogleSheetsBackupError(`明細を取得できませんでした: ${error.message}`);
  if (categoriesError) {
    throw new GoogleSheetsBackupError(`カテゴリを取得できませんでした: ${categoriesError.message}`);
  }
  if (accountsError) {
    throw new GoogleSheetsBackupError(`口座を取得できませんでした: ${accountsError.message}`);
  }

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  const header = ['日付', '摘要', '金額', 'カテゴリ', '口座', '状態'];
  const dataRows = rows.map((row) => [
    row.occurred_on,
    row.merchant_name ?? row.description,
    row.amount_yen,
    row.category_id ? (categoryNameById.get(row.category_id) ?? '') : '未分類',
    accountNameById.get(row.account_id) ?? '',
    row.review_status,
  ]);

  // 集計を除外する review_status='ignored' もそのまま含める(バックアップは
  // 生データの保管が目的で、家計簿としての集計とは別の関心事のため。
  // 予算・レポート側の isCountable() はここでは使わない)。
  return [header, ...dataRows];
}
