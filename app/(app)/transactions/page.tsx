'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { TransactionRow } from '@/components/ui/transaction-row';
import { formatYen } from '@/domain/money';
import { isRiskyPaymentMethod } from '@/features/classification/rules';
import {
  transactionStore,
  type ImportBatchSummary,
  type StoredTransaction,
} from '@/features/transactions/store';
import { formatDateJa } from '@/lib/date';

/**
 * 明細一覧(FR-10 の出口)。
 *
 * 日付ごとにまとめて出す。金融機関の明細に慣れた目には、
 * 日付が繰り返し出てくる一覧よりこちらの方が追いやすい。
 */
export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<StoredTransaction[] | null>(null);
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);

  useEffect(() => {
    void (async () => {
      setTransactions(await transactionStore.list());
      setBatches(await transactionStore.batches());
    })();
  }, []);

  if (transactions === null) {
    return (
      <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
        読み込み中…
      </p>
    );
  }

  if (transactions.length === 0) {
    return <EmptyState />;
  }

  const risky = transactions.filter((t) => isRiskyPaymentMethod(t.paymentMethod));
  const pending = transactions.filter((t) => t.reviewStatus === 'pending');
  const groups = groupByDate(transactions);

  return (
    <div className="rise space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          明細
        </h1>
        <Link
          href="/transactions/import"
          className="text-[13px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          取り込む
        </Link>
      </header>

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

      {pending.length > 0 ? (
        <div
          className="flex items-center justify-between gap-3 rounded-2xl p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
            確認待ちが {pending.length} 件
          </p>
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            M2-5 で確認画面を作ります
          </span>
        </div>
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
              <TransactionRow key={t.id} transaction={t} />
            ))}
          </ul>
        </section>
      ))}

      {batches.length > 0 ? (
        <p className="px-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {transactions.length} 件 / 取り込み {batches.length} 回。
          この明細はブラウザに一時保存されています(Supabase 接続後に永続化)。
        </p>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rise space-y-4">
      <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        明細
      </h1>

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

        <Link
          href="/transactions/import"
          className="mt-5 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          CSV を取り込む
          <span aria-hidden>→</span>
        </Link>
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
