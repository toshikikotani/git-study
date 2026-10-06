import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockClient, type MockResult } from '../../helpers/supabase-mock';

let tables: Record<string, MockResult> = {};
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    ...mockClient(tables),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: 'https://s/x' }, error: null }),
      }),
    },
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  }),
}));

import { discardCapture, listOpenCaptures } from '@/features/receipt-captures/store';

beforeEach(() => {
  tables = {};
});

describe('入力待ちのデータアクセス', () => {
  it('テーブルが未適用の間は、一覧は空(家計簿の画面は落とさない)', async () => {
    tables.receipt_captures = { data: null, error: { code: 'PGRST205', message: 'no table' } };
    expect(await listOpenCaptures()).toEqual([]);
  });

  it('一覧は署名付きの画像URLと、読めた項目・読めなかった項目・下書きを返す', async () => {
    tables.receipt_captures = {
      data: [
        {
          id: 'c1',
          status: 'needs_input',
          receipt_status: 'partial',
          image_path: 'u1/a.jpg',
          edited_image_path: null,
          ocr_raw: { warnings: ['薄い'] },
          read_fields: { amountYen: 980, storeName: 'ローソン' },
          unread_fields: ['occurredOn', 'bogus'],
          draft: null,
          captured_on: '2026-09-29',
        },
      ],
      error: null,
    };
    const [c] = await listOpenCaptures();
    expect(c).toMatchObject({
      id: 'c1',
      receiptStatus: 'partial',
      imageUrl: 'https://s/x',
      readFields: { amountYen: 980, storeName: 'ローソン' },
      unreadFields: ['occurredOn'],
      ocrWarnings: ['薄い'],
      draft: null,
    });
  });

  it('破棄の書き込みは、テーブル未適用なら「まだ使えません」を返す(黙って成功にしない)', async () => {
    tables.receipt_captures = { data: null, error: { code: 'PGRST205', message: 'no table' } };
    await expect(discardCapture('c1')).rejects.toThrow('まだ使えません');
  });
});
