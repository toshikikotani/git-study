'use client';

/** A familiar switch with a 44px hit target and a separate visual track. */
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
    <span className="hm-switch relative inline-flex min-h-11 w-13 shrink-0 items-center">
      <span
        aria-hidden
        className="relative h-8 w-full rounded-full transition-colors motion-reduce:transition-none"
        style={{ background: checked ? 'var(--switch-on)' : 'var(--field)' }}
      >
        <span
          className="absolute top-0.5 left-0.5 size-7 rounded-full transition-transform motion-reduce:transition-none"
          style={{
            transform: checked ? 'translateX(20px)' : 'none',
            background: 'var(--hm-switch-thumb)',
            boxShadow: 'var(--hm-switch-shadow)',
          }}
        />
      </span>
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
