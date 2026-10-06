/**
 * 予測の画面(M6)で共通の小さな部品。色・角丸・文字の大きさは既存のトークンだけを使う。
 * 統計用語は出さない(「10回中8回」「目安」など、docs/WRITING.md)。
 */

import { approxYen } from '@/domain/forecast/format';
import { LEARNING_DATA_DAYS } from '@/domain/forecast/simulate';
import type { Forecast } from '@/domain/forecast/types';

/** 「10回中N回」を10個の点で見せる。点は色だけでなく塗り/枠でも区別する。 */
export function TenDots({
  filled,
  onDark = false,
  size = 'sm',
}: {
  filled: number;
  onDark?: boolean;
  size?: 'sm' | 'lg';
}) {
  const fill = onDark ? 'var(--on-accent)' : 'var(--ink-secondary)';
  const ring = onDark ? 'var(--on-accent)' : 'var(--ink-muted)';
  const box = size === 'lg' ? 'h-5 rounded-full' : 'h-3 w-3 rounded-full';
  return (
    <span
      aria-hidden
      className={size === 'lg' ? 'grid flex-1 grid-cols-10 gap-1' : 'flex gap-1'}
    >
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className={box}
          style={
            i < filled
              ? { background: fill }
              : { border: `1.5px dashed ${ring}`, opacity: onDark ? 0.6 : 1 }
          }
        />
      ))}
    </span>
  );
}

/** 学習中・目安のバッジ。当たり具合を過去の月で確かめるまでは常に「目安」。 */
export function ForecastBadge({
  forecast,
  onDark = false,
}: {
  forecast: Pick<Forecast, 'status' | 'calibration'>;
  onDark?: boolean;
}) {
  const label = forecast.status === 'learning' ? '学習中' : forecast.calibration ? null : '目安';
  if (label === null) return null;
  return (
    <span
      className="rounded-full px-2 py-1 text-xs font-semibold"
      style={
        onDark
          ? { background: 'color-mix(in srgb, var(--on-accent) 18%, transparent)', color: 'var(--on-accent)' }
          : { background: 'var(--plane)', color: 'var(--ink-secondary)' }
      }
    >
      {label}
    </span>
  );
}

/** 学習中の一言(あと何日で学習が終わるか)。 */
export function learningNote(forecast: Pick<Forecast, 'status' | 'dataDays'>): string | null {
  if (forecast.status !== 'learning') return null;
  const left = Math.max(1, LEARNING_DATA_DAYS - forecast.dataDays);
  return `記録が増えるほど見込みが正確になります(あと${left}日)。いまの幅は広めです`;
}

/**
 * 1本の横棒:実績(濃い)・10回中8回の幅(淡い帯)・中央(点)・目標(縦線)。
 * scaleYen は棒の右端に当たる金額。
 */
export function BandBar({
  actualYen,
  low,
  mid,
  high,
  targetYen,
  scaleYen,
  tone,
}: {
  actualYen: number;
  low: number;
  mid: number;
  high: number;
  targetYen: number | null;
  scaleYen: number;
  tone: 'ok' | 'caution' | 'over';
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / Math.max(1, scaleYen)) * 100))}%`;
  const dot =
    tone === 'over'
      ? 'var(--state-over)'
      : tone === 'caution'
        ? 'var(--state-caution)'
        : 'var(--state-ok)';
  return (
    <div aria-hidden className="relative h-5">
      <div
        className="absolute inset-x-0 top-2 h-2 rounded-full"
        style={{ background: 'var(--plane)' }}
      />
      <div
        className="absolute top-2 h-2 rounded-full"
        style={{
          left: pct(low),
          width: `calc(${pct(high)} - ${pct(low)})`,
          background: 'var(--state-ok-track)',
        }}
      />
      <div
        className="absolute left-0 top-2 h-2 rounded-full"
        style={{ width: pct(actualYen), background: 'var(--ink-secondary)' }}
      />
      {targetYen !== null ? (
        <div
          className="absolute top-0 h-5"
          style={{ left: pct(targetYen), width: 2, background: 'var(--ink)' }}
        />
      ) : null}
      <div
        className="absolute top-1 h-3 w-3 rounded-full"
        style={{
          left: `calc(${pct(mid)} - 6px)`,
          background: dot,
          boxShadow: '0 0 0 2px var(--surface)',
        }}
      />
    </div>
  );
}

/** 目標との差の一言(「このままだと 約8,800円オーバー」「目標まで 約8,600円」)。 */
export function targetGapLabel(landingP50: number, targetYen: number): {
  text: string;
  over: boolean;
} {
  const gap = landingP50 - targetYen;
  if (gap > 0) return { text: `このままだと ${approxYen(gap)}オーバー`, over: true };
  return { text: `目標まで ${approxYen(-gap)}`, over: false };
}

export function Pill({ children, over }: { children: React.ReactNode; over: boolean }) {
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-semibold"
      style={
        over
          ? { background: 'var(--state-caution-track)', color: 'var(--ink)' }
          : { background: 'var(--state-ok-track)', color: 'var(--ink)' }
      }
    >
      {children}
    </span>
  );
}
