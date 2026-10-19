'use client';

import { useRouter } from 'next/navigation';

import { ReceiptCamera } from '@/components/receipt/receipt-camera';
import { enqueueReceiptFiles } from '@/features/import/receipt-queue';

/** URLを開いたら、そのままWebカメラから始める。撮影済みの画像は共通の読み取りへ回す。 */
export default function CameraPage() {
  const router = useRouter();
  return (
    <ReceiptCamera
      onCapture={(files) => enqueueReceiptFiles(files)}
      onClose={() => router.replace('/spending')}
    />
  );
}
