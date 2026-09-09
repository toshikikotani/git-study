/**
 * 取り込み画面(CSV / メール貼り付け)共通の「AI 分類を試す」呼び出し(M2-3b)。
 *
 * ANTHROPIC_API_KEY はブラウザに渡せない(NFR-04)ため、分類そのものは
 * /api/classify(サーバー側)が行う。ここは fetch を包むだけの薄い層で、
 * 結果をプレビューへどうマージするかは呼び出し側(各画面)に委ねる。
 */

import type { ClassifyResult } from '@/features/classification/store';

export type ClassifyOutcome = {
  results: ClassifyResult[];
  warnings: string[];
};

export async function requestAiClassification(
  targets: readonly { id: string; description: string; amountYen: number }[],
): Promise<ClassifyOutcome> {
  if (targets.length === 0) return { results: [], warnings: [] };

  let response: Response;
  try {
    response = await fetch('/api/classify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        transactions: targets.map((t) => ({
          id: t.id,
          description: t.description,
          merchantName: null,
          amountYen: t.amountYen,
        })),
      }),
    });
  } catch {
    return { results: [], warnings: ['AI 分類の呼び出しに失敗しました。'] };
  }

  if (!response.ok) {
    return { results: [], warnings: ['AI 分類の呼び出しに失敗しました。'] };
  }

  return (await response.json()) as ClassifyOutcome;
}
