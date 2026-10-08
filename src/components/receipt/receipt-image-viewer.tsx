'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MdClose } from 'react-icons/md';

import { ZoomableImage } from '@/components/receipt/zoomable-image';

/** レシート画像のフルスクリーン表示(ズーム可)。カードのぼかしに閉じ込められないよう、画面の一番上に出す。 */
export function ReceiptImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="レシート画像"
      className="fixed inset-0 z-[80] flex flex-col"
      style={{ background: '#000' }}
    >
      <div className="flex justify-end px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          aria-label="閉じる"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-full"
          style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
        >
          <MdClose aria-hidden size={22} />
        </button>
      </div>
      <ZoomableImage
        src={src}
        alt="レシート画像"
        highlightRatio={null}
        className="min-h-0 flex-1"
      />
    </div>,
    document.body,
  );
}
