/**
 * 「コンビニで500円」から、過去の記録でよく行くお店(「セブン-イレブン 渋谷道玄坂店」など)を当てる
 * (本人の要望、ADR-107)。いちばんありそうなお店で記録の案を作り、ほかの候補はボタンで出す
 * (押すと名前とカテゴリが変わる)。
 *
 * 判断は決定的に行う:店名の正規化(domain/store-name.ts のチェーン辞書と店の種類)で、
 *   1. AIが一覧から選んだお店(store_candidates。一覧に無い名前は捨てる)
 *   2. 「コンビニ」「スーパー」のような言い方なら、その種類のお店
 *   3. 「セブン」「ローソン」のような言い方なら、同じチェーンのお店(支店ちがい)と、名前にその語を含むお店
 * を、AIの選んだ順 → 回数の多い順 → 最近の順に並べる。DBにもネットワークにも触れない。
 */

import { comparableKey, normalizeStoreName, type StoreType } from '@/domain/store-name';
import type { Genre } from '@/features/genre/store';
import type { StoredTransaction } from '@/features/transactions/types';
import { addDays } from '@/lib/date';
import type { PlanContext, ProposedChange } from './plan';
import { recordChangeOf, recordWithStore, type StoreCandidate } from './record-change';

/** よく使うお店1つ(同じ名前の記録をまとめたもの)。 */
export type StoreSummary = {
  /** いちばん最近の記録の名前(支店名まで含む)。 */
  name: string;
  /** 比較用の形(comparableKey)。 */
  key: string;
  /** チェーン名(支店ちがいを同じお店とみなす)。 */
  chain: string;
  type: StoreType;
  /** 過去1年の回数。 */
  count: number;
  lastOn: string;
  /** このお店でいちばん多いカテゴリ。 */
  genreId: string | null;
  genreName: string | null;
};

/** 覚えておくお店の数と、AIに見せる数。 */
const MAX_STORES = 300;
export const STORES_IN_PROMPT = 30;
/** 確認カードに出すお店の候補の数(元の言い方のボタンは別に1つ)。 */
export const MAX_STORE_CANDIDATES = 4;

/**
 * 「コンビニ」「スーパー」のような、お店の種類だけの言い方(「駅前のコンビニ」も)。
 * 「スーパー玉出」のようにお店の名前の一部なら、種類の言い方とはみなさない。
 */
const GENERIC_WORDS: readonly [string, StoreType][] = [
  ['コンビニ|コンビニエンスストア', 'convenience'],
  ['スーパー|スーパーマーケット', 'supermarket'],
  ['カフェ|喫茶店|喫茶|コーヒー|珈琲|コーヒー屋', 'cafe'],
  ['ドラッグストア|ドラスト|薬局|薬屋', 'drugstore'],
  ['ファストフード|ハンバーガー|牛丼|牛丼屋', 'fast_food'],
  ['ファミレス|レストラン', 'restaurant'],
  ['本屋|書店', 'bookstore'],
  ['100均|百均|100円ショップ|ホームセンター', 'home_center'],
  ['家電|家電屋|家電量販店', 'electronics'],
  ['電車|バス|タクシー', 'transport'],
];

function genericTypeOf(hint: string): StoreType | null {
  const key = comparableKey(hint);
  return (
    GENERIC_WORDS.find(([words]) => new RegExp(`^(?:.{0,8}の)?(?:${words})$`).test(key))?.[1] ??
    null
  );
}

/**
 * 過去1年の支出の記録から、よく使うお店をまとめる(回数の多い順 → 最近の順)。
 * カテゴリ名や「手入力」のまま付いた名前は、お店ではないので入れない。
 */
