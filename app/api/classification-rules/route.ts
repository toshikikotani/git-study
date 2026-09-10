import { NextResponse } from 'next/server';

import {
  listActiveClassificationRules,
  listCategoryOptions,
} from '@/features/classification/store';

/**
 * DB 保存の分類ルール(手書き + 学習済み)とカテゴリ名を、取り込み画面
 * (クライアント側)へ渡す経路(M2-5)。カテゴリ名も返すのは、ルールが
 * categoryId を設定してもプレビューでは id しか分からず、
 * 「未分類」のまま表示されてしまうため(categoryId 自体は正しい)。
 * 認証は proxy.ts の関所が担う。
 */

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const [rules, categories] = await Promise.all([
    listActiveClassificationRules(),
    listCategoryOptions(),
  ]);
  return NextResponse.json({
    rules,
    categories: categories.map((category) => ({ id: category.id, name: category.name })),
  });
}
