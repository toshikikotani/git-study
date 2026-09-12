/**
 * CSV 取り込み画面(M2-2)の列マッピング保存・再利用の呼び出し(T-9)。
 *
 * `accounts-client.ts` と同じ考え方:取得に失敗しても画面は落とさず、
 * 呼び出し側が `guessMapping()` にフォールバックできるよう null を返す。
 * 保存側もベストエフォート(失敗しても取り込み自体は完了しているため、
 * 呼び出し側は結果を待たずに進めてよい)。
 */

import type { ImportAdapter } from '@/features/import/adapters';

export async function fetchImportAdapter(accountId: string): Promise<ImportAdapter | null> {
  try {
    const response = await fetch(`/api/import-adapters?accountId=${encodeURIComponent(accountId)}`);
    if (!response.ok) return null;
    const data = (await response.json()) as { adapter: ImportAdapter | null };
    return data.adapter;
  } catch {
    return null;
  }
}

export async function saveImportAdapter(accountId: string, adapter: ImportAdapter): Promise<void> {
  try {
    await fetch('/api/import-adapters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId, adapter }),
    });
  } catch {
    // 保存に失敗しても取り込み自体は完了している。次回は guessMapping に戻るだけ。
  }
}
