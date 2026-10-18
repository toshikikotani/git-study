/**
 * レシートの品目の読み取りミスを直す(本人の要望「明細のレシート内容もできたらチェックして」、ADR-120)。
 *
 * 品目はレシートを読み取って保存したもので、読み違えた品名(「牛孚L」のような文字)や、品目では
 * ない行(小計・お預り・お釣りなど)、桁を読み違えた金額が残ることがある。ここには、直す候補(fix)を
 * 品目に当てたあとの品目を作る純粋関数と、AI がなくても分かる「品目ではない行」の規則を置く。
 * 候補を出すだけで、保存は本人が選んで押したものだけ(店名の直し方と同じ、ADR-116)。
 *
 * 保存されている品目の金額は、税・値引きを含めて支払額に按分した値(receipt-reconcile.ts の
 * allocateToPayment)。印字の金額と少し違うのがふつうなので、小さなずれは候補にしない。
 * 品目の合計が支払額と一致していたレシートで行を消したり金額を直したりしたときは、直した金額の
 * 比率で支払額に配り直し、合計 = 支払額を保つ。割り勘などで初めから一致していなかったものは、
 * 直した金額のまま。
 */

import { apportion } from './receipt-reconcile';

export type ReceiptCheckItem = {
  id: string;
  name: string;
  /** 明細と同じ符号(支出なら負)。 */
  amountYen: number;
  genreId: string | null;
  productType: string | null;
};

export type ReceiptCheckEntry = {
  transactionId: string;
  occurredOn: string;
  /** 明細の金額(支払額、支出なら負)。 */
  amountYen: number;
  storeName: string;
  /** 取り込んだときの照合のずれ(読み取りの疑い)。無ければ null。 */
  reconcileDiffYen: number | null;
  items: ReceiptCheckItem[];
};

/** rename:品名を直す。remove:品目ではない行を消す。amount:金額を直す。 */
export type ReceiptFixKind = 'rename' | 'remove' | 'amount';

export type ReceiptFix = {
  key: string;
  transactionId: string;
  itemId: string;
  kind: ReceiptFixKind;
  /** rename のときの新しい品名。 */
  name: string | null;
  /** amount のときの新しい金額(正の整数円)。 */
  amountYen: number | null;
  reason: string;
  source: 'rule' | 'ai';
};

export type ReceiptCheckGroup = { entry: ReceiptCheckEntry; fixes: ReceiptFix[] };

export type FixedReceiptItem = {
  name: string;
  amountYen: number;
  genreId: string | null;
  productType: string | null;
};

const NOT_ITEM_LINE = new RegExp(
  '^(?:' +
    [
      '小計',
      '合計',
      '総計',
      '総合計',
      'お?買い?上げ?(?:合)?計',
      'お?預(?:り|かり)?金?',
      'お?釣り?銭?',
      'おつり',
      'つり銭',
      '現金',
      'クレジット',
      '[内外]?消費税等?(?:額)?',
      '[内外]税(?:額)?',
      '税額',
      '(?:\\d{1,2}%|軽減税率|標準税率)?対象(?:計|額)?',
      'ポイント(?:利用|払い?|支払い?)',
    ].join('|') +
    ')$',
);

/** 品目ではない行か(小計・お預り・お釣り・税の行など)。名前がその言葉だけのときに限る。 */
export function isNotItemLine(name: string): boolean {
  const label = name.normalize('NFKC').replace(/[\s()[\]【】*＊:：]/g, '');
  return label !== '' && NOT_ITEM_LINE.test(label);
}

export const NOT_ITEM_REASON = '品目ではない行(小計・お預り・税など)のようです';

