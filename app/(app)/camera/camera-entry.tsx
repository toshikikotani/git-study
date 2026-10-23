'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { CameraCaptureInput, type CameraCaptureHandle } from '@/components/receipt/camera-capture';
import { countReading, enqueueReceiptFiles, useReceiptJobs } from '@/features/import/receipt-queue';

/**
 * ホーム画面のカメラのアイコン・ショートカットから開く画面(ADR-125 → 126 → 133)。
 * ブラウザの決まりで、開いただけではカメラを起動できない(押す操作が要る)ので、大きな「撮る」ボタンを
 * 1つだけ置く。押すと iPhone のカメラが開く。撮ったら「もう1枚撮る」「確かめる」。読み取りは裏で進む。
 */
export function CameraEntry() {
  const router = useRouter();
  const camera = useRef<CameraCaptureHandle>(null);
  const [count, setCount] = useState(0);
  const reading = countReading(useReceiptJobs());

  return (
    <div
      className="flex min-h-[60dvh] flex-col justify-center gap-4"
      style={{ color: 'var(--ink)' }}
    >
      <CameraCaptureInput
        ref={camera}
        onFiles={(files) => {
          enqueueReceiptFiles(files);
          setCount((n) => n + files.length);
        }}
      />
      {count > 0 ? (
        <div className="flex flex-col gap-1 px-1 text-center">
          <p className="text-[17px] font-semibold">{count}枚 撮りました</p>
          <p role="status" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {reading > 0 ? `読み取り中 ${reading}枚 · 待たずに続けて撮れます` : '読み取りました'}
          </p>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => camera.current?.open()}
        className="btn-primary min-h-24 rounded-3xl text-[22px] font-semibold"
      >
        {count > 0 ? 'もう1枚撮る' : '撮る'}
      </button>
      {count > 0 ? (
        <button
          type="button"
          onClick={() => router.replace('/spending/review?receipt=next')}
          className="min-h-14 rounded-2xl text-[17px] font-semibold"
          style={{ background: 'var(--field)', color: 'var(--ink)' }}
        >
          確かめる
        </button>
      ) : null}
    </div>
  );
}
