import { NextResponse } from 'next/server';

import { scanReceipts } from '@/features/receipts/receipt-check-store';
import { describeUserError } from '@/lib/errors';

/**
 * レシートの品目の読み取りミスを探す(規則 + AI、ADR-120)。読むだけで何も書き換えない。
 * 店名の確認(api/merchant-names/scan)と同じく、数十秒かかることがあるためサーバーアクションでは
 * なくここで受ける(サーバーアクションは1つずつ順に送られ、そのあいだほかの操作が待たされる)。
 */
export const maxDuration = 120;

export async function POST() {
  try {
    return NextResponse.json(await scanReceipts());
  } catch (error) {
    return NextResponse.json(
      {
        error: describeUserError(
          error,
          'レシートの確認を読み込めませんでした。もう一度お試しください。',
        ),
      },
      { status: 500 },
    );
  }
}
