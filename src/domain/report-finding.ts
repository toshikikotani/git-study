export type ReportFinding = {
  genreName: string;
  priorYen: number;
  previousYen: number;
  saveYen: number;
};

/** 直近2ヶ月で一番増えたジャンル。増えていなければ null。 */
export function biggestIncrease(input: {
  monthKeys: readonly string[];
  categories: readonly { id: string; name: string }[];
  rows: readonly { monthKey: string; categoryId: string; spentYen: number }[];
}): ReportFinding | null {
  if (input.monthKeys.length < 2) return null;
  const previous = input.monthKeys[input.monthKeys.length - 1]!;
  const prior = input.monthKeys[input.monthKeys.length - 2]!;
  const amount = (id: string, month: string) =>
    input.rows
      .filter((row) => row.categoryId === id && row.monthKey === month)
      .reduce((sum, row) => sum + row.spentYen, 0);
  let best: ReportFinding | null = null;
  for (const category of input.categories) {
    const priorYen = amount(category.id, prior);
    const previousYen = amount(category.id, previous);
    const saveYen = previousYen - priorYen;
    if (saveYen <= 0) continue;
    if (best === null || saveYen > best.saveYen) {
      best = { genreName: category.name, priorYen, previousYen, saveYen };
    }
  }
  return best;
}
