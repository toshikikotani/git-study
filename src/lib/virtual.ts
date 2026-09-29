/**
 * 仮想化(画面に見えている行だけを描画する)の計算。DOM に触れない。
 *
 * 行の高さは、まず見積もり(estimate)で置き、実際に描画されて測れた行から本当の高さに
 * 差し替える。位置(offset)は高さの累積和で、1万件でも二分探索で見える範囲を出せる
 * (再計算は高さが変わったときだけ、O(n))。
 */
export class VirtualIndex {
  private heights: number[];
  private offsets: number[] | null = null;

  constructor(
    private count: number,
    private readonly estimate: number,
  ) {
    this.heights = new Array<number>(count).fill(estimate);
  }

  get length(): number {
    return this.count;
  }

  /** 件数が変わったとき(測れた高さは、同じ位置なら引き継ぐ)。 */
  resize(count: number): void {
    if (count === this.count) return;
    const next = new Array<number>(count).fill(this.estimate);
    for (let i = 0; i < Math.min(count, this.count); i++) next[i] = this.heights[i]!;
    this.heights = next;
    this.count = count;
    this.offsets = null;
  }

  /** 実際に測れた高さ。変わったときだけ true。 */
  setHeight(index: number, height: number): boolean {
    if (index < 0 || index >= this.count) return false;
    const h = Math.max(1, Math.round(height));
    if (this.heights[index] === h) return false;
    this.heights[index] = h;
    this.offsets = null;
    return true;
  }

  private build(): number[] {
    if (this.offsets) return this.offsets;
    const offsets = new Array<number>(this.count + 1);
    offsets[0] = 0;
    for (let i = 0; i < this.count; i++) offsets[i + 1] = offsets[i]! + this.heights[i]!;
    this.offsets = offsets;
    return offsets;
  }

  offsetOf(index: number): number {
    return this.build()[Math.min(Math.max(index, 0), this.count)]!;
  }

  totalHeight(): number {
    return this.build()[this.count]!;
  }

  /** scrollTop〜scrollTop+viewport に見える行の範囲 [start, end)(前後に overscan 行を足す)。 */
  range(scrollTop: number, viewport: number, overscan = 6): { start: number; end: number } {
    if (this.count === 0) return { start: 0, end: 0 };
    const offsets = this.build();
    const lower = (target: number): number => {
      // target を含む行(offsets[i] <= target < offsets[i+1])
      let lo = 0;
      let hi = this.count - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid]! <= target) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const first = lower(Math.max(scrollTop, 0));
    const last = lower(Math.max(scrollTop + viewport, 0));
    return {
      start: Math.max(0, first - overscan),
      end: Math.min(this.count, last + 1 + overscan),
    };
  }
}

/** タブごとのスクロール位置を覚えておく(切り替えて戻ったとき、続きから見られる)。 */
export class ScrollMemory<K extends string> {
  private positions = new Map<K, number>();
  save(key: K, y: number): void {
    this.positions.set(key, Math.max(0, Math.round(y)));
  }
  get(key: K): number | null {
    return this.positions.get(key) ?? null;
  }
}
