'use client';

import { useRef } from 'react';

import { GSAP_DURATION, GSAP_EASE, gsap, useGSAP } from '@/lib/gsap';
import { prefersReducedMotion } from '@/lib/motion';

/** 一度に増えた行がこれより多いときは、保存ではなく読み込み直し。動かさない。 */
const MAX_NEW_ROWS = 3;

/** 新しい行にうすく重ねる色。--new-row-glow(1→0)で消えていく。 */
const GLOW = 'color-mix(in srgb, var(--accent) calc(var(--new-row-glow, 0) * 16%), transparent)';

/**
 * 前の ids になく、今の ids にある id(今の並び順)。
 * 最初の表示(prev が null)と、一度にたくさん増えたとき(読み込み直し)は空。
 */
export function addedRowIds(prev: readonly string[] | null, next: readonly string[]): string[] {
  if (prev === null) return [];
  const before = new Set(prev);
  const added = next.filter((id) => !before.has(id));
  return added.length > MAX_NEW_ROWS ? [] : added;
}

/**
 * 保存したときの手応え(GSAP、ADR-140)。一覧に新しく入った行だけ、高さ 0 から開き、
 * うすい強調色がゆっくり引く。どこから保存しても(＋のシート・AI・LINE)、一覧の ids が増えれば動く。
 * 最初の表示・開閉では動かさない(開いただけで動くとうるさい)。
 * 行には data-row-id を付ける。「視差効果を減らす」ときは高さを動かさず、色だけ。
 */
export function NewRows({
  ids,
  children,
}: {
  /** 一覧に出す明細の id(畳んでいて見えない行も含めてよい)。 */
  ids: readonly string[];
  children: React.ReactNode;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const prev = useRef<readonly string[] | null>(null);
  const key = ids.join('\n');

  useGSAP(
    () => {
      const added = addedRowIds(prev.current, ids);
      prev.current = ids;
      if (added.length === 0 || !scope.current) return;
      const reduced = prefersReducedMotion();
      for (const id of added) {
        const row = scope.current.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
        if (!row) continue;
        gsap.set(row, {
          '--new-row-glow': 1,
          backgroundImage: `linear-gradient(${GLOW}, ${GLOW})`,
        });
        if (!reduced) {
          gsap.set(row, { overflow: 'hidden' });
          gsap.from(row, {
            height: 0,
            duration: GSAP_DURATION.row,
            ease: GSAP_EASE,
            clearProps: 'height,overflow',
          });
        }
        gsap.to(row, {
          '--new-row-glow': 0,
          duration: GSAP_DURATION.rowHighlight,
          delay: reduced ? 0 : GSAP_DURATION.row,
          ease: 'power1.out',
          onComplete: () => {
            row.style.removeProperty('--new-row-glow');
            row.style.removeProperty('background-image');
          },
        });
      }
    },
    { scope, dependencies: [key] },
  );

  return (
    <div ref={scope} className="contents">
      {children}
    </div>
  );
}
