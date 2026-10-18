import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ReceiptCheckGroup } from '@/domain/receipt-check';

/**
 * レシートの品目の読み取りミスを、右上の「AIでチェック」で店名と一緒に探して直せる
 * (本人の要望「明細のレシート内容もできたらチェックして」、ADR-120)。
 */

const store = vi.hoisted(() => ({ scan: vi.fn() }));
vi.mock('@/features/receipts/receipt-check-store', () => ({ scanReceipts: () => store.scan() }));
vi.mock('../../app/(app)/spending/receipt-check-actions', () => ({
  saveReceiptItemFixAction: vi.fn(),
}));
vi.mock('../../app/(app)/transactions/actions', () => ({ replaceReceiptItemsAction: vi.fn() }));
vi.mock('../../app/(app)/spending/merchant-name-actions', () => ({
  saveMerchantNameChangesAction: vi.fn(),
}));
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? h('div', { 'data-sheet': true }, children) : null,
  BottomSheetHeader: ({ children }: { children: React.ReactNode }) => h('div', null, children),
}));

import { POST } from '../../app/api/receipts/check/route';
import { AiCheckSheet } from '../../app/(app)/spending/ai-check';
import { describeReceiptFix, ReceiptCheckResults } from '../../app/(app)/spending/receipt-check';

const group: ReceiptCheckGroup = {
  entry: {
    transactionId: 'tx-1',
    occurredOn: '2026-10-17',
    amountYen: -300,
    storeName: 'ライフ',
    reconcileDiffYen: null,
    items: [
      { id: 'i-0', name: '牛孚L', amountYen: -100, genreId: null, productType: null },
      { id: 'i-1', name: 'パン', amountYen: -50, genreId: null, productType: null },
      { id: 'i-2', name: '小計', amountYen: -150, genreId: null, productType: null },
    ],
  },
  fixes: [
    {
      key: 'ai:0',
      transactionId: 'tx-1',
      itemId: 'i-0',
      kind: 'rename',
      name: '牛乳',
      amountYen: null,
      reason: '文字の読み違いのようです',
      source: 'ai',
    },
    {
      key: 'rule:2',
      transactionId: 'tx-1',
      itemId: 'i-2',
      kind: 'remove',
      name: null,
      amountYen: null,
      reason: '品目ではない行(小計・お預り・税など)のようです',
      source: 'rule',
    },
  ],
};

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const render = (
  groups: readonly ReceiptCheckGroup[] | null,
  extra: { error?: string | null; warning?: string | null } = {},
) => text(renderToStaticMarkup(h(ReceiptCheckResults, { groups, ...extra })));

describe('探す(api/receipts/check、読むだけ)', () => {
  it('規則と AI で見つけた候補を返す', async () => {
    store.scan.mockResolvedValueOnce({ groups: [group], warning: null });
    expect(await (await POST()).json()).toEqual({ groups: [group], warning: null });
  });

  it('読めなければ理由を返す', async () => {
    store.scan.mockRejectedValueOnce(new Error('x'));
    const response = await POST();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBeTruthy();
  });

  it('サーバーアクションにしない(数十秒かかっても、ほかの操作を待たせない)', () => {
    const route = readFileSync('app/api/receipts/check/route.ts', 'utf8');
    expect(route).toContain('export const maxDuration = 120;');
    expect(route).not.toContain("'use server'");
  });
});

describe('レシートの品目の欄', () => {
  it('探しているあいだは、AI が読み直していると書く', () => {
    expect(render(null)).toContain('AIが最近のレシートの品目を読み直しています…');
  });

  it('候補を、今の品目と並べて書き、直したあとの品目を見せる(支払額に配り直す)', () => {
    const found = render([group]);
    expect(found).toContain('確認が必要なレシート 1件');
    expect(found).toContain('ライフ');
    expect(found).toContain('「牛孚L」→「牛乳」');
    expect(found).toContain('「小計」の行を消す');
    expect(found).toContain('直したあとの品目');
    expect(found).toContain('支払額 300円 に合わせて、金額を配り直しています。');
    expect(found).toContain('選んだ2件を直して保存');
    expect(found).toContain('候補は自動では保存されません。');
  });

  it('金額の直しは、今の金額と新しい金額を並べる', () => {
    expect(
      describeReceiptFix(
        { ...group.fixes[0]!, kind: 'amount', name: null, amountYen: 150 },
        group.entry.items[0],
      ),
    ).toBe('「牛孚L」 100円 → 150円');
  });

  it('AI が使えなかったときは、規則で見つけた分だけだと書く', () => {
    expect(render([], { warning: 'AIのレシートチェックは設定されていません。' })).toContain(
      '決まった規則で見つけたもの(小計・お預りなどの行)だけを出しています。',
    );
  });

  it('見つからなければ「見つかりませんでした」', () => {
    expect(render([])).toContain('読み取りミスは見つかりませんでした');
  });
});

describe('AIでチェックのシート', () => {
  it('店名とレシートの品目を1つのシートで、別々に出す(片方が遅くても先に出す)', () => {
    const sheet = text(
      renderToStaticMarkup(
        h(AiCheckSheet, {
          open: true,
          names: { groups: [], error: null, warning: null },
          receipts: { groups: null, error: null, warning: null },
          onClose: () => {},
        }),
      ),
    );
    expect(sheet).toContain('AIでチェック');
    expect(sheet).toContain('店名');
    expect(sheet).toContain('直す店名は見つかりませんでした');
    expect(sheet).toContain('レシートの品目');
    expect(sheet).toContain('AIが最近のレシートの品目を読み直しています…');
  });

  it('押すたびに両方を同時に探し直す', () => {
    const check = readFileSync('app/(app)/spending/ai-check.tsx', 'utf8');
    expect(check).toContain("'/api/merchant-names/scan'");
    expect(check).toContain("'/api/receipts/check'");
  });
});
