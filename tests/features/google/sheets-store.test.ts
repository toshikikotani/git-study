import { describe, expect, it, vi } from 'vitest';

import { backupTransactionsToSheetAsAdmin } from '@/features/google/sheets-store';

/**
 * Googleスプレッドシートへの月次バックアップ(本人発案)。実際の Supabase/Google
 * API には触れず、呼び方だけを検証する(receipt-storage.test.ts と同じ考え方)。
 * 特に「列が無いあいだは新規作成を試みない」(sheets-store.ts 冒頭のコメント参照)
 * ことを最優先で確認する: 誤ればスプレッドシートが毎月末に増殖してしまう。
 */

vi.mock('@/lib/google-auth', () => ({
  refreshGoogleAccessToken: vi.fn().mockResolvedValue('fake-access-token'),
}));

vi.mock('@/lib/google-sheets', () => ({
  createSpreadsheet: vi.fn(),
  ensureSheetTab: vi.fn().mockResolvedValue(undefined),
  writeSheetValues: vi.fn().mockResolvedValue(undefined),
}));

const google = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REFRESH_TOKEN: 'refresh-token',
};

const LAST_DAY_OF_MONTH = new Date('2026-09-30T03:00:00Z'); // JST 12:00、月末
const MID_MONTH = new Date('2026-09-15T03:00:00Z');

type TableResponses = {
  app_settings?: { data?: unknown; error?: { code?: string; message: string } | null };
  transactions?: { data?: unknown[]; error?: { message: string } | null };
  categories?: { data?: unknown[]; error?: { message: string } | null };
  accounts?: { data?: unknown[]; error?: { message: string } | null };
};

function fakeClient(responses: TableResponses, updateSpy?: (payload: unknown) => void) {
  const from = vi.fn((table: string) => {
    if (table === 'app_settings') {
      const settingsResponse = responses.app_settings ?? {
        data: { google_backup_spreadsheet_id: null },
      };
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(settingsResponse),
          }),
        }),
        update: (payload: unknown) => {
          updateSpy?.(payload);
          return { eq: vi.fn().mockResolvedValue({ error: null }) };
        },
      };
    }
    if (table === 'transactions') {
      const response = responses.transactions ?? { data: [] };
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue(response),
            }),
          }),
        }),
      };
    }
    if (table === 'categories') {
      const response = responses.categories ?? { data: [] };
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue(response) }) };
    }
    if (table === 'accounts') {
      const response = responses.accounts ?? { data: [] };
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue(response) }) };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return { from } as never;
}

describe('backupTransactionsToSheetAsAdmin', () => {
  it('月末以外は何もしない', async () => {
    const client = fakeClient({});
    const result = await backupTransactionsToSheetAsAdmin(client, 'user-1', google, MID_MONTH);
    expect(result).toEqual({ backedUp: false, reason: 'not_last_day_of_month' });
  });

  it('列が無い(未マイグレーション)ならバックアップ自体を諦める(新規作成を試みない)', async () => {
    const { createSpreadsheet } = await import('@/lib/google-sheets');
    const client = fakeClient({
      app_settings: { data: null, error: { code: 'PGRST205', message: 'column not found' } },
    });

    const result = await backupTransactionsToSheetAsAdmin(
      client,
      'user-1',
      google,
      LAST_DAY_OF_MONTH,
    );

    expect(result).toEqual({ backedUp: false, reason: 'schema_not_migrated' });
    expect(createSpreadsheet).not.toHaveBeenCalled();
  });

  it('スプレッドシート未作成なら新規作成してidを保存する', async () => {
    const { createSpreadsheet, ensureSheetTab, writeSheetValues } =
      await import('@/lib/google-sheets');
    vi.mocked(createSpreadsheet).mockResolvedValueOnce({
      spreadsheetId: 'sheet-123',
      url: 'https://docs.google.com/spreadsheets/d/sheet-123',
    });
    const updateSpy = vi.fn();
    const client = fakeClient(
      {
        app_settings: { data: { google_backup_spreadsheet_id: null } },
        transactions: {
          data: [
            {
              occurred_on: '2026-09-05',
              description: 'コンビニ',
              merchant_name: null,
              amount_yen: 500,
              category_id: null,
              account_id: 'acc-1',
              review_status: 'confirmed',
            },
          ],
        },
        accounts: { data: [{ id: 'acc-1', name: '銀行' }] },
      },
      updateSpy,
    );

    const result = await backupTransactionsToSheetAsAdmin(
      client,
      'user-1',
      google,
      LAST_DAY_OF_MONTH,
    );

    expect(result).toEqual({
      backedUp: true,
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-123',
    });
    expect(createSpreadsheet).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({ google_backup_spreadsheet_id: 'sheet-123' });
    expect(ensureSheetTab).toHaveBeenCalledWith('fake-access-token', 'sheet-123', '2026-09');
    expect(writeSheetValues).toHaveBeenCalledWith(
      'fake-access-token',
      'sheet-123',
      '2026-09!A1',
      expect.arrayContaining([
        ['日付', '摘要', '金額', 'カテゴリ', '口座', '状態'],
        ['2026-09-05', 'コンビニ', 500, '未分類', '銀行', 'confirmed'],
      ]),
    );
  });

  it('スプレッドシート作成済みなら再作成せず既存のidへ書き込む', async () => {
    const { createSpreadsheet } = await import('@/lib/google-sheets');
    const client = fakeClient({
      app_settings: { data: { google_backup_spreadsheet_id: 'existing-sheet' } },
    });

    const result = await backupTransactionsToSheetAsAdmin(
      client,
      'user-1',
      google,
      LAST_DAY_OF_MONTH,
    );

    expect(createSpreadsheet).not.toHaveBeenCalled();
    expect(result).toEqual({
      backedUp: true,
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/existing-sheet',
    });
  });
});
