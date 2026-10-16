import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('../../app/(app)/category-sheet-actions', () => ({
  loadCategorySheetAction: vi.fn(),
  saveCategoryTargetAction: vi.fn(),
}));
vi.mock('../../app/(app)/spending/category/actions', () => ({
  setCategoryFixedAction: vi.fn(),
  setCategoryShowOnHomeAction: vi.fn(),
  createCategoryAction: vi.fn(),
}));
vi.mock('../../app/(app)/transactions/actions', () => ({
  saveImportBatchAction: vi.fn(),
  undoReceiptSaveAction: vi.fn(),
}));
vi.mock('../../app/(app)/transactions/new/actions', () => ({
  fetchQuickEntryGenresAction: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../app/(app)/reports/fixed-cost-actions', () => ({ confirmFixedCostAction: vi.fn() }));

import { CategorySheetBody } from '../../app/(app)/category-sheet';
import { RecordSheet } from '../../app/(app)/record-sheet';

const visible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ');

const outlook = {
  genreId: 'dining',
  name: '外食',
  targetYen: 42500,
  spentYen: 22752,
  scheduledYen: 0,
  lastMonthYen: 11266,
  p10: 30000,
  p50: 44000,
  p90: 60000,
  caution: { probability: 0.94 },
  fixed: false,
  sub: null,
  days: [],
};
const data = {
  outlook,
  planId: 'p1',
  periodStart: '2026-10-01',
  periodEnd: '2026-11-05',
  today: '2026-10-16',
  remainingDays: 21,
  isFixed: false,
  showOnHome: true,
};

describe('⑦ カテゴリ(デザイン仕様書、ADR-091)', () => {
  const html = visible(
    renderToString(h(CategorySheetBody, { data, onCancel: () => {}, onDone: () => {} })),
  );

  it('名前と、これまで・先月。見通し → 今期の目標額 → 設定 の順', () => {
    expect(html).toContain('これまで 22,752円 · 先月 11,266円');
    const order = ['見通し', '今期の目標額', '設定'].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('目標額は使った額が下限。「使った分だけ」の選択肢があり、下限より下の選択肢は出さない', () => {
    expect(html).toContain('下限 22,752円（使った額）');
    expect(html).toContain('いまのまま');
    expect(html).toContain('20%へらす');
    expect(html).toContain('使った分だけ');
    expect(html).toContain('このままだと約1,500円こえそう');
  });

  it('設定:名前・マーク・色、固定費にする、ホームに表示', () => {
    expect(html).toContain('名前・マーク・色');
    expect(html).toContain('固定費にする');
    expect(html).toContain('ホームに表示');
  });

  it('目標が無ければ、目標額の代わりに作り方を案内する', () => {
    const none = visible(
      renderToString(
        h(CategorySheetBody, {
          data: { ...data, planId: null, outlook: { ...outlook, targetYen: null } },
          onCancel: () => {},
          onDone: () => {},
        }),
      ),
    );
    expect(none).toContain('目標をつくる');
    expect(none).not.toContain('下限');
  });
});

describe('⑤ 記録する(デザイン仕様書、ADR-091)', () => {
  const html = visible(
    renderToString(
      h(RecordSheet, { onClose: () => {}, onCamera: () => {}, onFiles: () => {}, canStream: true }),
    ),
  );

  it('できるのは 記録する・カテゴリを足す・固定費にする の3つだけ', () => {
    expect(html).toContain('支出');
    expect(html).toContain('収入');
    expect(html).toContain('レシートで入力');
    expect(html).toContain('カテゴリ');
    expect(html).toContain('追加');
    expect(html).toContain('固定費にする');
    expect(html).toContain('日付を先にすると「予定」として記録され、使った額には入りません。');
    // メモ・ほかの記録のしかたは出さない(「…」のメニューにある)
    expect(html).not.toContain('店・メモ');
    expect(html).not.toContain('スクショから記録');
  });
});
