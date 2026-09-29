import { formatYen } from '@/domain/money';

/**
 * 金額の表示部品。数字は等幅(tabular)、「円」は数字の0.7倍で少し細く(.yen-unit)。
 * 一覧の支出には「−」を付けない(収入だけ緑の「+」)。読み上げは呼び出し側の aria-label が担う。
 */
export function Yen({ value, className }: { value: number; className?: string }) {
  const text = formatYen(value, { sign: 'never' });
  const number = text.slice(0, -1);
  return (
    <span className={`tabular ${className ?? ''}`}>
      {number}
      <span className="yen-unit">円</span>
    </span>
  );
}

/** 「円」付きの文字列(formatYen の結果など)を、金額の見た目に整える。 */
export function YenText({ text }: { text: string }) {
  if (!text.endsWith('円')) return <>{text}</>;
  return (
    <>
      {text.slice(0, -1)}
      <span className="yen-unit">円</span>
    </>
  );
}

/**
 * 明細・一覧の金額。支出は符号なし、収入だけ緑の「+」。
 * 返品・返金(支出の負)は収入と同じく「+」で表す。
 */
export function LedgerAmount({
  amountYen,
  className,
}: {
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
  className?: string;
}) {
  const income = amountYen > 0;
  return (
    <span
      className={`tabular ${className ?? ''}`}
      style={{ color: income ? 'var(--income)' : 'var(--ink)' }}
    >
      {income ? '+' : ''}
      <Yen value={Math.abs(amountYen)} />
    </span>
  );
}
