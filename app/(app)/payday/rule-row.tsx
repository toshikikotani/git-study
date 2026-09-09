'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import type { Account } from '@/features/accounts/store';
import type { CategoryOption, TransferRule } from '@/features/transfer-rules/store';
import {
  deleteTransferRuleAction,
  moveTransferRuleDownAction,
  moveTransferRuleUpAction,
  updateTransferRuleAction,
} from './actions';
import { RuleForm } from './rule-form';

/** 一覧の1件。読み取り表示と編集フォームをこの中で切り替える。 */
export function RuleRow({
  rule,
  accounts,
  categories,
  isFirst,
  isLast,
}: {
  rule: TransferRule;
  accounts: readonly Account[];
  categories: readonly CategoryOption[];
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Card>
        <RuleForm
          action={updateTransferRuleAction.bind(null, rule.id)}
          initial={rule}
          accounts={accounts}
          categories={categories}
          submitLabel="更新する"
          onDone={() => setEditing(false)}
        />
      </Card>
    );
  }

  const toAccountName = accounts.find((a) => a.id === rule.toAccountId)?.name ?? null;
  const categoryName = categories.find((c) => c.id === rule.categoryId)?.name ?? null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="tabular flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
          >
            {rule.executionOrder}
          </span>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {rule.name}
            </h3>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-secondary)' }}>
              {describeAmount(rule)}
              {toAccountName ? ` ・ ${toAccountName}へ` : ''}
              {categoryName ? ` ・ ${categoryName}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          編集
        </button>
      </div>

      {rule.note ? (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {rule.note}
        </p>
      ) : null}

      <div
        className="mt-3 flex items-center gap-3 border-t pt-2"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <form action={moveTransferRuleUpAction.bind(null, rule.id)}>
          <button
            type="submit"
            disabled={isFirst}
            className="text-xs font-medium disabled:opacity-30"
            style={{ color: 'var(--ink-secondary)' }}
          >
            ↑ 上へ
          </button>
        </form>
        <form action={moveTransferRuleDownAction.bind(null, rule.id)}>
          <button
            type="submit"
            disabled={isLast}
            className="text-xs font-medium disabled:opacity-30"
            style={{ color: 'var(--ink-secondary)' }}
          >
            ↓ 下へ
          </button>
        </form>
        <form action={deleteTransferRuleAction.bind(null, rule.id)} className="ml-auto">
          <button type="submit" className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            削除
          </button>
        </form>
      </div>
    </Card>
  );
}

function describeAmount(rule: TransferRule): string {
  if (rule.amountType === 'fixed' && rule.amountYen !== null) {
    return formatYen(rule.amountYen, { sign: 'never' });
  }
  if (rule.amountType === 'percentage' && rule.percentage !== null) {
    return `入金額の${rule.percentage}%`;
  }
  return '残り全額';
}
