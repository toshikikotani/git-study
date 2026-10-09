/**
 * レシートの照合(品目合計 + 税 − 値引き − ポイント・クーポン = 支払額)。
 *
 * 「品目の合計が金額と一致しません」が頻発していた原因は、日本のレシートの
 * 組み方(税率8%と10%の混在・内税/外税・値引き行・ポイント/クーポン払い)を
 * 単純な「品目の足し算 = 合計」で扱っていたこと。ここでは印字された値を
 * そのまま受けて、税・値引き・ポイントを別々に数えて照合する。
 *
 * 約束:
 *   - 金額はすべて整数の円。印字の金額は正で持ち、値引きは kind='discount' で区別する
 *   - ±1円のずれは端数(税の丸め)として自動で吸収する
 *   - 明細(親)の金額は常に支払額。子の品目は支払額にちょうど一致するよう按分する
 *     (合計が食い違う状態を保存しない。読み取りの疑いは reconcile の status で別に持つ)
 */

import { assertYen } from '@/domain/money';

export type TaxRate = 8 | 10 | 0;
export type ReceiptLineKind = 'item' | 'discount';
export type PriceBasis = 'tax_included' | 'tax_excluded';
export type TaxRounding = 'floor' | 'round' | 'ceil';

export type ReceiptLine = {
  id: string;
  name: string;
  /** 印字された金額(正の整数円)。値引き行も正で持つ。 */
  amountYen: number;
  kind: ReceiptLineKind;
  /** 8=軽減税率、10=標準、0=非課税・不明。読み取れなければ null。 */
  taxRate: TaxRate | null;
  genreId: string | null;
  /** 読み取りの確からしさ(0〜1)。低いものは画面で黄色の下線を引く。 */
  confidence: number;
  /** レシート画像上の縦位置(0=上端〜1=下端)。品目タップ時のハイライトに使う。 */
  yRatio: number | null;
  /** 値引き行が特定の品目にだけ掛かる場合の、その品目の id。 */
  appliesToLineId?: string | null;
};

export type ReceiptDraft = {
  /** 商品行の金額が税込か税抜か(レシート全体で1つ)。 */
  priceBasis: PriceBasis;
  lines: ReceiptLine[];
  /** 外税レシートに印字された税額(税率別)。無ければ税率から計算する。 */
  printedTaxYen: { 8?: number; 10?: number };
  taxRounding: TaxRounding;
  /** ポイント払い。 */
  pointsYen: number;
  /** クーポン・商品券など、値引きではなく支払い側に出るもの。 */
  couponYen: number;
  /** 割り勘でもらった額。クーポンと同じく支払額から引く。 */
  splitYen: number;
  /** 本人が「端数として調整」した額(符号あり)。 */
  roundingAdjustYen: number;
  /** 実際に支払った額。 */
  paidYen: number;
};

export const RECEIPT_ABSORB_YEN = 1;

export type TaxGroup = {
  rate: TaxRate | null;
  itemsYen: number;
  discountYen: number;
  /** 外税として加算する税額。 */
  taxYen: number;
  /** 内税レシートの、品目に含まれている税額(参考表示)。 */
  includedTaxYen: number;
};

export type ReconcileSuggestion =
  | { type: 'adjust_rounding'; amountYen: number; recommended: boolean }
  | { type: 'add_discount'; amountYen: number; recommended: boolean }
  | { type: 'check_missing_line'; amountYen: number; recommended: boolean };

export type ReconcileResult = {
  itemsYen: number;
  taxYen: number;
  includedTaxYen: number;
  discountYen: number;
  pointsYen: number;
  couponYen: number;
  splitYen: number;
  roundingAdjustYen: number;
  expectedPaidYen: number;
  paidYen: number;
  /** 支払額 − 計算上の支払額(±1円は吸収済みの値ではなく、生の差)。 */
  diffYen: number;
  /** 自動で端数として吸収した額(±1円以内のずれ)。 */
  absorbedYen: number;
  status: 'ok' | 'mismatch';
  groups: TaxGroup[];
  suggestions: ReconcileSuggestion[];
};

function applyRounding(value: number, rounding: TaxRounding): number {
  if (rounding === 'floor') return Math.floor(value);
  if (rounding === 'ceil') return Math.ceil(value);
  return Math.round(value);
}

/** 本体価格 base(税抜)に掛かる税額。 */
export function taxOnBase(baseYen: number, rate: number, rounding: TaxRounding = 'floor'): number {
  return applyRounding((baseYen * rate) / 100, rounding);
}

/** 税込価格 gross に含まれる税額(内税の内訳)。 */
export function taxIncludedIn(
  grossYen: number,
  rate: number,
  rounding: TaxRounding = 'floor',
): number {
  return applyRounding((grossYen * rate) / (100 + rate), rounding);
}

