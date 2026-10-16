'use server';

import { revalidatePath } from 'next/cache';

/**
 * すべての画面を最新にする(端末に残した画面も作り直す)。サーバーアクションから revalidatePath を呼ぶと、
 * 端末の画面の作り置き(Client Cache)が全部消える。AIの確認カードで反映したあと(ルートハンドラーで
 * 書き込むため、そのままでは他の画面が古いまま)に呼ぶ(ADR-103)。
 */
export async function refreshAllAction(): Promise<void> {
  revalidatePath('/', 'layout');
}
