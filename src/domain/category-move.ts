/**
 * カテゴリの移動の計画(純粋関数)。画面の楽観的更新と、サーバーの書き込みが、同じ計画を使う。
 *
 *   planCategoryMove … 明細(の、あるカテゴリに属する部分)を別のカテゴリへ移す
 *   planItemMove     … 分割したレシートの品目1つだけを別のカテゴリへ移し、分割の内訳を作り直す
 *
 * 約束:移したあとも「分割の合計 = 明細の金額」を保つ。分割が1つだけになったら分割を解除して、
 * 明細本体のジャンルにする。
 */

export type MoveSplit = { genreId: string | null; amountYen: number; note: string | null };
export type MoveItem = { id: string; amountYen: number; genreId: string | null; name: string };

export type MoveInput = {
  /** 明細の金額(符号付き。支出は負)。 */
  amountYen: number;
  /** 明細本体(代表)のジャンル。 */
  genreId: string | null;
  splits: readonly MoveSplit[];
  items: readonly MoveItem[];
};

export type MovePlan = {
  genreId: string | null;
  /** 2つ以上あるときだけ。空なら分割なし。 */
  splits: MoveSplit[];
  /** 品目ごとの新しいジャンル(変わったものだけ)。 */
  itemGenres: Map<string, string | null>;
};

export class MovePlanError extends Error {}

/** 同じジャンルの分割を1つにまとめる(金額は足し、メモは重複なく連ねる)。 */
export function mergeSplits(splits: readonly MoveSplit[]): MoveSplit[] {
  const order: (string | null)[] = [];
  const by = new Map<string | null, { amountYen: number; notes: string[] }>();
  for (const s of splits) {
    const e = by.get(s.genreId) ?? { amountYen: 0, notes: [] };
    e.amountYen += s.amountYen;
    if (s.note && !e.notes.includes(s.note)) e.notes.push(s.note);
    if (!by.has(s.genreId)) order.push(s.genreId);
    by.set(s.genreId, e);
  }
  return order.map((genreId) => {
    const e = by.get(genreId)!;
    return {
      genreId,
      amountYen: e.amountYen,
      note: e.notes.length > 0 ? e.notes.join('、') : null,
    };
  });
}

function largestGenre(splits: readonly MoveSplit[]): string | null {
  return splits.reduce((a, b) => (Math.abs(b.amountYen) > Math.abs(a.amountYen) ? b : a)).genreId;
}

/** あるカテゴリ(from)に属する部分を、別のカテゴリ(to)へ移す。 */
export function planCategoryMove(
  input: MoveInput,
  fromGenreId: string | null,
  toGenreId: string | null,
): MovePlan {
  const itemGenres = new Map<string, string | null>();
  for (const item of input.items) {
    if (item.genreId === fromGenreId && fromGenreId !== null) itemGenres.set(item.id, toGenreId);
  }
  if (input.splits.length === 0) {
    return { genreId: toGenreId, splits: [], itemGenres };
  }
  const merged = mergeSplits(
    input.splits.map((s) => (s.genreId === fromGenreId ? { ...s, genreId: toGenreId } : s)),
  );
  if (merged.length === 1) {
    return { genreId: merged[0]!.genreId, splits: [], itemGenres };
  }
  const genreId = input.genreId === fromGenreId ? largestGenre(merged) : input.genreId;
  return { genreId, splits: merged, itemGenres };
}

/**
 * 品目1つだけを別のカテゴリへ移し、レシートの分割の内訳を作り直す。
 * 品目の実効ジャンル = 品目のジャンル、無ければ明細本体のジャンル。品目に載っていない額
 * (合計との差)は、明細本体のジャンルに残す。
 */
export function planItemMove(input: MoveInput, itemId: string, toGenreId: string | null): MovePlan {
  const target = input.items.find((i) => i.id === itemId);
  if (!target) throw new MovePlanError('品目が見つかりません。');
  const items = input.items.map((i) => (i.id === itemId ? { ...i, genreId: toGenreId } : i));
  const effective = (i: MoveItem) => i.genreId ?? input.genreId;

  const groups: MoveSplit[] = items.map((i) => ({
    genreId: effective(i),
    amountYen: i.amountYen,
    note: i.name,
  }));
  const itemSum = items.reduce((a, i) => a + i.amountYen, 0);
  const remainder = input.amountYen - itemSum;
  if (remainder !== 0) {
    if (Math.sign(remainder) !== Math.sign(input.amountYen)) {
      throw new MovePlanError('品目の合計が明細の金額を超えているため、移せません。');
    }
    groups.push({ genreId: input.genreId, amountYen: remainder, note: null });
  }
  const merged = mergeSplits(groups);
  const itemGenres = new Map<string, string | null>([[itemId, toGenreId]]);
  if (merged.length === 1) return { genreId: merged[0]!.genreId, splits: [], itemGenres };
  const genreId = merged.some((s) => s.genreId === input.genreId)
    ? input.genreId
    : largestGenre(merged);
  return { genreId, splits: merged, itemGenres };
}

/** 移動の計画を適用したあとの、分割の合計が明細の金額と一致しているか(保存前の確認)。 */
export function splitsAreConsistent(amountYen: number, plan: MovePlan): boolean {
  return plan.splits.length === 0 || plan.splits.reduce((a, s) => a + s.amountYen, 0) === amountYen;
}

/** 明細のすべて(分割も品目も)を1つのカテゴリへ移す(店ごとのルールを過去にも当てるとき)。 */
export function planWholeMove(input: MoveInput, toGenreId: string | null): MovePlan {
  return {
    genreId: toGenreId,
    splits: [],
    itemGenres: new Map(input.items.map((i) => [i.id, toGenreId])),
  };
}

/** 計画を適用した「次の状態」(続けて別の品目を移すとき)。 */
export function applyPlanToInput(input: MoveInput, plan: MovePlan): MoveInput {
  return {
    amountYen: input.amountYen,
    genreId: plan.genreId,
    splits: plan.splits,
    items: input.items.map((i) =>
      plan.itemGenres.has(i.id) ? { ...i, genreId: plan.itemGenres.get(i.id)! } : i,
    ),
  };
}
