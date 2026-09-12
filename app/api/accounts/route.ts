import { NextResponse } from 'next/server';

import { listAccounts } from '@/features/accounts/store';

/**
 * 取り込み画面(CSV / メール貼り付け、M6-2)と請求金額の突合画面(M6-4)の
 * 口座選択に使う経路。closingDay は突合画面が期間の自動計算に使う。
 * 認証は proxy.ts の関所が担う。
 */

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const accounts = await listAccounts();
  return NextResponse.json({
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      closingDay: account.closingDay,
    })),
  });
}
