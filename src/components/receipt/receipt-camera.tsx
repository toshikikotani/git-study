'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MdClose, MdMoreHoriz, MdPhotoLibrary } from 'react-icons/md';
import { createPortal } from 'react-dom';
import { useIsClient } from '@/components/ui/use-is-client';
import { projectDocumentBox } from '@/features/import/document-preview';
import './receipt-camera.css';
import { PhotoLibrary } from './photo-library';
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
 * レシートの自動撮影(全画面のカメラ)。
 *
 * 映像を縮小して輪郭を検出し(features/import/document-detect.ts)、レシートだと確かめられて
 * (紙の全体が枠の中・縦長・印字の行がいくつもある)、2秒ほぼ動かなかったときだけ自動でシャッターを
 * 切る。確かめられないものは自動では撮らない(シャッターで撮る)。自動はオフにもできる。
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
  onManual,
}: {
  onCapture: (files: File[]) => void;
  onClose: () => void;
  onManual?: () => void;
  /** 最初のモード(撮影ボタンの長押しから「連続撮影」を選んだときは continuous)。 */
  initialMode?: 'single' | 'continuous' | 'long';
}) {
  const isClient = useIsClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [libraryOpen, setLibraryOpen] = useState(false);
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

  useEffect(() => {
    if (!libraryOpen) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>('.receipt-camera__library-back')?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [libraryOpen]);

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
            'カメラを開けませんでした(権限を確認してください)。写真ライブラリから選べます。',
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
    if (error !== null || libraryOpen || settingsOpen) return;
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
  }, [error, libraryOpen, settingsOpen, shoot]);

  const projected = box ? projectDocumentBox(box, videoSize, viewport) : null;
  const capturedCount = mode === 'long' ? parts.length : count;
  const status = error
    ? '写真からも読み取れます'
    : capturedCount > 0
      ? `${capturedCount}枚 撮りました · 次のレシートをどうぞ`
      : guidance({ box, assessment, auto, progress });
  const close = () => {
    stop();
    onClose();
  };
  const content = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="レシートを撮影"
      className="receipt-camera"
      data-no-pull
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (libraryOpen) setLibraryOpen(false);
          else if (settingsOpen) setSettingsOpen(false);
          else close();
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), a[href]',
          ),
        ).filter((element) => !element.closest('[inert]'));
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
      <div className="receipt-camera__preview" ref={previewRef} inert={libraryOpen}>
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
            className="min-h-[44px] receipt-camera__round-button"
          >
            <MdClose aria-hidden size={22} />
          </button>
          <button
            type="button"
            aria-label="撮影設定"
            aria-expanded={settingsOpen}
            aria-controls="receipt-camera-settings"
            onClick={() => setSettingsOpen((value) => !value)}
            className="min-h-[44px] receipt-camera__round-button receipt-camera__settings-trigger"
          >
            <MdMoreHoriz aria-hidden size={24} />
          </button>
          {onManual ? (
            <button
              type="button"
              onClick={() => {
                close();
                onManual();
              }}
              className="min-h-[44px] receipt-camera__manual"
            >
              手で入力
            </button>
          ) : (
            <span className="receipt-camera__header-spacer" />
          )}
        </header>
        {settingsOpen ? (
          <section
            className="receipt-camera__settings"
            id="receipt-camera-settings"
            aria-label="撮影設定"
          >
            <h2>撮影設定</h2>
            <div role="radiogroup" aria-label="撮影モード" className="receipt-camera__modes">
              {MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.value}
                  onClick={() => {
                    setMode(option.value);
                    modeRef.current = option.value;
                    partsRef.current = [];
                    setParts([]);
                  }}
                  className="min-h-[44px]"
                >
                  {option.label}
                </button>
              ))}
            </div>
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
                  /* この撮影の間は切り替える */
                }
              }}
              className="min-h-[44px] receipt-camera__auto"
            >
              自動撮影<span>{auto ? 'オン' : 'オフ'}</span>
            </button>
            <button
              type="button"
              className="min-h-[44px] receipt-camera__settings-done"
              onClick={() => setSettingsOpen(false)}
            >
              設定を閉じる
            </button>
          </section>
        ) : null}
        {error ? (
          <div className="receipt-camera__error">
            <MdPhotoLibrary aria-hidden size={32} />
            <p>{error}</p>
            <button type="button" onClick={() => setLibraryOpen(true)} className="min-h-[44px]">
              写真から読み取る
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
      <footer className="receipt-camera__controls" inert={libraryOpen}>
        <div className="receipt-camera__photos">
          <span className="receipt-camera__recent-label">最近の写真</span>
          <div className="receipt-camera__thumbnails" aria-label="このタブで選択・撮影した写真">
            {recentPhotos.slice(0, 3).map((photo) => (
              <button
                type="button"
                key={photo.id}
                aria-label={`${photo.file.name}を写真一覧で開く`}
                onClick={() => setLibraryOpen(true)}
                className="min-h-[44px]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="" />
              </button>
            ))}
            {recentPhotos.length === 0 ? (
              <span className="receipt-camera__empty-photos">写真を選べます</span>
            ) : null}
          </div>
          <button
            type="button"
            className="min-h-[44px] receipt-camera__all-photos"
            onClick={() => setLibraryOpen(true)}
          >
            すべての写真
          </button>
        </div>
        <div className="receipt-camera__actions">
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="min-h-[44px] receipt-camera__album"
            aria-label="写真ライブラリから選ぶ"
          >
            {recentPhotos[0] ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={recentPhotos[0].url} alt="" />
              </>
            ) : (
              <MdPhotoLibrary aria-hidden size={25} />
            )}
            {capturedCount > 0 ? (
              <span className="receipt-camera__count">{capturedCount}</span>
            ) : null}
          </button>
          <button
            type="button"
            aria-label="シャッター"
            disabled={error !== null || shooting}
            onClick={() => void shoot()}
            className="min-h-[44px] receipt-camera__shutter"
          />
          <button
            type="button"
            disabled={mode === 'long' && parts.length === 0}
            onClick={() => {
              if (mode === 'long') void finishLong();
              else close();
            }}
            className="min-h-[44px] receipt-camera__done"
          >
            {mode === 'long' ? 'つなげる' : '完了'}
          </button>
        </div>
        <p className="receipt-camera__hint">
          {auto ? 'かざすと自動で撮れます。続けて何枚でも。' : 'シャッターを押して撮影します。'}
        </p>
      </footer>
      {libraryOpen ? (
        <section className="receipt-camera__library" aria-label="写真から読み取る">
          <button
            type="button"
            onClick={() => setLibraryOpen(false)}
            className="min-h-[44px] receipt-camera__library-back"
          >
            ‹ カメラに戻る
          </button>
          <h2>写真から読み取る</h2>
          <PhotoLibrary onFiles={finish} />
        </section>
      ) : null}
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
