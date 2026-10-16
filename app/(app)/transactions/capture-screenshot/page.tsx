import { redirect } from 'next/navigation';

/**
 * 旧「スクショから記録」。スクショはレシートの写真と同じく、記録するの「画像から入力」で読み取る
 * ようにした(ADR-100)ので、明細へ移って記録するを開く。
 */
export default function CaptureScreenshotPage() {
  redirect('/spending?record=1');
}
