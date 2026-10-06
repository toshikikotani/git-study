'use client';

/**
 * 手入力のカテゴリ格子の長押しメニュー(N2「長押しで手動の並べ替えと非表示」)。
 *
 * ドラッグではなく▲▼ボタンでの並べ替えにした——タッチのドラッグ&ドロップは
 * スクロール領域との競合(意図しないスクロール/誤操作)が起きやすく、
 * このアプリの他の並べ替え(明細の絞り込み等)もボタン操作が基本のため、
 * 一貫した操作感を優先した判断(docs/decisions.md に記録)。
 */

import { useEffect, useState } from 'react';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import type { QuickEntryGenreSetting } from '@/features/genre/store';
import {
  fetchQuickEntryGenreSettingsAction,
  reorderQuickEntryGenresAction,
  setQuickEntryGenreHiddenAction,
} from './genre-quick-entry-actions';

export function QuickEntryGenreManager({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** 並び替え・非表示が確定したときに呼ばれる(呼び出し側は格子を再取得する)。 */
  onChanged: () => void;
}) {
  const [items, setItems] = useState<QuickEntryGenreSetting[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- シートを開くたびの読み込み中表示のリセット
    setItems(null);
    void fetchQuickEntryGenreSettingsAction().then(setItems);
  }, [open]);

  async function move(index: number, direction: -1 | 1): Promise<void> {
    if (items === null) return;
    const visible = items.filter((g) => !g.hiddenInQuickEntry);
    const target = index + direction;
    if (target < 0 || target >= visible.length) return;
    const reordered = [...visible];
    const [moved] = reordered.splice(index, 1);
    if (moved === undefined) return;
    reordered.splice(target, 0, moved);

    const hidden = items.filter((g) => g.hiddenInQuickEntry);
    setItems([...reordered, ...hidden]);
    setSaving(true);
    await reorderQuickEntryGenresAction(reordered.map((g) => g.id));
    setSaving(false);
    onChanged();
  }

  async function toggleHidden(id: string, hidden: boolean): Promise<void> {
    if (items === null) return;
    setItems(items.map((g) => (g.id === id ? { ...g, hiddenInQuickEntry: hidden } : g)));
    setSaving(true);
    await setQuickEntryGenreHiddenAction(id, hidden);
    setSaving(false);
    onChanged();
  }

  const visible = items?.filter((g) => !g.hiddenInQuickEntry) ?? [];
  const hidden = items?.filter((g) => g.hiddenInQuickEntry) ?? [];

  return (
    <BottomSheet open={open} onClose={onClose} role="dialog">
      <div className="px-4 pt-2 pb-6">
        <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          カテゴリの並び替え・非表示
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          ▲▼で並び替え、目のアイコンで格子から隠せます(ジャンル自体は残ります)。
        </p>

        {items === null ? (
          <p className="mt-4 text-xs" style={{ color: 'var(--ink-muted)' }}>
            読み込み中…
          </p>
        ) : (
          <>
            <ul className="mt-3 space-y-1">
              {visible.map((g, index) => (
                <li
                  key={g.id}
                  className="flex items-center gap-2 rounded-xl px-2 py-1"
                  style={{ background: 'var(--plane)' }}
                >
                  <span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--ink)' }}>
                    {g.name}
                  </span>
                  <button
                    type="button"
                    aria-label={`${g.name}を上へ`}
                    disabled={saving || index === 0}
                    onClick={() => void move(index, -1)}
                    className="min-h-11 min-w-11 text-base disabled:opacity-30"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`${g.name}を下へ`}
                    disabled={saving || index === visible.length - 1}
                    onClick={() => void move(index, 1)}
                    className="min-h-11 min-w-11 text-base disabled:opacity-30"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    aria-label={`${g.name}を格子から隠す`}
                    disabled={saving}
                    onClick={() => void toggleHidden(g.id, true)}
                    className="min-h-11 min-w-11 flex items-center justify-center"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    <MdVisibility aria-hidden size={18} />
                  </button>
                </li>
              ))}
            </ul>

            {hidden.length > 0 ? (
              <>
                <p className="mt-4 text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
                  非表示中
                </p>
                <ul className="mt-2 space-y-1">
                  {hidden.map((g) => (
                    <li
                      key={g.id}
                      className="flex items-center gap-2 rounded-xl px-2 py-1"
                      style={{ background: 'var(--plane)', opacity: 0.6 }}
                    >
                      <span
                        className="min-w-0 flex-1 truncate text-sm"
                        style={{ color: 'var(--ink-secondary)' }}
                      >
                        {g.name}
                      </span>
                      <button
                        type="button"
                        aria-label={`${g.name}を格子に戻す`}
                        disabled={saving}
                        onClick={() => void toggleHidden(g.id, false)}
                        className="min-h-11 min-w-11 flex items-center justify-center"
                        style={{ color: 'var(--ink-secondary)' }}
                      >
                        <MdVisibilityOff aria-hidden size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 min-h-11 w-full rounded-xl text-sm font-semibold"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
        >
          閉じる
        </button>
      </div>
    </BottomSheet>
  );
}
