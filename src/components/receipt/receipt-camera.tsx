'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MdClose, MdPhotoLibrary } from 'react-icons/md';

import { CameraLink } from '@/components/receipt/camera-link';
import {
  assessReceipt,
  createStabilityTracker,
  cropRect,
  detectDocument,
  stitchLayout,
  type Box,
  type ReceiptAssessment,
} from '@/features/import/document-detect';

/**
 * レシートの自動撮影(全画面のカメラ)。
 *
 * 映像を縮小して輪郭を検出し(features/import/document-detect.ts)、レシートだと確かめられて
 * (紙の全体が枠の中・縦長・印字の行がいくつもある)、2秒ほぼ動かなかったときだけ自動でシャッターを
 * 切る。確かめられないものは自動では撮らない(シャッターで撮る)。自動はオフにもできる。
 *   - 1枚:撮ったら閉じる
 *   - 連続:撮り続けられる(1枚ごとに読み取りは裏で進む)
 *   - 長いレシート:分けて撮った複数枚を縦に結合して1枚にする
 *   - ライブラリ:写真ライブラリから複数選択
 * カメラを使えない環境(権限拒否・非対応)でも、画面を残して再試行とライブラリ選択を案内する。
 */

type Mode = 'single' | 'continuous' | 'long';

const MODES: { value: Mode; label: string }[] = [
  { value: 'single', label: '1枚' },
  { value: 'continuous', label: '連続' },
  { value: 'long', label: '長いレシート' },
];

const SAMPLE_WIDTH = 240;
const AUTO_KEY = 'receipt-camera-auto';

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}
const SAMPLE_INTERVAL_MS = 250;
const COOLDOWN_MS = 1600;

