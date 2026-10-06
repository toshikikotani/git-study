/**
 * 分類ルールの提案と、一致する過去の取引の探し方(純粋関数)。
 *
 * カテゴリを変えた直後に、ルール化を提案する:
 *   品目単位  「今後も[店名]の[品目名]は[カテゴリ]にしますか?」
 *   店単位    同じ店の品目を3件以上まとめて移したとき「[店名]は今後すべて[カテゴリ]にしますか?」
 * ルールを保存する前に、一致する過去の取引の件数と一覧を見せ、「今後のみ」「過去のN件にも」を選ばせる。
 */

import { comparableKey, normalizeStoreName } from '@/domain/store-name';

export type RuleScope =
  { kind: 'item'; storeName: string; itemName: string } | { kind: 'store'; storeName: string };

export type RuleCandidate = {
  id: string;
  occurredOn: string;
  /** 店名(表示用。正規化済みでなくてもよい)。 */
  label: string;
  amountYen: number;
  genreId: string | null;
  itemNames: readonly string[];
};

/** 店名の比較用キー(支店名・法人格・表記ゆれを除く)。 */
export function storeKeyOf(label: string): string {
  return comparableKey(normalizeStoreName(label).name || label);
}

export function ruleMatches(scope: RuleScope, c: RuleCandidate): boolean {
  if (storeKeyOf(c.label) !== storeKeyOf(scope.storeName) || storeKeyOf(c.label) === '')
    return false;
  if (scope.kind === 'store') return true;
  const key = comparableKey(scope.itemName);
  return key !== '' && c.itemNames.some((n) => comparableKey(n) === key);
}

/**
 * ルールに一致する過去の取引(すでに移し先のカテゴリにあるもの、支出でないものは除く)。
 * 新しい日付が先頭。
 */
export function findRuleMatches(
  scope: RuleScope,
  toGenreId: string,
  candidates: readonly RuleCandidate[],
): RuleCandidate[] {
  return candidates
    .filter((c) => c.amountYen < 0 && c.genreId !== toGenreId && ruleMatches(scope, c))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
}

export type MovedForSuggestion = {
  storeName: string;
  /** 移した部分の品目名(無ければ空)。 */
  itemNames: readonly string[];
};

export type RuleSuggestion = {
  scope: RuleScope;
  /** 「今後も○○の△△は□□にしますか?」 */
  question: string;
};

export const STORE_RULE_MIN_ITEMS = 3;

export function suggestRule(
  moved: readonly MovedForSuggestion[],
  toGenreName: string,
): RuleSuggestion | null {
  if (moved.length === 0) return null;
  // 店ごとに、移した品目の数(品目が無い明細は1件と数える)。
  const byStore = new Map<string, { storeName: string; count: number }>();
  for (const m of moved) {
    const key = storeKeyOf(m.storeName);
    if (key === '') continue;
    const e = byStore.get(key) ?? {
      storeName: normalizeStoreName(m.storeName).name || m.storeName,
      count: 0,
    };
    e.count += Math.max(m.itemNames.length, 1);
    byStore.set(key, e);
  }
  const top = [...byStore.values()].sort((a, b) => b.count - a.count)[0];
  if (top && top.count >= STORE_RULE_MIN_ITEMS) {
    return {
      scope: { kind: 'store', storeName: top.storeName },
      question: `${top.storeName}は今後すべて${toGenreName}にしますか?`,
    };
  }
  const withItem = moved.find((m) => m.itemNames.length > 0 && storeKeyOf(m.storeName) !== '');
  if (withItem) {
    const storeName = normalizeStoreName(withItem.storeName).name || withItem.storeName;
    const itemName = withItem.itemNames[0]!;
    return {
      scope: { kind: 'item', storeName, itemName },
      question: `今後も${storeName}の${itemName}は${toGenreName}にしますか?`,
    };
  }
  // 品目が無い明細だけのときは、店単位で提案する。
  const only = moved.find((m) => storeKeyOf(m.storeName) !== '');
  if (only) {
    const storeName = normalizeStoreName(only.storeName).name || only.storeName;
    return {
      scope: { kind: 'store', storeName },
      question: `${storeName}は今後すべて${toGenreName}にしますか?`,
    };
  }
  return null;
}

/** ルールの説明(一覧・確認に出す)。 */
export function describeRule(scope: RuleScope): string {
  return scope.kind === 'store'
    ? `${scope.storeName} は すべて`
    : `${scope.storeName} の ${scope.itemName}`;
}
