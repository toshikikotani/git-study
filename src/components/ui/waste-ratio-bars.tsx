import { formatMonthJa } from '@/lib/date';

export type WasteRatioPoint = {
  monthKey: string;
  /** 診断がまだ無い月は null。0% と誤読させないため、バーを描かない。 */
  ratio: number | null;
};

/** 月ごとの浪費比率(家計簿の診断カードと AIレポートで同じものを見せる)。 */
export function WasteRatioBars({ points }: { points: readonly WasteRatioPoint[] }) {
  if (points.every((p) => p.ratio === null)) return null;

  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        浪費比率の推移
      </p>
      <div className="mt-2 flex h-16 items-end gap-[3px]">
        {points.map((point) => (
          <div
            key={point.monthKey}
            className="relative h-full flex-1 overflow-hidden rounded-t-[3px]"
            style={{ background: 'var(--over-track)' }}
            title={
              point.ratio === null
                ? `${formatMonthJa(point.monthKey)}: 未診断`
                : `${formatMonthJa(point.monthKey)}: 浪費 ${Math.round(point.ratio * 100)}%`
            }
          >
            {point.ratio !== null ? (
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-[3px]"
                style={{ height: `${Math.round(point.ratio * 100)}%`, background: 'var(--over)' }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {points.map((point) => (
          <span
            key={point.monthKey}
            className="tabular flex-1 text-center text-[10px]"
            style={{ color: 'var(--ink-muted)' }}
          >
            {formatMonthJa(point.monthKey)}
          </span>
        ))}
      </div>
    </div>
  );
}
