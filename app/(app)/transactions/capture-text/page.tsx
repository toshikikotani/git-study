import { CaptureTextForm } from './capture-text-form';

/**
 * 「話して記録」「文字で記録」(N3)。普通の文章(または音声認識でテキスト化
 * した文章)から取引の候補を作る。入口が2つあるだけで、後段の処理は完全に
 * 共通(features/import/natural-text-ai.ts)。
 */
export default function CaptureTextPage() {
  return <CaptureTextForm />;
}
