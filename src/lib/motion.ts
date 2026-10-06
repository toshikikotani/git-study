/**
 * モーションのトークン(JS 側)。CSS 側は app/globals.css の --motion-* と同じ値で、
 * tests/motion.test.ts が食い違いを検出する。
 *
 *   標準の遷移        スプリング(応答 0.35 秒、減衰 0.85 相当)
 *   小さな状態変化    250ms、ease-out
 *   金額の変化        数字が桁ごとに回転(400ms)
 *   一覧の行の出入り  高さと透明度を同時に(250ms)
 *
 * 「視差効果を減らす」がオンのときは、動きをすべてクロスフェードに置き換える。
 */

export const MOTION = {
  spring: { responseSec: 0.35, dampingFraction: 0.85 },
  smallMs: 250,
  numberMs: 400,
  rowMs: 250,
  standardMs: 350,
} as const;

/**
 * スプリング(単位ステップ応答)の値。t は秒。減衰振動の解析解:
 *   x(t) = 1 − e^(−ζω₀t) (cos ω_d t + ζ/√(1−ζ²) · sin ω_d t)
 * ω₀ = 2π / 応答、ζ = 減衰比(dampingFraction)。ζ<1 なので少しだけ行き過ぎて収まる。
 */
export function springValue(t: number, responseSec = 0.35, damping = 0.85): number {
  const w0 = (2 * Math.PI) / responseSec;
  const wd = w0 * Math.sqrt(1 - damping * damping);
  const decay = Math.exp(-damping * w0 * t);
  return 1 - decay * (Math.cos(wd * t) + ((damping * w0) / wd) * Math.sin(wd * t));
}

/** 収まるまでの時間(秒)。差が 0.1% 未満になる時刻。 */
export function springDurationSec(responseSec = 0.35, damping = 0.85): number {
  const w0 = (2 * Math.PI) / responseSec;
  return Math.log(1000) / (damping * w0);
}

/** CSS の linear() イージング(スプリングを折れ線で近似)。animation-duration は springDurationSec。 */
export function springEasing(samples = 24): string {
  const duration = springDurationSec();
  const points = Array.from({ length: samples }, (_, i) => {
    const t = (duration * i) / (samples - 1);
    return i === samples - 1 ? 1 : Math.round(springValue(t) * 1000) / 1000;
  });
  return `linear(${points.join(', ')})`;
}

export function prefersReducedMotion(
  win: Pick<Window, 'matchMedia'> | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  return win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * 数字が桁ごとに回転する表示のための計算。旧値と新値を右揃えの桁に分け、
 * それぞれの桁が「どの数字から どの数字へ」回転するかを返す(桁が増える/減るときは
 * 増えた桁だけ新しく現れる)。カンマ・記号は回転させない。
 */
export type DigitColumn =
  { kind: 'digit'; from: number; to: number; changed: boolean } | { kind: 'static'; char: string };

export function digitColumns(prev: number | null, next: number): DigitColumn[] {
  const nextText = Math.abs(next).toLocaleString('ja-JP');
  const prevText = prev === null ? '' : Math.abs(prev).toLocaleString('ja-JP');
  const columns: DigitColumn[] = [];
  const offset = nextText.length - prevText.length;
  for (let i = 0; i < nextText.length; i++) {
    const ch = nextText[i]!;
    if (!/\d/.test(ch)) {
      columns.push({ kind: 'static', char: ch });
      continue;
    }
    const prevCh = i - offset >= 0 ? prevText[i - offset] : undefined;
    const to = Number(ch);
    const from =
      prevCh !== undefined && /\d/.test(prevCh) ? Number(prevCh) : prev === null ? to : 0;
    columns.push({ kind: 'digit', from, to, changed: from !== to });
  }
  return columns;
}
