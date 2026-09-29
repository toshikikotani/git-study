'use client';

import { useEffect, useRef, useState } from 'react';

import { VirtualIndex } from '@/lib/virtual';

/**
 * 仮想化した一覧(画面に見えている行だけを描画する)。1万件でも滑らかにスクロールできる。
 * ページ全体のスクロール(window)に合わせる。行の高さは見積もりから始め、描画された行を測って
 * 本当の高さに差し替える(店名の折り返し・文字サイズの違いでも位置がずれない)。
 * 最初の描画(サーバー側を含む)では先頭の数十行を出すので、JS が動く前でも内容が読める。
 */
export function VirtualList<T>({
  items,
  estimate,
  getKey,
  render,
  label,
  onWindow,
}: {
  items: readonly T[];
  /** 行の高さの見積もり(px)。 */
  estimate: number;
  getKey: (item: T, index: number) => string;
  render: (item: T, index: number) => React.ReactNode;
  label: string;
  /** 見えている先頭の行が変わったとき(上部に固定する日付の見出しに使う)。 */
  onWindow?: (firstVisible: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [index] = useState(() => new VirtualIndex(items.length, estimate));
  const [win, setWin] = useState({ start: 0, end: Math.min(items.length, 30) });
  const [version, setVersion] = useState(0);

  // 件数が変わったら、位置の表を作り直す(冪等。測れた高さは同じ位置なら引き継ぐ)。
  index.resize(items.length);

  useEffect(() => {
    let frame = 0;
    const recalc = () => {
      frame = 0;
      const el = container.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const r = index.range(window.scrollY - top, window.innerHeight, 6);
      setWin((prev) => (prev.start === r.start && prev.end === r.end ? prev : r));
      onWindow?.(index.range(window.scrollY - top, 0, 0).start);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(recalc);
    };
    recalc();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [index, version, onWindow, items.length]);

  // 描画された行を測って、高さを本当の値に差し替える(変わったときだけ再計算)。
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let changed = false;
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const i = Number(child.dataset.index);
      if (Number.isFinite(i) && index.setHeight(i, child.offsetHeight)) changed = true;
    }
    if (changed) setVersion((v) => v + 1);
  }, [index, win, items, version]);

  const rows: React.ReactNode[] = [];
  for (let i = win.start; i < Math.min(win.end, items.length); i++) {
    rows.push(
      <div
        key={getKey(items[i]!, i)}
        role="listitem"
        data-index={i}
        className="absolute inset-x-0"
        style={{ top: index.offsetOf(i) }}
      >
        {render(items[i]!, i)}
      </div>,
    );
  }

  return (
    <div
      ref={container}
      role="list"
      aria-label={label}
      className="relative"
      style={{ height: index.totalHeight() }}
    >
      {rows}
    </div>
  );
}
