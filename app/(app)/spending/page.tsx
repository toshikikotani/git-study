import Link from 'next/link';

import { formatYen } from '@/domain/money';
import { loadAccumulationView, type AccumulationView } from '@/features/accumulation/store';
import { listCategoryOptions } from '@/features/classification/store';
import { loadSpendingDiagnosisView } from '@/features/diagnosis/store';
import { listExpenseSubtypesForTransactionIds } from '@/features/receipts/expense-subtype-store';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import {
  loadMonthlyLedger,
  type MonthlyForecast,
  type MonthlyLedgerView,
} from '@/features/spending/store';
import { formatDateJa } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';
import { CategoryBreakdownChart, type DrilldownTransaction } from './category-breakdown-chart';
import { DiagnosisCard } from './diagnosis-card';

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
 * ── 今月の明細一覧はここに置かない(本人からのUX指摘「情報の重複が
 *    あってはならない、どこか一箇所見ればその情報がわかるように」)─────
 * 以前はここに `MonthlyTransactionList`(今月分の再掲)を置いていたが、
 * `/transactions`(全期間、並び替え・分類編集も可能)と中身がほぼ
 * そのまま重複していた。同じ明細をこの画面だけ読み取り専用で見せる
 * 意味は薄く、ヘッダーの「明細(全期間)」リンク1本に統合した。
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
 */

// 取り込み直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function SpendingPage() {
  const [ledger, pile, diagnosis] = await withMinDuration(
    Promise.all([loadMonthlyLedger(), loadAccumulationView(), loadSpendingDiagnosisView()]),
  );
  const netYen = ledger.totalIncomeYen - ledger.totalSpentYen;

  // カテゴリ別内訳からの深掘り(ADR-040)用。ledger.transactions は当月分
  // だけのため、件数は少なく1回にまとめて読める(/transactions と同じ
  // listReceiptItemsForTransactionIds・listExpenseSubtypesForTransactionIds)。
  const transactionIds = ledger.transactions.map((t) => t.id);
  const [categories, itemsByTransactionId, expenseSubtypeByTransactionId] = await Promise.all([
    listCategoryOptions(),
    listReceiptItemsForTransactionIds(transactionIds),
    listExpenseSubtypesForTransactionIds(transactionIds),
  ]);
  const transactionsByCategory: Record<string, DrilldownTransaction[]> = {};
  for (const t of ledger.transactions) {
    const key = t.categoryId ?? 'uncategorized';
    const list = transactionsByCategory[key] ?? [];
    list.push({
      id: t.id,
      occurredOn: t.occurredOn,
      label: t.label,
      amountYen: t.amountYen,
      accountId: t.accountId,
      paymentMethod: t.paymentMethod,
      items: itemsByTransactionId.get(t.id) ?? [],
      expenseSubtype: expenseSubtypeByTransactionId.get(t.id) ?? null,
    });
    transactionsByCategory[key] = list;
  }

  return (
    <div className="rise space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            家計簿
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {formatDateJa(ledger.period.from)} 〜 {formatDateJa(ledger.period.to)}
          </p>
        </div>
        <Link href="/transactions" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          明細(全期間)
        </Link>
      </header>

      <SummaryCard ledger={ledger} netYen={netYen} />
      <ForecastCard forecast={ledger.forecast} />
      <DiagnosisCard view={diagnosis} />
      <CategoryBreakdownChart
        rows={ledger.categoryBreakdown}
        transactionsByCategory={transactionsByCategory}
        categories={categories}
      />
      <PileTeaserCard view={pile} />
    </div>
  );
}

/**
 * 今月使った額をヒーロー数値にし、収入・差額(貯蓄)・先月同日比を添える。
 * 先月同日比(pace)は domain/accumulation.ts の compareToPreviousMonthPace を
 * 小口支出だけでなく全支出に対して使う(月末を待たずに差が見える)。
 */
function SummaryCard({ ledger, netYen }: { ledger: MonthlyLedgerView; netYen: number }) {
  const { pace } = ledger;
  const isLess = pace.differenceYen < 0;
  const hasDifference = pace.differenceYen !== 0;

  return (
    <div
      className="rounded-3xl p-6"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        今月使った額
      </p>
      <p
        className="mt-1 text-4xl leading-none font-semibold tracking-tight"
        style={{ color: 'var(--ink)' }}
      >
        {formatYen(ledger.totalSpentYen, { sign: 'never' })}
      </p>

      <dl
        className="mt-4 grid grid-cols-2 gap-3 border-t pt-4"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <div>
          <dt className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            収入
          </dt>
          <dd className="tabular text-sm font-semibold" style={{ color: 'var(--income)' }}>
            {formatYen(ledger.totalIncomeYen, { sign: 'never' })}
          </dd>
        </div>
        <div>
          <dt className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            差額
          </dt>
          <dd
            className="tabular text-sm font-semibold"
            style={{ color: netYen >= 0 ? 'var(--income)' : 'var(--over)' }}
          >
            {formatYen(netYen)}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        先月の{pace.dayOfMonth}日時点は {formatYen(pace.lastMonthSameDayYen, { sign: 'never' })}。
        {hasDifference ? (
          <>
            {' '}
            今月は{' '}
            <span
              className="tabular font-semibold whitespace-nowrap"
              style={{ color: isLess ? 'var(--income)' : 'var(--over)' }}
            >
              {formatYen(pace.differenceYen, { sign: 'never' })} {isLess ? '少ない' : '多い'}
            </span>
            。
          </>
        ) : (
          ' 今月はちょうど同じです。'
        )}
      </p>
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
