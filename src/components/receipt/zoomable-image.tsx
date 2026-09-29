'use client';

import { useRef, useState } from 'react';

/**
 * ズームできるレシート画像。選んだ品目の縦位置(highlightRatio、0〜1)を
 * 帯でハイライトする。拡大はボタンとピンチ、移動は拡大時のスクロール。
 */
export function ZoomableImage({
  src,
  alt,
  highlightRatio,
  className,
}: {
  src: string;
  alt: string;
  /** ハイライトする縦位置(画像の上端 0 〜 下端 1)。null なら出さない。 */
  highlightRatio: number | null;
  className?: string;
}) {
  const [scale, setScale] = useState(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const clamp = (v: number) => Math.min(4, Math.max(1, Math.round(v * 100) / 100));

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  return (
    <div className={`relative ${className ?? ''}`} style={{ background: '#111' }}>
      <div
        ref={scroller}
        className="size-full overflow-auto"
        style={{ touchAction: scale > 1 ? 'pan-x pan-y' : 'pan-y' }}
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            pinchStart.current = { distance: distance(), scale };
          }
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (
            pointers.current.size === 2 &&
            pinchStart.current &&
            pinchStart.current.distance > 0
          ) {
            setScale(clamp((pinchStart.current.scale * distance()) / pinchStart.current.distance));
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          pinchStart.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          pinchStart.current = null;
        }}
        onDoubleClick={() => setScale((s) => (s > 1 ? 1 : 2))}
      >
        <div className="relative" style={{ width: `${scale * 100}%` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="block w-full select-none" draggable={false} />
          {highlightRatio !== null ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0"
              style={{
                top: `${Math.min(Math.max(highlightRatio, 0), 1) * 100}%`,
                height: '3.2%',
                transform: 'translateY(-50%)',
                background: 'rgba(250, 204, 21, 0.35)',
                borderTop: '1px solid rgba(250, 204, 21, 0.9)',
                borderBottom: '1px solid rgba(250, 204, 21, 0.9)',
              }}
            />
          ) : null}
        </div>
      </div>
      <div className="absolute right-2 bottom-2 flex gap-2">
        {[
          { label: '縮小', text: '−', next: () => setScale((s) => clamp(s - 0.5)) },
          { label: '拡大', text: '+', next: () => setScale((s) => clamp(s + 0.5)) },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            aria-label={`画像を${b.label}`}
            onClick={b.next}
            className="flex size-9 items-center justify-center rounded-full text-lg font-semibold"
            style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
          >
            {b.text}
          </button>
        ))}
      </div>
    </div>
  );
}
