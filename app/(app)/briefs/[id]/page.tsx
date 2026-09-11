import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Card } from '@/components/ui/card';
import { getDailyBrief } from '@/features/briefs/store';
import { formatDateJa } from '@/lib/date';
import { BRIEF_EXCLUSION_REASON_LABELS, BRIEF_ITEM_KIND_LABELS } from '../kind-labels';

/**
 * 配信1件の詳細(M5-3、FR-32)。
 *
 * 項目(brief_items)を並び順どおりに表示する。除外ログ(brief_excluded_items)
 * があれば、なぜ載せなかったかが本人にも見えるようにする(FR-31)。
 */

export const dynamic = 'force-dynamic';

export default async function BriefDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brief = await getDailyBrief(id);
  if (!brief) notFound();

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          {formatDateJa(brief.briefOn)}
        </h1>
        <Link href="/briefs" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          一覧へ戻る
        </Link>
      </header>

      <div className="space-y-3">
        {brief.items.map((item) => (
          <Card key={item.id}>
            <p
              className="text-[11px] font-medium tracking-[0.08em] uppercase"
              style={{ color: 'var(--ink-muted)' }}
            >
              {BRIEF_ITEM_KIND_LABELS[item.kind]}
            </p>
            <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {item.title}
            </p>
            {item.summary ? (
              <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                {item.summary}
              </p>
            ) : null}
          </Card>
        ))}
      </div>

      {brief.excludedItems.length > 0 ? (
        <Card>
          <p className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
            載せなかった項目(FR-31)
          </p>
          <ul className="mt-2 space-y-2">
            {brief.excludedItems.map((item) => (
              <li key={item.id} className="text-xs leading-relaxed">
                <span style={{ color: 'var(--ink)' }}>{item.title}</span>
                <span style={{ color: 'var(--ink-muted)' }}>
                  {' '}
                  — {BRIEF_EXCLUSION_REASON_LABELS[item.reason]}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
