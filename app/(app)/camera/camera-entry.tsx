'use client';

import { useRouter } from 'next/navigation';

import { ReceiptCamera } from '@/components/receipt/receipt-camera';
import { enqueueReceiptFiles } from '@/features/import/receipt-queue';

/**
 * ホーム画面のアイコン・ショートカットから、すぐカメラを開く(ADR-125 → 126)。説明の画面は挟まない。
 * 撮り終えたら読み取り結果へ。閉じたら前の画面へ戻る(アイコンから開いたときはホームへ)。
 */
export function CameraEntry() {
  const router = useRouter();
  return (
    <ReceiptCamera
      onCapture={(files) => enqueueReceiptFiles(files)}
      onDone={() => router.replace('/transactions/receipt')}
      onClose={() => {
        if (window.history.length > 1) router.back();
        else router.replace('/');
      }}
      onManual={() => router.replace('/spending?record=1')}
    />
  );
}
