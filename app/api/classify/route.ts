import { NextResponse } from 'next/server';

import type { ClassifiableTransaction } from '@/features/classification/ai';
import { classifyUnclassified } from '@/features/classification/store';

/**
 * 取り込み画面(CSV / メール貼り付け)から、ルールに当たらなかった明細を
 * AI 分類へ回す経路(M2-3b)。認証は proxy.ts の関所が担う(/api/* は
 * 未ログインなら401)。
 */

export const runtime = 'nodejs';

/** 1回の上限。月間想定300件(docs/architecture.md §3.5)を大きく超える異常値を弾く。 */
const MAX_ROWS = 300;

type RequestBody = { transactions?: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  let payload: RequestBody;
  try {
    payload = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'JSON として読めませんでした' }, { status: 400 });
  }

  const rows = parseRows(payload.transactions);
  if (rows === null) {
    return NextResponse.json({ error: 'transactions の形式が不正です' }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `一度に分類できるのは${MAX_ROWS}件までです` },
      { status: 413 },
    );
  }

  const { results, warnings } = await classifyUnclassified(rows);
  return NextResponse.json({ results, warnings });
}

function parseRows(value: unknown): ClassifiableTransaction[] | null {
  if (!Array.isArray(value)) return null;

  const rows: ClassifiableTransaction[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || row.id === '') return null;
    if (typeof row.description !== 'string') return null;
    if (typeof row.amountYen !== 'number' || !Number.isFinite(row.amountYen)) return null;
    if (row.merchantName !== null && typeof row.merchantName !== 'string') return null;

    rows.push({
      id: row.id,
      description: row.description,
      merchantName: row.merchantName,
      amountYen: row.amountYen,
    });
  }
  return rows;
}
