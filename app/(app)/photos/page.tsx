'use client';
import { useRouter } from 'next/navigation';
import { PhotoLibrary } from '@/components/receipt/photo-library';
import { enqueueReceiptFiles } from '@/features/import/receipt-queue';

export default function PhotosPage() {
  const router = useRouter();
  return (
    <main className="space-y-5 px-4 py-6">
      <h1 className="text-xl font-semibold">写真から読み取る</h1>
      <PhotoLibrary
        onFiles={(files) => {
          enqueueReceiptFiles(files);
          router.push('/transactions/receipt');
        }}
      />
    </main>
  );
}
