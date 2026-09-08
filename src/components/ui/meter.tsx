import type { BudgetTone } from '@/domain/budget';

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
      style={{ background: isOver ? 'var(--over-soft)' : 'var(--accent-soft)' }}
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
 * 返済済みの割合。減っていく残債ではなく「進んだ分」を見せる。
 */
export function ProgressGauge({ ratio, label }: { ratio: number; label: string }) {
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);

  return (
    <div>
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--accent-soft)' }}
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
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {label}
        </span>
        <span className="tabular text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
          {percent}%
        </span>
      </div>
    </div>
  );
}
