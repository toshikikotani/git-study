import { NextResponse } from 'next/server';

import { SUPPORTED_RECEIPT_MEDIA_TYPES, type ReceiptMediaType } from '@/features/import/receipt-ai';
import { uploadReceiptImage } from '@/features/import/receipt-storage';
import { createClient } from '@/lib/supabase/server';

/**
 * レシート画像を Storage へ保存する(本人発案、ADR-021 の続き)。
 *
 * ── なぜ ../route.ts(AI抽出)と分けるか ──────────────────────
 * 抽出は「読み取れるかどうか」を試すだけの操作で、保存するかは本人が
 * 内容を確認してから決める(receipt/page.tsx の save() で呼ぶ)。
 * 抽出のたびに画像を保存すると、結局取り込まなかった写真まで溜まる。
 *
 * ── 認証 ────────────────────────────────────────────────────
 * proxy.ts の関所が /api/* を守る(M0-3)。ここでは本人のセッション
 * client(createClient())を使うため、Storage の RLS(receipts_own_folder)が
 * そのまま効く。admin client は使わない(本人のフォルダ以外に書けて
 * しまうと意味が無い)。
 */

export const runtime = 'nodejs';

/** ../route.ts と同じ上限(画面側でリサイズしてから送る前提の保険)。 */
const MAX_BASE64_CHARS = 6_000_000;

function isSupportedMediaType(value: unknown): value is ReceiptMediaType {
  return (
    typeof value === 'string' &&
    (SUPPORTED_RECEIPT_MEDIA_TYPES as readonly string[]).includes(value)
  );
}

type RequestBody = { image?: unknown; mediaType?: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  let payload: RequestBody;
  try {
    payload = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ path: null, error: 'JSON として読めませんでした' }, { status: 400 });
  }

  const image = typeof payload.image === 'string' ? payload.image : '';
  if (image.trim() === '') {
    return NextResponse.json({ path: null, error: '画像がありません' }, { status: 400 });
  }
  if (image.length > MAX_BASE64_CHARS) {
    return NextResponse.json({ path: null, error: '画像が大きすぎます' }, { status: 413 });
  }
  if (!isSupportedMediaType(payload.mediaType)) {
    return NextResponse.json(
      {
        path: null,
        error: `対応していない画像形式です(${SUPPORTED_RECEIPT_MEDIA_TYPES.join(' / ')} のみ)`,
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json(
      { path: null, error: 'ログイン状態を確認できませんでした' },
      { status: 401 },
    );
  }

  const result = await uploadReceiptImage(supabase, auth.user.id, image, payload.mediaType);
  return NextResponse.json(result);
}
