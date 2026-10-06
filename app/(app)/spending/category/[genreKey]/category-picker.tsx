'use client';

import { GenreBadge } from '@/components/ui/genre-badge';

/**
 * カテゴリの格子(アイコン + 名前)。1タップで移す先を選ぶ。いまのカテゴリは選べない。
 * 先頭に「いつもの移動先」があれば、目立たせて置く。
 */
export function CategoryPicker({
  genres,
  currentId,
  suggestedId,
  onPick,
  includeUncategorized = false,
}: {
  genres: readonly { id: string; name: string }[];
  currentId: string | null;
  suggestedId?: string | null;
  onPick: (genreId: string | null) => void;
  includeUncategorized?: boolean;
}) {
  const options = genres.filter((g) => g.id !== currentId);
  const ordered = [
    ...options.filter((g) => g.id === suggestedId),
    ...options.filter((g) => g.id !== suggestedId),
  ];
  return (
    <div role="group" aria-label="移すカテゴリ" className="grid grid-cols-4 gap-2">
      {ordered.map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={() => onPick(g.id)}
          aria-label={`${g.name}へ移す${g.id === suggestedId ? '(いつもの移動先)' : ''}`}
          className="min-h-16 flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2"
          style={{
            background: 'var(--surface-raised)',
            color: 'var(--ink)',
            outline: g.id === suggestedId ? '2px solid var(--ink-secondary)' : 'none',
          }}
        >
          <GenreBadge name={g.name} size={28} />
          <span className="w-full truncate text-center text-xs font-semibold">{g.name}</span>
        </button>
      ))}
      {includeUncategorized && currentId !== null ? (
        <button
          type="button"
          onClick={() => onPick(null)}
          aria-label="未分類へ戻す"
          className="min-h-16 flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink-secondary)' }}
        >
          <GenreBadge name={null} size={28} />
          <span className="text-xs font-semibold">未分類</span>
        </button>
      ) : null}
    </div>
  );
}
