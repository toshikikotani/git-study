import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { formatYen } from '@/domain/money';
import type { DetectedSubscription } from '@/domain/subscriptions';
import { listAccounts } from '@/features/accounts/store';
import { listCategoryOptions } from '@/features/classification/store';
import { isRiskyPaymentMethod } from '@/features/classification/rules';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import {
  loadPaydayPeriodSummary,
  type PaydayPeriodSummary,
} from '@/features/transactions/period-summary';
import { listExpenseSubtypesForTransactionIds } from '@/features/receipts/expense-subtype-store';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { listDuplicateCandidates } from '@/features/transactions/duplicates-store';
import { listSplitsForDisplay } from '@/features/transactions/splits-store';
import {
  listImportBatches,
  listTransactions,
  type StoredTransaction,
} from '@/features/transactions/store';
import { formatDateJa } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';
import { TransactionFilters, type TransactionFilterState } from './filters';
import { TransactionRowWithSplit } from './split-editor';

/**
 * 明細一覧(FR-10 の出口)。
 *
 * 日付ごとにまとめて出す。金融機関の明細に慣れた目には、
 * 日付が繰り返し出てくる一覧よりこちらの方が追いやすい。
 */

// 取り込み直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

type SearchParams = { account?: string; category?: string; month?: string };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filter: TransactionFilterState = {
    accountId: params.account ?? '',
    categoryId: params.category ?? '',
    month: params.month ?? '',
  };

  const [transactions, batches, periodSummary, categories, subscriptions, duplicates, accounts] =
    await withMinDuration(
      Promise.all([
        listTransactions(),
        listImportBatches(),
        loadPaydayPeriodSummary(),
        listCategoryOptions(),
        loadDetectedSubscriptions(),
        listDuplicateCandidates(),
        listAccounts(),
      ]),
    );

  if (transactions.length === 0) {
    return <EmptyState />;
  }

  const months = listMonthOptions(transactions);
  const filteredTransactions = transactions.filter((t) => matchesFilter(t, filter));

  const transactionIds = filteredTransactions.map((t) => t.id);
  const [splitsByTransactionId, itemsByTransactionId, expenseSubtypeByTransactionId] =
    await Promise.all([
      listSplitsForDisplay(transactionIds),
      listReceiptItemsForTransactionIds(transactionIds),
      listExpenseSubtypesForTransactionIds(transactionIds),
    ]);

  // リボ・キャッシングは「今すぐ対応が要るもの」を知らせる目的のバナーのため、
  // 絞り込みの影響を受けない(全件を対象に数える)。絞り込みが変えるのは
  // 下の一覧だけ。
  const risky = transactions.filter((t) => isRiskyPaymentMethod(t.paymentMethod));
  const groups = groupByDate(filteredTransactions);
  const isFiltered = filter.accountId !== '' || filter.categoryId !== '' || filter.month !== '';

  return (
    <div className="rise space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          明細
        </h1>
        {/* 家計簿(/spending)とレシート撮影は下タブ・専用ボタン
            (app/(app)/layout.tsx)へ動線を移したため、ここには置かない
            (本人発案:見出しの文字リンクが多すぎて動線がわかりにくかった)。 */}
        <div className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1">
          <Link href="/accounts" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            口座
          </Link>
          <Link
            href="/transactions/reconcile"
            className="text-[13px]"
            style={{ color: 'var(--ink-muted)' }}
          >
            突き合わせ
          </Link>
          <Link
            href="/transactions/import"
            className="text-[13px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            取り込む
          </Link>
        </div>
      </header>

      <TransactionFilters
        accounts={accounts}
        categories={categories}
        months={months}
        current={filter}
      />

      <PaydayPeriodCard summary={periodSummary} />

      <SubscriptionsCard subscriptions={subscriptions} />

      {/* FR-21:リボ・キャッシングは一覧の最上部で数を見せる。
          埋もれさせないことが再発防止の要 */}
      {risky.length > 0 ? (
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--over-track)', boxShadow: 'var(--card-shadow)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--over)' }}>
            リボ・キャッシング・分割が {risky.length} 件あります
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            合計 {formatYen(risky.reduce((a, t) => a + Math.abs(t.amountYen), 0))}。
            該当カードの停止を検討してください。
          </p>
        </div>
      ) : null}

      {/* 複数経路(CSV・メール・レシート)から同じ買い物が入ると fingerprint では
          拾えず二重計上になる。気づける場所は一覧の上しかない */}
      {duplicates.length > 0 ? (
        <Link
          href="/transactions/duplicates"
          className="flex items-center justify-between gap-3 rounded-2xl p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
            二重に入っていそうな明細が {duplicates.length} 組
          </p>
          <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
            確認する →
          </span>
        </Link>
      ) : null}

      {groups.length === 0 ? (
        <p className="px-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
          この絞り込みに一致する明細がありません。
        </p>
      ) : null}

      {groups.map(([date, rows]) => (
        <section
          key={date}
          className="overflow-hidden rounded-2xl"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div
            className="flex items-baseline justify-between px-4 pt-3 pb-1"
            style={{ color: 'var(--ink-muted)' }}
          >
            <span className="text-xs font-medium">{formatDateJa(date)}</span>
            <span className="tabular text-xs">
              {formatYen(rows.reduce((a, t) => a + t.amountYen, 0))}
            </span>
          </div>
          <ul className="divide-y" style={{ borderColor: 'var(--hairline)' }}>
            {rows.map((t) => (
              <TransactionRowWithSplit
                key={t.id}
                transaction={t}
                categories={categories}
                initialSplits={splitsByTransactionId.get(t.id) ?? []}
                receiptItems={itemsByTransactionId.get(t.id) ?? []}
                expenseSubtype={expenseSubtypeByTransactionId.get(t.id) ?? null}
              />
            ))}
          </ul>
        </section>
      ))}

      {batches.length > 0 ? (
        <p className="px-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {isFiltered
            ? `${filteredTransactions.length} 件 / 全 ${transactions.length} 件`
            : `${transactions.length} 件`}{' '}
          / 取り込み {batches.length} 回
        </p>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          明細
        </h1>
        <Link href="/accounts" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          口座
        </Link>
      </header>

      <div
        className="rounded-3xl p-6"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
      >
        <p className="text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          明細がまだありません。
          <br />
          銀行やカードの CSV を取り込むと、自動で分類され、リボ・キャッシングが
          あればその場で分かります。
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button href="/transactions/import" variant="filled">
            CSV を取り込む
            <span aria-hidden>→</span>
          </Button>
          <Button href="/transactions/receipt" variant="outlined">
            レシートを撮る
            <span aria-hidden>→</span>
          </Button>
        </div>
      </div>

      <ul className="space-y-1.5 px-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
        <li>・Shift_JIS の CSV もそのまま読めます</li>
        <li>・列の並びは自動で推測し、違っていれば直せます</li>
        <li>・同じファイルを二度取り込んでも増えません</li>
      </ul>

      {/* CSV は月次。日々の検知にはメールの自動取得が要る(ADR-018) */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
          毎回取り込むのは大変です
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          Gmail 連携を設定すると、カードの利用通知メールが自動で取り込まれます。
          リボやキャッシングを月末を待たずに検知できます。
        </p>
        <Link
          href="/settings/gmail"
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          自動取得を設定する
          <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}

/**
 * 給料日〜給料日の期間ビュー(FR-17, M6-3)。
 *
 * 保存は暦月のままだが(ADR-015)、給料日基準で「今のサイクルでいくら
 * 使ったか」を口座別・カテゴリ別に見せる。使用額が無いカテゴリ・
 * まだ使っていない口座も「0円」として意味を持つため、口座は全件出す。
 */
function PaydayPeriodCard({ summary }: { summary: PaydayPeriodSummary }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          {formatDateJa(summary.startOn)} 〜 {formatDateJa(summary.endOn)}
        </p>
        <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {formatYen(summary.totalSpentYen)}
        </p>
      </div>

      {summary.byAccount.length > 0 ? (
        <dl className="mt-3 space-y-1">
          {summary.byAccount.map((a) => (
            <div key={a.accountId} className="flex items-baseline justify-between gap-3 text-xs">
              <dt style={{ color: 'var(--ink-secondary)' }}>{a.accountName}</dt>
              <dd className="tabular" style={{ color: 'var(--ink-secondary)' }}>
                {formatYen(a.spentYen)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {summary.byCategory.length > 0 ? (
        <dl className="mt-3 space-y-1 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
          {summary.byCategory.map((c) => (
            <div
              key={c.categoryId ?? 'uncategorized'}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <dt style={{ color: 'var(--ink-muted)' }}>{c.categoryName ?? '未分類'}</dt>
              <dd className="tabular" style={{ color: 'var(--ink-muted)' }}>
                {formatYen(c.spentYen)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * 検知した定期支払い(サブスク、本人発案)。
 *
 * 新しいテーブルは持たず domain/subscriptions.ts が都度計算した結果を
 * そのまま表示するだけ(features/subscriptions/store.ts 参照)。
 */
function SubscriptionsCard({ subscriptions }: { subscriptions: DetectedSubscription[] }) {
  if (subscriptions.length === 0) return null;

  const totalYen = subscriptions.reduce((a, s) => a + s.amountYen, 0);

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          定期支払い({subscriptions.length} 件)
        </p>
        <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          月あたり {formatYen(totalYen)}
        </p>
      </div>

      <dl className="mt-3 space-y-1.5">
        {subscriptions.map((s) => (
          <div key={s.key} className="flex items-baseline justify-between gap-3 text-xs">
            <dt style={{ color: 'var(--ink-secondary)' }}>
              {s.label}
              <span className="ml-1.5" style={{ color: 'var(--ink-muted)' }}>
                前回 {formatDateJa(s.lastOccurredOn)}・{s.occurrenceCount}回目
              </span>
            </dt>
            <dd className="tabular" style={{ color: 'var(--ink-secondary)' }}>
              {formatYen(s.amountYen)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 日付ごとにまとめる。新しい日付が上。 */
function groupByDate(transactions: readonly StoredTransaction[]): [string, StoredTransaction[]][] {
  const map = new Map<string, StoredTransaction[]>();
  for (const t of transactions) {
    const list = map.get(t.occurredOn) ?? [];
    list.push(t);
    map.set(t.occurredOn, list);
  }
  return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
}

/** 明細1件が絞り込み条件に合うか。categoryId === 'none' は未分類を指す。 */
function matchesFilter(transaction: StoredTransaction, filter: TransactionFilterState): boolean {
  if (filter.accountId !== '' && transaction.accountId !== filter.accountId) return false;
  if (filter.categoryId === 'none' && transaction.categoryId !== null) return false;
  if (
    filter.categoryId !== '' &&
    filter.categoryId !== 'none' &&
    transaction.categoryId !== filter.categoryId
  ) {
    return false;
  }
  if (filter.month !== '' && !transaction.occurredOn.startsWith(filter.month)) return false;
  return true;
}

/** 実際に明細がある月だけを選択肢にする(無い月を選ばせても空の一覧になるだけ)。 */
function listMonthOptions(
  transactions: readonly StoredTransaction[],
): { value: string; label: string }[] {
  const monthKeys = new Set(transactions.map((t) => t.occurredOn.slice(0, 7)));
  return [...monthKeys]
    .sort((a, b) => b.localeCompare(a))
    .map((monthKey) => {
      const [year, month] = monthKey.split('-');
      return { value: monthKey, label: `${year}年${Number(month)}月` };
    });
}
