import Link from 'next/link';

import { listCategories } from '@/features/categories/store';
import { listClassificationRules } from '@/features/classification/store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { CategoryRow } from './category-row';
import { NewCategory } from './new-category';
import { RuleRow } from './rule-row';

/**
 * カテゴリと分類ルールの編集(M2-6、FR-13, NFR-02, 設計原則1)。
 *
 * カテゴリ名は初期値にすぎず、ここでいつでも変更できる(ADR-016)。
 * 統廃合は削除ではなく merged_into_id での付け替え(docs/schema.sql の方針)。
 */

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const [categories, rules] = await withMinDuration(
    Promise.all([listCategories(), listClassificationRules()]),
  );

  return (
    <div className="rise space-y-6">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          カテゴリと分類ルール
        </h1>
        <Link
          href="/rules/chat"
          className="text-[13px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          AIに相談する
        </Link>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          カテゴリ
        </h2>
        {categories.map((category) => (
          <CategoryRow key={category.id} category={category} categories={categories} />
        ))}
        <NewCategory />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          分類ルール
        </h2>
        {rules.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
            まだルールがありません。
          </p>
        ) : (
          rules.map((rule, index) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              isFirst={index === 0}
              isLast={index === rules.length - 1}
            />
          ))
        )}
      </section>
    </div>
  );
}
