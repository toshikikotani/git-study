/**
 * 家計簿の MCP サーバー(AI とつなぐ、ADR-142・144・146)。読む道具6つと、書く道具(記録する・レシート・
 * カテゴリを直す・目標を変える・取り消す)。書く道具は、本人がチャットで内容を見て許可したときに
 * 呼ばれる(本人「チャットで確かめる」。ChatGPT・Claude は書く道具の前に許可を聞く。説明でも、内容を
 * 見せてからはっきり頼まれたときだけ呼ぶよう AI に頼む)。レシートは「これでいいですか」の画面を出し、
 * 本人が「はい」を押すと登録する(MCP Apps、receipt-ui.ts)。
 *
 * 道具の中身は data.ts(読む)と write.ts(書く)。ここでは名前・説明・引数の形を決め、呼ばれたら `run` の中
 * (本人のセッション)で動かして JSON の文字で返す。できなければ isError で理由を返す(AI がそのまま伝え、
 * 直して呼び直せるように)。
 */
import 'server-only';

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server';
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
import { RECEIPT_UI_URI, receiptConfirmHtml, SAVE_RECEIPT_TOOL } from './receipt-ui';
import {
  addReceipt,
  addRecord,
  MAX_YEN,
  previewReceipt,
  setCategory,
  setTarget,
  undoRecord,
} from './write';

export const MCP_SERVER_NAME = 'kakeibo';

const INSTRUCTIONS = [
  '日本円の家計簿(本人1人分)の道具です。金額はすべて正の円で、type が expense(支出)・income(収入)・',
  'refund(返金)を表します。scheduled が true の明細は今日より先の予定で、使った額には入りません。',
  '「今期」は本人が決めた目標の期間(無ければ今月)です。日付は日本時間の YYYY-MM-DD です。',
  'レシートを登録するときは preview_receipt を呼びます。本人に「これでいいですか」の画面が出て、本人が「はい」を',
  '押すと登録されます(呼んだあとに、チャットで改めて許可を聞かなくてよい)。',
  'ほかの書く道具(add_record・add_receipt・set_category・set_target・undo_record)は、本人にはっきり頼まれたときだけ、',
  '呼ぶ前に内容(日付・お店・金額・カテゴリ)を本人に見せてから使ってください。カテゴリの名前は get_categories にある',
  '名前を使います。「同じ支払いかも」が返ったら、本人に聞いてから allowDuplicate: true で呼び直します。',
].join('');

/** 道具を呼んだ結果を MCP の形にする。 */
async function answer(
  run: () => Promise<unknown>,
  failed: string,
  structured = false,
): Promise<CallToolResult> {
  try {
    const data = await run();
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 1) }],
      // 確かめの画面(receipt-ui.ts)はこちらを読む。
      ...(structured ? { structuredContent: data as Record<string, unknown> } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text', text: `${failed}: ${message}` }] };
  }
}

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('YYYY-MM-DD(日本時間)');

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
/** 足す・変える(消さない)。クライアントは使う前に本人に許可を聞く。 */
const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const yen = z.number().int().min(1).max(MAX_YEN);
const categoryName = z.string().min(1).max(40).describe('カテゴリの名前(get_categories の名前)');
const allowDuplicate = z
  .boolean()
  .optional()
  .describe('「同じ支払いかも」と返ったあと、本人が別の支払いだと言ったときだけ true');
const confirmFirst = '呼ぶ前に、内容を本人に見せて確かめること。';

/** レシート(お店・日付・合計・品目)。preview_receipt・save_receipt・add_receipt で同じ形。 */
const receiptInput = {
  store: z.string().min(1).max(60).describe('お店の名前(支店名は省く)'),
  date: date.describe('レシートの日付'),
  totalYen: yen.describe('支払った合計(税込み・値引き後)'),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        yen: yen.describe('税込みの金額'),
        category: categoryName.optional().describe('品目のカテゴリ(省くとレシート全体のカテゴリ)'),
      }),
    )
    .max(100)
    .optional(),
  category: categoryName.optional().describe('レシート全体のカテゴリ'),
  account: z.string().max(40).optional().describe('支払った口座の名前。省くといつもの口座'),
};

