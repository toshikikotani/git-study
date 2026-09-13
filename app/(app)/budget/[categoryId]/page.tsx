import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StatTile } from '@/components/ui/stat-tile';
import { budgetTone } from '@/domain/budget';
import { formatSpendable, formatYen, spendableParts } from '@/domain/money';
import { loadCategoryMonthDetail } from '@/features/categories/category-detail-store';
import { formatDateJa } from '@/lib/date';

/**
 * ホームの予算タイル1枠分の詳細(本人発案:「生活費って押したら一覧
 * みたいなん」を見れるようにしたい)。
 *
 * 上部はホーム(app/(app)/page.tsx)と同じ StatTile を再利用し、数字が
 * タイルと必ず一致することを見た目でも裏付ける。下は当月の該当明細を
 * 日付の新しい順に並べ、各行に金額の大きさに応じたバーを添える
 * (本人の要望どおり「一覧」を「バー」で見せる)。
 */

// 当月の金額は常に最新でなければならない(ADR-001と同じ考え方)。
export const dynamic = 'force-dynamic';

export default async function BudgetCategoryDetailPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = await params;
  const detail = await loadCategoryMonthDetail(categoryId);
  if (!detail) notFound();

  const { categoryName, status, transactions } = detail;
  const tone = budgetTone(status, status.code === 'sanctuary' ? 'sanctuary' : 'other');
  const maxAbsYen = Math.max(...transactions.map((t) => Math.abs(t.amountYen)), 1);

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          {categoryName}
        </h1>
        <Link href="/" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          ホームへ戻る
        </Link>
      </header>

      <StatTile
        label={categoryName}
        value={status.remainingYen === null ? '予算なし' : formatSpendable(status.remainingYen)}
        valueParts={status.remainingYen === null ? undefined : spendableParts(status.remainingYen)}
        sub={
          status.budgetYen === null
            ? undefined
            : `${formatYen(status.spentYen)} / ${formatYen(status.budgetYen)}`
        }
        ratio={status.usageRatio}
        tone={tone}
        note={status.usageRatio === null ? undefined : `${Math.round(status.usageRatio * 100)}%`}
      />

      {transactions.length === 0 ? (
        <p className="px-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
          今月、このカテゴリの明細はまだありません。
        </p>
      ) : (
        <div
          className="rounded-[22px] p-5"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
            今月の明細({transactions.length}件)
          </p>
          <ul className="mt-3 space-y-3">
            {transactions.map((t) => {
              const percent = Math.round((Math.abs(t.amountYen) / maxAbsYen) * 100);
              const isIncome = t.amountYen > 0;
              return (
                <li key={t.id}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium" style={{ color: 'var(--ink)' }}>
                        {t.merchantName ?? t.description}
                      </span>
                      <span style={{ color: 'var(--ink-muted)' }}>
                        {formatDateJa(t.occurredOn)}
                      </span>
                    </span>
                    <span
                      className="tabular shrink-0 font-medium"
                      style={{ color: isIncome ? 'var(--income)' : 'var(--ink)' }}
                    >
                      {formatYen(t.amountYen)}
                    </span>
                  </div>
                  <div
                    className="mt-1 h-2 overflow-hidden rounded-full"
                    style={{ background: isIncome ? 'var(--income-track)' : 'var(--over-track)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${percent}%`,
                        background: isIncome ? 'var(--income)' : 'var(--over)',
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
