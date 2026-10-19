'use client';

import { useState } from 'react';
import { rememberPhotos, useRecentPhotos } from '@/features/import/recent-photos';

export function PhotoLibrary({ onFiles }: { onFiles: (files: File[]) => void }) {
  const photos = useRecentPhotos();
  const [selected, setSelected] = useState<ReadonlySet<File>>(new Set());
  const [error, setError] = useState('');
  const chosen = photos.filter((p) => selected.has(p.file));
  return (
    <section className="space-y-4">
      <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-full border px-4 py-3 font-semibold">
        すべての写真から選ぶ
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length === 0) return;
            const validImages = files.filter(
              (file) => file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name),
            );
            const images = validImages.slice(0, 12);
            if (validImages.length > 12)
              setError('一度に選べる写真は12枚までです。最初の12枚を表示します。');
            else if (images.length !== files.length) setError('画像ファイルを選んでください。');
            else setError('');
            rememberPhotos(images);
            // 選んだ画像を確認してから読み取る。選択をキャンセルした場合は維持する。
            setSelected(new Set(images));
          }}
        />
      </label>
      <p className="text-xs">
        このタブで選んだ写真・撮影した写真だけを表示します。端末の写真は「すべての写真から選ぶ」から選択できます。
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="grid grid-cols-3 gap-3">
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            aria-label={`${photo.file.name}を選択`}
            aria-pressed={selected.has(photo.file)}
            className="min-h-11 overflow-hidden rounded-xl border-2 p-1"
            style={{ borderColor: selected.has(photo.file) ? 'var(--action)' : 'transparent' }}
            onClick={() =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(photo.file)) next.delete(photo.file);
                else next.add(photo.file);
                return next;
              })
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.file.name}
              className="aspect-square w-full rounded-lg object-cover"
            />
            <span className="text-xs">{selected.has(photo.file) ? '選択中' : '選ぶ'}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={chosen.length === 0}
        className="min-h-11 w-full rounded-full px-4 py-3 font-semibold disabled:opacity-40"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        onClick={() => onFiles(chosen.map((p) => p.file))}
      >
        選んだ{chosen.length}枚を読み取る
      </button>
    </section>
  );
}
