/**
 * Google スプレッドシート API のクライアント(本人発案:月次バックアップ)。
 *
 * 「何を書き出すか」の業務判断は features/google/sheets-store.ts が持つ。
 * ここは Sheets API を叩くだけ(lib/discord.ts と同じ役割分担)。
 */

import { AppError } from '@/lib/errors';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export class GoogleSheetsError extends AppError {}

export type CreatedSpreadsheet = { spreadsheetId: string; url: string };

/** 新しいスプレッドシートを作る(バックアップ先を初回だけ用意する)。 */
export async function createSpreadsheet(
  accessToken: string,
  title: string,
): Promise<CreatedSpreadsheet> {
  const response = await sheetsFetch(accessToken, '', {
    method: 'POST',
    body: JSON.stringify({ properties: { title } }),
  });
  if (!response.ok) throw new GoogleSheetsError(await describeError(response));

  const json = (await response.json()) as { spreadsheetId: string; spreadsheetUrl: string };
  return { spreadsheetId: json.spreadsheetId, url: json.spreadsheetUrl };
}

/** 指定した名前のタブ(シート)が無ければ追加する(月ごとに1タブ)。 */
export async function ensureSheetTab(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
): Promise<void> {
  const getRes = await sheetsFetch(
    accessToken,
    `/${spreadsheetId}?fields=sheets.properties.title`,
    { method: 'GET' },
  );
  if (!getRes.ok) throw new GoogleSheetsError(await describeError(getRes));

  const json = (await getRes.json()) as { sheets?: { properties: { title: string } }[] };
  const exists = (json.sheets ?? []).some((s) => s.properties.title === tabTitle);
  if (exists) return;

  const addRes = await sheetsFetch(accessToken, `/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabTitle } } }] }),
  });
  if (!addRes.ok) throw new GoogleSheetsError(await describeError(addRes));
}

/** 指定した範囲(例 "2026-09!A1")へ値を書き込む(既存の内容は上書き)。 */
export async function writeSheetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: readonly (string | number)[][],
): Promise<void> {
  const response = await sheetsFetch(
    accessToken,
    `/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ values }) },
  );
  if (!response.ok) throw new GoogleSheetsError(await describeError(response));
}

function sheetsFetch(accessToken: string, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${SHEETS_API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
  });
}

async function describeError(response: Response): Promise<string> {
  const detail = await response.text().catch(() => '');
  return `Google スプレッドシートへの書き込みに失敗しました(ステータス ${response.status}): ${detail}`;
}
