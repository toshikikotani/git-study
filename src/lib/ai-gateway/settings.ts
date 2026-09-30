/**
 * AIゲートウェイ(N1)。全AI機能の一括オン/オフを見る。
 *
 * 本人発案の要件「設定でAI機能をまとめてオフにできる。オフでもアプリの
 * すべての基本機能が使えること」に対応する唯一の入口。ここを常に経由すれば、
 * 新しいAI機能を足すたびにオフ切り替えを個別実装しなくて済む。
 */

import { getAppSettings } from '@/features/settings/store';

/**
 * AI機能が有効か。設定そのものが読めない(未ログイン・DB障害等)場合は
 * 有効側へ倒す——それは「本人がオフにした」とは別の状態で、実際のAI呼び出しは
 * 通常のAPIエラー経路(認証・ネットワーク)で既に失敗を扱えるため、ここで
 * 基本機能まで止める理由にしない。
 */
export async function isAiEnabled(): Promise<boolean> {
  try {
    const settings = await getAppSettings();
    return settings.aiEnabled;
  } catch {
    return true;
  }
}
