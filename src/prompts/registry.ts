/**
 * AI機能が使うプロンプトの一元管理(N1本人要件「プロンプトは prompts/ ディレクトリで
 * 管理し、バージョンを付ける」)。
 *
 * 各プロンプトはこの definePrompt() で作り、バージョン番号を持たせる。プロンプトの
 * 文面を変えるときは version を1つ上げること——過去にキャッシュされたAI応答
 * (src/lib/ai-gateway/cache.ts)や評価結果(evals/)を、どのプロンプトで作った
 * ものか後から区別できるようにするため。呼び出し側は常にこのファイル群が
 * エクスポートする最新版を import する(過去バージョンをここに残す義務は無い——
 * 必要なら git 履歴で追える)。
 */
export type PromptDefinition = {
  /** 機能を一意に識別する名前(例: 'daily-report')。features/*-ai.ts のモデル定数の
   *  命名と揃える。 */
  id: string;
  version: number;
  text: string;
};

export function definePrompt(id: string, version: number, text: string): PromptDefinition {
  return { id, version, text };
}
