'use client';

import { useLayoutEffect, useRef } from 'react';

export type Pt = [number, number]; // 描画領域に対する割合(%)。x は左から、y は上から。

export type DeltaGeometry = {
  /** 先端の点。 */
  end: Pt;
  /** 避ける線(累計・理想・予測・帯の縁)の点列。 */
  lines: Pt[][];
  /** 避ける帯(多角形)。 */
  band: Pt[] | null;
};

const GAP = 8;

function inPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 候補の位置(先端の点の上下左右)から、線・帯・描画領域の端と重ならない位置を選ぶ。
 * 描画領域の実寸とラベルの実寸を測って決める(画面の幅や文字の大きさで変わるため)。
 */
export function chooseDeltaPosition(input: {
  plot: { w: number; h: number };
  label: { w: number; h: number };
  geometry: DeltaGeometry;
}): { left: number; top: number; clear: boolean } {
  const { plot, label, geometry } = input;
  const X = (geometry.end[0] / 100) * plot.w;
  const Y = (geometry.end[1] / 100) * plot.h;
  // 先端の点の周りの候補(点に近い順)。横は 右寄せ・左・左寄せ・右、縦は 上・中・下・さらに下。
  const xs = [X - label.w + 4, X - label.w - GAP, X - 4, X + GAP];
  const ys = [Y - label.h - GAP, Y - label.h / 2, Y + GAP, Y + GAP + label.h];
  const cands: [number, number][] = xs
    .flatMap((left) => ys.map((top): [number, number] => [left, top]))
    .sort(
      (a, b) =>
        Math.hypot(a[0] + label.w / 2 - X, a[1] + label.h / 2 - Y) -
        Math.hypot(b[0] + label.w / 2 - X, b[1] + label.h / 2 - Y),
    );
  const pts: [number, number][] = [];
  for (const ln of geometry.lines) {
    for (let k = 1; k < ln.length; k += 1) {
      const [x0, y0] = [(ln[k - 1]![0] / 100) * plot.w, (ln[k - 1]![1] / 100) * plot.h];
      const [x1, y1] = [(ln[k]![0] / 100) * plot.w, (ln[k]![1] / 100) * plot.h];
      const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
      for (let s = 0; s <= steps; s += 1) {
        pts.push([x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps]);
      }
    }
  }
  const band = geometry.band?.map(([x, y]): [number, number] => [
    (x / 100) * plot.w,
    (y / 100) * plot.h,
  ]);
  let best: { left: number; top: number; score: number } | null = null;
  for (const [left, top] of cands) {
    let score = 0;
    if (left < 0) score += 1000 + -left;
    if (top < 0) score += 1000 + -top;
    if (left + label.w > plot.w) score += 1000 + (left + label.w - plot.w);
    if (top + label.h > plot.h) score += 1000 + (top + label.h - plot.h);
    for (const [x, y] of pts) {
      if (x > left - 2 && x < left + label.w + 2 && y > top - 2 && y < top + label.h + 2)
        score += 1;
    }
    if (band) {
      const probes: [number, number][] = [
        [left, top],
        [left + label.w, top],
        [left, top + label.h],
        [left + label.w, top + label.h],
        [left + label.w / 2, top + label.h / 2],
      ];
      for (const [x, y] of probes) if (inPolygon(x, y, band)) score += 1;
    }
    if (best === null || score < best.score) best = { left, top, score };
    if (score === 0) break;
  }
  return { left: best!.left, top: best!.top, clear: best!.score === 0 };
}

/** 「理想より○円少ない / 多い」。先端の点の横で、線や帯にかからない位置に置く。 */
export function DeltaLabel({ text, geometry }: { text: string; geometry: DeltaGeometry }) {
  const ref = useRef<HTMLSpanElement>(null);
  const geoRef = useRef(geometry);
  const [endX, endY] = geometry.end;

  useLayoutEffect(() => {
    geoRef.current = geometry;
    const el = ref.current;
    const plotEl = el?.parentElement;
    if (!el || !plotEl) return;
    const place = () => {
      const pr = plotEl.getBoundingClientRect();
      const lr = el.getBoundingClientRect();
      if (pr.width === 0) return;
      const pos = chooseDeltaPosition({
        plot: { w: pr.width, h: pr.height },
        label: { w: lr.width, h: lr.height },
        geometry: geoRef.current,
      });
      el.style.left = `${pos.left}px`;
      el.style.top = `${pos.top}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(plotEl);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 図形は ref 経由で最新を読む(先端の位置と文言が変わったときに置き直す)
  }, [text, endX, endY]);

  return (
    <span
      ref={ref}
      data-chart-label="delta"
      className="tabular pointer-events-none absolute text-xs font-semibold whitespace-nowrap"
      style={{
        left: `${geometry.end[0]}%`,
        top: `calc(${geometry.end[1]}% - 28px)`,
        color: 'var(--ink)',
      }}
    >
      {text}
    </span>
  );
}
