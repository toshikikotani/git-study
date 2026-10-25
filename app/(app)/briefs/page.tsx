import Link from 'next/link';

import { BackHeader } from '@/components/ui/back-header';
import { requireOwner } from '@/features/auth/owner';

import { Card } from '@/components/ui/card';
import { listDailyBriefs } from '@/features/briefs/store';
import { formatDateJa } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';

/**
 * 配信アーカイブ(M5-3、FR-32)。
 *
 * 「配信内容は保存され、後から検索・参照できる」ための一覧。並びは
 * `listDailyBriefs()` 側で新しい順に揃えてある。
 */

// 新しい配信が増えるたびに最新の一覧を見せる。
export const dynamic = 'force-dynamic';

export default async function BriefsPage() {
  await requireOwner();
  const briefs = await withMinDuration(listDailyBriefs());

  return (
    <div className="rise space-y-4">
      <BackHeader back={{ href: '/settings', label: '設定' }} title="朝配信" />

      {briefs.length === 0 ? (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          まだ配信がありません。
        </p>
      ) : (
        <div className="space-y-3">
          {briefs.map((brief) => (
            <Link key={brief.id} href={`/briefs/${brief.id}`} className="block min-h-11">
              <Card>
                <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  {formatDateJa(brief.briefOn)}
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {brief.headline ?? ''}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
