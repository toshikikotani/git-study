import { NextResponse } from 'next/server';

import { listAccounts } from '@/features/accounts/store';

/**
 * 取り込み画面(CSV / メール貼り付け)の口座選択に使う経路(M6-2)。
 * 認証は proxy.ts の関所が担う。
 */

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const accounts = await listAccounts();
  return NextResponse.json({
    accounts: accounts.map((account) => ({ id: account.id, name: account.name })),
  });
}
