'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import { createAccountAction } from './actions';
import { AccountForm } from './account-form';

/** 追加ボタンとフォームの切り替え。 */
export function NewAccount() {
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
        + 口座を追加
      </button>
    );
  }

  return (
    <Card>
      <AccountForm
        action={createAccountAction}
        submitLabel="登録する"
        onDone={() => setAdding(false)}
      />
    </Card>
  );
}
