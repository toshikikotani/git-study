/**
 * 自動で取り込んだ明細(Gmail・CSV・LINEのレシート・LINEの文字)のカテゴリを、AIを使わずに決める
 * (v4「自信のないときだけ聞く」、ADR-129)。次の順で最初に決まったものを採る:
 *
 *   1. 利用者のルール「この店はすべて○○」(pinned、答え合わせで直したお店もここに入る) … 自信 1
 *   2. その店での過去の選び方(答え合わせで「合ってる」を押した回数)                   … 自信 0.7〜0.95
 *   3. 店名の辞書(スターバックス → カフェ・飲料 など。はじめてのお店の推測)            … 自信 0.7
 *
 * 自信が設定のしきい値(classification_confidence_threshold、既定 0.8)以上なら auto_ok(そのまま
 * 数える)、未満か決まらなければ pending(答え合わせでオレンジの枠)。DBにもネットワークにも触れない。
 */

import { STORE_WIDE_ITEM, type ClassificationMemory } from '@/domain/classification-pipeline';
import { lookupItemDictionary } from '@/domain/classification-dictionary';
import { comparableKey } from '@/domain/store-name';

/** 店名の辞書は、品目の辞書より当てずっぽうなので、しきい値の既定(0.8)より低くする。 */
export const STORE_DICTIONARY_CONFIDENCE = 0.7;
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

export type ImportClassifyContext = {
  memory: ClassificationMemory;
  /** ジャンル名 → id(利用者のジャンル一覧)。 */
  genreIdByName: ReadonlyMap<string, string>;
  /** 0〜1。これ以上の自信なら確かめずに数える。 */
  threshold: number;
};

export type ImportClassification = {
  genreId: string | null;
  classifiedBy: 'rule' | 'unclassified';
  confidence: number | null;
  reviewStatus: 'auto_ok' | 'pending';
};

/** 店のキー(「この店はすべて」のルール・履歴と同じ形)。 */
export function storeMemoryKey(storeName: string): string {
  return `${comparableKey(storeName)}|${STORE_WIDE_ITEM}`;
}

function classifyStore(
  storeName: string,
  ctx: ImportClassifyContext,
): { genreId: string; confidence: number } | null {
  if (comparableKey(storeName) === '') return null;
  const remembered = ctx.memory.get(storeMemoryKey(storeName));
  if (remembered?.pinned) return { genreId: remembered.genreId, confidence: 1 };
  if (remembered) {
    return {
      genreId: remembered.genreId,
      confidence: Math.min(Math.round((0.7 + 0.1 * remembered.hits) * 100) / 100, 0.95),
    };
  }
  const name = lookupItemDictionary(storeName);
  const id = name === null ? undefined : ctx.genreIdByName.get(name);
  return id === undefined ? null : { genreId: id, confidence: STORE_DICTIONARY_CONFIDENCE };
}

/** 店名(無ければ摘要)からカテゴリと、確かめる必要があるかを決める。 */
export function classifyImported(
  row: { merchantName: string | null; description: string },
  ctx: ImportClassifyContext,
): ImportClassification {
  const hit =
    (row.merchantName ? classifyStore(row.merchantName, ctx) : null) ??
    classifyStore(row.description, ctx);
  if (hit === null) {
    return {
      genreId: null,
      classifiedBy: 'unclassified',
      confidence: null,
      reviewStatus: 'pending',
    };
  }
  return {
    genreId: hit.genreId,
    classifiedBy: 'rule',
    confidence: hit.confidence,
    reviewStatus: hit.confidence >= ctx.threshold ? 'auto_ok' : 'pending',
  };
}
