import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { MerchantNameReviewGroup } from '@/domain/merchant-name-review';

/**
 * 店名の表記ゆれを、右上の「AIでチェック」(はじめは「店名を整える」)からいつでも AI で探して直せる
 * (本人の要望、ADR-118 → 119 → 120)。
 */

const store = vi.hoisted(() => ({ scan: vi.fn() }));
vi.mock('@/features/transactions/merchant-name-store', () => ({
  scanMerchantNames: () => store.scan(),
}));
vi.mock('../../app/(app)/spending/merchant-name-actions', () => ({
  saveMerchantNameChangesAction: vi.fn(),
}));
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? h('div', { 'data-sheet': true }, children) : null,
  BottomSheetHeader: ({ children }: { children: React.ReactNode }) => h('div', null, children),
}));

import { POST } from '../../app/api/merchant-names/scan/route';
import { MerchantNameResults } from '../../app/(app)/spending/merchant-name-review';

const group: MerchantNameReviewGroup = {
  key: 'ai:0',
  label: 'ｾﾌﾞﾝｲﾚﾌﾞﾝ / SEVEN-ELEVEN',
  branchName: null,
  reasons: ['ai'],
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

describe('探す(api/merchant-names/scan、読むだけ)', () => {
  it('規則と AI で見つけたまとめを返す', async () => {
    store.scan.mockResolvedValueOnce({ groups: [group], warning: null });
    const response = await POST();
    expect(await response.json()).toEqual({ groups: [group], warning: null });
  });

  it('読めなければ理由を返す', async () => {
    store.scan.mockRejectedValueOnce(new Error('x'));
    const response = await POST();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBeTruthy();
  });

  it('サーバーアクションにしない(数十秒かかっても、明細のほかの読み込みを待たせない)', () => {
    const route = readFileSync('app/api/merchant-names/scan/route.ts', 'utf8');
    expect(route).toContain('export const maxDuration = 120;');
    expect(route).not.toContain("'use server'");
  });
});

describe('店名をまとめて直すのシート', () => {
  const render = (
    groups: readonly MerchantNameReviewGroup[] | null,
    extra: { error?: string | null; warning?: string | null } = {},
  ) => text(renderToStaticMarkup(h(MerchantNameResults, { groups, ...extra })));

  it('探しているあいだは、AI が見比べていると書く', () => {
    expect(render(null)).toContain('AIがすべての月の明細の店名を見比べています…');
  });

  it('AI が見つけたものは、そうと分かるように出す', () => {
    const found = render([group]);
    expect(found).toContain('確認が必要な店名 1件');
    expect(found).toContain('AIが見つけた表記ゆれ');
    expect(found).toContain('セブン-イレブン');
  });

  it('AI が使えなかったときは、規則で見つけた分だけだと書く', () => {
    expect(render([], { warning: 'AIの店名チェックは設定されていません。' })).toContain(
      '決まった規則で見つけたものだけを出しています。',
    );
  });

  it('見つからなければ「見つかりませんでした」', () => {
    expect(render([])).toContain('直す店名は見つかりませんでした');
  });
});

describe('入口(明細の右上「AIでチェック」)', () => {
  const menu = readFileSync('app/(app)/spending/ledger-selection-menu.tsx', 'utf8');
  const list = readFileSync('app/(app)/spending/ledger-list.tsx', 'utf8');
  const check = readFileSync('app/(app)/spending/ai-check.tsx', 'utf8');
  const filter = readFileSync('app/(app)/spending/filter-sheet.tsx', 'utf8');

  it('右上の「選択」の隣に、いつでも出す(選択中は出さない)', () => {
    expect(menu).toContain('AIでチェック');
    expect(menu).toContain('{onTidy && !selectMode ? (');
    expect(list).toContain('onTidy={check.start}');
    expect(list).toContain('useAiCheck(reloadVisibleMonth)');
  });

  it('分かりにくかった絞り込みの中の入口はやめた', () => {
    expect(filter).not.toContain('店名の表記ゆれを直す');
  });

  it('押すたびに探し直し、閉じたら探すのをやめる', () => {
    expect(check).toContain("fetch(url, { method: 'POST', signal })");
    expect(check).toContain("'/api/merchant-names/scan'");
    expect(check).toContain('aborter.current?.abort();');
  });
});
