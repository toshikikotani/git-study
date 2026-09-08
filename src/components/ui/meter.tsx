import type { BudgetTone } from '@/domain/budget';
import { MILESTONES } from '@/features/home/summary';

/**
 * 予算の消化を示すメーター。
 *
 * 仕様(dataviz: marks-and-anatomy):
 *   - 塗りが重要度を運ぶ。残りのトラックは同一ランプの明るい段
 *   - データ端は 4px 丸め、起点側は角のまま
 *   - 色だけで意味を運ばない。呼び出し側が必ず数値ラベルを添える
 *
 * 重要度は2段(通常=青 / 超過=赤)。中間にオレンジを挟む案は、
 * 赤との通常視 ΔE が 7.1 で識別できずバリデータが落としたため採らない。
 * 70% 到達は色ではなくラベルで示す。
 */
export function Meter({
  ratio,
  tone,
  label,
}: {
  /** 消化率。1 を超えることがある。 */
  ratio: number | null;
  tone: BudgetTone;
  /** スクリーンリーダー向けの説明。 */
  label: string;
}) {
  if (ratio === null) {
    return (
      <div
        className="h-1.5 w-full rounded-full"
        style={{ background: 'var(--hairline)' }}
        aria-hidden
      />
    );
  }

  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  const isOver = tone === 'over';

  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: isOver ? 'var(--over-track)' : 'var(--accent-track)' }}
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="h-full rounded-r-[4px] transition-[width] duration-700 ease-out"
        style={{
          width: `${percent}%`,
          background: isOver ? 'var(--over)' : 'var(--accent)',
        }}
      />
    </div>
  );
}

/**
 * 完済の進捗ゲージ(FR-63)。
 *
 * 返済アプリが例外なく持つ 25/50/75/100% のマイルストーンを刻む。
 * 節目が見えていると、次の一歩までの距離が具体的になる。
 * 到達済みの節目は塗りの上に載るため、色を反転させて視認性を保つ。
 */
export function ProgressGauge({
  ratio,
  label,
  nextMilestone,
}: {
  ratio: number;
  label: string;
  /** 次に到達する節目(0.25 など)。全て達成済みなら null。 */
  nextMilestone?: number | null | undefined;
}) {
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const percent = Math.round(clamped * 100);

  return (
    <div>
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--accent-track)' }}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-r-[4px] transition-[width] duration-1000 ease-out"
          style={{ width: `${percent}%`, background: 'var(--accent)' }}
        />

        {/* 節目。到達済みは塗りの上に乗るので、サーフェス色で切る */}
        {MILESTONES.filter((m) => m < 1).map((m) => {
          const reached = clamped >= m;
          return (
            <span
              key={m}
              aria-hidden
              className="absolute top-0 h-full w-px"
              style={{
                left: `${m * 100}%`,
                background: reached ? 'var(--surface-raised)' : 'var(--accent)',
                opacity: reached ? 0.85 : 0.35,
              }}
            />
          );
        })}
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {label}
          {nextMilestone != null && nextMilestone < 1 ? (
            <span style={{ color: 'var(--ink-muted)' }}>
              {' · 次の節目 '}
              {Math.round(nextMilestone * 100)}%
            </span>
          ) : null}
        </span>
        <span className="tabular text-xs font-semibold" style={{ color: 'var(--accent)' }}>
          {percent}%
        </span>
      </div>
    </div>
  );
}
