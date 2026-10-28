/**
 * 家計簿の MCP サーバー(AI とつなぐ、ADR-142)。読むだけの道具を6つ並べる。書く道具は置かない
 * (記録・保存は、本人がアプリで確かめて押したときだけ、ADR-141)。
 *
 * 道具の中身は data.ts。ここでは名前・説明・引数の形を決め、呼ばれたら `run` の中(本人のセッション)で
 * 読んで JSON の文字で返す。読めなければ isError で理由を返す(AI がそのまま伝えられるように)。
 */
import 'server-only';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  categoryData,
  MAX_RANGE_DAYS,
  MAX_ROWS,
  monthData,
  needsCheckData,
  searchData,
  todayData,
  upcomingData,
} from './data';

export const MCP_SERVER_NAME = 'kakeibo';

const INSTRUCTIONS = [
  '日本円の家計簿(本人1人分)を読む道具です。金額はすべて正の円で、type が expense(支出)・income(収入)・',
  'refund(返金)を表します。scheduled が true の明細は今日より先の予定で、使った額には入りません。',
  '「今期」は本人が決めた目標の期間(無ければ今月)です。日付は日本時間の YYYY-MM-DD です。',
  'この道具では記録・保存はできません。記録や保存前のレシートの保存は、本人がアプリで確かめて行います。',
].join('');

/** 道具を呼んだ結果を MCP の形にする。 */
async function answer(read: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await read();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text', text: `読めませんでした: ${message}` }] };
  }
}

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('YYYY-MM-DD(日本時間)');

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export function createKakeiboMcpServer(ctx: {
  userId: string;
  /** 本人のセッションの中で動かす。 */
  run: <T>(fn: () => Promise<T>) => Promise<T>;
}): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );
  const call = (read: () => Promise<unknown>) => answer(() => ctx.run(read));

  server.registerTool(
    'get_today',
    {
      title: '今日の目安と今期の見通し',
      description:
        '今日あといくら使えるか(こえていればこえた額)、明日からの1日の目安、今期の見通し(使った額・着地の見込み・目標・目標内に収まる確率)、今日の記録、片づけることの件数。',
      annotations: readOnly,
    },
    () => call(() => todayData(ctx.userId)),
  );

  server.registerTool(
    'get_categories',
    {
      title: 'カテゴリごとの今期',
      description:
        'カテゴリごとの今期の目標・使った額・予定・着地の見込み・先月の額・目標をこえそうか。category で名前をしぼれる(部分一致)。',
      inputSchema: {
        category: z.string().max(40).optional().describe('カテゴリの名前(例: 外食)。省くとすべて'),
      },
      annotations: readOnly,
    },
    ({ category }) => call(() => categoryData(category)),
  );

  server.registerTool(
    'get_month_summary',
    {
      title: '月の合計',
      description:
        'ある月の支出・収入・収支・予定の合計と、カテゴリごとの使った額(多い順)。明細の画面の月の合計と同じ数え方。',
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe('YYYY-MM。省くと今月'),
      },
      annotations: readOnly,
    },
    ({ month }) => call(() => monthData(month)),
  );

  server.registerTool(
    'search_transactions',
    {
      title: '明細をさがす',
      description: `期間・お店やメモの言葉・カテゴリ・金額で明細をさがす(新しい順、最大${MAX_ROWS}件)。期間の既定は今月1日から今日まで、最長${MAX_RANGE_DAYS}日。合計も返す(予定は合計に入れない)。`,
      inputSchema: {
        from: date.optional(),
        to: date.optional(),
        query: z.string().max(60).optional().describe('お店・摘要・メモに含まれる言葉'),
        category: z.string().max(40).optional().describe('カテゴリの名前(部分一致)'),
        minYen: z.number().int().min(0).optional(),
        maxYen: z.number().int().min(0).optional(),
        type: z.enum(['expense', 'income', 'refund']).optional(),
        limit: z.number().int().min(1).max(MAX_ROWS).optional().describe('返す件数(既定30)'),
      },
      annotations: readOnly,
    },
    (input) => call(() => searchData(input)),
  );

  server.registerTool(
    'get_upcoming',
    {
      title: 'これからの予定と固定費',
      description: '明日から days 日先までの支払いの予定(近い順)。固定費かどうかも返す。',
      inputSchema: {
        days: z.number().int().min(1).max(92).optional().describe('何日先まで(既定31)'),
      },
      annotations: readOnly,
    },
    ({ days }) => call(() => upcomingData(days)),
  );

  server.registerTool(
    'get_needs_check',
    {
      title: '確かめること',
      description:
        '本人が確かめることの件数:今日の答え合わせ、保存前のレシート(お店・日付・金額)、読めずに入力待ちのレシート。保存はアプリで本人がする。',
      annotations: readOnly,
    },
    () => call(() => needsCheckData(ctx.userId)),
  );

  return server;
}
