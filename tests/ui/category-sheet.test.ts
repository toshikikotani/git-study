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
import { clearDraft, keepDraft } from '@/features/transactions/record-draft';

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
  const html = visible(renderToString(h(RecordSheet, { onClose: () => {}, onFiles: () => {} })));

  it('できるのは 記録する・カテゴリを足す・固定費にする の3つだけ', () => {
    expect(html).toContain('支出');
    expect(html).toContain('収入');
    // 画像から入力(レシートの写真でもスクショでもよい、ADR-100)
    expect(html).toContain('画像から入力');
    expect(html).not.toContain('レシートで入力');
    expect(html).toContain('カテゴリ');
    expect(html).toContain('追加');
    expect(html).toContain('固定費にする');
    expect(html).toContain('日付を先にすると「予定」として記録され、使った額には入りません。');
    // メモ・ほかの記録のしかたは出さない(「…」のメニューにある)
    expect(html).not.toContain('店・メモ');
    expect(html).not.toContain('スクショから記録');
  });

  it('手で記録するのはここだけ:返金・メモもここで入れる(ADR-096)', () => {
    expect(html).toContain('返金');
    expect(html).toContain('メモ');
  });

  it('開くときの日付と、収入から始めるかを受け取る(カレンダーの「この日に手で記録」など)', () => {
    const opened = visible(
      renderToString(
        h(RecordSheet, {
          onClose: () => {},
          onFiles: () => {},
          initialDate: '2026-10-14',
          initialKind: 'income',
        }),
      ),
    );
    expect(opened).toContain('10月14日（水）');
    // 収入ではカテゴリのタイルを出さない
    expect(opened).not.toContain('固定費にする');
  });

  it('レシート名を入れられる。空ならカテゴリ名で記録する(ADR-092)', () => {
    const raw = renderToString(h(RecordSheet, { onClose: () => {}, onFiles: () => {} }));
    expect(html).toContain('レシート名');
    expect(raw).toContain('placeholder="店名など（任意）"');
    expect(raw).toContain('maxLength="60"');
  });
});

describe('⑤ 記録する:雑に扱っても困らない(ADR-098)', () => {
  const sheet = (props: Record<string, unknown> = {}) =>
    renderToString(
      h(RecordSheet, {
        onClose: () => {},
        onFiles: () => {},
        ...props,
      }),
    );

  it('保存せずに閉じた入力は、次に開いたときに戻り、「消す」で消せる', () => {
    keepDraft({
      kind: 'expense',
      amount: '1,200',
      genreId: null,
      date: '2026-10-16',
      name: 'ファミリーマート',
      memo: '',
      fixed: false,
      accountId: 'a1',
    });
    const raw = sheet();
    expect(raw).toContain('value="1,200"');
    expect(raw).toContain('value="ファミリーマート"');
    expect(visible(raw)).toContain('前に入れかけた内容を戻しました');
    expect(visible(raw)).toContain('消す');
    clearDraft();
  });

  it('何も残っていなければ、空のまま開く', () => {
    clearDraft();
    const raw = sheet();
    expect(visible(raw)).not.toContain('前に入れかけた内容を戻しました');
  });

  it('保存できなかったときは、理由をつけて開き直す', () => {
    const raw = sheet({ initialError: '保存できませんでした。' });
    expect(raw).toContain('role="alert"');
    expect(visible(raw)).toContain('保存できませんでした。');
  });

  it('画像から入力は、カメラを決め打ちせず画像を選ばせる(写真を撮る / 写真ライブラリのどちらでも)', () => {
    const raw = sheet();
    const input = raw.match(/<input[^>]*type="file"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('accept="image/*"');
    expect(input).not.toContain('capture');
  });

  it('文字を入れる欄は自動入力を止める(iPhone の「連絡先を自動入力」を出さない、ADR-099)', () => {
    const raw = sheet();
    expect(raw.match(/autoComplete="off"/gi)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('保存は金額が無くても押せる(押すと足りないものを伝える。黙って効かないボタンにしない)', () => {
    const raw = sheet();
    const save = raw.match(/<button[^>]*>保存<\/button>/)?.[0] ?? '';
    expect(save).not.toBe('');
    expect(save).not.toContain('disabled');
  });
});
