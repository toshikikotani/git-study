'use client';

/**
 * セグメントコントロール(デザイン仕様書の切り替え、ADR-090。iOS の標準の切り替え部品に合わせた見た目)。
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
      className={`inline-flex max-w-full ${className ?? ''}`}
      style={{ background: 'var(--field)', borderRadius: 10, padding: 2, gap: 2 }}
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
            className={`min-h-11 min-w-11 px-4 text-[14px] whitespace-nowrap ${on ? 'font-semibold' : 'font-medium'}`}
            style={{
              borderRadius: 8,
              background: on ? 'var(--surface)' : 'transparent',
              color: on ? 'var(--ink)' : 'var(--ink-secondary)',
              boxShadow: on ? '0 1px 3px rgba(0, 0, 0, 0.12)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
