/**
 * これからの支払い(デザイン v3-7、ADR-108)。予定・毎月の固定費・カテゴリごと固定費・見つけた定期支払いを、
 * 明細の行から組み立てる。DBにもネットワークにも触れない。
 *
 * カテゴリごと固定費(カテゴリの予測を止める印)に、毎月ちがう出費(ライブ代など)が入っていると、
 * 「最近の勢い」や1日の目安から外れてしまう(本人の指摘:娯楽・趣味がカテゴリごと固定費になっていた)。
 * そういうカテゴリは「固定費から外しますか？」と聞く。固定費は記録ごとに決める(ADR-102)。
 */

import { subscriptionKeyOf, type DetectedSubscription } from '@/domain/subscriptions';

export type UpcomingRow = {
  id: string;
  occurredOn: string;
  label: string;
  description: string;
  genreId: string | null;
  genreName: string | null;
  /** 支出は負。 */
  amountYen: number;
  mustPay: boolean;
};

export type UpcomingPayment = {
  id: string;
  date: string;
  name: string;
  genreName: string | null;
  amountYen: number;
  /** 固定費の予定か(固定費の確認・その記録の印)。 */
  fixed: boolean;
};

export type FixedItem = {
  key: string;
  name: string;
  genreName: string | null;
  amountYen: number;
  /** 今月払った日(まだなら null)。 */
  paidOn: string | null;
  /** 今月これから払う日(払っていれば null)。 */
  dueOn: string | null;
};

export type CategoryFixed = {
  genreId: string;
  genreName: string;
  /** 今月の、このカテゴリの支出(払った分と予定)。 */
  amountYen: number;
  /** 店・額のちがう支払いが入っている(毎月同じ支払いではない)。 */
  mixed: boolean;
};

export type UpcomingView = {
  scheduled: UpcomingPayment[];
  fixedItems: FixedItem[];
  categoryFixed: CategoryFixed[];
  /** 毎月の固定費の合計(記録ごとの固定費+カテゴリごと固定費)。 */
  fixedTotalYen: number;
  /** まだ固定費にしていない、見つけた定期支払い。 */
  detected: DetectedSubscription[];
};

export function buildUpcoming(input: {
  rows: readonly UpcomingRow[];
  today: string;
  /** 予定を出す最後の日(今期の終わり)。 */
  until: string;
  /** 今月の始めと終わり(毎月の固定費を数える範囲)。 */
  month: { from: string; to: string };
  /** カテゴリごと固定費のカテゴリ(予測を止める印、または genre:<id> の固定費の確認)。 */
  categoryFixedIds: ReadonlySet<string>;
  /** 固定費として確認した店・額のキー。 */
  fixedKeys: ReadonlySet<string>;
  detected: readonly DetectedSubscription[];
}): UpcomingView {
  const { rows, today, until, month, categoryFixedIds, fixedKeys } = input;
  const spend = rows.filter((r) => r.amountYen < 0);
  const keyOf = (r: UpcomingRow) => subscriptionKeyOf(r.label, r.description, r.amountYen);
  const isFixedRow = (r: UpcomingRow) => r.mustPay || fixedKeys.has(keyOf(r));

  const scheduled = spend
    .filter((r) => r.occurredOn > today && r.occurredOn <= until)
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))
    .map((r) => ({
      id: r.id,
      date: r.occurredOn,
      name: r.label,
      genreName: r.genreName,
      amountYen: -r.amountYen,
      fixed: isFixedRow(r),
    }));

  const inMonth = spend.filter((r) => r.occurredOn >= month.from && r.occurredOn <= month.to);
  const fixedByKey = new Map<string, FixedItem>();
  for (const r of inMonth) {
    if (!isFixedRow(r) || (r.genreId !== null && categoryFixedIds.has(r.genreId))) continue;
    const key = keyOf(r);
    const paid = r.occurredOn <= today;
    const item = fixedByKey.get(key) ?? {
      key,
      name: r.label,
      genreName: r.genreName,
      amountYen: -r.amountYen,
      paidOn: null,
      dueOn: null,
    };
    if (paid)
      item.paidOn = item.paidOn === null || r.occurredOn > item.paidOn ? r.occurredOn : item.paidOn;
    else item.dueOn = item.dueOn === null || r.occurredOn < item.dueOn ? r.occurredOn : item.dueOn;
    fixedByKey.set(key, item);
  }
  const fixedItems = [...fixedByKey.values()].sort((a, b) => b.amountYen - a.amountYen);

  const categoryFixed: CategoryFixed[] = [];
  for (const genreId of categoryFixedIds) {
    const own = inMonth.filter((r) => r.genreId === genreId);
    if (own.length === 0) continue;
    categoryFixed.push({
      genreId,
      genreName: own[0]!.genreName ?? '未分類',
      amountYen: own.reduce((sum, r) => sum - r.amountYen, 0),
      mixed: new Set(own.map(keyOf)).size > 1,
    });
  }
  categoryFixed.sort((a, b) => b.amountYen - a.amountYen);

  const detected = input.detected.filter((d) => !fixedKeys.has(d.key));
  return {
    scheduled,
    fixedItems,
    categoryFixed,
    fixedTotalYen:
      fixedItems.reduce((sum, f) => sum + f.amountYen, 0) +
      categoryFixed.reduce((sum, c) => sum + c.amountYen, 0),
    detected,
  };
}
