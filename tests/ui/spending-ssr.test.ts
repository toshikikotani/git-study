import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// サーバー専用の Server Action・ルーターは、描画に関係しないので差し替える。
vi.mock('../../app/(app)/spending/actions', () => ({ loadCalendarMonthAction: vi.fn() }));
vi.mock('../../app/(app)/transactions/actions', () => ({
  deleteTransactionAction: vi.fn(),
  duplicateTransactionAction: vi.fn(),
  recordGenreCorrectionAction: vi.fn(),
  replaceSplitsAction: vi.fn(),
  updateTransactionAction: vi.fn(),
  updateTransactionMemoAction: vi.fn(),
  resolveReconcileAction: vi.fn(),
  checkReceiptDuplicatesAction: vi.fn(),
}));
vi.mock('../../app/(app)/transactions/receipt-items-panel', () => ({
  ReceiptItemsPanel: () => null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/spending',
}));

import { AttentionCard } from '../../app/(app)/spending/attention-card';
import { CalendarHeatmap } from '../../app/(app)/spending/calendar-heatmap';
import { GenreBreakdown } from '../../app/(app)/spending/genre-breakdown';
import { LedgerList } from '../../app/(app)/spending/ledger-list';
import { PeriodSwitcher } from '../../app/(app)/spending/period-switcher';
import { SpendingMonthProvider } from '../../app/(app)/spending/spending-month-provider';
import { LedgerSearch } from '../../app/(app)/spending/ledger-list';
import { MonthSummary } from '../../app/(app)/spending/month-summary';
import { budgetSpokenLabel } from '@/domain/budget-state';
import { GenreBudgetRow } from '@/components/ui/genre-budget-row';
import { buildLedgerViews } from '@/features/spending/views';
import { ledgerSplit, ledgerTx } from '../helpers/ledger';

const genres = [
  { id: 'dining', name: '外食' },
  { id: 'cafe', name: 'カフェ・飲料' },
];
const txs = [
  {
    ...ledgerTx({
      id: 'a',
      occurredOn: '2026-09-28',
      label: 'ココカラファイン',
      branchName: '阪神大阪梅田駅店',
      genreId: 'dining',
      genreName: '外食',
      amountYen: -3000,
      splits: [
        ledgerSplit({ genreId: 'dining', genreName: '外食', amountYen: -1000 }),
        ledgerSplit({ genreId: 'cafe', genreName: 'カフェ・飲料', amountYen: -2000 }),
      ],
    }),
    items: [],
    expenseSubtype: null,
  },
  {
    ...ledgerTx({
      id: 'b',
      occurredOn: '2026-09-28',
      label: 'ローソン',
      genreId: null,
      genreName: null,
      amountYen: -400,
    }),
    items: [],
    expenseSubtype: null,
  },
  {
    ...ledgerTx({
      id: 'f',
      occurredOn: '2026-10-03',
      label: '発表会',
      kind: 'special',
      status: 'scheduled',
      amountYen: -26540,
    }),
    items: [],
    expenseSubtype: null,
  },
];
txs.push({
  ...ledgerTx({
    id: 'r',
    occurredOn: '2026-09-27',
    label: 'ドトールコーヒー',
    branchName: '梅田店',
    genreId: 'cafe',
    genreName: 'カフェ・飲料',
    amountYen: -500,
    thumbnailUrl: 'https://example.test/r.jpg',
  }),
  items: [],
  expenseSubtype: null,
});
const views = buildLedgerViews({
  genres: genres.map((g) => ({ ...g, budget_yen: g.id === 'dining' ? 8000 : null })),
  transactions: txs,
  range: { from: '2026-09-01', to: '2026-09-30' },
  today: '2026-09-29',
});

/** React が文字列の間に挟む <!-- --> を除いて、見えている文字列だけにする。 */
const visible = (html: string) => html.replace(/<!-- -->/g, '');

