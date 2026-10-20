/** 入力待ちのレシートを入力したあとの戻り先(「‹ 前の画面の名前」にそろえる、ADR-127)。 */
export function captureReturnTarget(value: string | undefined): {
  href: '/spending' | '/spending/review' | '/';
  label: string;
} {
  if (value === '/spending/review' || value === '/spending?review=input') {
    return { href: '/spending/review', label: '確認が必要' };
  }
  if (value === '/') return { href: '/', label: '今日' };
  return { href: '/spending', label: '明細' };
}
