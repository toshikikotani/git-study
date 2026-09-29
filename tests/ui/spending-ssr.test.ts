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
import { SummaryCard } from '../../app/(app)/spending/summary-card';
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
          h(SummaryCard, {
            key: 's',
            pace: { kind: 'since_start', days: 9 },
            forecast: { projectedTotalYen: null, totalBudgetYen: null },
            hasIncomeRegistered: false,
            goal: null,
          }),
          h(AttentionCard, { key: 'at', hasGoal: true }),
          h(GenreBreakdown, { key: 'g', goalRows: null }),
          h(CalendarHeatmap, { key: 'c', goal: null }),
          h(LedgerList, { key: 'l', goalRange: null, duplicateCount: 0 }),
        ],
      }),
    ),
  );

  it('上から 期間切り替え → サマリー → 要確認 → 内訳 → カレンダー → 明細 の順に並ぶ', () => {
    const order = [
      '表示する月',
      '使った額のサマリー',
      '要確認',
      'ジャンル別の内訳',
      'カレンダー',
      '明細',
    ].map((k) => html.indexOf(`aria-label="${k}`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('前月データが無いときは「記録開始からN日」、収入未登録は「収入を登録」で、赤字の差額は出ない', () => {
    expect(html).toContain('記録開始から9日');
    expect(html).toContain('収入を登録');
    expect(html).not.toContain('先月の29日時点');
    expect(html).not.toMatch(/円 (多い|少ない)/);
    expect(html).not.toContain('このペースが続くと');
  });

  it('予定は「予定」セクション、使った額に入らない。要確認に未分類が出る', () => {
    expect(html).toContain('予定');
    expect(html).toContain('3,400円'); // 使った額(3,000 + 400)。26,540円は入らない
    expect(html).not.toContain('29,940円');
    expect(html).toContain('未分類 1件');
    expect(html).toContain('目標に未反映');
  });

  it('分割した明細は、子の羅列ではなく比率のバー(role=img)', () => {
    expect(html).toContain('ジャンルの内訳:カフェ・飲料 67%、外食 33%');
    expect(html).toContain('阪神大阪梅田駅店');
  });

  it('行のマイナスはハイフンではなく U+2212、VoiceOver 向けの読み上げがある', () => {
    expect(html).toContain('−3,000円');
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

  it('未分類の行は、「?」やグレーのバーではなく、行の中の「ジャンルを選ぶ」チップ(受け入れ基準5)', () => {
    expect(html).toContain('ジャンルを選ぶ');
    // 未分類は1件だけ → チップも1つ
    expect(html.match(/ジャンルを選ぶ/g)).toHaveLength(1);
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

  it('見出し右側の「口座・突き合わせ・取り込む」は1つの「…」メニューにまとまっている', () => {
    expect(html).toContain('明細のメニュー');
    expect(html).not.toContain('突き合わせ');
  });
});

describe('ジャンル行(目標画面と共通)', () => {
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
    expect(none).toContain('予算なし');
  });
});

describe('F5 カレンダー', () => {
  const render = (date: string | null, goal: boolean) =>
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
            h(CalendarHeatmap, {
              key: 'c',
              goal: goal
                ? {
                    range: { from: '2026-09-25', to: '2026-10-05' },
                    dailyAllowanceYen: 2300,
                  }
                : null,
            }),
            h(LedgerList, { key: 'l', goalRange: null, duplicateCount: 0 }),
          ],
        }),
      ),
    );

  it('凡例は「少〜多」の1行だけで、目標期間の凡例(●余裕 ▲注意 !超過)は無い', () => {
    const html = render(null, true);
    expect(html).toContain('少');
    expect(html).not.toContain('下の帯=目標期間');
    expect(html).not.toContain('●余裕');
  });

  it('目標期間は週の行の背後に帯として描かれる', () => {
    expect(render(null, true)).toContain('data-goal-band');
    expect(render(null, false)).not.toContain('data-goal-band');
  });

  it('状態の印は注意・超過の日だけ(余裕の日に ● は付かない)', () => {
    const html = render(null, true);
    expect(html).not.toContain('●');
  });

  it('予定のある日にはカレンダーのマークが付く', () => {
    expect(render(null, false)).toContain('data-scheduled-mark');
  });

  it('日付で絞り込み中は「9/29で絞り込み中 ×」のチップが出る', () => {
    expect(render('2026-09-29', false)).toContain('9/29で絞り込み中');
    expect(render(null, false)).not.toContain('で絞り込み中');
  });
});
