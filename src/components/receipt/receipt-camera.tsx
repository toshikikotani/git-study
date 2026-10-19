'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MdClose, MdMoreHoriz, MdPhotoLibrary } from 'react-icons/md';
import { createPortal } from 'react-dom';
import { useIsClient } from '@/components/ui/use-is-client';
import { projectDocumentBox } from '@/features/import/document-preview';
import './receipt-camera.css';
import { rememberPhotos, useRecentPhotos } from '@/features/import/recent-photos';

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
 * レシートの自動撮影(全画面のカメラ、デザイン v3-12、ADR-126)。
 *
 * 映像を縮小して輪郭を検出し(features/import/document-detect.ts)、レシートだと確かめられて
 * (紙の全体が枠の中・縦長・印字の行がいくつもある)、2秒ほぼ動かなかったときだけ自動でシャッターを
 * 切る。確かめられないものは自動では撮らない(シャッターで撮る)。自動はオフにもできる。
 *   - 連続(既定):撮り続けられる(1枚ごとに読み取りは裏で進む)。最後に「完了」
 *   - 1枚:撮ったら閉じる
 *   - 長いレシート:分けて撮った複数枚を縦に結合して1枚にする
 *   - すべての写真:端末の写真を選ぶ画面をすぐ開く(間に自前の画面を挟まない)
 * カメラを使えない環境(権限拒否・非対応)では、写真から選べるようにする。
 * 色はカメラらしく黒・白・灰色だけ(アプリのテーマの色を、映像の上には載せない)。
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
  onDone,
  initialMode = 'continuous',
  onManual,
}: {
  onCapture: (files: File[]) => void;
  /** ✕で閉じたとき(撮った分の読み取りは裏で続く)。 */
  onClose: () => void;
  /** 撮り終えたとき(「完了」・1枚で撮った・長いレシートをつなげた)。無ければ onClose。 */
  onDone?: () => void;
  onManual?: () => void;
  initialMode?: 'single' | 'continuous' | 'long';
}) {
  const isClient = useIsClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const photoInput = useRef<HTMLInputElement>(null);
  const recentPhotos = useRecentPhotos();
  const [shooting, setShooting] = useState(false);
  const shootingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef(createStabilityTracker());
  const lastCaptureRef = useRef(0);
  const boxRef = useRef<Box | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const modeRef = useRef<Mode>(initialMode);
  const [box, setBox] = useState<Box | null>(null);
  const [progress, setProgress] = useState(0);
  const [assessment, setAssessment] = useState<ReceiptAssessment | null>(null);
  const [auto, setAuto] = useState(() => (typeof window === 'undefined' ? true : readAuto()));
  const autoRef = useRef(auto);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [parts, setParts] = useState<Blob[]>([]);
  const partsRef = useRef<Blob[]>([]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!isClient) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const preview = previewRef.current;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    if (preview) observer.observe(preview);
    return () => {
      observer.disconnect();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isClient]);

  const done = useCallback(() => {
    stop();
    (onDone ?? onClose)();
  }, [onClose, onDone, stop]);

  const finish = useCallback(
    (files: File[]) => {
      onCapture(files);
      done();
    },
    [done, onCapture],
  );

  /** 端末の写真から選んだもの。撮ったものと同じく読み取りへ回す。 */
  const pick = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      rememberPhotos(files);
      if (modeRef.current === 'single') {
        finish(files);
        return;
      }
      onCapture(files);
      setCount((c) => c + files.length);
    },
    [finish, onCapture],
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
    if (shootingRef.current) return;
    shootingRef.current = true;
    setShooting(true);
    try {
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
      rememberPhotos([file]);
      if (current === 'single') {
        finish([file]);
        return;
      }
      // 連続:撮ったらすぐ読み取りへ回し、カメラは開いたまま次を待つ。
      onCapture([file]);
      setCount((c) => c + 1);
    } finally {
      shootingRef.current = false;
      setShooting(false);
    }
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

  // カメラの起動。Portalが描画されてから映像を接続する。
  useEffect(() => {
    if (!isClient) return;
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
            'カメラを開けませんでした(カメラの利用を許可してください)。写真から選ぶこともできます。',
          );
        }
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [isClient, stop]);

  // 輪郭の検出と自動撮影。
  useEffect(() => {
    if (error !== null || settingsOpen) return;
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
  }, [error, settingsOpen, shoot]);

  const projected = box ? projectDocumentBox(box, videoSize, viewport) : null;
  const capturedCount = mode === 'long' ? parts.length : count;
  const status = error
    ? '写真から選んで読み取れます'
    : capturedCount > 0
      ? `${capturedCount}枚 撮りました · 次のレシートをどうぞ`
      : guidance({ box, assessment, auto, progress });
  const close = () => {
    stop();
    onClose();
  };
  const openPhotos = () => photoInput.current?.click();
  const content = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="レシートを撮る"
      className="receipt-camera"
      data-no-pull
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (settingsOpen) setSettingsOpen(false);
          else close();
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'),
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          pick(files);
        }}
      />
      <div className="receipt-camera__preview" ref={previewRef}>
        <video
          ref={videoRef}
          playsInline
          muted
          onLoadedMetadata={(event) =>
            setVideoSize({
              width: event.currentTarget.videoWidth,
              height: event.currentTarget.videoHeight,
            })
          }
          className="receipt-camera__video"
          aria-label="カメラの映像"
        />
        <div className="receipt-camera__shade" aria-hidden />
        <header className="receipt-camera__header">
          <button
            type="button"
            aria-label="閉じる"
            onClick={close}
            className="min-h-11 receipt-camera__round-button"
          >
            <MdClose aria-hidden size={20} />
          </button>
          <div className="receipt-camera__header-end">
            <button
              type="button"
              aria-label="撮影の設定"
              aria-expanded={settingsOpen}
              aria-controls="receipt-camera-settings"
              onClick={() => setSettingsOpen((value) => !value)}
              className="min-h-11 receipt-camera__round-button"
            >
              <MdMoreHoriz aria-hidden size={22} />
            </button>
            {onManual ? (
              <button
                type="button"
                onClick={() => {
                  close();
                  onManual();
                }}
                className="min-h-11 receipt-camera__pill"
              >
                手で入力
              </button>
            ) : null}
          </div>
        </header>
        {settingsOpen ? (
          <section
            className="receipt-camera__settings"
            id="receipt-camera-settings"
            aria-label="撮影の設定"
          >
            <div role="radiogroup" aria-label="撮り方" className="receipt-camera__modes">
              {MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.value}
                  className="min-h-11"
                  onClick={() => {
                    setMode(option.value);
                    modeRef.current = option.value;
                    partsRef.current = [];
                    setParts([]);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={auto}
              onClick={() => {
                const next = !auto;
                setAuto(next);
                autoRef.current = next;
                trackerRef.current.reset();
                setProgress(0);
                try {
                  localStorage.setItem(AUTO_KEY, next ? 'on' : 'off');
                } catch {
                  /* この撮影の間は切り替える */
                }
              }}
              className="min-h-11 receipt-camera__auto"
            >
              かざしたら自動で撮る<span>{auto ? 'オン' : 'オフ'}</span>
            </button>
          </section>
        ) : null}
        {error ? (
          <div className="receipt-camera__error">
            <MdPhotoLibrary aria-hidden size={32} />
            <p>{error}</p>
            <button type="button" onClick={openPhotos} className="min-h-11 receipt-camera__pill">
              写真から選ぶ
            </button>
          </div>
        ) : (
          <div
            aria-hidden
            className={`receipt-camera__frame${projected ? ' is-detected' : ''}`}
            style={
              projected
                ? {
                    left: `${projected.left}%`,
                    top: `${projected.top}%`,
                    width: `${projected.width}%`,
                    height: `${projected.height}%`,
                  }
                : undefined
            }
          >
            <i />
            <i />
            <i />
            <i />
          </div>
        )}
        <div className="receipt-camera__status" role="status">
          <span aria-hidden className="receipt-camera__status-dot" />
          <span>{status}</span>
        </div>
      </div>
      <footer className="receipt-camera__controls">
        {/* Web からは端末の最近の写真を並べられないため、「すべての写真」のボタンだけを出す
            (デザインの注記どおり)。押すと端末の写真を選ぶ画面がすぐ開く。 */}
        <div className="receipt-camera__photos">
          <button
            type="button"
            className="min-h-11 receipt-camera__all-photos"
            onClick={openPhotos}
          >
            <MdPhotoLibrary aria-hidden size={18} />
            すべての写真
          </button>
        </div>
        <div className="receipt-camera__actions">
          <span className="receipt-camera__stack" aria-hidden={capturedCount === 0}>
            {capturedCount > 0 && recentPhotos[0] ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={recentPhotos[0].url} alt="" />
                <span className="receipt-camera__count">{capturedCount}</span>
              </>
            ) : null}
          </span>
          <button
            type="button"
            aria-label="撮る"
            disabled={error !== null || shooting}
            onClick={() => void shoot()}
            className="min-h-11 receipt-camera__shutter"
          >
            <span aria-hidden />
          </button>
          <button
            type="button"
            disabled={mode === 'long' && parts.length === 0}
            onClick={() => {
              if (mode === 'long') void finishLong();
              else if (capturedCount > 0) done();
              else close();
            }}
            className={`min-h-11 receipt-camera__done${capturedCount > 0 ? ' is-ready' : ''}`}
          >
            {mode === 'long' ? 'つなげる' : '完了'}
          </button>
        </div>
        <p className="receipt-camera__hint">
          {auto ? 'かざすと自動で撮れます。続けて何枚でも。' : 'シャッターを押して撮ります。'}
        </p>
      </footer>
    </div>
  );
  return isClient ? createPortal(content, document.body) : null;
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
    return 'レシートを枠に合わせてください';
  }
  if (assessment.receipt) return progress >= 1 ? '撮影します' : 'そのまま動かさずに…';
  switch (assessment.reason) {
    case 'edge':
      return 'レシート全体が画面に入るように、少し離してください';
    case 'shape':
      return 'レシートを縦向きにしてください';
    default:
      return 'レシートと確かめられないので、自動では撮りません(シャッターで撮れます)';
  }
}
