'use client';

import { useEffect, useRef, useState } from 'react';

import { GSAP_DURATION, GSAP_EASE, gsap, useGSAP } from '@/lib/gsap';
import { digitColumns, prefersReducedMotion } from '@/lib/motion';

/**
 * 金額が変わったとき、数字が桁ごとに回転する表示(400ms、GSAP、ADR-140)。
 * 最初の表示はふつうの文字(サーバーの描画のまま。重い桁の列を作らない)。値が変わったときだけ、
 * 変わった桁が前の数字から新しい数字へ回る。回っている途中に次の値が来ても、そこから続けて回る。
 * 「視差効果を減らす」ときは回転せず、変わった桁をクロスフェードにする。
 * 読み上げは aria-label に最終の金額を入れ、表示の数字は aria-hidden にする
 * (途中の数字が読み上げられない)。「円」は数字と同じ大きさ(.yen-unit)。
 */
export function RollingNumber({
  value,
  unit = true,
  className,
  style,
}: {
  value: number;
  /** 「円」を付ける。 */
  unit?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  /** null は最初の表示(回っていない)。 */
  const [roll, setRoll] = useState<{ prev: number; next: number; tick: number } | null>(null);
  const last = useRef(value);
  const scope = useRef<HTMLSpanElement>(null);
  /** 一度でも位置を決めた桁の列。2回めからは今いる位置から回す(途中で次の値が来ても飛ばない)。 */
  const placed = useRef(new WeakSet<HTMLElement>());

  useEffect(() => {
    if (last.current === value) return;
    const prev = last.current;
    last.current = value;
    setRoll((r) => ({ prev, next: value, tick: (r?.tick ?? 0) + 1 }));
  }, [value]);

  useGSAP(
    () => {
      if (roll === null || !scope.current) return;
      const reduced = prefersReducedMotion();
      for (const el of scope.current.querySelectorAll<HTMLElement>('[data-roll]')) {
        const from = Number(el.dataset.from);
        const to = Number(el.dataset.to);
        // 1桁の列は 0〜9 の10段。yPercent -10 で1段上がる。
        if (!placed.current.has(el)) {
          gsap.set(el, { yPercent: -(reduced ? to : from) * 10 });
          placed.current.add(el);
        }
        if (reduced) {
          gsap.set(el, { yPercent: -to * 10 });
          if (from !== to) {
            gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: GSAP_DURATION.fade });
          }
          continue;
        }
        gsap.to(el, {
          yPercent: -to * 10,
          duration: GSAP_DURATION.number,
          ease: GSAP_EASE,
          overwrite: 'auto',
        });
      }
    },
    { scope, dependencies: [roll?.tick] },
  );

  const label = `${value < 0 ? 'マイナス' : ''}${Math.abs(value).toLocaleString('ja-JP')}${unit ? '円' : ''}`;

  return (
    <span
      ref={scope}
      role="text"
      aria-label={label}
      className={`tabular inline-flex items-baseline ${className ?? ''}`}
      style={style}
    >
      {value < 0 ? <span aria-hidden>−</span> : null}
      {roll === null ? (
        <span aria-hidden>{Math.abs(value).toLocaleString('ja-JP')}</span>
      ) : (
        digitColumns(roll.prev, roll.next).map((c, i, all) =>
          // key は右から数えた位置。桁が増えても、同じ位(一の位など)は同じ列のまま回る。
          c.kind === 'static' ? (
            <span key={`s${all.length - i}`} aria-hidden>
              {c.char}
            </span>
          ) : (
            <span
              key={`d${all.length - i}`}
              aria-hidden
              className="inline-block h-[1em] overflow-hidden leading-none"
              style={{ verticalAlign: 'bottom' }}
            >
              {/* 位置(transform)は GSAP だけが持つ。React は触らない。 */}
              <span data-roll data-from={c.from} data-to={c.to} className="flex flex-col">
                {Array.from({ length: 10 }, (_, n) => (
                  <span key={n} className="h-[1em] leading-none">
                    {n}
                  </span>
                ))}
              </span>
            </span>
          ),
        )
      )}
      {unit ? (
        <span aria-hidden className="yen-unit">
          円
        </span>
      ) : null}
    </span>
  );
}
