'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import type { Account } from '@/features/accounts/store';
import type { CategoryOption } from '@/features/transfer-rules/store';
import { createTransferRuleAction } from './actions';
import { RuleForm } from './rule-form';

/** 追加ボタンとフォームの切り替え。 */
export function NewRule({
  accounts,
  categories,
}: {
  accounts: readonly Account[];
  categories: readonly CategoryOption[];
}) {
  const [adding, setAdding] = useState(false);

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="w-full rounded-full py-3 text-sm font-semibold"
        style={{
          background: 'var(--plane)',
          color: 'var(--accent)',
          border: '1px solid var(--hairline)',
        }}
      >
        + ルールを追加
      </button>
    );
  }

  return (
    <Card>
      <RuleForm
        action={createTransferRuleAction}
        accounts={accounts}
        categories={categories}
        submitLabel="登録する"
        onDone={() => setAdding(false)}
      />
    </Card>
  );
}
