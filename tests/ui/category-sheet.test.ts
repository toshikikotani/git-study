import { readFileSync } from 'node:fs';
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
vi.mock('../../app/(app)/reports/fixed-cost-actions', () => ({
  confirmFixedCostAction: vi.fn(),
  markRecordFixedAction: vi.fn(),
}));

import { CategorySheetBody } from '../../app/(app)/category-sheet';
import { RecordSheet, visibleGenres } from '../../app/(app)/record-sheet';
import { clearDraft, keepDraft } from '@/features/transactions/record-draft';

const visible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ');

const outlook = {
  genreId: 'dining',
  name: '外食',
  targetYen: 42500,
  untargeted: false,
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
  planTotalYen: 172000,
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
    expect(html).toContain('下限 22,752円  （使った額）');
    expect(html).toContain('いまのまま');
    expect(html).toContain('20%へらす');
    expect(html).toContain('使った分だけ');
    expect(html).toContain('このままだと約1,500円こえそう');
  });

  it('設定:名前・マーク・色。固定費は記録ごとに決める(カテゴリごと固定費は外せる、ADR-108)。ホームに出すかは選ばない(自動、ADR-117)', () => {
    expect(html).toContain('名前・マーク・色');
    expect(html).not.toContain('ホームに表示');
    expect(html).toContain('固定費はカテゴリではなく、記録ごとに決めます(毎月の支払いだけ)。');
    expect(html).not.toContain('カテゴリごと固定費');
    const fixed = visible(
      renderToString(
        h(CategorySheetBody, {
          data: { ...data, isFixed: true },
          onCancel: () => {},
          onDone: () => {},
        }),
      ),
    );
    expect(fixed).toContain('カテゴリごと固定費');
  });

  it('下限は使った額と予定の合計。こえたら知らせ、目標を上げる・このままにするを選べる(デザイン v3-5、ADR-108)', () => {
    const hobby = visible(
      renderToString(
        h(CategorySheetBody, {
          data: {
            ...data,
            outlook: {
              ...outlook,
              name: '娯楽・趣味',
              targetYen: 33300,
              spentYen: 41590,
              scheduledYen: 6000,
              p50: 47590,
            },
          },
          onCancel: () => {},
          onDone: () => {},
        }),
      ),
    );
    expect(hobby).toContain('これまで 41,590円 · 予定 6,000円');
    expect(hobby).toContain('目標 33,300円を 8,290円 こえています');
    expect(hobby).toContain('予定(6,000円)を入れると、14,290円 こえる見込みです。');
    expect(hobby).toContain('どうしますか？');
    expect(hobby).toContain('今期の目標を上げる');
    expect(hobby).toContain('このままにする');
    expect(hobby).toContain('下限 47,590円  （使った額 41,590 ＋ 予定 6,000）');
    expect(hobby).toContain('予定まで');
    expect(hobby).toContain('少し余裕');
    expect(hobby).toContain('今期の目標の合計は 約18.7万円 になります');
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
  const html = visible(renderToString(h(RecordSheet, { onClose: () => {} })));

  it('撮影・写真と手入力・カテゴリ・固定費の操作を用意する', () => {
    expect(html).toContain('支出');
    expect(html).toContain('収入');
    // 撮影と写真選択はそれぞれ専用画面へ。
    expect(html).toContain('レシートを撮る');
    expect(html).toContain('写真から読み取る');
    expect(html).not.toContain('レシートで入力');
    expect(html).toContain('カテゴリ');
    expect(html).toContain('追加');
    expect(html).toContain('毎月の固定費にする');
    // 種類は支出・収入の2つ。返金・割り勘・メモは「詳細」にたたむ(デザイン v3-4、ADR-108)
    expect(html).toContain('詳細');
    expect(html).toContain('割り勘・返金・メモ');
    expect(html).toContain('よく使う順。店名を入れると、前回のカテゴリを先に選びます。');
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
    const raw = renderToString(h(RecordSheet, { onClose: () => {} }));
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

  it('撮影と写真選択の専用画面へそれぞれ直接進める', () => {
    const raw = sheet();
    expect(raw).toContain('href="/camera"');
    expect(raw).toContain('href="/photos"');
  });

  it('文字を入れる欄は自動入力を止める(iPhone の「連絡先を自動入力」を出さない、ADR-099)', () => {
    const raw = sheet();
    // レシート名(メモ・割り勘は「詳細」を開いたときに出る。どれも自動入力を止める)
    expect(raw.match(/autoComplete="off"/gi)?.length ?? 0).toBeGreaterThanOrEqual(1);
    const src = readFileSync('app/(app)/record-sheet.tsx', 'utf8');
    expect(src.match(/autoComplete="off"/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('保存は金額が無くても押せる(押すと足りないものを伝える。黙って効かないボタンにしない)', () => {
    const raw = sheet();
    const save = raw.match(/<button[^>]*>保存<\/button>/)?.[0] ?? '';
    expect(save).not.toBe('');
    expect(save).not.toContain('disabled');
  });
});

describe('記録を直す:記録すると同じ画面(ADR-101)', () => {
  const raw = renderToString(
    h(RecordSheet, {
      onClose: () => {},
      edit: {
        initial: {
          kind: 'expense',
          amountYen: 6000,
          genreId: null,
          date: '2026-10-23',
          name: 'ハンブレッターズ',
          memo: '',
        },
        onSave: () => {},
        footer: h('p', null, 'レシートの品目'),
      },
    }),
  );
  const text = visible(raw);

  it('題は「記録を直す」で、直す前の値から始める', () => {
    expect(text).toContain('記録を直す');
    expect(raw).toContain('value="6,000"');
    expect(raw).toContain('value="ハンブレッターズ"');
    expect(text).toContain('10月23日');
  });

  it('画像から入力・固定費・下書きの案内は出さず、下にレシートの品目を出す', () => {
    expect(text).not.toContain('画像から入力');
    expect(text).not.toContain('固定費にする');
    expect(text).not.toContain('前に入れかけた内容を戻しました');
    expect(text).toContain('レシートの品目');
  });

  it('割り勘でもらった額を入れられる(記録するでも同じ。「詳細」の中)', () => {
    expect(text).toContain('割り勘・返金・メモ');
    const src = readFileSync('app/(app)/record-sheet.tsx', 'utf8');
    expect(src).toContain('割り勘でもらった額');
  });
});

describe('記録するをシンプルに(デザイン v3-4、ADR-108)', () => {
  const genres = Array.from({ length: 23 }, (_, i) => ({ id: `g${i}`, name: `カテゴリ${i}` }));

  it('カテゴリは、よく使う順の8個と「すべて」', () => {
    expect(visibleGenres(genres, null, false).map((g) => g.id)).toEqual([
      'g0',
      'g1',
      'g2',
      'g3',
      'g4',
      'g5',
      'g6',
      'g7',
    ]);
    expect(visibleGenres(genres, null, true)).toHaveLength(23);
  });

  it('選んだカテゴリが8個に無ければ、8個目と入れかえて見せる', () => {
    expect(visibleGenres(genres, 'g15', false).map((g) => g.id)).toEqual([
      'g0',
      'g1',
      'g2',
      'g3',
      'g4',
      'g5',
      'g6',
      'g15',
    ]);
  });

  it('店名を入れると、前回その店で選んだカテゴリを先に選ぶ(本人が選んでいなければ)', () => {
    const src = readFileSync('app/(app)/record-sheet.tsx', 'utf8');
    expect(src).toContain('storeGenreCache?.get(comparableKey(value))');
    expect(src).toContain("if (genreTouched.current || kind === 'income') return;");
  });
});
