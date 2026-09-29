'use client';

import { useEffect, useRef, useState } from 'react';

import {
  clampBrightness,
  clampInsets,
  cropRect,
  isUnadjusted,
  MAX_CROP_INSET,
  NO_CROP,
  rotateBy,
  rotatedSize,
  type CropInsets,
  type Rotation,
} from '@/domain/image-adjust';

/**
 * レシート画像の補正(回転・切り抜き・明るさ)。文字が読み取れるように整えるための道具。
 * 元の画像は変えず、補正した画像を別の画像として保存する(onSave に JPEG の base64 を渡す)。
 * 切り抜きは各辺の余白をスライダーで削る方式(指で枠をなぞる方式は後回し、DECISIONS.md)。
 */
export function ImageEditor({
  src,
  onSave,
  onClose,
}: {
  src: string;
  onSave: (imageBase64: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [insets, setInsets] = useState<CropInsets>(NO_CROP);
  const [brightness, setBrightness] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        // 署名付きURLは別オリジンなので、いったん取り込んでから描く(canvas を汚さない)。
        const blob = await (await fetch(src)).blob();
        revoke = URL.createObjectURL(blob);
        const el = new window.Image();
        el.onload = () => !cancelled && setImage(el);
        el.onerror = () => !cancelled && setError('画像を読み込めませんでした。');
        el.src = revoke;
      } catch {
        if (!cancelled) setError('画像を読み込めませんでした。');
      }
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [src]);

  const draw = (canvas: HTMLCanvasElement, img: HTMLImageElement, maxSide: number) => {
    const rect = cropRect(img.width, img.height, rotation, insets);
    const rotated = rotatedSize(img.width, img.height, rotation);
    const scale = Math.min(1, maxSide / Math.max(rect.width, rect.height));
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-rect.x, -rect.y);
    ctx.filter = `brightness(${clampBrightness(brightness)})`;
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
    return true;
  };

  useEffect(() => {
    if (image && canvasRef.current) draw(canvasRef.current, image, 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, rotation, insets, brightness]);

  const save = async () => {
    if (!image) return;
    const canvas = document.createElement('canvas');
    if (!draw(canvas, image, 1600)) return;
    const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    if (!base64) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(base64);
    } catch {
      setError('保存できませんでした。');
      setBusy(false);
    }
  };

  const setInset = (side: keyof CropInsets, value: number) =>
    setInsets((prev) => clampInsets({ ...prev, [side]: value }));

  const SIDES: [keyof CropInsets, string][] = [
    ['top', '上'],
    ['bottom', '下'],
    ['left', '左'],
    ['right', '右'],
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="画像を補正"
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'var(--plane)' }}
    >
      <div
        className="flex min-h-0 flex-1 items-center justify-center p-4"
        style={{ background: '#111' }}
      >
        {image ? (
          <canvas ref={canvasRef} className="max-h-full max-w-full" aria-label="補正のプレビュー" />
        ) : (
          <p className="text-[13px]" style={{ color: '#fff' }}>
            {error ?? '読み込んでいます…'}
          </p>
        )}
      </div>
      <div className="space-y-3 overflow-y-auto p-4" style={{ maxHeight: '45dvh' }}>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setRotation((r) => rotateBy(r, -90))}
            className="min-h-11 flex-1 rounded-xl text-[15px] font-semibold"
            style={{ background: 'var(--surface)', color: 'var(--ink)' }}
          >
            ⟲ 左に回す
          </button>
          <button
            type="button"
            onClick={() => setRotation((r) => rotateBy(r, 90))}
            className="min-h-11 flex-1 rounded-xl text-[15px] font-semibold"
            style={{ background: 'var(--surface)', color: 'var(--ink)' }}
          >
            右に回す ⟳
          </button>
        </div>
        <label className="block text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          明るさ
          <input
            type="range"
            min={0.6}
            max={1.6}
            step={0.05}
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            className="mt-1 h-11 w-full"
          />
        </label>
        <div className="grid grid-cols-2 gap-x-4">
          {SIDES.map(([side, label]) => (
            <label
              key={side}
              className="block text-[13px]"
              style={{ color: 'var(--ink-secondary)' }}
            >
              {label}を切り取る
              <input
                type="range"
                min={0}
                max={MAX_CROP_INSET}
                step={0.01}
                value={insets[side]}
                onChange={(e) => setInset(side, Number(e.target.value))}
                className="h-11 w-full"
              />
            </label>
          ))}
        </div>
        {error && image ? (
          <p role="alert" className="text-[13px]" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        ) : null}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 flex-1 rounded-xl text-[15px] font-semibold"
            style={{ background: 'var(--surface)', color: 'var(--ink)' }}
          >
            やめる
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || image === null || isUnadjusted(rotation, insets, brightness)}
            className="min-h-11 flex-1 rounded-xl text-[15px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            {busy ? '保存しています…' : 'この画像を使う'}
          </button>
        </div>
      </div>
    </div>
  );
}
