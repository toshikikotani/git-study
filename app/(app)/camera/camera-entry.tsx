'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReceiptCamera } from '@/components/receipt/receipt-camera';
import { enqueueReceiptFiles } from '@/features/import/receipt-queue';

export function CameraEntry() {
  const router = useRouter();
  const captured = useRef(false);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  return (
    <main className="space-y-5 px-4 py-6">
      <h1 className="text-xl font-semibold">レシートカメラ</h1>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-full px-6 py-3 font-semibold"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        カメラを開く
      </button>
      <Link href="/transactions/receipt" className="flex min-h-11 items-center underline">
        読み取り結果を確認する →
      </Link>
      <section className="space-y-3 rounded-2xl p-4" style={{ background: 'var(--surface)' }}>
        <h2 className="font-semibold">ホーム画面からすぐ撮影</h2>
        <p className="text-sm">
          このページをホーム画面に追加すると、アイコンから直接カメラを開けます。iPhone は Safari
          の共有メニュー →「ホーム画面に追加」、Android はブラウザのメニュー
          →「ホーム画面に追加」を選んでください。
        </p>
        <p className="text-sm">カメラの利用を許可してください。撮影には HTTPS 接続が必要です。</p>
        <button
          type="button"
          className="min-h-11 underline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(new URL('/camera', window.location.origin).href);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          カメラのURLをコピー
        </button>
        <p role="status" className="text-sm">
          {copied ? 'URLをコピーしました' : 'URLはブラウザのアドレスバーからもコピーできます。'}
        </p>
      </section>
      {open ? (
        <ReceiptCamera
          initialMode="continuous"
          onCapture={(files) => {
            captured.current = true;
            enqueueReceiptFiles(files);
          }}
          onClose={() => {
            setOpen(false);
            if (captured.current) router.push('/transactions/receipt');
          }}
          onManual={() => router.push('/spending?record=1')}
        />
      ) : null}
    </main>
  );
}
