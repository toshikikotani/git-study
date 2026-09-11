'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import { createCategoryAction } from './actions';
import { CategoryForm } from './category-form';

/** 追加ボタンとフォームの切り替え(M2-6)。 */
export function NewCategory() {
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
        + カテゴリを追加
      </button>
    );
  }

  return (
    <Card>
      <CategoryForm
        action={createCategoryAction}
        submitLabel="登録する"
        onDone={() => setAdding(false)}
      />
    </Card>
  );
}
