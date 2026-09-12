import { NextResponse } from 'next/server';

import {
  ClaudeReceiptExtractor,
  SUPPORTED_RECEIPT_MEDIA_TYPES,
  type ReceiptMediaType,
} from '@/features/import/receipt-ai';

/**
 * レシート画像を解析する(新機能、ADR-021)。
 *
 * ── 認証 ────────────────────────────────────────────────────
 * proxy.ts の関所が /api/* を守る(M0-3)。未ログインならここに来る前に401。
 * 以下の呼び出し回数制限は、その上でなお課金APIを乱用から守るための歯止め
 * (email/route.ts と同じ考え方)。
 *
 * ── なぜ辞書経路が無いのか ──────────────────────────────────
 * email/route.ts はラベル辞書で読めたときは AI を呼ばない。画像には
 * それに相当する費用ゼロの経路が無いため、この API は呼ばれた時点で
 * 必ず AI を使う(receipt-ai.ts のコメント参照)。
 */

export const runtime = 'nodejs';

/**
 * base64 文字列の上限(約 4.5MB の画像相当)。スマートフォンの写真を
 * そのまま送ると数MB〜十数MBになりうるため、画面側でリサイズしてから
 * 送らせる前提だが、念のためサーバー側でも歯止めを置く。
 */
const MAX_BASE64_CHARS = 6_000_000;

/** 認証が入るまでの歯止め。プロセスが生きている間の AI 呼び出し回数。 */
const AI_CALL_LIMIT_PER_HOUR = 20;

let aiCallWindowStartedAt = 0;
let aiCallsInWindow = 0;

function takeAiCallSlot(): boolean {
  const now = Date.now();
  if (now - aiCallWindowStartedAt > 60 * 60 * 1000) {
    aiCallWindowStartedAt = now;
    aiCallsInWindow = 0;
  }
  if (aiCallsInWindow >= AI_CALL_LIMIT_PER_HOUR) return false;
  aiCallsInWindow += 1;
  return true;
}

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
    return NextResponse.json({ error: 'JSON として読めませんでした' }, { status: 400 });
  }

  const image = typeof payload.image === 'string' ? payload.image : '';
  if (image.trim() === '') {
    return NextResponse.json({ error: '画像がありません' }, { status: 400 });
  }
  if (image.length > MAX_BASE64_CHARS) {
    return NextResponse.json({ error: '画像が大きすぎます' }, { status: 413 });
  }
  if (!isSupportedMediaType(payload.mediaType)) {
    return NextResponse.json(
      { error: `対応していない画像形式です(${SUPPORTED_RECEIPT_MEDIA_TYPES.join(' / ')} のみ)` },
      { status: 400 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    return NextResponse.json({
      transactions: [],
      warnings: ['AI による読み取りは設定されていません(ANTHROPIC_API_KEY が未設定)。'],
    });
  }

  if (!takeAiCallSlot()) {
    return NextResponse.json({
      transactions: [],
      warnings: ['AI の呼び出しが混み合っています。時間をおいてください。'],
    });
  }

  const result = await new ClaudeReceiptExtractor(apiKey).extract({
    imageBase64: image,
    mediaType: payload.mediaType,
  });

  return NextResponse.json({ transactions: result.transactions, warnings: result.warnings });
}
