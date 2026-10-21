import type { LedgerRowPresentation } from '@/domain/ledger-row-presentation';

/** 通常の明細行と複数選択で共用する、必ず2行の表示。全内容は明細を開いて見る。 */
export function CompactTransactionSummary({
  summary,
  fixed = false,
  attentionLabel = null,
}: {
  summary: LedgerRowPresentation;
  fixed?: boolean;
  attentionLabel?: string | null;
}) {
  const suffix = summary.otherItemCount > 0 ? ` ほか${summary.otherItemCount}` : '';
  const subtitle =
    suffix && summary.subtitle.endsWith(suffix)
      ? summary.subtitle.slice(0, -suffix.length)
      : summary.subtitle;
  return (
    <div className="min-w-0 flex-1">
      <p
        className="flex h-5 items-center gap-1 text-[15px] leading-5 font-semibold"
        style={{ color: 'var(--ink)' }}
      >
        <span className="min-w-0 truncate" title={summary.name}>
          {summary.name}
        </span>
        {fixed ? (
          <span
            className="shrink-0 rounded px-1 text-[11px] font-semibold"
            style={{ background: 'var(--plane)', color: 'var(--ink-muted)' }}
          >
            固定費
          </span>
        ) : null}
        {attentionLabel ? (
          <span
            className="shrink-0 rounded px-1 text-[11px] font-semibold"
            style={{ background: 'var(--attention-track)', color: 'var(--attention)' }}
          >
            {attentionLabel}
          </span>
        ) : null}
      </p>
      <p
        className="flex h-5 items-center gap-1 text-[12px] leading-5"
        style={{ color: 'var(--ink-muted)' }}
        title={summary.subtitle}
      >
        <span className="min-w-0 truncate">{subtitle}</span>
        {suffix ? <span className="shrink-0">{suffix.trimStart()}</span> : null}
      </p>
    </div>
  );
}
