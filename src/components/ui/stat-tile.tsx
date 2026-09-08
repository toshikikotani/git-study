import type { BudgetTone } from '@/domain/budget';
import { Meter } from './meter';

/**
 * 残額タイル(FR-14, FR-64)。
 *
 * dataviz の stat tile 契約に沿う: label(そのまま文、コロンなし)・value・
 * 補足・メーター。値が主役で、ラベルと補足は退く。
 *
 * 状態は色だけで運ばない。閾値に達したときも超過したときも、
 * 必ず文字のバッジを添える(ステータス色は単独で意味を持たせない)。
 */
export function StatTile({
  label,
  value,
  valueParts,
  sub,
  ratio,
  tone,
  note,
}: {
  label: string;
  /** 単純な文字列表示。valueParts があればそちらが優先される。 */
  value: string;
  /** 金額だけを大きく組みたいとき。文言の分割は domain 側で行う。 */
  valueParts?: { prefix: string; amount: string; suffix: string } | undefined;
  sub?: string | undefined;
  ratio?: number | null | undefined;
  tone?: BudgetTone | undefined;
  /** バッジに出す短い注記。「予算の 75%」など。 */
  note?: string | undefined;
}) {
  const resolvedTone: BudgetTone = tone ?? 'normal';

  return (
    <div
      className="rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[11px] font-medium tracking-[0.08em] uppercase"
          style={{ color: 'var(--ink-muted)' }}
        >
          {label}
        </span>
        {note ? <ToneBadge tone={resolvedTone} text={note} /> : null}
      </div>

      {/* 金額を主役にする。FR-64 の肯定形は保ったまま、数字だけを大きく組む */}
      <p className="mt-2.5 leading-tight" style={{ color: 'var(--ink)' }}>
        {valueParts ? (
          <>
            <span className="text-base" style={{ color: 'var(--ink-secondary)' }}>
              {valueParts.prefix}
            </span>
            <span className="text-[30px] font-semibold tracking-[-0.03em]">
              {valueParts.amount}
            </span>
            <span className="ml-0.5 text-base" style={{ color: 'var(--ink-secondary)' }}>
              {valueParts.suffix}
            </span>
          </>
        ) : (
          <span className="text-[26px] font-semibold tracking-[-0.02em]">{value}</span>
        )}
      </p>

      {ratio !== undefined ? (
        <div className="mt-4">
          <Meter ratio={ratio} tone={resolvedTone} label={`${label}の消化`} />
        </div>
      ) : null}

      {sub ? (
        <p className="tabular mt-2.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 状態バッジ。ステータス色は必ずこの文字ラベルと対で出す。
 * 色覚特性や強制カラーモードで色が落ちても、意味が残るようにするため。
 */
function ToneBadge({ tone, text }: { tone: BudgetTone; text: string }) {
  const color = {
    normal: 'var(--ink-muted)',
    attention: 'var(--attention)',
    over: 'var(--over)',
  }[tone];

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium">
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span style={{ color: tone === 'normal' ? 'var(--ink-muted)' : 'var(--ink-secondary)' }}>
        {text}
      </span>
    </span>
  );
}