/**
 * total を weights の比率で整数に按分する(最大剰余法)。合計は必ず total に一致する。
 * weights が全部 0 なら均等。負の total は符号を保って按分する。
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const w = weights.map((x) => Math.max(x, 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const base = sum > 0 ? w : w.map(() => 1);
  const baseSum = base.reduce((a, b) => a + b, 0);

  const raw = base.map((x) => (abs * x) / baseSum);
  const floors = raw.map((x) => Math.floor(x));
  let remainder = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x), w: base[i]! }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i]! += 1;
    remainder -= 1;
  }
  return floors.map((x) => sign * x);
}

function items(draft: ReceiptDraft): ReceiptLine[] {
  return draft.lines.filter((l) => l.kind === 'item');
}
function discounts(draft: ReceiptDraft): ReceiptLine[] {
  return draft.lines.filter((l) => l.kind === 'discount');
}

/** 税率別のグループ。税率が不明(null)の品目は 10% として扱う(標準税率が既定)。 */
function groupKey(rate: TaxRate | null): TaxRate {
  return rate === null ? 10 : rate;
}

/** 税率別に、品目・値引き・税額を集める。 */
export function groupByTaxRate(draft: ReceiptDraft): TaxGroup[] {
  const map = new Map<TaxRate, TaxGroup>();
  const ensure = (rate: TaxRate) => {
    let g = map.get(rate);
    if (!g) {
      g = { rate, itemsYen: 0, discountYen: 0, taxYen: 0, includedTaxYen: 0 };
      map.set(rate, g);
    }
    return g;
  };

  for (const l of items(draft)) ensure(groupKey(l.taxRate)).itemsYen += l.amountYen;

  // 値引き行:税率が分かれば同じ税率の品目から、特定の品目に掛かるならその品目の税率から、
  // それ以外は品目の大きさで税率グループへ按分して引く。
  const itemById = new Map(items(draft).map((l) => [l.id, l]));
  const unratedDiscount: number[] = [];
  for (const d of discounts(draft)) {
    const target = d.appliesToLineId ? itemById.get(d.appliesToLineId) : undefined;
    if (target) {
      ensure(groupKey(target.taxRate)).discountYen += d.amountYen;
    } else if (d.taxRate !== null) {
      ensure(groupKey(d.taxRate)).discountYen += d.amountYen;
    } else {
      unratedDiscount.push(d.amountYen);
    }
  }
  const unratedTotal = unratedDiscount.reduce((a, b) => a + b, 0);
  if (unratedTotal > 0 && map.size > 0) {
    const groups = [...map.values()];
    const shares = apportion(
      unratedTotal,
      groups.map((g) => g.itemsYen),
    );
    groups.forEach((g, i) => {
      g.discountYen += shares[i]!;
    });
  } else if (unratedTotal > 0) {
    ensure(10).discountYen += unratedTotal;
  }

  for (const g of map.values()) {
    const net = Math.max(g.itemsYen - g.discountYen, 0);
    const rate = g.rate ?? 10;
    if (draft.priceBasis === 'tax_excluded') {
      const printed = rate === 8 || rate === 10 ? draft.printedTaxYen[rate] : undefined;
      g.taxYen = printed ?? taxOnBase(net, rate, draft.taxRounding);
    } else if (rate > 0) {
      g.includedTaxYen = taxIncludedIn(net, rate, draft.taxRounding);
    }
  }
  return [...map.values()].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
}

/** 印字値を照合する。 */
export function reconcileReceipt(draft: ReceiptDraft): ReconcileResult {
  assertYen(draft.paidYen, '支払額');
  const groups = groupByTaxRate(draft);
  const itemsYen = groups.reduce((a, g) => a + g.itemsYen, 0);
  const discountYen = groups.reduce((a, g) => a + g.discountYen, 0);
  const taxYen = groups.reduce((a, g) => a + g.taxYen, 0);
  const includedTaxYen = groups.reduce((a, g) => a + g.includedTaxYen, 0);

  const expectedPaidYen =
    itemsYen +
    taxYen -
    discountYen -
    draft.pointsYen -
    draft.couponYen -
    draft.splitYen +
    draft.roundingAdjustYen;
  const diffYen = draft.paidYen - expectedPaidYen;
  const withinAbsorb = Math.abs(diffYen) <= RECEIPT_ABSORB_YEN;

  return {
    itemsYen,
    taxYen,
    includedTaxYen,
    discountYen,
    pointsYen: draft.pointsYen,
    couponYen: draft.couponYen,
    splitYen: draft.splitYen,
    roundingAdjustYen: draft.roundingAdjustYen,
    expectedPaidYen,
    paidYen: draft.paidYen,
    diffYen,
    absorbedYen: withinAbsorb ? diffYen : 0,
    status: withinAbsorb ? 'ok' : 'mismatch',
    groups,
    suggestions: withinAbsorb ? [] : suggestFixes(diffYen),
  };
}

