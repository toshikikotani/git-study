/**
 * 保存前の重複警告。同じ店・同じ日・近い金額の取引が既にあれば候補として知らせる
 * (取り込み経路をまたぐ重複は domain/duplicate-match.ts が保存後に拾う。こちらは
 * 「今から保存するもの」が既存と重なるかの事前チェック)。
 */

import { comparableKey } from '@/domain/store-name';
import { daysBetween, type DateOnly } from '@/lib/date';

export type DuplicateProbe = { storeName: string; occurredOn: DateOnly; amountYen: number };
export type ExistingForDuplicate = {
  id: string;
  storeName: string;
  occurredOn: DateOnly;
  amountYen: number;
};

/** 「近い金額」:差が 3% 以内、または 100円以内。 */
export function isCloseAmount(a: number, b: number): boolean {
  const diff = Math.abs(Math.abs(a) - Math.abs(b));
  const larger = Math.max(Math.abs(a), Math.abs(b));
  return diff <= 100 || diff <= larger * 0.03;
}

export function findReceiptDuplicates(
  probe: DuplicateProbe,
  existing: readonly ExistingForDuplicate[],
): ExistingForDuplicate[] {
  const key = comparableKey(probe.storeName);
  return existing.filter(
    (e) =>
      comparableKey(e.storeName) === key &&
      key !== '' &&
      daysBetween(e.occurredOn, probe.occurredOn) === 0 &&
      isCloseAmount(e.amountYen, probe.amountYen),
  );
}
