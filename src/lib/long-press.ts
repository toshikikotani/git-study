/**
 * 長押しの判定(撮影ボタンの「手入力 / 写真から選ぶ / 連続撮影」メニュー)。
 * 押し始めから delay ミリ秒たったら onLongPress を呼ぶ。指が動いた・離れた場合は取り消す。
 * 長押しが成立したあとに続けて起きる「クリック」は、consumeClick() で打ち消す
 * (長押しのあとに撮影が始まってしまわないように)。
 */
export const LONG_PRESS_MS = 450;
export const LONG_PRESS_MOVE_TOLERANCE = 10;

export function createLongPress(options: {
  onLongPress: () => void;
  delay?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}) {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let fired = false;
  let origin: { x: number; y: number } | null = null;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    origin = null;
  };

  return {
    start(x: number, y: number) {
      cancel();
      fired = false;
      origin = { x, y };
      timer = setTimer(() => {
        timer = null;
        fired = true;
        options.onLongPress();
      }, options.delay ?? LONG_PRESS_MS);
    },
    move(x: number, y: number) {
      if (origin === null) return;
      if (Math.hypot(x - origin.x, y - origin.y) > LONG_PRESS_MOVE_TOLERANCE) cancel();
    },
    end: cancel,
    /** 長押しが成立していたら true(1回だけ)。クリックを打ち消すかどうかの判断に使う。 */
    consumeClick(): boolean {
      const was = fired;
      fired = false;
      return was;
    },
  };
}
