import { parseYen } from '@/domain/money';

export type OptionalSavingsGoal = {
  title: string;
  targetAmountYen: number | null;
  targetDate: string | null;
};

/** 未入力の任意項目は作らない。一部を入力した場合だけ内容を確かめる。 */
export function optionalSavingsGoal(input: {
  title: string;
  amountText: string;
  targetDate: string;
}): { goal: OptionalSavingsGoal | null; error: string | null } {
  const title = input.title.trim();
  const amountText = input.amountText.trim();
  const targetDate = input.targetDate.trim();
  if (title === '' && amountText === '' && targetDate === '') return { goal: null, error: null };
  if (title === '')
    return { goal: null, error: '貯金目標を追加する場合は、何のために貯めるかを入れてください。' };
  let targetAmountYen: number | null = null;
  if (amountText !== '') {
    try {
      targetAmountYen = parseYen(amountText);
    } catch {
      /* 下で入力エラーを表示する */
    }
    if (targetAmountYen === null || !Number.isInteger(targetAmountYen) || targetAmountYen <= 0) {
      return { goal: null, error: '貯めたい額は1円以上の数字で入れてください' };
    }
  }
  return { goal: { title, targetAmountYen, targetDate: targetDate || null }, error: null };
}