describe('家計簿の画面(サーバー描画のスモークテスト)', () => {
  const html = visible(
    renderToString(
      h(SpendingMonthProvider, {
        today: '2026-09-29',
        currentMonthStart: '2026-09-01',
        currentTransactions: txs,
        currentGenreBreakdown: views.genreBreakdown,
        currentTotals: views.totals,
        genres,
        accounts: [{ id: 'a', name: '現金' }],
        children: [
          h(PeriodSwitcher, { key: 'p' }),
          h(MonthSummary, { key: 's' }),
          h(LedgerSearch, { key: 'q' }),
          h(CalendarHeatmap, { key: 'c' }),
          h(AttentionCard, { key: 'at', hasGoal: true }),
          h(LedgerList, { key: 'l', goalRange: null, duplicateCount: 0 }),
          h(GenreBreakdown, { key: 'g' }),
        ],
      }),
    ),
  );

  it('上から 月の切り替え → 合計 → 検索 → カレンダー → 要確認 → 明細 の順に並ぶ(デザイン仕様書)', () => {
    const order = ['表示する月', 'この月の合計', '明細を検索', 'カレンダー', '要確認', '明細'].map(
      // 要確認は件数つきの読み上げ(「要確認 1件。…」)なので前方一致
      (k) => html.indexOf(k === '要確認' ? `aria-label="${k}` : `aria-label="${k}"`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('合計は 支出・収入・差額 の3列', () => {
    expect(html).toContain('支出');
    expect(html).toContain('収入');
    expect(html).toContain('差額');
  });

  it('カテゴリはドーナツと、名前・金額・割合の行', () => {
    expect(html).toContain('9月の支出');
    expect(html).toMatch(/外食[\s\S]{0,200}%/);
  });

  it('予定は「予定」セクション、使った額に入らない。要確認に未分類が出る', () => {
    expect(html).toContain('予定 · 使った額には入りません');
    expect(html).toContain('3,400円'); // 使った額(3,000 + 400)。26,540円は入らない
    expect(html).not.toContain('29,940円');
    expect(html).toContain('未分類 1件');
    expect(html).toContain('目標に未反映');
  });

  it('分割した明細は、子の羅列ではなく比率のバー(role=img)', () => {
    expect(html).toContain('カテゴリの内訳:カフェ・飲料 2,000円、外食 1,000円');
    expect(html).toContain('阪神大阪梅田駅店');
  });

  it('支出の行に「−」は付かず、「円」は小さく組まれ、VoiceOver 向けの読み上げがある', () => {
    expect(html).not.toContain('−3,000');
    expect(html).toContain('3,000<span class="yen-unit">円</span>');
    expect(html).toMatch(/aria-label="ココカラファイン、[^"]*支出3,000円/);
  });
});

describe('F4 明細の行', () => {
  const html = visible(
    renderToString(
      h(SpendingMonthProvider, {
        today: '2026-09-29',
        currentMonthStart: '2026-09-01',
        currentTransactions: txs,
        currentGenreBreakdown: views.genreBreakdown,
        currentTotals: views.totals,
        genres,
        accounts: [{ id: 'a', name: '現金' }],
        children: h(LedgerList, { goalRange: null, duplicateCount: 0 }),
      }),
    ),
  );

  it('未分類の行は、「?」やグレーのバーではなく、行の中の「カテゴリを選ぶ」チップ(受け入れ基準5)', () => {
    expect(html).toContain('カテゴリを選ぶ');
    // 未分類は1件だけ → チップも1つ
    expect(html.match(/カテゴリを選ぶ/g)).toHaveLength(1);
    expect(html).not.toContain('未分類</span>'); // 「未分類」ラベルのバッジを出さない
  });

  it('1行目は正規化した店名、2行目に支店名(受け入れ基準6)。店名は切れない(truncate しない)', () => {
    expect(html).toMatch(/ドトールコーヒー[\s\S]{0,400}梅田店/);
    const nameLine = html.match(/<p class="([^"]*)"[^>]*>ドトールコーヒー/);
    expect(nameLine?.[1]).not.toContain('truncate');
  });

  it('レシート画像はサムネイルではなく小さなレシートアイコン(タップでフルスクリーン)', () => {
    expect(html).toContain('レシート画像を見る');
    expect(html).not.toContain('<img');
  });

  it('明細には「…」メニューを置かない(取り込む・突き合わせ・口座は今日の「…」から、ADR-090)', () => {
    expect(html).not.toContain('明細のメニュー');
    expect(html).not.toContain('突き合わせ');
  });
});

describe('カテゴリ行(目標画面と共通)', () => {
  it('予算あり:状態とアイコン・ラベル、読み上げ。予算なし:状態を出さない', () => {
    const withBudget = renderToString(
      h(GenreBudgetRow, {
        name: '外食',
        spentYen: 5000,
        budgetYen: 7900,
        idealYen: 3000,
        maxYen: 5000,
      }),
    );
    expect(withBudget).toContain('注意');
    expect(withBudget).toContain(budgetSpokenLabel('外食', 5000, 7900));
    const none = renderToString(
      h(GenreBudgetRow, { name: '酒', spentYen: 0, budgetYen: 0, maxYen: 1 }),
    );
    expect(none).not.toContain('余裕');
    expect(none).not.toContain('順調');
    expect(none).toContain('目標なし');
  });
});

describe('F5 カレンダー', () => {
  const render = (date: string | null, initialView?: 'week' | 'month') =>
    visible(
      renderToString(
        h(SpendingMonthProvider, {
          today: '2026-09-29',
          currentMonthStart: '2026-09-01',
          currentTransactions: txs,
          currentGenreBreakdown: views.genreBreakdown,
          currentTotals: {
            ...views.totals,
            scheduledDaySpend: { ...views.totals.scheduledDaySpend, '2026-09-30': 5000 },
          },
          genres,
          accounts: [{ id: 'a', name: '現金' }],
          initialFilter: date !== null ? { date } : {},
          children: [
            h(CalendarHeatmap, { key: 'c', ...(initialView ? { initialView } : {}) }),
            h(LedgerList, { key: 'l', goalRange: null, duplicateCount: 0 }),
          ],
        }),
      ),
    );

  it('前回「月で見る」にしていたら、開いたときから月で出す(ADR-093)', () => {
    const month = render(null, 'month');
    expect(month).toContain('週で見る');
    expect(month).not.toContain('9月27日〜10月3日');
    expect(month).toContain('9月');
    const week = render(null, 'week');
    expect(week).toContain('月で見る');
    expect(week).toContain('9月27日〜10月3日');
  });

  it('凡例は「点が濃いほど多い」と「予定あり」(デザイン仕様書)', () => {
    const html = render(null);
    expect(html).toContain('点が濃いほど多い');
    expect(html).toContain('予定あり');
    expect(html).toContain('9月27日〜10月3日');
    expect(html).toContain('月で見る');
  });

  it('予定のある日には輪の点が付く', () => {
    expect(render(null)).toContain('data-scheduled-mark');
  });

  it('日付で絞り込み中は「9/29で絞り込み中 ×」のチップが出る', () => {
    expect(render('2026-09-29')).toContain('9/29で絞り込み中');
    expect(render(null)).not.toContain('で絞り込み中');
  });
});

describe('分析のカテゴリ(デザイン仕様書)', () => {
  const html = visible(
    renderToString(
      h(SpendingMonthProvider, {
        today: '2026-09-29',
        currentMonthStart: '2026-09-01',
        currentTransactions: txs,
        currentGenreBreakdown: views.genreBreakdown,
        currentTotals: views.totals,
        genres,
        accounts: [{ id: 'a', name: '現金' }],
        children: h(GenreBreakdown),
      }),
    ),
  );

  it('行は色の点・名前・金額・割合だけで、月の目安(使った額 / 目安)は出さない', () => {
    expect(html).toContain('カテゴリ');
    expect(html).not.toContain(' / 8,000円');
    expect(html).toMatch(/\d+%/);
  });
});

describe('明細は省略しない(本人の要望「省略はなし」、ADR-095)', () => {
  const names = ['ファミリーマート', 'マツモトキヨシ', '耳鼻咽喉科', 'スギ薬局', 'ローソン'];
  const many = names.map((label, i) => ({
    ...ledgerTx({ id: `d${i}`, occurredOn: '2026-09-15', label, amountYen: -100 * (i + 1) }),
    items:
      i === 3
        ? ['野菜', 'レジ袋', '牛乳', '卵', 'ライオンキャラメル'].map((name, j) => ({
            id: `it${j}`,
            name,
            amountYen: 100,
            genreId: null,
            genreName: null,
            productType: null,
          }))
        : [],
    expenseSubtype: null,
  }));
  const manyViews = buildLedgerViews({
    genres: genres.map((g) => ({ ...g, budget_yen: null })),
    transactions: many,
    range: { from: '2026-09-01', to: '2026-09-30' },
    today: '2026-09-29',
  });
  const html = visible(
    renderToString(
      h(SpendingMonthProvider, {
        today: '2026-09-29',
        currentMonthStart: '2026-09-01',
        currentTransactions: many,
        currentGenreBreakdown: manyViews.genreBreakdown,
        currentTotals: manyViews.totals,
        genres,
        accounts: [{ id: 'a', name: '現金' }],
        children: h(LedgerList, { goalRange: null, duplicateCount: 0 }),
      }),
    ),
  );

  it('1日に4件以上あっても、たたまずにすべて出す', () => {
    for (const name of names) expect(html).toContain(name);
    expect(html).not.toContain('この日のほかの記録');
  });

  it('品目はすべて並べ、「ほか○点」や「…」で切らない', () => {
    expect(html).toContain('野菜、レジ袋、牛乳、卵、ライオンキャラメル');
    expect(html).not.toMatch(/ほか\d+点/);
  });
});
