'use client';

/** iOS のスイッチの形(51×31)。 */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <span
      className="relative h-8 w-13 shrink-0 rounded-full transition-colors"
      style={{ background: checked ? 'var(--switch-on)' : 'var(--field)' }}
    >
      <span
        aria-hidden
        className="absolute top-0.5 size-7 rounded-full transition-[left]"
        style={{
          left: checked ? 22 : 2,
          background: '#ffffff',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
        }}
      />
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="absolute inset-0 m-0 cursor-pointer opacity-0"
      />
    </span>
  );
}
