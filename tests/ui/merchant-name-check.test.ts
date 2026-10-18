import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { MerchantNameReviewGroup } from '@/domain/merchant-name-review';

/**
 * 店名の表記ゆれを、いつでも探して直せる(本人の要望「任意のタイミングで実行できるようにしたい」、ADR-118)。
 * 以前は明細を開いたときに候補があれば「確認が必要」に出るだけで、候補が無いと入口も無かった。
 */

const store = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/features/transactions/merchant-name-store', () => ({
  listMerchantNameReviewGroups: () => store.list(),
  saveMerchantNameChanges: (input: unknown) => store.save(input),
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => store.revalidate(path) }));
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? h('div', { 'data-sheet': true }, children) : null,
  BottomSheetHeader: ({ children }: { children: React.ReactNode }) => h('div', null, children),
}));

import { findMerchantNameGroupsAction } from '../../app/(app)/spending/merchant-name-actions';
import { MerchantNameReview } from '../../app/(app)/spending/merchant-name-review';

const group: MerchantNameReviewGroup = {
  key: 'k',
  label: 'ｾﾌﾞﾝｲﾚﾌﾞﾝ',
  branchName: null,
  reasons: ['normalization'],
  suggestedName: 'セブン-イレブン',
  suggestedBranch: null,
  entries: [
    {
      id: '00000000-0000-0000-0000-000000000001',
      merchantName: 'ｾﾌﾞﾝｲﾚﾌﾞﾝ',
      description: 'ｾﾌﾞﾝｲﾚﾌﾞﾝ',
      branchName: null,
      updatedAt: '2026-10-18T00:00:00Z',
      occurredOn: '2026-10-17',
      amountYen: -500,
    },
  ],
};

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('いつでも探す(読むだけ、ADR-118)', () => {
  it('すべての月の明細から候補を探して返す。何も書き換えない', async () => {
    store.list.mockResolvedValueOnce([group]);
    await expect(findMerchantNameGroupsAction()).resolves.toEqual({ groups: [group], error: null });
    expect(store.save).not.toHaveBeenCalled();
    expect(store.revalidate).not.toHaveBeenCalled();
  });

  it('読めなければ理由を返す(画面は止めない)', async () => {
    store.list.mockRejectedValueOnce(new Error('x'));
    const result = await findMerchantNameGroupsAction();
    expect(result.groups).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

describe('店名をまとめて直すのシート', () => {
  const render = (groups: readonly MerchantNameReviewGroup[] | null, error: string | null = null) =>
    text(
      renderToStaticMarkup(h(MerchantNameReview, { open: true, groups, error, onClose: () => {} })),
    );

  it('探しているあいだは、そう書く', () => {
    expect(render(null)).toContain('すべての月の明細から、店名の表記ゆれを探しています…');
  });

  it('見つからなければ、何を探したかと一緒に「見つかりませんでした」', () => {
    const empty = render([]);
    expect(empty).toContain('直す店名は見つかりませんでした');
    expect(empty).toContain(
      '表記のゆれ・店名なし・住所のような店名を、すべての月の明細から探しました。',
    );
    expect(empty).not.toContain('店名の確認が終わりました');
  });

  it('見つかれば件数と候補を出す', () => {
    const found = render([group]);
    expect(found).toContain('確認が必要な店名 1件');
    expect(found).toContain('セブン-イレブン');
  });

  it('読めなければ理由を出す', () => {
    expect(render([], '店名の確認を読み込めませんでした。')).toContain(
      '店名の確認を読み込めませんでした。',
    );
  });
});

describe('入口(明細の絞り込みの「整える」)', () => {
  const sheet = readFileSync('app/(app)/spending/filter-sheet.tsx', 'utf8');
  const review = readFileSync('app/(app)/spending/merchant-name-review.tsx', 'utf8');

  it('候補が無くても、いつでも押せる。押すと絞り込みを閉じて探し始める', () => {
    expect(sheet).toContain('<Group label="整える">');
    expect(sheet).toContain('店名の表記ゆれを直す');
    expect(sheet).toMatch(/setOpen\(false\);\s*names\.start\(\);/);
    expect(sheet).toContain('{names.sheet}');
  });

  it('開くたびに探し直し、直したら明細を読み直す', () => {
    expect(review).toMatch(/const start = \(\) => \{[\s\S]*findMerchantNameGroupsAction\(\)/);
    expect(sheet).toContain('useMerchantNameCheck(reloadVisibleMonth)');
  });
});
