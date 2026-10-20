import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pending = vi.hoisted(() => ({ input: vi.fn(), review: vi.fn() }));
vi.mock('@/features/home/pending', () => ({
  needsInputSummary: () => pending.input(),
  countPendingReview: () => pending.review(),
}));
const { HomeBanners } = await import('../../app/(app)/_home/home-banners');

beforeEach(() => {
  pending.input.mockResolvedValue({ count: 0, firstId: null });
  pending.review.mockResolvedValue(0);
});

describe('未処理バナーから対象へ進む', () => {
  it('入力待ちが1件ならレシートを直接開き、次の入力待ちへ戻れる', async () => {
    pending.input.mockResolvedValue({ count: 1, firstId: 'capture-one' });
    const html = renderToString(await HomeBanners());
    expect(html).toContain(
      'href="/transactions/receipt/capture-one?returnTo=%2Fspending%2Freview"',
    );
  });

  it('複数の入力待ちとカテゴリ確認は、種類別の全月一覧へ進む', async () => {
    pending.input.mockResolvedValue({ count: 2, firstId: 'capture-one' });
    pending.review.mockResolvedValue(3);
    const html = renderToString(h('main', null, await HomeBanners()));
    // 入力待ちもカテゴリの確認も「確認が必要」の画面にまとめた(ADR-127)。
    expect(html.match(/href="\/spending\/review"/g)).toHaveLength(2);
    expect(html).not.toContain('href="/spending"');
  });
});
