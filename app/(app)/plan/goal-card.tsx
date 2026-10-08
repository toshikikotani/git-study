import Link from 'next/link';

import { Yen } from '@/components/ui/money';
import { STATE_COLOR } from '@/domain/budget-state';
import { formatYen } from '@/domain/money';
import type { GoalCardModel } from '@/features/goals/card';
import { formatDateJa } from '@/lib/date';

/**
 * 目標カード。第一行は確保した貯蓄。今日あとは出さない。
 * 予定と自由残は内訳に置く。注意と「近づいています」は同時に出さない。
 * 状態バッジは注意・超過のときだけ。予定の行は展開して日付・名前・金額・ジャンルを見られる。
 */
export function GoalCard({ model }: { model: GoalCardModel }) {
  const { primary } = model;
  return (
    <section
      aria-label="目標"
      className="glass rounded-2xl p-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        目標 {model.periodLabel} ・ {model.remainingLabel}
      </p>

      <details className="mt-2">
        <summary
          className="min-h-11 cursor-pointer list-none"
          aria-label="確保した貯蓄(タップで内訳)"
        >
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {primary.label}
              </p>
              <p
                className="tabular text-4xl leading-tight font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                {primary.amountYen === null ? '—' : <Yen value={primary.amountYen} />}
              </p>
            </div>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-secondary)' }}>
            {model.summary}
            {primary.note ? `。${primary.note}` : ''}
            <span className="ml-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
              内訳を見る →
            </span>
          </p>
          {model.forecast ? (
            <p
              className="mt-1 text-sm leading-relaxed"
              style={{ color: STATE_COLOR[model.forecast.tone] }}
            >
              {model.forecast.text}
            </p>
          ) : null}
        </summary>

        <dl
          className="mt-3 space-y-2 border-t pt-3 text-sm"
          style={{ borderColor: 'var(--hairline)' }}
        >
          {model.details.map((d) => (
            <div key={d.key} className="flex justify-between gap-3">
              <dt style={{ color: 'var(--ink-muted)' }}>{d.label}</dt>
              <dd className="tabular text-right" style={{ color: 'var(--ink)' }}>
                {d.text}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      {model.scheduled ? (
        <details className="mt-3 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
          <summary className="min-h-11 flex cursor-pointer items-baseline justify-between gap-3 text-sm">
            <span style={{ color: 'var(--ink-secondary)' }}>
              予定の支出 {model.scheduled.count}件
            </span>
            <span className="tabular" style={{ color: 'var(--ink)' }}>
              {formatYen(model.scheduled.totalYen, { sign: 'never' })} →
            </span>
          </summary>
          <ul className="mt-2 space-y-2">
            {model.scheduled.items.map((i) => (
              <li key={i.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0" style={{ color: 'var(--ink)' }}>
                  <span className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {formatDateJa(i.date)}
                  </span>{' '}
                  {i.label}
                  <span className="ml-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {i.genreName ?? '未分類'}
                  </span>
                </span>
                <span className="tabular shrink-0" style={{ color: 'var(--ink)' }}>
                  {formatYen(i.amountYen, { sign: 'never' })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {model.uncategorized ? (
        <Link
          href="/spending/category/none"
          className="min-h-11 mt-3 flex items-baseline justify-between gap-3 border-t pt-3 text-sm"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <span style={{ color: 'var(--ink-secondary)' }}>
            未分類 {formatYen(model.uncategorized.yen, { sign: 'never' })}(目標に未反映)
          </span>
          <span style={{ color: 'var(--ink)' }}>分類する →</span>
        </Link>
      ) : null}

      {model.pending ? (
        <p
          className="mt-3 border-t pt-3 text-sm"
          style={{ borderColor: 'var(--hairline)', color: 'var(--ink-secondary)' }}
        >
          入力待ちのレシート {model.pending.count}件(目標に未反映)
        </p>
      ) : null}
    </section>
  );
}
