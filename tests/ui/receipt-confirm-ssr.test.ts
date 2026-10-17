import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/(app)/transactions/actions', () => ({ checkReceiptDuplicatesAction: vi.fn() }));

import { ReceiptConfirm } from '../../app/(app)/transactions/receipt/receipt-confirm';
import { buildFromAiRows } from '@/features/import/receipt-ai';
import { newJob } from '@/features/import/receipt-queue';

const item = (name: string, amount_yen: number, confidence = 0.9) => ({
  name,
  amount_yen,
  product_type: '',
  tax_rate: 10,
  is_discount: false,
  confidence,
  y_ratio: 0.4,
});

function render(
  amount: number,
  goal: Parameters<typeof ReceiptConfirm>[0]['goal'],
  options: { accountId?: string; parentGenreId?: string } = {},
) {
  const parsed = buildFromAiRows([
    {
      occurred_on: '2026-09-29',
      amount_yen: amount,
      store_name: "TULLY'S COFFEE 梅田店",
      payment_method_text: '',
      items: [item("TULLY'S ラテ", 800, 0.5), item('サンドイッチ', 700)],
      expense_subtype: '',
      price_basis: 'tax_included',
      tax_8_yen: 0,
      tax_10_yen: 0,
      points_used_yen: 0,
      coupon_yen: 0,
      store_confidence: 0.4,
      date_confidence: 1,
      total_confidence: 1,
    },
  ]).transactions[0]!;
  const job = {
    ...newJob('j', 'blob:x', 0),
    status: 'ready' as const,
    parsed: [parsed],
    parentGenreIds: options.parentGenreId ? { 0: options.parentGenreId } : {},
  };
  return renderToString(
    h(ReceiptConfirm, {
      job,
      index: 0,
      genres: [{ id: 'cafe', name: 'カフェ・飲料' }],
      accountId: options.accountId ?? 'a',
      saving: false,
      savedLabel: null,
      goal,
      onSave: () => undefined,
      onDiscard: () => undefined,
    }),
  ).replace(/<!-- -->/g, '');
}

describe('レシート確認画面(サーバー描画のスモークテスト)', () => {
  it('要約・画像への入口・照合バー・低信頼の下線・一括変更のチップが出る', () => {
    const html = render(1500, null);
    expect(html).toContain('レシート画像を確認する');
    expect(html).toContain('一致しています');
    expect(html).toContain('カフェ・飲料'); // カテゴリのチップ
    expect(html).toContain('underline'); // 低信頼(店名 0.4・品目 0.5)の黄色の下線
    expect(html).toContain('標準税率 10%');
    expect(html).toContain('内税');
  });

  it('金額が合わなければ差額と修正候補を出し、目標があれば保存前 → 保存後の残り予算を出す', () => {
    const goal = {
      today: '2026-09-29',
      snapshot: {
        range: { from: '2026-09-29', to: '2026-10-05' },
        genres: [{ genreId: 'cafe', genreName: 'カフェ・飲料', targetYen: 5000, spentYen: 1000 }],
      },
    };
    const html = render(1200, goal);
    expect(html).toContain('差額');
    expect(html).toContain('値引き行を追加');
    expect(html).toContain('端数として調整');
    expect(html).toContain('目標への影響');
    // 品目がカフェ・飲料になっていない(未選択)ので、影響の行は出ない=クラッシュしないこと
    expect(html).toContain('明細のカテゴリ');
  });
});

describe('目標への確認と保存を一つの操作にする', () => {
  const snapshot = {
    range: { from: '2026-09-28', to: '2026-10-05' },
    genres: [{ genreId: 'cafe', genreName: 'カフェ・飲料', targetYen: 2000, spentYen: 0 }],
  };

  it('未来日は理由と影響を先に示し、主ボタンで確認して保存できる', () => {
    const html = render(1500, { today: '2026-09-28', snapshot }, { parentGenreId: 'cafe' });
    expect(html).toContain('今日より先の日付です');
    expect(html).toContain('目標に含めて保存');
    expect(html).toContain('今日より先の予定なので、目標のペースには含めません');
    expect(html).not.toContain('aria-label="目標の扱い"');
    expect(html.indexOf('今日より先の日付です')).toBeLessThan(
      html.indexOf('レシート画像を確認する'),
    );
  });

  it('高額かつ差額がある場合も、差額を残す機能と明示確認を一つにする', () => {
    const html = render(1200, { today: '2026-09-29', snapshot }, { parentGenreId: 'cafe' });
    expect(html).toContain('このカテゴリの目標の半分以上になる支払いです');
    expect(html).toContain('目標に含め、差額を残して保存');
    expect(html).toContain('修正候補へ');
    expect(html).toContain('値引き行を追加');
  });

  it('保存先がまだ無い場合は保存を実行できない', () => {
    const html = render(1500, null, { accountId: '' });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存する<\/button>/);
  });
});
