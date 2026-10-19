import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('許可された写真の一時プレビュー', () => {
  it('明示的に追加した画像だけを表示し、同一Fileを重複保持しない', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const { rememberPhotos, useRecentPhotos } = await import('@/features/import/recent-photos');
    expect(useRecentPhotos()).toEqual([]);
    const file = new File(['image'], 'receipt.jpg', { type: 'image/jpeg' });
    rememberPhotos([file, file]);
    expect(useRecentPhotos()).toHaveLength(1);
    expect(useRecentPhotos()[0]?.file).toBe(file);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
  it('12枚を超えた古い画像のObject URLを解放する', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => `blob:${(blob as File).name}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { rememberPhotos, useRecentPhotos } = await import('@/features/import/recent-photos');
    const files = Array.from(
      { length: 13 },
      (_, i) => new File(['image'], `${i}.jpg`, { type: 'image/jpeg' }),
    );
    rememberPhotos(files);
    expect(useRecentPhotos()).toHaveLength(12);
    expect(useRecentPhotos()[0]?.file.name).toBe('12.jpg');
    expect(revoke).toHaveBeenCalledWith('blob:0.jpg');
  });
});
