'use client';

import { useImperativeHandle, useRef } from 'react';

/**
 * iPhone のカメラをそのまま開く(v5 変更1、ADR-133)。アプリの中の自前カメラ(自動シャッター・
 * 連続撮影)はやめ、ファイルの選び方の「カメラで撮る」(accept="image/*" capture="environment")を使う。
 * ピント・フラッシュ・ズームは iPhone のいつもの操作になり、カメラの許可も聞かれない。
 *
 * ブラウザの決まりで、カメラは「押した」操作の中でしか開けない。open() は押したときの処理の中で
 * そのまま呼ぶ(あとから・時間をおいて呼ぶと開かない)。
 */
export type CameraCaptureHandle = { open: () => void };

export function CameraCaptureInput({
  ref,
  onFiles,
}: {
  ref: React.Ref<CameraCaptureHandle>;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ open: () => input.current?.click() }), []);
  return (
    <input
      ref={input}
      type="file"
      accept="image/*"
      capture="environment"
      className="sr-only"
      aria-hidden="true"
      tabIndex={-1}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length > 0) onFiles(files);
      }}
    />
  );
}