/**
 * 不一致のときの修正候補。支払額の方が少なければ「値引き行の見落とし」、
 * 多ければ「品目行の読み落とし」の可能性が高いので、そちらを勧める。
 * 端数としての調整は、どちらの場合も選べる。
 */
export function suggestFixes(diffYen: number): ReconcileSuggestion[] {
  if (diffYen === 0) return [];
  const amountYen = Math.abs(diffYen);
  const missingIsDiscount = diffYen < 0;
  return [
    { type: 'add_discount', amountYen, recommended: missingIsDiscount },
    { type: 'check_missing_line', amountYen, recommended: !missingIsDiscount },
    { type: 'adjust_rounding', amountYen: diffYen, recommended: false },
  ];
}

/** 修正候補を下書きに適用する。 */
export function applyFix(draft: ReceiptDraft, fix: ReconcileSuggestion): ReceiptDraft {
  switch (fix.type) {
    case 'adjust_rounding':
      return { ...draft, roundingAdjustYen: draft.roundingAdjustYen + fix.amountYen };
    case 'add_discount':
      return {
        ...draft,
        lines: [
          ...draft.lines,
          {
            id: `fix-discount-${draft.lines.length}`,
            name: '値引き(追加)',
            amountYen: fix.amountYen,
            kind: 'discount',
            taxRate: null,
            genreId: null,
            confidence: 1,
            yRatio: null,
          },
        ],
      };
    case 'check_missing_line':
      return {
        ...draft,
        lines: [
          ...draft.lines,
          {
            id: `fix-missing-${draft.lines.length}`,
            name: '読み落とし分',
            amountYen: fix.amountYen,
            kind: 'item',
            taxRate: null,
            genreId: null,
            confidence: 1,
            yRatio: null,
          },
        ],
      };
  }
}

export type AllocatedItem = { id: string; amountYen: number };

/**
 * 品目を支払額に按分する。返す品目の金額(正)の合計は必ず paidYen に一致する
 * (子の分割合計 = 親の金額、を常に満たす)。
 *
 * 重み = 品目の税込価格から、その品目に掛かる値引きを引いたもの。ポイント・
 * クーポンで支払額が小さくなる分も、この比率で全品目に薄く乗る。
 */
export function allocateToPayment(draft: ReceiptDraft): AllocatedItem[] {
  const list = items(draft);
  if (list.length === 0 || draft.paidYen <= 0) return [];

  const groups = groupByTaxRate(draft);
  const groupByRate = new Map(groups.map((g) => [groupKey(g.rate), g]));

  // 特定の品目に掛かる値引きはその品目から引き、残りの値引きは税率グループ内で
  // 品目の大きさに応じて薄く引く。外税なら税も品目の大きさで乗せる。
  const targeted = new Map<string, number>();
  for (const d of discounts(draft)) {
    if (d.appliesToLineId && list.some((l) => l.id === d.appliesToLineId)) {
      targeted.set(d.appliesToLineId, (targeted.get(d.appliesToLineId) ?? 0) + d.amountYen);
    }
  }
  const targetedByGroup = new Map<TaxRate, number>();
  for (const l of list) {
    const t = targeted.get(l.id) ?? 0;
    targetedByGroup.set(groupKey(l.taxRate), (targetedByGroup.get(groupKey(l.taxRate)) ?? 0) + t);
  }

  const weights = list.map((l) => {
    const key = groupKey(l.taxRate);
    const g = groupByRate.get(key);
    if (!g) return l.amountYen;
    const share = g.itemsYen > 0 ? l.amountYen / g.itemsYen : 0;
    const untargeted = Math.max(g.discountYen - (targetedByGroup.get(key) ?? 0), 0);
    const net = l.amountYen - (targeted.get(l.id) ?? 0) - untargeted * share;
    const tax = draft.priceBasis === 'tax_excluded' ? g.taxYen * share : 0;
    return Math.max(net + tax, 0);
  });

  const amounts = apportion(draft.paidYen, weights);
  return list.map((l, i) => ({ id: l.id, amountYen: amounts[i]! }));
}

/** 下書きの品目の税率別の小計(画面のグループ見出し用)。 */
export function linesByTaxRate(
  draft: ReceiptDraft,
): { rate: TaxRate | null; lines: ReceiptLine[] }[] {
  const rates: (TaxRate | null)[] = [8, 10, 0, null];
  return rates
    .map((rate) => ({ rate, lines: draft.lines.filter((l) => l.taxRate === rate) }))
    .filter((g) => g.lines.length > 0);
}
