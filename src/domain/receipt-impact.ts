/** 撮ったレシートを、自由残からその場で引く。実績にはまだ入れない。 */
export function freeAfterReceipt(freeYen: number, receiptYen: number): number {
  return freeYen - Math.abs(receiptYen);
}

export function receiptTotalYen(amounts: readonly number[]): number {
  return amounts.reduce((sum, amount) => sum + Math.abs(amount), 0);
}
