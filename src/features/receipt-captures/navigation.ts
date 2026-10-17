/** 入力待ちの戻り先。外部URLや不明な経路を渡されても明細へ戻す。 */
export function captureReturnTarget(value: string | undefined): {
  href: '/spending' | '/spending?review=input' | '/';
  label: string;
} {
  if (value === '/spending?review=input') return { href: value, label: '入力待ちへ戻る' };
  if (value === '/') return { href: value, label: '今日へ戻る' };
  return { href: '/spending', label: '家計簿へ' };
}
