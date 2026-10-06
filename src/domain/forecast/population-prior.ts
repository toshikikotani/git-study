/**
 * 母集団の補正(設計書 v3 4.5)。本人の完了した月が少ないうちは、本人の補正 Ĝ を、母集団の補正
 * G(母集団) と混ぜて使う:G = a·Ĝ(本人) + (1 − a)·G(母集団)。中心の係数も同じく、本人の値を
 * 母集団の値へ寄せる。
 *
 * 同意した利用者の集計(u と時点帯だけ)が無い間は、合成データから作る。合成データはモデルと
 * 同じ仮定で作るので甘く出やすい。外れやすい人物像(設計書 v3 5.2)を入れた世帯で、評価に使う
 * 世帯とは別の世帯から作る(scripts/forecast-eval/population.ts が下の値を書き出す)。
 *
 * 記録の長さで分ける(設計書 v3 5.1 と同じ):'short' は1か月未満(28日未満)、'medium' は
 * 1〜3か月(90日未満)、'long' は3か月以上。
 */

import type { ForecastPhase } from './types';
import { POPULATION_PRIOR_DATA } from './population-prior-data';

export type PopulationPrior = {
  centerByPhase: Record<ForecastPhase, number>;
  /** 時点帯ごとの u(実際が生の予測分布のどこに入ったか)の分位点(0〜1、昇順)。 */
  pitByPhase: Record<ForecastPhase, readonly number[]>;
};

export type RecordLength = 'short' | 'medium' | 'long';
export const SHORT_RECORD_DAYS = 28;
export const MEDIUM_RECORD_DAYS = 90;

export function recordLengthOf(recordDays: number): RecordLength {
  if (recordDays < SHORT_RECORD_DAYS) return 'short';
  if (recordDays < MEDIUM_RECORD_DAYS) return 'medium';
  return 'long';
}

export function populationPriorFor(recordDays: number): PopulationPrior {
  return POPULATION_PRIOR_DATA[recordLengthOf(recordDays)];
}
