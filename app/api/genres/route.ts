import { NextResponse } from 'next/server';

import { listGenres } from '@/features/genre/store';

/**
 * 取り込み画面(CSV / メール貼り付け / レシート撮影)のジャンル選択欄向けに、
 * 本人のジャンル一覧をクライアント側へ渡す経路(ADR-057)。
 * 認証は proxy.ts の関所が担う。
 */

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const genres = await listGenres();
  return NextResponse.json({
    genres: genres.map((g) => ({ id: g.id, name: g.name })),
  });
}
