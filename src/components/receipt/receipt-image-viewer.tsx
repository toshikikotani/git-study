'use client';

import { MdClose } from 'react-icons/md';

import { ZoomableImage } from '@/components/receipt/zoomable-image';

/** レシート画像のフルスクリーン表示(ズーム可)。 */
export function ReceiptImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="レシート画像"
      className="fixed inset-0 z-50 flex flex-col"
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
    </div>
  );
}
