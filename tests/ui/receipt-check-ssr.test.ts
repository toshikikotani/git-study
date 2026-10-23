import { createElement as h, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? h('div', { role: 'dialog' }, children) : null,
  BottomSheetHeader: ({ children }: { children: ReactNode }) => h('div', null, children),
}));
vi.mock('../../app/(app)/transactions/new/actions', () => ({
  fetchGenreChoicesAction: async () => ({ genres: [], recentIds: [] }),
}));

import { ReceiptCheck } from '../../app/(app)/transactions/receipt/receipt-check';
import { initialCheckState, type CheckState } from '@/features/import/receipt-check';
import { buildFromAiRows, type ExtractionRow } from '@/features/import/receipt-ai';
import { fromServer } from '@/features/import/unsaved-receipts';

/**
 * 直しやすい確認画面(v5 変更3、ADR-133):「要約を見て、違う行だけ押して直す」形。
 */
const row = (o: Partial<ExtractionRow> = {}): ExtractionRow => ({
  occurred_on: '2026-10-22',
  amount_yen: 700,
  store_name: 'スギ薬局',
  payment_method_text: '',
  items: [
    {
      name: 'プロテインバー',
      amount_yen: 200,
      product_type: '',
      tax_rate: 8,
      is_discount: false,
      confidence: 1,
      y_ratio: 0.4,
    },
    {
      name: 'シャンプー',
      amount_yen: 500,
      product_type: '',
      tax_rate: 10,
      is_discount: false,
      confidence: 1,
      y_ratio: 0.5,
    },
  ],
  expense_subtype: '',
  price_basis: 'tax_included',
  tax_8_yen: 0,
  tax_10_yen: 0,
  points_used_yen: 0,
  coupon_yen: 0,
  store_confidence: 1,
  date_confidence: 1,
  total_confidence: 1,
  ...o,
});
const receipt = (o: Partial<ExtractionRow> = {}, sure = true) =>
  fromServer({
    id: 'cap-1',
    imageUrl: 'https://example.test/r.jpg',
    imagePath: 'u/r.jpg',
    capturedOn: '2026-10-23',
    createdAt: '2026-10-23T01:00:00Z',
    parsed: buildFromAiRows([row(o)]).transactions[0]!,
    warnings: [],
    classifications: [
      { key: '0:0', genreId: 'food', confidence: sure ? 1 : 0.3, source: 'ai' },
      { key: '0:1', genreId: 'goods', confidence: 1, source: 'rule' },
    ],
    parentGenreId: null,
    accountGuess: { accountId: 'cash', confidence: 1, reason: 'card' },
  });

const visible = (html: string) => html.replace(/<!-- -->/g, '');
function render(r = receipt(), state?: CheckState) {
  return visible(
    renderToString(
      h(ReceiptCheck, {
        receipt: r,
        state: state ?? initialCheckState(r, 'cash'),
        onChange: () => {},
        ctx: { level: 'normal', goalRange: null },
        genres: [
          { id: 'food', name: '食料品' },
          { id: 'goods', name: '日用品' },
        ],
        accounts: [{ id: 'cash', name: '現金' }],
        goal: null,
        position: { index: 0, total: 2 },
        saving: false,
        duplicates: [],
        mergeChoice: null,
        onMergeChoice: () => {},
        onSave: () => {},
        onNext: () => {},
        onDiscard: () => {},
        onJoinNext: null,
        joining: false,
        toast: null,
      }),
    ),
  );
}

describe('上から順に', () => {
  const html = render();

  it('画像は高さ120ptほどの細長い帯。押すと全画面で拡大できる', () => {
    expect(html).toContain('h-[120px]');
    expect(html).toContain('aria-label="レシートの画像を大きく見る"');
  });

  it('要約の5行:お店・日付・合計・支払い・カテゴリ(左に項目名、右に値)', () => {
    const labels = ['お店', '日付', '合計', '支払い', 'カテゴリ'];
    const at = labels.map((l) => html.indexOf(`>${l}</span>`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('スギ薬局');
    expect(html).toContain('22日（木）');
    expect(html).toContain('700円');
    expect(html).toContain('現金');
  });

  it('合計の答え合わせは1行。品目は1行に品名・金額・カテゴリのマーク(税率ごとにまとめない)', () => {
    expect(html).toContain('品目の合計と合っています');
    expect(html).toContain('品目 2点');
    expect(html).not.toContain('軽減税率 8%');
    expect(html).toContain('選んで変える');
  });

  it('詳細はたたんでおく。下に固定の大きな「保存」と、ほかにもあれば「次へ」', () => {
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('詳細(税率・値引き・ポイント・割り勘・メモ)');
    expect(html).toContain('sticky bottom-0');
    expect(html).toMatch(/>保存<\/button>/);
    expect(html).toContain('>次へ</button>');
    expect(html).not.toContain('確かめること');
  });
});

describe('確かめることと保存', () => {
  it('必ず聞くが残っていると「保存」を押せない。問いのカードに画像のその部分を出す', () => {
    const html = render(receipt({}, false));
    expect(html).toContain('確かめること');
    expect(html).toContain('「プロテインバー」は');
    expect(html).toContain('ほかから選ぶ');
    expect(html).toContain('object-position:50% 40%');
    expect(html).toMatch(/disabled=""[^>]*>答えると保存できます/);
  });

  it('合計が合わないとき、どちらを直せばよいかが1行で分かる', () => {
    const html = render(receipt({ amount_yen: 820 }));
    expect(html).toContain('品目が120円足りません');
    expect(html).toContain('品目を足す');
    expect(html).toContain('合計を直す');
  });
});
