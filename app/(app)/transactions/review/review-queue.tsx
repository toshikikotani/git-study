'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import type { StoredTransaction } from '@/features/transactions/store';
import { formatDateJa } from '@/lib/date';
import { updateTransactionAction } from '../actions';
import { createLearnedRuleAction } from './actions';

type CategoryOption = { id: string; name: string };

/**
 * 確認待ちの明細を1件ずつ確定していく(M2-5、FR-12、T-7 で実データ化)。
 *
 * 一覧はサーバー側(review/page.tsx)で取得して渡す。カテゴリを選んで
 * 確定すると:
 *   1. その明細のカテゴリが確定する(即座に画面から消える)
 *   2. 同じ摘要の学習ルールを DB に作る(次回以降の取り込みで自動的に当たる)
 * 2 が失敗しても 1 は既に終わっているので、本人の作業は無駄にならない
 * (失敗は画面下部にまとめて出す)。
 */
export function ReviewQueue({
  categories,
  initialPending,
}: {
  categories: readonly CategoryOption[];
  initialPending: readonly StoredTransaction[];
}) {
  const [pending, setPending] = useState<StoredTransaction[]>([...initialPending]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [ruleWarnings, setRuleWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (transaction: StoredTransaction) => {
    const categoryId = selected[transaction.id];
    if (!categoryId) return;

    setSavingId(transaction.id);
    setError(null);

    const result = await updateTransactionAction(transaction.id, categoryId);
    if (result.error) {
      setError(result.error);
      setSavingId(null);
      return;
    }

    const ruleResult = await createLearnedRuleAction(transaction.description, categoryId);
    if (ruleResult.error) {
      setRuleWarnings((prev) => [...prev, `「${transaction.description}」: ${ruleResult.error}`]);
    }

    setPending((prev) => prev.filter((t) => t.id !== transaction.id));
    setSavingId(null);
  };

  if (pending.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          確認待ちの明細はありません。
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {pending.map((transaction) => (
        <Card key={transaction.id}>
          <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
            {transaction.description}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {formatDateJa(transaction.occurredOn)} ・ {formatYen(transaction.amountYen)}
          </p>

          <div className="mt-3 flex gap-2">
            <select
              value={selected[transaction.id] ?? ''}
              onChange={(e) =>
                setSelected((prev) => ({ ...prev, [transaction.id]: e.target.value }))
              }
              className="flex-1 rounded-xl px-3 py-2 text-sm"
              style={{
                background: 'var(--plane)',
                color: 'var(--ink)',
                border: '1px solid var(--hairline)',
              }}
            >
              <option value="">カテゴリを選ぶ</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void confirm(transaction)}
              disabled={!selected[transaction.id] || savingId === transaction.id}
              className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {savingId === transaction.id ? '保存中…' : '確定'}
            </button>
          </div>
        </Card>
      ))}

      {error ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}

      {ruleWarnings.length > 0 ? (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          分類は反映しましたが、学習ルールを作れなかったものがあります:
          <br />
          {ruleWarnings.join(' / ')}
        </p>
      ) : null}
    </div>
  );
}
