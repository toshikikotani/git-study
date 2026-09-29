'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MdClose, MdPhotoLibrary } from 'react-icons/md';

import {
  createStabilityTracker,
  cropRect,
  detectDocument,
  stitchLayout,
  type Box,
} from '@/features/import/document-detect';

/**
 * レシートの自動撮影(全画面のカメラ)。
 *
 * 映像を縮小して輪郭を検出し(features/import/document-detect.ts)、レシートが
 * 一定時間ほぼ動かずに枠へ収まったら自動でシャッターを切る。
 *   - 1枚:撮ったら閉じる
 *   - 連続:撮り続けられる(1枚ごとに読み取りは裏で進む)
 *   - 長いレシート:分けて撮った複数枚を縦に結合して1枚にする
 *   - ライブラリ:写真ライブラリから複数選択
 * カメラを使えない環境(権限拒否・非対応)では、ライブラリ選択に切り替える。
 */

type Mode = 'single' | 'continuous' | 'long';

const MODES: { value: Mode; label: string }[] = [
  { value: 'single', label: '1枚' },
  { value: 'continuous', label: '連続' },
  { value: 'long', label: '長いレシート' },
];

const SAMPLE_WIDTH = 160;
const SAMPLE_INTERVAL_MS = 250;
const COOLDOWN_MS = 1600;

