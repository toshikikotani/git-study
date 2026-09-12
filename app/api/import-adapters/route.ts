import { NextResponse } from 'next/server';

import {
  getImportAdapterForAccount,
  saveImportAdapterForAccount,
} from '@/features/import/adapter-store';
import type { ImportAdapter } from '@/features/import/adapters';

/**
 * CSV 取り込み画面(M2-2)の列マッピング保存・再利用(T-9)。
 * 認証は proxy.ts の関所が担う。
 */

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const accountId = new URL(request.url).searchParams.get('accountId');
  if (!accountId) {
    return NextResponse.json({ error: 'accountId が指定されていません' }, { status: 400 });
  }

  const adapter = await getImportAdapterForAccount(accountId);
  return NextResponse.json({ adapter });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { accountId?: string; adapter?: ImportAdapter };
  if (!body.accountId || !body.adapter) {
    return NextResponse.json({ error: 'accountId と adapter を指定してください' }, { status: 400 });
  }

  await saveImportAdapterForAccount(body.accountId, body.adapter);
  return NextResponse.json({ saved: true });
}