export function summarizeStores(
  transactions: readonly StoredTransaction[],
  today: string,
  genres: readonly Pick<Genre, 'id' | 'name'>[],
): StoreSummary[] {
  const from = addDays(today, -365);
  const notStores = new Set(['手入力', '収入', '返金', ...genres.map((g) => g.name)]);
  const groups = new Map<
    string,
    { name: string; lastOn: string; count: number; genres: Map<string, number> }
  >();
  for (const t of transactions) {
    if (t.amountYen >= 0 || t.kind === 'refund') continue;
    if (t.occurredOn > today || t.occurredOn < from) continue;
    const name = t.description.trim();
    if (name === '' || notStores.has(name)) continue;
    const key = comparableKey(name);
    if (key === '') continue;
    const group = groups.get(key) ?? { name, lastOn: t.occurredOn, count: 0, genres: new Map() };
    group.count += 1;
    if (t.occurredOn > group.lastOn) {
      group.lastOn = t.occurredOn;
      group.name = name;
    }
    if (t.genreId !== null) group.genres.set(t.genreId, (group.genres.get(t.genreId) ?? 0) + 1);
    groups.set(key, group);
  }
  const genreName = new Map(genres.map((g) => [g.id, g.name]));
  return [...groups.entries()]
    .map(([key, g]) => {
      const usual = [...g.genres.entries()]
        .filter(([id]) => genreName.has(id))
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      const normalized = normalizeStoreName(g.name);
      return {
        name: g.name,
        key,
        chain: comparableKey(normalized.name),
        type: normalized.type,
        count: g.count,
        lastOn: g.lastOn,
        genreId: usual ?? null,
        genreName: usual === undefined ? null : (genreName.get(usual) ?? null),
      };
    })
    .sort((a, b) => b.count - a.count || b.lastOn.localeCompare(a.lastOn))
    .slice(0, MAX_STORES);
}

/** 言い方(と、AIが一覧から選んだお店)に当てはまるお店。AIの選んだ順 → 回数の多い順。 */
export function matchStores(
  hint: string,
  stores: readonly StoreSummary[],
  picks: readonly string[] = [],
): StoreSummary[] {
  const byKey = new Map(stores.map((s) => [s.key, s]));
  const picked = picks
    .map((p) => byKey.get(comparableKey(p)))
    .filter((s): s is StoreSummary => s !== undefined);
  const hintKey = comparableKey(hint);
  const type = genericTypeOf(hint);
  const chain = hintKey === '' ? '' : comparableKey(normalizeStoreName(hint).name);
  const matched = stores.filter((s) => {
    if (hintKey === '') return false;
    if (type !== null) return s.type === type;
    return s.chain === chain || (hintKey.length >= 2 && s.key.includes(hintKey));
  });
  const seen = new Set<string>();
  return [...picked, ...matched].filter((s) => {
    if (seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });
}

function candidateOf(s: StoreSummary): StoreCandidate {
  return { name: s.name, genreId: s.genreId, genreName: s.genreName };
}

/**
 * 記録の案に、お店の候補をつける(会話のときだけ。反映するときは、本人が選んだ名前のまま確かめる)。
 * 言い方がよく行くお店そのものでなければ、いちばんありそうなお店で案を作り直し、元の言い方もボタンに残す
 * (押せば戻せる)。候補が1つしかなければボタンは出さない。
 */
export function withStoreCandidates(
  change: ProposedChange,
  input: unknown,
  ctx: Pick<PlanContext, 'stores'>,
  today: string,
): ProposedChange {
  const record = change.record;
  if (record === undefined || record.kind !== 'expense') return change;
  const stores = ctx.stores ?? [];
  const raw = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const picks = Array.isArray(raw.store_candidates)
    ? raw.store_candidates.filter((p): p is string => typeof p === 'string')
    : [];
  // 言い方がよく行くお店そのものなら、それを先頭にする(AIが選んだ候補に押し出させない)。
  const exact = stores.find((s) => s.key === comparableKey(record.name));
  const others = matchStores(record.name, stores, picks).filter((s) => s.key !== exact?.key);
  const matched = (exact ? [exact, ...others] : others).slice(0, MAX_STORE_CANDIDATES);
  if (matched.length === 0) return change;

  const chosen = exact ?? matched[0]!;
  const original: StoreCandidate[] =
    exact === undefined && record.name !== ''
      ? [{ name: record.name, genreId: record.genreId, genreName: record.genreName }]
      : [];
  const candidates = [...matched.map(candidateOf), ...original];
  const next = exact ? change : recordChangeOf(recordWithStore(record, candidateOf(chosen)), today);
  return candidates.length >= 2 ? { ...next, candidates } : next;
}

/** AIに見せる「よく使うお店」。 */
export function formatStoreLines(stores: readonly StoreSummary[]): string {
  if (stores.length === 0) return '(まだありません)';
  return stores
    .slice(0, STORES_IN_PROMPT)
    .map(
      (s) => `- ${JSON.stringify(s.name)}(${s.count}回${s.genreName ? ` · ${s.genreName}` : ''})`,
    )
    .join('\n');
}
