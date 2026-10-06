'use client';

/**
 * セグメントコントロール(iOS の標準の切り替え部品に合わせた見た目)。
 * 角丸の四角い溝の中で、選んでいる項目だけが浮いた面になる。丸いボタンを並べない。
 * どの項目も高さ44pt以上。読み上げは tablist / tab。
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`inline-flex max-w-full gap-1 p-1 ${className ?? ''}`}
      style={{ background: 'var(--surface-raised)', borderRadius: 'var(--radius-inner)' }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className="min-h-11 min-w-11 px-4 text-sm font-semibold whitespace-nowrap"
            style={{
              borderRadius: 'calc(var(--radius-inner) - 4px)',
              background: on ? 'var(--surface)' : 'transparent',
              color: on ? 'var(--ink)' : 'var(--ink-secondary)',
              boxShadow: on ? '0 1px 2px rgba(10, 16, 32, 0.12)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
