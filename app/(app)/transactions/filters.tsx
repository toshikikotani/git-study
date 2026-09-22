'use client';

/**
 * 明細一覧の絞り込み(本人発案:「プルダウンなどで表示するっていうのもあり」)。
 *
 * 「全期間・全件」が既定の一覧は、明細が増えるほど目的の行を探しにくくなる。
 * 口座・カテゴリ・月の3つで絞り込めるようにする。選択状態は URL のクエリ
 * パラメータに持たせ(サーバー側で絞り込む)、ブックマーク・共有・再読み込みで
 * 状態が消えないようにした。
 */

import { useRouter } from 'next/navigation';

export type TransactionFilterState = {
  accountId: string;
  categoryId: string;
  month: string;
};

const SELECT_STYLE = {
  background: 'var(--plane)',
  color: 'var(--ink-secondary)',
  border: '1px solid var(--hairline)',
} as const;

export function TransactionFilters({
  accounts,
  categories,
  months,
  current,
}: {
  accounts: readonly { id: string; name: string }[];
  categories: readonly { id: string; name: string }[];
  months: readonly { value: string; label: string }[];
  current: TransactionFilterState;
}) {
  const router = useRouter();

  function update(patch: Partial<TransactionFilterState>): void {
    const next = { ...current, ...patch };
    const params = new URLSearchParams();
    if (next.accountId) params.set('account', next.accountId);
    if (next.categoryId) params.set('category', next.categoryId);
    if (next.month) params.set('month', next.month);
    const query = params.toString();
    router.push(query ? `/transactions?${query}` : '/transactions');
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="明細の絞り込み">
      <select
        value={current.accountId}
        onChange={(e) => update({ accountId: e.target.value })}
        aria-label="口座で絞り込む"
        className="rounded-full px-2.5 py-1 text-[11px] font-medium"
        style={SELECT_STYLE}
      >
        <option value="">すべての口座</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>

      <select
        value={current.categoryId}
        onChange={(e) => update({ categoryId: e.target.value })}
        aria-label="カテゴリで絞り込む"
        className="rounded-full px-2.5 py-1 text-[11px] font-medium"
        style={SELECT_STYLE}
      >
        <option value="">すべてのカテゴリ</option>
        <option value="none">未分類</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>

      <select
        value={current.month}
        onChange={(e) => update({ month: e.target.value })}
        aria-label="月で絞り込む"
        className="rounded-full px-2.5 py-1 text-[11px] font-medium"
        style={SELECT_STYLE}
      >
        <option value="">全期間</option>
        {months.map((month) => (
          <option key={month.value} value={month.value}>
            {month.label}
          </option>
        ))}
      </select>
    </div>
  );
}