export function createKakeiboMcpServer(ctx: {
  userId: string;
  /** 本人のセッションの中で動かす。 */
  run: <T>(fn: () => Promise<T>) => Promise<T>;
}): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );
  const call = (read: () => Promise<unknown>, structured = false) =>
    answer(() => ctx.run(read), '読めませんでした', structured);
  const change = (write: () => Promise<unknown>, structured = false) =>
    answer(() => ctx.run(write), 'できませんでした', structured);

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

  server.registerTool(
    'add_record',
    {
      title: '記録する',
      description: `本人が言った支出・収入・返金を1件記録する(例「ランチ 1200円」「昨日コンビニ 540円」)。支出と返金はカテゴリが要る。${confirmFirst}`,
      inputSchema: {
        type: z.enum(['expense', 'income', 'refund']).describe('支出・収入・返金'),
        amountYen: yen.describe('金額(正の円)'),
        date: date.optional().describe('YYYY-MM-DD。省くと今日'),
        store: z.string().max(60).optional().describe('お店・名前。省くとカテゴリの名前'),
        category: categoryName.optional(),
        memo: z.string().max(200).optional(),
        account: z.string().max(40).optional().describe('支払った口座の名前。省くといつもの口座'),
        allowDuplicate,
      },
      annotations: writes,
    },
    (input) => change(() => addRecord(input)),
  );

  // レシート:preview_receipt で「これでいいですか」の画面を出し、本人が「はい」を押すと save_receipt
  // (画面からだけ呼べる)で登録する(本人「これでいいですかで、はいボタンを押したら登録」、ADR-146)。
  // add_receipt は、画面を出せない AI のため(本人がチャットで「はい」と言ったら呼ぶ)。
  registerAppTool(
    server,
    'preview_receipt',
    {
      title: 'レシートを確かめて登録',
      description:
        '本人が見せたレシート(写真など)から読んだお店・日付・合計・品目で、本人に「これでいいですか」の画面(はい・やめる)を出す。本人が「はい」を押すと登録される。まだ登録はしない。カテゴリは分かれば get_categories の名前で入れ、分からなければ省く(アプリが当てて「推定」と出す)。読めない所は推測せず本人に聞くこと。',
      inputSchema: receiptInput,
      annotations: readOnly,
      _meta: { ui: { resourceUri: RECEIPT_UI_URI } },
    },
    (input) => call(() => previewReceipt(input), true),
  );

  registerAppTool(
    server,
    SAVE_RECEIPT_TOOL,
    {
      title: 'レシートを登録(確かめの画面の「はい」)',
      description:
        '確かめの画面で本人が「はい」を押したときに、画面から呼ばれる。AI からは呼ばない(preview_receipt を使う)。',
      inputSchema: { ...receiptInput, allowDuplicate },
      annotations: writes,
      _meta: { ui: { resourceUri: RECEIPT_UI_URI, visibility: ['app'] } },
    },
    (input) => change(() => addReceipt(input), true),
  );

  registerAppResource(
    server,
    'レシートの確認',
    RECEIPT_UI_URI,
    { description: 'レシートの「これでいいですか」と「はい」ボタン' },
    async () => ({
      contents: [
        {
          uri: RECEIPT_UI_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: receiptConfirmHtml(),
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    }),
  );

  server.registerTool(
    'add_receipt',
    {
      title: 'レシートを入れる(画面を出せないとき)',
      description: `確かめの画面を出せない AI のときだけ使う(ふつうは preview_receipt)。本人が見せたレシートから読んだお店・日付・合計・品目を1件記録する。品目が2つ以上なら品目ごとのカテゴリで分ける。品目の合計が合計と少し違えば「調整」の行を足す(大きく違えば断る)。読めない所は推測せず本人に聞くこと。${confirmFirst}`,
      inputSchema: { ...receiptInput, allowDuplicate },
      annotations: writes,
    },
    (input) => change(() => addReceipt(input)),
  );

  server.registerTool(
    'set_category',
    {
      title: 'カテゴリを直す',
      description: `明細のカテゴリを変える。id は search_transactions の結果の id。次から同じお店はそのカテゴリになりやすくなる。${confirmFirst}`,
      inputSchema: {
        id: z.string().min(1).max(64).describe('明細の id'),
        category: categoryName,
      },
      annotations: { ...writes, idempotentHint: true },
    },
    (input) => change(() => setCategory(input)),
  );

  server.registerTool(
    'set_target',
    {
      title: '目標を変える',
      description: `今期の目標の、カテゴリの目標額を変える(目標に無いカテゴリは足す)。使った額と予定の合計より下にはできない。${confirmFirst}`,
      inputSchema: {
        category: categoryName,
        targetYen: z.number().int().min(0).max(MAX_YEN).describe('新しい目標額(円)'),
      },
      annotations: { ...writes, idempotentHint: true },
    },
    (input) => change(() => setTarget(input)),
  );

  server.registerTool(
    'undo_record',
    {
      title: '記録を取り消す',
      description: `add_record・add_receipt で入れた記録を取り消す(ほかの記録は消せない)。id は記録したときの結果の id。${confirmFirst}`,
      inputSchema: { id: z.string().min(1).max(64).describe('記録の id') },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    (input) => change(() => undoRecord(input)),
  );

  return server;
}