export function ReceiptCamera({
  onCapture,
  onClose,
  initialMode = 'single',
  singleCapture = false,
}: {
  onCapture: (files: File[]) => void;
  onClose: () => void;
  /** 最初のモード(撮影ボタンの長押しから「連続撮影」を選んだときは continuous)。 */
  initialMode?: 'single' | 'continuous' | 'long';
  /** 撮り直しでは一枚だけを返し、連続撮影・写真の複数選択を出さない。 */
  singleCapture?: boolean;
}) {
  const startingMode = singleCapture && initialMode === 'continuous' ? 'single' : initialMode;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const closedRef = useRef(false);
  const sessionRef = useRef(0);
  const capturingRef = useRef(false);
  const trackerRef = useRef(createStabilityTracker());
  const lastCaptureRef = useRef(0);
  const boxRef = useRef<Box | null>(null);
  const [mode, setMode] = useState<Mode>(startingMode);
  const modeRef = useRef<Mode>(startingMode);
  const [box, setBox] = useState<Box | null>(null);
  const [progress, setProgress] = useState(0);
  const [assessment, setAssessment] = useState<ReceiptAssessment | null>(null);
  const [auto, setAuto] = useState(true);
  const autoRef = useRef(auto);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [count, setCount] = useState(0);
  const [parts, setParts] = useState<Blob[]>([]);
  const partsRef = useRef<Blob[]>([]);

  useEffect(() => {
    const saved = readAuto();
    autoRef.current = saved;
    // ブラウザの保存値はhydration後に読む。サーバーと最初の表示を一致させる。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuto(saved);
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    stop();
    onClose();
  }, [onClose, stop]);

  const finish = useCallback(
    (files: File[]) => {
      if (closedRef.current) return;
      closedRef.current = true;
      stop();
      try {
        onCapture(files);
      } finally {
        onClose();
      }
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
    if (closedRef.current || capturingRef.current || !streamRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    const session = sessionRef.current;
    const current = modeRef.current;
    try {
      const blob = await grabFrame();
      if (
        !blob ||
        closedRef.current ||
        session !== sessionRef.current ||
        current !== modeRef.current
      )
        return;
      lastCaptureRef.current = Date.now();
      trackerRef.current.reset();
      setProgress(0);
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
    } catch {
      if (!closedRef.current && session === sessionRef.current) {
        stop();
        setReady(false);
        setError(
          '撮影できませんでした。もう一度カメラを開くか、写真ライブラリから選んでください。',
        );
      }
    } finally {
      capturingRef.current = false;
      if (!closedRef.current) setCapturing(false);
    }
  }, [finish, grabFrame, onCapture, stop]);

  const finishLong = useCallback(async () => {
    const blobs = partsRef.current;
    if (blobs.length === 0 || closedRef.current || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    const session = sessionRef.current;
    let bitmaps: ImageBitmap[] = [];
    try {
      bitmaps = await Promise.all(blobs.map((b) => createImageBitmap(b)));
      if (closedRef.current || session !== sessionRef.current || modeRef.current !== 'long') return;
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
      if (
        stitched &&
        !closedRef.current &&
        session === sessionRef.current &&
        modeRef.current === 'long'
      ) {
        finish([new File([stitched], `receipt-long-${Date.now()}.jpg`, { type: 'image/jpeg' })]);
      }
    } catch {
      if (!closedRef.current && session === sessionRef.current) {
        stop();
        setReady(false);
        setError('レシートをつなげられませんでした。もう一度お試しください。');
      }
    } finally {
      bitmaps.forEach((bitmap) => bitmap.close());
      capturingRef.current = false;
      if (!closedRef.current) setCapturing(false);
    }
  }, [finish, stop]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // カメラの起動。
  useEffect(() => {
    let cancelled = false;
    let removeTrackListeners = () => {};
    closedRef.current = false;
    const session = ++sessionRef.current;
    // 同期的な setState を避けるため、非対応も Promise の失敗として扱う。
    const request = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      : () => Promise.reject(new Error('unsupported'));
    request({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false })
      .then(async (stream) => {
        if (cancelled || closedRef.current || session !== sessionRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ended = () => {
          if (cancelled || closedRef.current || session !== sessionRef.current) return;
          stop();
          setReady(false);
          setError(
            'カメラが停止しました。もう一度カメラを開くか、写真ライブラリから選んでください。',
          );
        };
        const tracks = stream.getTracks();
        tracks.forEach((track) => track.addEventListener?.('ended', ended));
        removeTrackListeners = () =>
          tracks.forEach((track) => track.removeEventListener?.('ended', ended));
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          if (!cancelled && !closedRef.current && session === sessionRef.current) {
            setFrameSize({ width: video.videoWidth, height: video.videoHeight });
            setReady(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled && !closedRef.current && session === sessionRef.current) {
          stop();
          setReady(false);
          setError(
            'カメラを開けませんでした(権限を確認してください)。写真ライブラリから選べます。',
          );
        }
      });
    return () => {
      cancelled = true;
      removeTrackListeners();
      closedRef.current = true;
      stop();
    };
  }, [attempt, stop]);

  // 輪郭の検出と自動撮影。
  useEffect(() => {
    if (error !== null || !ready) return;
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
      const image = { width: w, height: h, data: gray };
      const detection = detectDocument(image);
      boxRef.current = detection?.box ?? null;
      setBox(detection?.box ?? null);
      const judged = detection === null ? null : assessReceipt(image, detection);
      setAssessment(judged);
      // レシートだと確かめられたときだけ数える(それ以外は自動では撮らない)。
      const confirmed = autoRef.current && judged?.receipt === true ? detection!.box : null;
      const { stable, progress: p } = trackerRef.current.push(confirmed);
      setProgress(p);
      if (stable && Date.now() - lastCaptureRef.current > COOLDOWN_MS) void shoot();
    }, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [error, ready, shoot]);

  const onLibrary = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length > 0) finish(list);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="レシートを撮影"
      data-no-pull
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: '#000', color: '#fff' }}
    >
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          aria-label="閉じる"
          onClick={close}
          className="min-h-11 flex size-10 items-center justify-center rounded-full"
          style={{ background: 'rgba(255,255,255,0.18)' }}
        >
          <MdClose aria-hidden size={22} />
        </button>
        <span className="text-sm font-semibold">レシートを撮影</span>
        <button
          type="button"
          role="switch"
          aria-checked={auto}
          aria-label="レシートと確かめられたら自動で撮る"
          onClick={() => {
            const next = !auto;
            setAuto(next);
            autoRef.current = next;
            trackerRef.current.reset();
            setProgress(0);
            try {
              localStorage.setItem(AUTO_KEY, next ? 'on' : 'off');
            } catch {
              // 保存できなくても、この撮影の間は切り替える
            }
          }}
          className="min-h-11 rounded-full px-3 py-2 text-xs font-semibold"
          style={{
            background: auto ? '#fff' : 'rgba(255,255,255,0.18)',
            color: auto ? '#000' : '#fff',
          }}
        >
          自動 {auto ? 'オン' : 'オフ'}
        </button>
      </div>
      <div role="radiogroup" aria-label="撮影モード" className="grid grid-cols-3 gap-2 px-4 pb-2">
        {MODES.filter((m) => !singleCapture || m.value !== 'continuous').map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            disabled={capturing}
            onClick={() => {
              if (capturingRef.current) return;
              setMode(m.value);
              modeRef.current = m.value;
              partsRef.current = [];
              setParts([]);
            }}
            className="min-h-11 rounded-full px-2 py-2 text-xs font-semibold"
            style={{
              background: mode === m.value ? '#fff' : 'rgba(255,255,255,0.18)',
              color: mode === m.value ? '#000' : '#fff',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        {error === null ? (
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 size-full object-contain"
            aria-label="カメラの映像"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setFrameSize({ width: video.videoWidth, height: video.videoHeight });
            }}
            onResize={(event) => {
              const video = event.currentTarget;
              setFrameSize({ width: video.videoWidth, height: video.videoHeight });
            }}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center text-sm">
            <p role="alert">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setReady(false);
                trackerRef.current.reset();
                boxRef.current = null;
                setBox(null);
                setProgress(0);
                setAttempt((value) => value + 1);
              }}
              className="min-h-11 rounded-full px-4 py-2 font-semibold"
              style={{ background: '#fff', color: '#000' }}
            >
              もう一度カメラを開く
            </button>
          </div>
        )}
        {box !== null && frameSize !== null && frameSize.width > 0 && frameSize.height > 0 ? (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full"
            viewBox={`0 0 ${frameSize.width} ${frameSize.height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <rect
              x={box.x0 * frameSize.width}
              y={box.y0 * frameSize.height}
              width={(box.x1 - box.x0) * frameSize.width}
              height={(box.y1 - box.y0) * frameSize.height}
              rx={8}
              fill="none"
              stroke={assessment?.receipt && auto ? '#34d399' : '#fbbf24'}
              strokeWidth={2}
              strokeDasharray={assessment?.receipt && auto ? undefined : '6 4'}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}
        <p
          role="status"
          className="absolute inset-x-0 bottom-3 text-center text-xs"
          style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
        >
          {error !== null
            ? ''
            : ready
              ? guidance({ box, assessment, auto, progress })
              : 'カメラを起動しています…'}
          {mode === 'continuous' && count > 0 ? `(${count}枚撮影済み)` : ''}
          {mode === 'long' && parts.length > 0 ? `(${parts.length}枚目まで撮影済み)` : ''}
        </p>
      </div>

      <div className="flex items-center justify-between px-6 py-4">
        <label
          className="flex size-12 cursor-pointer items-center justify-center rounded-full"
          style={{ background: 'rgba(255,255,255,0.18)' }}
          aria-label="写真ライブラリから選ぶ"
        >
          <input
            type="file"
            accept="image/*"
            multiple={!singleCapture}
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
          disabled={error !== null || !ready || capturing}
          onClick={() => void shoot()}
          className="size-16 rounded-full border-4 disabled:opacity-30"
          style={{ borderColor: '#fff', background: 'rgba(255,255,255,0.35)' }}
        />
        {mode === 'long' ? (
          <button
            type="button"
            disabled={parts.length === 0 || capturing}
            onClick={() => void finishLong()}
            className="min-h-11 rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-30"
            style={{ background: '#fff', color: '#000' }}
          >
            つなげて完了
          </button>
        ) : mode === 'continuous' ? (
          <button
            type="button"
            onClick={close}
            className="min-h-11 rounded-full px-4 py-2 text-xs font-semibold"
            style={{ background: '#fff', color: '#000' }}
          >
            完了
          </button>
        ) : (
          <span className="w-12" />
        )}
      </div>
      <CameraLink />
    </div>
  );
}

/** 画面の下の案内。自動で撮らないときは、理由と「シャッターで撮れる」ことを伝える。 */
function guidance({
  box,
  assessment,
  auto,
  progress,
}: {
  box: Box | null;
  assessment: ReceiptAssessment | null;
  auto: boolean;
  progress: number;
}): string {
  if (!auto) return 'シャッターを押して撮ります(自動はオフ)';
  if (box === null || assessment === null) {
    return 'レシート全体を枠に収めてください。自動で撮れないときはシャッターを';
  }
  if (assessment.receipt) return progress >= 1 ? '撮影します' : 'レシートです。そのまま動かさずに…';
  switch (assessment.reason) {
    case 'edge':
      return 'レシート全体が画面に入るように、少し離してください';
    case 'shape':
      return 'レシートを縦向きにしてください';
    default:
      return 'レシートと確かめられないので、自動では撮りません(シャッターで撮れます)';
  }
}
