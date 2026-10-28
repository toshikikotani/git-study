/**
 * GSAP の入口(本人「GSAP導入」、ADR-140)。動きは GSAP で書き、型(長さ・曲線)はここにそろえる。
 * CSS の動き(app/globals.css の --motion-*)と同じ考え:状態の変化を伝えるときだけ動かす。
 * 行き過ぎて跳ねる曲線は使わない(ADR-136)。「視差効果を減らす」ときは位置・大きさを動かさない
 * (呼ぶ側で prefersReducedMotion() を見て、透明度だけにする)。
 */

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';

import { MOTION } from './motion';

gsap.registerPlugin(useGSAP);

/** 着地する動き(数字・行の出入り・グラフ)。最後にゆっくり止まり、行き過ぎない。 */
export const GSAP_EASE = 'power3.out';

/** 長さ(秒)。 */
export const GSAP_DURATION = {
  /** 金額の数字が桁ごとに回る。 */
  number: MOTION.numberMs / 1000,
  /** 一覧に新しい行が入る。 */
  row: 0.35,
  /** 新しい行の色が消えるまで。 */
  rowHighlight: 1.2,
  /** グラフが左から描かれる。 */
  reveal: 0.7,
  /** 視差効果を減らすときのクロスフェード。 */
  fade: MOTION.smallMs / 1000,
} as const;

export { gsap, useGSAP };
