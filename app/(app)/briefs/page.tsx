import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import { listDailyBriefs } from '@/features/briefs/store';
import { formatDateJa } from '@/lib/date';

/**
 * 配信アーカイブ(M5-3、FR-32)。
 *
 * 「配信内容は保存され、後から検索・参照できる」ための一覧。並びは
 * `listDailyBriefs()` 側で新しい順に揃えてある。
 */

// 新しい配信が増えるたびに最新の一覧を見せる。
export const dynamic = 'force-dynamic';

export default async function BriefsPage() {
  const briefs = await listDailyBriefs();

  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          朝配信
        </h1>
      </header>

      {briefs.length === 0 ? (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          まだ配信がありません。
        </p>
      ) : (
        <div className="space-y-3">
          {briefs.map((brief) => (
            <Link key={brief.id} href={`/briefs/${brief.id}`}>
              <Card>
                <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  {formatDateJa(brief.briefOn)}
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {brief.daysToPayoff === null ? '完済済み' : `完済まで残り${brief.daysToPayoff}日`}
                  {brief.remainingDebtYen !== null
                    ? ` ・ 残債${formatYen(brief.remainingDebtYen, { sign: 'never' })}`
                    : ''}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
