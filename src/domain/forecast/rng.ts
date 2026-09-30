/**
 * 予測エンジン専用の決定論的な乱数(M3「同じデータなら、何度開いても同じ数字を出す」)。
 *
 * Math.random() は使わない(毎回結果が変わる)。シードは呼び出し側が
 * (期間ID, データのバージョン)から文字列として作り、hashSeed() で32bit整数へ
 * 落としてから mulberry32 に渡す。乱数生成そのものに暗号強度は要らない
 * (統計シミュレーション用途のみ)。
 */

export type Rng = () => number;

/** 文字列シードを32bit整数へ(xmur3)。 */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32: 軽量な決定論的PRNG。[0,1) を返す。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: string): Rng {
  return mulberry32(hashSeed(seed));
}

/**
 * 標準正規分布(Marsaglia の極座標法)。単位円内の点を棄却法で選び、
 * 三角関数(cos/sin)を使わずに正規分布へ変換する。Box-Muller(毎回 cos を
 * 呼ぶ)より、モンテカルロで数百万回呼ぶ用途では実測で速い(1万試行規模の
 * シミュレーションを200ms級に収める必要があるため、M3で採用)。
 */
export function sampleStandardNormal(rng: Rng): number {
  let u = 0;
  let v = 0;
  let s = 0;
  do {
    u = rng() * 2 - 1;
    v = rng() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt((-2 * Math.log(s)) / s);
}

/**
 * ガンマ分布(Marsaglia-Tsang法)。shape > 0, scale > 0。
 * shape < 1 のときは shape+1 で生成した後に一様乱数の1/shape乗で補正する
 * (Gamma(shape) = Gamma(shape+1) * U^(1/shape) の性質)。
 */
export function sampleGamma(rng: Rng, shape: number, scale: number): number {
  if (shape <= 0) return 0;
  if (shape < 1) {
    const u = rng();
    return sampleGamma(rng, shape + 1, scale) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleStandardNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

/** ベータ分布(2つの独立なガンマ分布の比)。事後分布の要約に使う。 */
export function sampleBeta(rng: Rng, alpha: number, beta: number): number {
  const x = sampleGamma(rng, alpha, 1);
  const y = sampleGamma(rng, beta, 1);
  return x / (x + y);
}

/**
 * ポアソン分布。lambda <= 0 なら常に0。lambda が大きいとき(>=30)は
 * 正規近似(連続性補正つき、非負丸め)にして反復回数の爆発を避ける
 * (家計の1日あたりの回数では通常発生しないが、安全側として用意)。
 */
export function samplePoisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda >= 30) {
    const z = sampleStandardNormal(rng);
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
  }
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > l);
  return k - 1;
}

/** 対数正規分布。muは log(円) の平均、sigmaは log(円) の標準偏差。 */
export function sampleLognormal(rng: Rng, mu: number, sigma: number): number {
  return Math.exp(mu + sigma * sampleStandardNormal(rng));
}

/** 配列から重み無しで1件を一様に選ぶ(特別費の再標本化用)。 */
export function pickOne<T>(rng: Rng, items: readonly T[]): T {
  const idx = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[idx]!;
}

/** 重み付きで1件を選ぶ(ブロック・ブートストラップの直近優先サンプリング用)。 */
export function pickWeighted<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  if (total <= 0) return pickOne(rng, items);
  let target = rng() * total;
  for (const item of items) {
    target -= weightOf(item);
    if (target <= 0) return item;
  }
  return items[items.length - 1]!;
}