export function ReceiptCamera({
  onCapture,
  onClose,
  initialMode = 'single',
}: {
  onCapture: (files: File[]) => void;
  onClose: () => void;
  /** 最初のモード(撮影ボタンの長押しから「連続撮影」を選んだときは continuous)。 */
  initialMode?: 'single' | 'continuous' | 'long';
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef(createStabilityTracker());
  const lastCaptureRef = useRef(0);
  const boxRef = useRef<Box | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const modeRef = useRef<Mode>(initialMode);
  const [box, setBox] = useState<Box | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [parts, setParts] = useState<Blob[]>([]);
  const partsRef = useRef<Blob[]>([]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const finish = useCallback(
    (files: File[]) => {
      stop();
      onCapture(files);
      onClose();
    },
    [onCapture, onClose, stop],
  );

  const grabFrame = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const crop = boxRef.current
      ? cropRect(boxRef.current, video.videoWidth, video.videoHeight)
      : { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
    const canvas = document.createElement('canvas');
    canvas.width = crop.width;
    canvas.height = crop.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  }, []);

  const shoot = useCallback(async () => {
    const blob = await grabFrame();
    if (!blob) return;
    lastCaptureRef.current = Date.now();
    trackerRef.current.reset();
    setProgress(0);
    const current = modeRef.current;
    if (current === 'long') {
      partsRef.current = [...partsRef.current, blob];
      setParts(partsRef.current);
      return;
    }
    const file = new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' });
    if (current === 'single') {
      finish([file]);
      return;
    }
    // 連続:撮ったらすぐ読み取りへ回し、カメラは開いたまま次を待つ。
    onCapture([file]);
    setCount((c) => c + 1);
  }, [finish, grabFrame, onCapture]);

  const finishLong = useCallback(async () => {
    const blobs = partsRef.current;
    if (blobs.length === 0) return;
    const bitmaps = await Promise.all(blobs.map((b) => createImageBitmap(b)));
    const layout = stitchLayout(bitmaps.map((b) => ({ width: b.width, height: b.height })));
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    bitmaps.forEach((bmp, i) => {
      const p = layout.placements[i]!;
      ctx.drawImage(bmp, p.x, p.y, p.width, p.height);
    });
    const stitched = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (stitched) {
      finish([new File([stitched], `receipt-long-${Date.now()}.jpg`, { type: 'image/jpeg' })]);
    }
  }, [finish]);

  // カメラの起動。
  useEffect(() => {
    let cancelled = false;
    // 同期的な setState を避けるため、非対応も Promise の失敗として扱う。
    const request = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      : () => Promise.reject(new Error('unsupported'));
    request({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            'カメラを開けませんでした(権限を確認してください)。写真ライブラリから選べます。',
          );
        }
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  // 輪郭の検出と自動撮影。
  useEffect(() => {
    if (error !== null) return;
    const canvas = document.createElement('canvas');
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      const w = SAMPLE_WIDTH;
      const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const gray = new Uint8ClampedArray(w * h);
      for (let i = 0; i < w * h; i += 1) {
        gray[i] = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
      }
      const detection = detectDocument({ width: w, height: h, data: gray });
      boxRef.current = detection?.box ?? null;
      setBox(detection?.box ?? null);
      const { stable, progress: p } = trackerRef.current.push(detection?.box ?? null);
      setProgress(p);
      if (stable && Date.now() - lastCaptureRef.current > COOLDOWN_MS) void shoot();
    }, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [error, shoot]);

  const onLibrary = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length > 0) finish(list);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="レシートを撮影"
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: '#000', color: '#fff' }}
    >
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          aria-label="閉じる"
          onClick={() => {
            stop();
            onClose();
          }}
          className="min-h-11 flex size-10 items-center justify-center rounded-full"
          style={{ background: 'rgba(255,255,255,0.18)' }}
        >
          <MdClose aria-hidden size={22} />
        </button>
        <div role="radiogroup" aria-label="撮影モード" className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => {
                setMode(m.value);
                modeRef.current = m.value;
                partsRef.current = [];
                setParts([]);
              }}
              className="min-h-11 rounded-full px-3 py-2 text-xs font-semibold"
              style={{
                background: mode === m.value ? '#fff' : 'rgba(255,255,255,0.18)',
                color: mode === m.value ? '#000' : '#fff',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="w-10" />
      </div>

      <div className="relative min-h-0 flex-1">
        {error === null ? (
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 size-full object-cover"
            aria-label="カメラの映像"
          />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm">
            {error}
          </p>
        )}
        {box !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-lg border-2"
            style={{
              left: `${box.x0 * 100}%`,
              top: `${box.y0 * 100}%`,
              width: `${(box.x1 - box.x0) * 100}%`,
              height: `${(box.y1 - box.y0) * 100}%`,
              borderColor: progress >= 1 ? '#34d399' : '#fbbf24',
            }}
          />
        ) : null}
        <p
          role="status"
          className="absolute inset-x-0 bottom-3 text-center text-xs"
          style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
        >
          {error !== null
            ? ''
            : box === null
              ? 'レシートを枠に収めてください'
              : progress >= 1
                ? '撮影します'
                : 'そのまま動かさずに…'}
          {mode === 'continuous' && count > 0 ? `(${count}枚撮影済み)` : ''}
          {mode === 'long' && parts.length > 0 ? `(${parts.length}枚目まで撮影済み)` : ''}
        </p>
      </div>

      <div className="flex items-center justify-between px-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <label
          className="flex size-12 cursor-pointer items-center justify-center rounded-full"
          style={{ background: 'rgba(255,255,255,0.18)' }}
          aria-label="写真ライブラリから選ぶ"
        >
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              onLibrary(e.target.files);
              e.target.value = '';
            }}
          />
          <MdPhotoLibrary aria-hidden size={24} />
        </label>
        <button
          type="button"
          aria-label="シャッター"
          disabled={error !== null}
          onClick={() => void shoot()}
          className="size-16 rounded-full border-4 disabled:opacity-30"
          style={{ borderColor: '#fff', background: 'rgba(255,255,255,0.35)' }}
        />
        {mode === 'long' ? (
          <button
            type="button"
            disabled={parts.length === 0}
            onClick={() => void finishLong()}
            className="min-h-11 rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-30"
            style={{ background: '#fff', color: '#000' }}
          >
            つなげて完了
          </button>
        ) : mode === 'continuous' ? (
          <button
            type="button"
            onClick={() => {
              stop();
              onClose();
            }}
            className="min-h-11 rounded-full px-4 py-2 text-xs font-semibold"
            style={{ background: '#fff', color: '#000' }}
          >
            完了
          </button>
        ) : (
          <span className="w-12" />
        )}
      </div>
    </div>
  );
}
