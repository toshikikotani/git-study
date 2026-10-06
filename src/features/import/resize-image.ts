/**
 * ブラウザ側での画像リサイズ(本人発案、ADR-021)。
 *
 * スマートフォンの写真をそのまま送ると数MB〜十数MBになりうるため、
 * AIへ渡す前に長辺を縮め、JPEGに変換してから送る(画像トークン数と
 * 通信量を抑える)。レシート撮影画面(receipt/page.tsx)専用だった処理を、
 * 既存の明細に後からレシートを紐付ける機能(split-editor.tsx)でも
 * 使うため、共有モジュールへ切り出した。
 */

const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.85;

export async function resizeToJpegBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('画像を読み込めませんでした'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('画像を読み込めませんでした'));
    el.src = dataUrl;
  });

  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を処理できませんでした');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const jpegDataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const base64 = jpegDataUrl.split(',')[1];
  if (!base64) throw new Error('画像を変換できませんでした');
  return base64;
}