/** AI がなくても分かる候補:品目ではない行を消す。全部の行が当たるレシートは出さない。 */
export function ruleReceiptFixes(entry: ReceiptCheckEntry): ReceiptFix[] {
  const hits = entry.items.filter((item) => isNotItemLine(item.name));
  if (hits.length === 0 || hits.length === entry.items.length) return [];
  return hits.map((item) => ({
    key: `rule:${entry.transactionId}:${item.id}:remove`,
    transactionId: entry.transactionId,
    itemId: item.id,
    kind: 'remove',
    name: null,
    amountYen: null,
    reason: NOT_ITEM_REASON,
    source: 'rule',
  }));
}

/**
 * 候補をレシートごとにまとめる(明細の並び順のまま)。同じ品目・同じ直し方は先の候補だけを使う
 * (AI の候補を先に渡す)。無い品目への候補は捨て、全部の行を消すことになるレシートは出さない。
 */
export function receiptCheckGroups(
  entries: readonly ReceiptCheckEntry[],
  fixes: readonly ReceiptFix[],
): ReceiptCheckGroup[] {
  const byTransaction = new Map<string, ReceiptFix[]>();
  for (const fix of fixes) {
    const list = byTransaction.get(fix.transactionId);
    if (list) list.push(fix);
    else byTransaction.set(fix.transactionId, [fix]);
  }
  const groups: ReceiptCheckGroup[] = [];
  for (const entry of entries) {
    const itemIds = new Set(entry.items.map((item) => item.id));
    const seen = new Set<string>();
    const kept: ReceiptFix[] = [];
    for (const fix of byTransaction.get(entry.transactionId) ?? []) {
      const key = `${fix.itemId}:${fix.kind}`;
      if (!itemIds.has(fix.itemId) || seen.has(key)) continue;
      seen.add(key);
      kept.push(fix);
    }
    if (kept.length === 0) continue;
    const removed = new Set(kept.filter((f) => f.kind === 'remove').map((f) => f.itemId));
    if (removed.size === entry.items.length) continue;
    groups.push({ entry, fixes: kept });
  }
  return groups;
}

/**
 * 選んだ候補を当てたあとの品目。消す行と金額の直しがあり、もとの合計が支払額と一致していたら、
 * 直した金額の比率で支払額に配り直す(0円の行ができるときは配り直さない)。
 * 品目が残らないときは null(全部を消す保存はしない)。
 */
export function applyReceiptFixes(
  entry: ReceiptCheckEntry,
  fixes: readonly ReceiptFix[],
): { items: FixedReceiptItem[]; rebalanced: boolean } | null {
  const sign = entry.amountYen < 0 ? -1 : 1;
  const paid = Math.abs(entry.amountYen);
  const before = entry.items.reduce((sum, item) => sum + Math.abs(item.amountYen), 0);
  let amountsChanged = false;
  const kept: (Omit<FixedReceiptItem, 'amountYen'> & { amount: number })[] = [];
  for (const item of entry.items) {
    const mine = fixes.filter((fix) => fix.itemId === item.id);
    if (mine.some((fix) => fix.kind === 'remove')) {
      amountsChanged = true;
      continue;
    }
    const rename = mine.find((fix) => fix.kind === 'rename' && fix.name);
    const amount = mine.find((fix) => fix.kind === 'amount' && fix.amountYen);
    if (amount) amountsChanged = true;
    kept.push({
      name: rename?.name ?? item.name,
      amount: amount?.amountYen ?? Math.abs(item.amountYen),
      genreId: item.genreId,
      productType: item.productType,
    });
  }
  if (kept.length === 0) return null;
  const spread =
    amountsChanged && paid > 0 && before === paid
      ? apportion(
          paid,
          kept.map((k) => k.amount),
        )
      : null;
  const amounts =
    spread !== null && spread.every((yen) => yen > 0) ? spread : kept.map((k) => k.amount);
  return {
    items: kept.map((k, i) => ({
      name: k.name,
      amountYen: sign * amounts[i]!,
      genreId: k.genreId,
      productType: k.productType,
    })),
    rebalanced: amounts === spread,
  };
}
