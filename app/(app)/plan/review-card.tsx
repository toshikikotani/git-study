'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatSignedYen } from '@/domain/budget-state';
import { formatYen } from '@/domain/money';
import type { GoalReview } from '@/domain/goal-review';
import { createNextPlanAction } from './actions';

/**
 * 振り返り(目標期間の終了後):ジャンルごとの目標と実績、うまくいった点1つ、
 * 次に見直すジャンル1つ。「この結果で次の目標を作る」で、実績を反映した次の目標案を
 * そのまま保存する(あとから配分は直せる)。記録 → 目標 → 振り返り → 次の目標 のループ。
 * 超えたジャンルも責めず、数字とできたことを先に見せる。
 */
export function ReviewCard({ planId, review }: { planId: string; review: GoalReview }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = async () => {
    setBusy(true);
    setError(null);
    const result = await createNextPlanAction(planId);
    setBusy(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <section
      aria-label="目標の振り返り"
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        振り返り
      </p>
      <p className="tabular mt-1 text-sm" style={{ color: 'var(--ink)' }}>
        合計 目標 {formatYen(review.targetYen, { sign: 'never' })} ・ 実績{' '}
        {formatYen(review.actualYen, { sign: 'never' })}
      </p>

      <table className="mt-3 w-full text-xs">
        <caption className="sr-only">ジャンルごとの目標と実績</caption>
        <thead>
          <tr style={{ color: 'var(--ink-muted)' }}>
            <th scope="col" className="pb-1 text-left font-medium">
              ジャンル
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              目標
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              実績
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              差
            </th>
          </tr>
        </thead>
        <tbody>
          {review.rows.map((r) => (
            <tr key={r.genreId} style={{ color: 'var(--ink)' }}>
              <th scope="row" className="py-1 text-left font-normal">
                {r.genreName}
              </th>
              <td className="tabular py-1 text-right">
                {formatYen(r.targetYen, { sign: 'never' })}
              </td>
              <td className="tabular py-1 text-right">
                {formatYen(r.actualYen, { sign: 'never' })}
              </td>
              <td
                className="tabular py-1 text-right"
                style={{ color: r.met ? 'var(--state-ok)' : 'var(--ink-secondary)' }}
              >
                {r.met ? '✓ ' : ''}
                {formatSignedYen(r.diffYen)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div
        className="mt-3 space-y-1.5 border-t pt-3 text-xs leading-relaxed"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <p style={{ color: 'var(--ink)' }}>
          <span className="font-semibold">うまくいった点:</span> {review.goodPoint}
        </p>
        {review.reviewGenre ? (
          <p style={{ color: 'var(--ink)' }}>
            <span className="font-semibold">次に見直す:</span> {review.reviewGenre.genreName}(
            {review.reviewGenre.reason})
          </p>
        ) : null}
      </div>

      <Button variant="filled" className="mt-4 w-full" disabled={busy} onClick={() => void next()}>
        {busy ? '次の目標を作っています…' : 'この結果で次の目標を作る'}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
