import Link from 'next/link';

import { formatYen } from '@/domain/money';
import { loadAccumulationView, type AccumulationView } from '@/features/accumulation/store';
import { loadSpendingDiagnosisView } from '@/features/diagnosis/store';
import { listGenres } from '@/features/genre/store';
import { listExpenseSubtypesForTransactionIds } from '@/features/receipts/expense-subtype-store';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { loadMonthlyLedger, type MonthlyForecast } from '@/features/spending/store';
import { formatDateJa } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';
import { SpendingCalendar } from './calendar';
import { MonthLinkedCategoryBreakdown } from './category-breakdown-chart';
import { toDrilldownTransactions } from './drilldown';
import { DiagnosisCard } from './diagnosis-card';
import { ReorderableCards, type SpendingCardKey } from './reorderable-cards';
import { CurrentMonthOnly, MonthLinkedSummaryCard } from './month-linked-cards';
import { SpendingMonthProvider } from './spending-month-provider';
import {
  TransactionListSection,
  type TransactionListSearchParams,
} from './transaction-list-section';

/** カードの既定の並び順(ADR-043/044 時点の並び、ADR-047/ADR-057参照)。 */
const DEFAULT_CARD_ORDER: readonly SpendingCardKey[] = [
  'summary',
  'calendar',
  'forecast',
  'diagnosis',
  'categoryBreakdown',
  'pile',
  'transactionList',
];

/**
 * 家計簿(本人発案:「ちりつもだけ表示されてて微妙。普通の一般的な家計簿を
 * 表示し補助でちりつもの項目を作るべき」)。
 *
 * ── 何を「普通の家計簿」とみなしたか ────────────────────────────
 * 今月使った額・収入・先月同日比の収支サマリー、カテゴリ別の内訳(グラフ)、
 * 月末までの着地予測の3点セット。どれも既存の純粋関数
 * (domain/spending.ts・domain/accumulation.ts・domain/budget.ts)を土台に
 * しており、新しい判断ロジックは着地予測(projectedMonthTotalYen)だけ
 * 追加した(features/spending/store.ts 参照)。
 *
 * ── 明細一覧(/transactions)をこの画面へ統合した(ADR-057) ─────────
 * 本人発案「明細と家計簿については統合する。二つのタブの使い分けが
 * わからん」への対応。旧 `/transactions` は独立したタブだったが、
 * 家計簿と明細は本人にとって別々の概念ではなかったため、カレンダー・
 * AI診断カードの下に明細一覧(`TransactionListSection`、全期間・
 * 口座/ジャンル/月で絞り込み可能)をそのまま埋め込んだ。ボトムナビの
 * 「明細」タブは廃止し、`/transactions` は `/spending` へリダイレクトする。
 *
 * ── ただしレシートの詳細だけは例外(本人発案、ADR-040)────────────
 * 「カテゴリ別の内訳を押したら使った一覧が見れて、さらにそこからレシート
 * の詳細も見えるようにしてほしい。レシート登録も家計簿の方の責務」との
 * 指摘を受け、カテゴリ別の内訳(下の CategoryBreakdownChart)を押して
 * 開く形にした。既定では畳んであり、`/transactions` の全件一覧をそのまま
 * 再掲するわけではない——カテゴリで絞った上での深掘り経路という位置づけ。
 * 品目が無い明細はそこから直接レシートを登録できる(receipt-items-panel.tsx、
 * /transactions の明細行(split-editor.tsx、P10-40)と共通の部品)。
 *
 * ── ちりつもは補助として残す ────────────────────────────────────
 * 削除はしない——「480円が完済2ヶ月に見える」という小口支出への気づきは
 * 通常の家計簿には無い視点で、価値がある。ただし主役ではないため
 * /spending/pile へ移し、ここではカード1枚の要約から辿れるだけにした。
 *
 * ── AI家計診断(本人発案、ADR-030)────────────────────────────
 * 「AIの分析が弱い。もっと客観視した分析が必要。投資家目線で今のが浪費か
 * 必要経費なのか判断する機構とそれを分析結果を蓄積表示改善する機能」への
 * 対応。category_kind(浪費/生活費/聖域...)はカテゴリ単位の静的な分類
 * だが、こちらは明細1件ごとにAIが下す動的な評定(features/diagnosis/、
 * DiagnosisCard 参照)。押されたときだけ AI を呼び、結果は蓄積して
 * 月ごとの浪費比率の推移を見せる。
 *
 * ── トップのカレンダー(本人発案、ADR-043/044)──────────────────
 * 「カレンダー追加。家計簿のトップはカレンダー、その下に詳細。カレンダー
 * 押したら何に使ったかすぐ見れるように編集できるように」への対応。
 * `SpendingCalendar`(calendar.tsx)を日を押すとその日の明細一覧が
 * カード内に展開される。新しいクエリは増やさず、`CategoryBreakdownChart`
 * と共有する `drilldownTransactions` をそのまま渡す。
 *
 * ── ただしトップは今月使った額(本人からのUX指摘、ADR-044)──────────
 * 「これは一番上に持っていって」(SummaryCard を指す手書き注釈)を受け、
 * カレンダーより先に SummaryCard(今月使った額)を置くよう並び替えた。
 * カレンダー自体は引き続き上寄りの重要な要素として残る。
 *
 * ── カレンダーの日別明細もカテゴリごとに分け、レシートを見せる(本人発案、
 *    ADR-044)────────────────────────────────────────────
 * 「カレンダーに紐づくやつもカテゴリーごとに分けてレシート表示して。今
 * カテゴリーが弱いな、生活費ってなっちゃう全部」という指摘への対応。
 * 「生活費」に丸められてしまう明細が多く、カテゴリ名だけでは何を買ったか
 * 分からないため、`SpendingCalendar` の日別明細をカテゴリでグルーピングし、
 * 各明細に `CategoryBreakdownChart` と同じ `ReceiptItemsPanel` を出して
 * レシートの品目まで見えるようにした(ADR-033、部品を複製しない)。
 *
 * ── カードの並び順は本人が自由に変えられる(本人発案、ADR-047)──────
 * 「そこの部分自由にレイアウト変えれるようにしたい」への対応。並び替えの
 * たびに本人からの指摘→コード変更という往復(ADR-043/044)が続いていた
 * ため、`ReorderableCards`(reorderable-cards.tsx)で本人が直接、各カードを
 * 長押し+ドラッグして並べ替えられるようにした。並び順はブラウザの
 * localStorage に保存する(詳細はコンポーネント側のコメント参照)。
 */

