import { describe, expect, it, vi } from 'vitest';

import { uploadReceiptImage, createReceiptImageSignedUrl } from '@/features/import/receipt-storage';

/**
 * レシート画像の保存(本人発案)。実際の Storage には触れず、
 * SupabaseClient.storage の呼び方だけを検証する(splits-store.test.ts と
 * 同じ考え方: 失敗を例外にせず、呼び出し側が扱える形で返すこと)。
 */

function fakeClient(overrides: {
  upload?: ReturnType<typeof vi.fn>;
  createSignedUrl?: ReturnType<typeof vi.fn>;
}) {
  return {
    storage: {
      from: vi.fn().mockReturnValue({
        upload: overrides.upload ?? vi.fn(),
        createSignedUrl: overrides.createSignedUrl ?? vi.fn(),
      }),
    },
  } as never;
}

describe('uploadReceiptImage', () => {
  it('本人の user_id をフォルダにした一意なパスへ保存する', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const client = fakeClient({ upload });

    const result = await uploadReceiptImage(client, 'user-1', 'aGVsbG8=', 'image/jpeg');

    expect(result.error).toBeNull();
    expect(result.path).toMatch(/^user-1\/[0-9a-f-]{36}\.jpg$/);
    expect(upload).toHaveBeenCalledTimes(1);
    const [calledPath, , options] = upload.mock.calls[0]!;
    expect(calledPath).toBe(result.path);
    expect(options).toMatchObject({ contentType: 'image/jpeg', upsert: false });
  });

  it('拡張子はメディアタイプに対応する', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const client = fakeClient({ upload });

    const result = await uploadReceiptImage(client, 'user-1', 'aGVsbG8=', 'image/png');
    expect(result.path).toMatch(/\.png$/);
  });

  it('保存に失敗しても例外を投げず、理由を返す', async () => {
    const upload = vi.fn().mockResolvedValue({ error: { message: '容量制限を超えました' } });
    const client = fakeClient({ upload });

    const result = await uploadReceiptImage(client, 'user-1', 'aGVsbG8=', 'image/jpeg');
    expect(result.path).toBeNull();
    expect(result.error).toMatch(/容量制限/);
  });
});

describe('createReceiptImageSignedUrl', () => {
  it('署名URLを返す', async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://example.test/signed' }, error: null });
    const client = fakeClient({ createSignedUrl });

    const url = await createReceiptImageSignedUrl(client, 'user-1/abc.jpg');
    expect(url).toBe('https://example.test/signed');
  });

  it('失敗したら例外を投げず null を返す', async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'not found' } });
    const client = fakeClient({ createSignedUrl });

    const url = await createReceiptImageSignedUrl(client, 'user-1/missing.jpg');
    expect(url).toBeNull();
  });
});
