'use client';

import { formatYen } from '@/domain/money';
import type { GoalRange } from '@/domain/goal-range';

export function GoalChart({ range }: { range: GoalRange }) {
  const max = Math.max(range.targetYen, range.highYen, range.spentYen, 1);
  const y = (yen: number) => 100 - (yen / max) * 100;
  const spentX = 28;
  const endX = 92;
  return (
    <section
      aria-label="目標と照らした着地範囲"
      className="rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        目標 {formatYen(range.targetYen, { sign: 'never' })}
      </p>
      <div className="relative mt-3 h-40">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img">
          <line
            x1="4"
            y1={y(range.targetYen)}
            x2="96"
            y2={y(range.targetYen)}
            stroke="var(--hairline)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <polygon
            points={`${spentX},${y(range.highYen)} ${endX},${y(range.highYen)} ${endX},${y(range.lowYen)} ${spentX},${y(range.lowYen)}`}
            fill="var(--income)"
            opacity="0.2"
          />
          <line
            x1="4"
            y1={y(0)}
            x2={endX}
            y2={y(range.targetYen)}
            stroke="var(--income)"
            strokeWidth="1.4"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={`4,${y(0)} ${spentX},${y(range.spentYen)}`}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={spentX}
            y1={y(range.spentYen)}
            x2={endX}
            y2={y(range.pointYen)}
            stroke="var(--over)"
            strokeWidth="1.6"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="absolute text-[11px]"
          style={{ left: '30%', top: `${y(range.spentYen)}%`, color: 'var(--ink-secondary)' }}
        >
          {range.spentYen > range.idealYen
            ? `理想より${formatYen(range.spentYen - range.idealYen, { sign: 'never' })}多い`
            : `理想より${formatYen(range.idealYen - range.spentYen, { sign: 'never' })}少ない`}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
        着地の範囲は {formatYen(range.lowYen, { sign: 'never' })} から{' '}
        {formatYen(range.highYen, { sign: 'never' })}。 点予測は{' '}
        {formatYen(range.pointYen, { sign: 'never' })}。
        {range.saveYen > 0
          ? `目標まで戻すと ${formatYen(range.saveYen, { sign: 'never' })} 残る。`
          : '点予測は目標の中に収まっている。'}
      </p>
    </section>
  );
}
