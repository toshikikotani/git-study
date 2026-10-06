/** 見出し付きの箇条書き(AIレポートの気づき・アドバイス)。 */
export function BulletList({ heading, items }: { heading: string; items: readonly string[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {heading}
      </p>
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            ・{item}
          </li>
        ))}
      </ul>
    </div>
  );
}
