/**
 * グラフの操作(長押ししてなぞる/タップ/マウスのホバー)の状態機械。
 *
 *   - 長押し(450ms)が成立すると「なぞりモード」になり、指を動かすたびに、いまの区間を返す。
 *     区間が変わったときだけ、選択の触覚と吹き出しの更新を起こす(1区間ごとに1回)。
 *   - 長押しの前に指が10px以上動いたら、ただのスクロールとして扱う(取り消し)。
 *   - 短いタップ(動きが10px未満)は、その区間を選ぶ(絞り込み)。
 *   - マウスは、押さなくても、ホバーで吹き出しを出す。
 * DOM に触れない(座標と幅は呼び出し側が渡す)ので、テストできる。
 */

import { indexAtX } from '@/features/category/series';
import { createLongPress } from '@/lib/long-press';

export type GestureConfig = {
  bucketCount: number;
  /** 棒の領域(画面上の左端と幅)。 */
  geometry: () => { left: number; width: number };
  /** 未来の区間(実績がまだない)は選べない。 */
  pickable: (index: number) => boolean;
  onTip: (index: number | null) => void;
  onHaptic: () => void;
  onPick: (index: number) => void;
};

export const TIP_LINGER_MS = 1500;

export class ChartGesture {
  private config: GestureConfig | null = null;
  private scrubbing = false;
  private last = -1;
  private down: { x: number; y: number } | null = null;
  private lingerTimer: unknown = null;
  private readonly longPress;

  constructor(
    private readonly timers: {
      setTimer: (fn: () => void, ms: number) => unknown;
      clearTimer: (id: unknown) => void;
    } = {
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    },
  ) {
    this.longPress = createLongPress({
      onLongPress: () => {
        this.scrubbing = true;
        this.config?.onHaptic();
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
  }

  /** 毎回の描画で最新の設定を渡す。 */
  configure(config: GestureConfig): void {
    this.config = config;
  }

  get isScrubbing(): boolean {
    return this.scrubbing;
  }

  private indexFor(clientX: number): number {
    const c = this.config;
    if (!c) return 0;
    const g = c.geometry();
    return indexAtX(clientX - g.left, g.width, c.bucketCount);
  }

  private visit(index: number): void {
    if (index === this.last) return;
    this.last = index;
    this.config?.onHaptic();
    this.config?.onTip(index);
  }

  pointerDown(x: number, y: number): void {
    if (this.lingerTimer !== null) this.timers.clearTimer(this.lingerTimer);
    this.lingerTimer = null;
    this.down = { x, y };
    this.last = -1;
    this.longPress.start(x, y);
  }

  pointerMove(x: number, y: number, pointerType: string): void {
    if (this.scrubbing) {
      this.visit(this.indexFor(x));
    } else if (pointerType === 'mouse') {
      this.visit(this.indexFor(x));
    } else {
      this.longPress.move(x, y);
    }
  }

  pointerUp(x: number, y: number): void {
    this.longPress.end();
    const wasScrubbing = this.scrubbing;
    this.scrubbing = false;
    const d = this.down;
    this.down = null;
    if (wasScrubbing) {
      // なぞり終わったあと、吹き出しを少しだけ残す。
      this.lingerTimer = this.timers.setTimer(() => {
        this.config?.onTip(null);
        this.last = -1;
      }, TIP_LINGER_MS);
      return;
    }
    if (d && Math.hypot(x - d.x, y - d.y) < 10) {
      const i = this.indexFor(x);
      if (this.config?.pickable(i)) this.config.onPick(i);
    }
  }

  pointerLeave(): void {
    if (this.scrubbing) return;
    this.config?.onTip(null);
    this.last = -1;
  }

  cancel(): void {
    this.longPress.end();
    this.scrubbing = false;
    this.down = null;
  }
}
