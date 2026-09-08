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
  sub,
  ratio,
  tone,
  note,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  ratio?: number | null | undefined;
  tone?: BudgetTone | undefined;
  /** バッジに出す短い注記。「予算の 75%」など。 */
  note?: string | undefined;
}) {
  const resolvedTone: BudgetTone = tone ?? 'normal';

  return (
    <div
      className="rounded-2xl p-5 ring-1"
      style={{
        background: 'var(--surface)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
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

      <p
        className="mt-2 text-2xl leading-tight font-semibold tracking-tight"
        style={{ color: 'var(--ink)' }}
      >
        {value}
      </p>

      {ratio !== undefined ? (
        <div className="mt-4">
          <Meter ratio={ratio} tone={resolvedTone} label={`${label}の消化`} />
        </div>
      ) : null}

      {sub ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
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
    attention: 'var(--warning)',
    over: 'var(--critical)',
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
