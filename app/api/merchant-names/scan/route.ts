import { NextResponse } from 'next/server';

import { scanMerchantNames } from '@/features/transactions/merchant-name-store';
import { describeUserError } from '@/lib/errors';

/**
 * 店名の表記ゆれを探す(規則 + AI、ADR-119)。読むだけで何も書き換えない。
 * AI の見比べは数十秒かかることがあるため、サーバーアクションではなくここで受ける(サーバーアクションは
 * 1つずつ順に送られ、そのあいだ明細の月の読み込みなどが待たされる、Next.js の Server Actions)。
 */
export const maxDuration = 120;

export async function POST() {
  try {
    return NextResponse.json(await scanMerchantNames());
  } catch (error) {
    return NextResponse.json(
      {
        error: describeUserError(
          error,
          '店名の確認を読み込めませんでした。もう一度お試しください。',
        ),
      },
      { status: 500 },
    );
  }
}