// 取り込み直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function SpendingPage({
  searchParams,
}: {
  searchParams: Promise<TransactionListSearchParams>;
}) {
  const params = await searchParams;
  const [ledger, pile, diagnosis] = await withMinDuration(
    Promise.all([loadMonthlyLedger(), loadAccumulationView(), loadSpendingDiagnosisView()]),
  );

  // カテゴリ別内訳からの深掘り(ADR-040)用。ledger.transactions は当月分
  // だけのため、件数は少なく1回にまとめて読める(/transactions と同じ
  // listReceiptItemsForTransactionIds・listExpenseSubtypesForTransactionIds)。
  const transactionIds = ledger.transactions.map((t) => t.id);
  const [categories, itemsByTransactionId, expenseSubtypeByTransactionId] = await Promise.all([
    listGenres(),
    listReceiptItemsForTransactionIds(transactionIds),
    listExpenseSubtypesForTransactionIds(transactionIds),
  ]);
  // ジャンル別内訳(CategoryBreakdownChart)とカレンダー(SpendingCalendar、
  // ADR-044)の両方から使う、明細1件分の共通の形。ここで1回だけ作り、
  // 両画面で共有する(ADR-033、同じ考慮を複数箇所で作らない)。
  const drilldownTransactions = toDrilldownTransactions(
    ledger.transactions,
    itemsByTransactionId,
    expenseSubtypeByTransactionId,
  );

  return (
    <div className="rise space-y-3">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          家計簿
        </h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {formatDateJa(ledger.period.from)} 〜 {formatDateJa(ledger.period.to)}
        </p>
      </header>

      {/* カレンダーと「ジャンル別の内訳」は同じ月を見せる(本人発案)。表示中の月は
          SpendingMonthProvider が持ち、両方のカードがそれを読む。 */}
      <SpendingMonthProvider
        today={ledger.period.to}
        currentMonthStart={ledger.period.from}
        currentTransactions={drilldownTransactions}
        currentGenreBreakdown={ledger.genreBreakdown}
        currentTotals={ledger.totals}
      >
        <ReorderableCards
          defaultOrder={DEFAULT_CARD_ORDER}
          cards={{
            summary: <MonthLinkedSummaryCard pace={ledger.pace} />,
            calendar: <SpendingCalendar categories={categories} />,
            forecast: (
              <CurrentMonthOnly>
                <ForecastCard forecast={ledger.forecast} />
              </CurrentMonthOnly>
            ),
            diagnosis: <DiagnosisCard view={diagnosis} />,
            categoryBreakdown: <MonthLinkedCategoryBreakdown categories={categories} />,
            pile: <PileTeaserCard view={pile} />,
            transactionList: <TransactionListSection searchParams={params} />,
          }}
        />
      </SpendingMonthProvider>
    </div>
  );
}

/**
 * 今のペースが続いた場合の月内着地見込み(本人発案:「予測」)。
 * カテゴリ予算の合計が分かれば、それと比べて超過/余裕の見込みも添える。
 */
function ForecastCard({ forecast }: { forecast: MonthlyForecast }) {
  const { projectedTotalYen, totalBudgetYen } = forecast;
  const overBudgetYen = totalBudgetYen === null ? null : projectedTotalYen - totalBudgetYen;

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          このペースが続くと月末までに
        </p>
        <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {formatYen(projectedTotalYen, { sign: 'never' })}
        </p>
      </div>

      {overBudgetYen === null || totalBudgetYen === null ? (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          カテゴリに予算を設定すると、着地見込みとの比較も出せます。
        </p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          カテゴリ予算の合計 {formatYen(totalBudgetYen, { sign: 'never' })} に対して
          {overBudgetYen > 0 ? (
            <>
              {' '}
              <span className="tabular font-semibold" style={{ color: 'var(--over)' }}>
                {formatYen(overBudgetYen, { sign: 'never' })}
              </span>{' '}
              超える見込みです。
            </>
          ) : (
            <>
              {' '}
              <span className="tabular font-semibold" style={{ color: 'var(--income)' }}>
                {formatYen(-overBudgetYen, { sign: 'never' })}
              </span>{' '}
              余る見込みです。
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** ちりつもは補助。要約1行だけ見せて /spending/pile へ誘導する。 */
function PileTeaserCard({ view }: { view: AccumulationView }) {
  return (
    <Link
      href="/spending/pile"
      className="flex items-center justify-between gap-3 rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          ちりつも
        </p>
        <p
          className="mt-0.5 truncate text-xs leading-relaxed"
          style={{ color: 'var(--ink-secondary)' }}
        >
          1回{formatYen(view.thresholdYen, { sign: 'never' })}未満の小口支出、今月は{' '}
          {formatYen(view.smallSpendTotalYen, { sign: 'never' })}
        </p>
      </div>
      <span className="shrink-0 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
        詳しく →
      </span>
    </Link>
  );
}
