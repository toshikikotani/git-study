/**
 * レシートの写真を撮る・選ぶ → 送れる大きさに縮める(長い辺 1600px・JPEG)→ base64。
 * サーバー(/api/mobile/receipts)は 約4.5MB までしか受け取らない。
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const LONG_SIDE = 1600;

export type PickedPhoto = { base64: string } | { canceled: true } | { error: string };

async function shrink(uri: string, width: number, height: number): Promise<string | null> {
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > LONG_SIDE) {
    context.resize(width >= height ? { width: LONG_SIDE } : { height: LONG_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  return saved.base64 ?? null;
}

export async function pickReceiptPhoto(from: 'camera' | 'library'): Promise<PickedPhoto> {
  if (from === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return {
        error: 'カメラを使えません。iPhone の設定 › このアプリ でカメラをオンにしてください。',
      };
    }
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 1 };
  const result =
    from === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return { canceled: true };
  const asset = result.assets[0];
  if (!asset) return { canceled: true };
  try {
    const base64 = await shrink(asset.uri, asset.width, asset.height);
    return base64 ? { base64 } : { error: '写真を読み込めませんでした。' };
  } catch {
    return { error: '写真を読み込めませんでした。' };
  }
}
