import { formatYen } from '@/domain/money';
import { isRiskyPaymentMethod } from '@/features/classification/rules';
import type { PaymentMethod } from '@/features/import/adapters';
import type { StoredTransaction } from '@/features/transactions/store';

const METHOD_LABEL: Partial<Record<PaymentMethod, string>> = {
  revolving: 'リボ払い',
  cashing: 'キャッシング',
  installment: '分割払い',
};

/**
 * 明細1行。
 *
 * 収入は緑、支出は赤。ただしこの2色は CVD で ΔE 6.5 まで近づくため、
 * 色だけに頼らず必ず符号(+/−)を併記する(globals.css の注記)。
 */
export function TransactionRow({ transaction }: { transaction: StoredTransaction }) {
  const isIncome = transaction.amountYen > 0;
  const risky = isRiskyPaymentMethod(transaction.paymentMethod);
  const methodLabel = METHOD_LABEL[transaction.paymentMethod];

  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px]" style={{ color: 'var(--ink)' }}>
          {transaction.description}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {transaction.categoryName ?? '未分類'}
          </span>

          {/* FR-21:増やしてはいけない借入は、一覧の時点で目に入るようにする */}
          {risky && methodLabel ? (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ background: 'var(--over-track)', color: 'var(--over)' }}
            >
              <span aria-hidden>!</span>
              {methodLabel}
            </span>
          ) : null}

          {/* FR-12:確信度が低く、本人の確認を待っているもの */}
          {transaction.reviewStatus === 'pending' ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
            >
              確認待ち
            </span>
          ) : null}
        </div>
      </div>

      {/* 符号は色の予備。色が落ちても収支が読める */}
      <span
        className="tabular shrink-0 text-[15px] font-semibold"
        style={{ color: isIncome ? 'var(--income)' : 'var(--ink)' }}
      >
        {isIncome ? '+' : '−'}
        {formatYen(Math.abs(transaction.amountYen))}
      </span>
    </li>
  );
}
