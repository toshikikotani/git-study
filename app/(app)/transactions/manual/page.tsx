import Link from 'next/link';

import { listAccounts } from '@/features/accounts/store';
import { listCategoryOptions } from '@/features/classification/store';
import { todayJst } from '@/lib/date';
import { ManualEntryForm } from './manual-entry-form';

/**
 * 明細の手動登録(本人発案)。
 *
 * 取り込み経路(CSV・メール貼り付け・レシート撮影)はどれも「何かしらの
 * 記録(ファイル・メール本文・写真)がある」ことが前提になっている。
 * 口頭で金額と日付が分かっているだけの支払い(記録を残し忘れた、
 * そもそも紙もメールも残らない支払いなど)を1件だけ直接入力したい
 * という要望に応える、最後の砦としての経路。
 *
 * 取り込みバッチと同じ `importTransactions()`(actions.ts の
 * `createManualTransactionAction`)にそのまま乗せるため、二重計上の
 * 検知(fingerprint)や確認待ちキューへの合流もほかの経路と同じに動く。
 */
export default async function ManualTransactionPage() {
  const [accounts, categories] = await Promise.all([listAccounts(), listCategoryOptions()]);

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          手動で記録する
        </h1>
        <Link href="/transactions" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          やめる
        </Link>
      </header>

      <div
        className="rounded-2xl p-4"
        style={{ background: 'var(--accent-track)', boxShadow: 'var(--card-shadow)' }}
      >
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          レシートも通知メールも残らない支払いを、金額と日付だけで1件記録します。 撮影できる場合は
          <Link href="/transactions/receipt" className="mx-1 underline decoration-dotted">
            レシート撮影
          </Link>
          の方が手間が少なく画像も残ります。
        </p>
      </div>

      <ManualEntryForm
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories}
        defaultOccurredOn={todayJst()}
      />
    </div>
  );
}
