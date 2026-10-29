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
import {
  analyzeData,
  DIMENSIONS,
  MAX_ANALYZE_DAYS,
  overviewData,
  receiptItemsData,
} from './analysis';
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
  '道具の選び方:いまの状況は get_today・get_categories、ある月の合計は get_month_summary、',
  '期間をまたぐ比べ・傾向・ランキング(月ごと・曜日・お店・カテゴリ×月・前年比など)は analyze_spending、',
  '個々の支払いを見るときは search_transactions、何をいくらで買ったか(品目・値段の推移・どの店が安いか)は',
  'get_receipt_items、分析の前にデータの範囲・口座・カテゴリを知るには get_overview。数字は家計簿の画面と同じ',
  '数え方なので、AI が明細を足し直すより analyze_spending の結果を使ってください。',
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
        '【いまの状況】今日あといくら使えるか(こえていればこえた額)、明日からの1日の目安、今期の見通し(使った額・着地の見込み・目標・目標内に収まる確率)、今日の記録、片づけることの件数。使うとき:「今日あといくら？」「今月大丈夫？」など、いまの家計の様子を聞かれたとき。会話の最初に全体をつかむときにも。',
      annotations: readOnly,
    },
    () => call(() => todayData(ctx.userId)),
  );

  server.registerTool(
    'get_categories',
    {
      title: 'カテゴリごとの今期',
      description:
        '【今期のカテゴリ】カテゴリごとの今期の目標・使った額・予定・着地の見込み(と幅)・先月の額・目標をこえそうか(確率)・固定費か。category で名前をしぼれる(部分一致)。使うとき:「外食使いすぎ？」「どのカテゴリが危ない？」など、今期の目標に対する進み具合を聞かれたとき。カテゴリの正しい名前を知りたいときにも。過去の月の比べには analyze_spending。',
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
        '【月の合計】ある月の支出・収入・収支(収入−支出)・予定の合計と、カテゴリごとの使った額(多い順)・明細の件数。明細の画面の月の合計と同じ数え方。使うとき:「先月いくら使った？」「9月の収支は？」など、1つの月の締めを聞かれたとき。何か月も並べて比べるなら analyze_spending(groupBy: month)。',
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
      description: `【明細そのもの】期間・お店やメモの言葉・カテゴリ・金額・種類で明細をさがし、1件ずつ(日付・お店・金額・カテゴリ・メモ・id)返す(新しい順、最大${MAX_ROWS}件)。条件に合う件数と合計も返す(予定は合計に入れない)。期間の既定は今月1日から今日まで、最長${MAX_RANGE_DAYS}日。使うとき:「ファミマでいつ何円使った？」「1万円以上の買い物は？」など個々の支払いを見るとき、カテゴリを直す明細の id を知るとき。件数が多い集計(お店ごとの合計など)は analyze_spending のほうが正確で速い。`,
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
      description:
        '【これからの支払い】明日から days 日先までの支払いの予定(日付・お店・金額・カテゴリ、近い順)と合計。固定費(毎月決まって出ていくもの)かどうかも返す。使うとき:「来月の引き落としは？」「固定費はいくら？」「月末までに払うものは？」と聞かれたとき。',
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
        '【片づけること】本人が確かめることの件数:今日の答え合わせ、アプリで撮って保存前のレシート(お店・日付・金額)、読めずに入力待ちのレシート。保存前のレシートの保存はアプリで本人がする。使うとき:「やること残ってる？」と聞かれたとき、記録が足りないか気になるとき。',
      annotations: readOnly,
    },
    () => call(() => needsCheckData(ctx.userId)),
  );

  // ---- 分析の道具(本人「AI 側で複雑な分析をしたい」、ADR-147) ----
  server.registerTool(
    'analyze_spending',
    {
      title: '集計する(分析)',
      description: `【集計・比べ・傾向】明細を1〜2つの軸で集計し、軸の組ごとに金額・件数・1件あたりの平均・全体に占める割合を返す。軸は month(月)・week(週、月曜始まり)・day(日)・weekday(曜日)・category(カテゴリ)・store(お店)・account(口座)。2つ並べるとクロス集計(例 ["category","month"] でカテゴリ×月)。compareWith で直前の同じ長さの期間か前年の同じ期間と比べ、差も返す。数え方は家計簿の画面と同じ(レシートの分割はカテゴリごと、返金は使った額から引く、振替・対象外は数えない、予定は既定で除く)。期間の既定は今月1日から今日まで、最長${MAX_ANALYZE_DAYS}日。使うとき:「月ごとの食費の推移」「どの曜日に使いがち？」「よく行くお店ランキング」「去年より何が増えた？」「カードごとの支払い」「1日平均いくら？」など、期間をまたぐ分析・比べ・ランキング。個々の明細は search_transactions、品目は get_receipt_items。`,
      inputSchema: {
        from: date.optional().describe('始まりの日(YYYY-MM-DD)。省くと今月1日'),
        to: date.optional().describe('終わりの日(YYYY-MM-DD)。省くと今日'),
        groupBy: z
          .array(z.enum(DIMENSIONS))
          .max(2)
          .optional()
          .describe('集計の軸(0〜2個)。省くと全体の合計だけ'),
        type: z
          .enum(['expense', 'income'])
          .optional()
          .describe('expense=使った額(既定、返金を引く)・income=収入'),
        category: z.string().max(40).optional().describe('カテゴリでしぼる(部分一致)'),
        store: z.string().max(60).optional().describe('お店でしぼる(部分一致)'),
        account: z.string().max(40).optional().describe('口座・カードでしぼる(部分一致)'),
        minYen: z.number().int().min(0).optional().describe('1件の金額の下限'),
        maxYen: z.number().int().min(0).optional().describe('1件の金額の上限'),
        includeScheduled: z.boolean().optional().describe('今日より先の予定も入れる(既定 false)'),
        excludeSpecial: z
          .boolean()
          .optional()
          .describe('特別費(旅行・家電など、ふだんのペースから外すもの)を除く'),
        compareWith: z
          .enum(['previous_period', 'previous_year'])
          .optional()
          .describe('previous_period=直前の同じ長さの期間・previous_year=1年前の同じ期間と比べる'),
        limit: z.number().int().min(1).max(200).optional().describe('返す行の数(既定50)'),
      },
      annotations: readOnly,
    },
    (input) => call(() => analyzeData(input)),
  );

  server.registerTool(
    'get_receipt_items',
    {
      title: 'レシートの品目',
      description:
        '【何をいくらで買ったか】レシートで記録した品目(日付・お店・品名・金額・カテゴリ)を返し、品目ごと(回数・合計・平均・最安・最高・最後に買った日・お店ごとの平均と最安)とお店ごと(件数・合計)にまとめる。品名・お店・カテゴリでしぼれる(部分一致、全角半角・大文字小文字は区別しない)。期間の既定は90日前から今日まで、最長2年。使うとき:「牛乳はどこが安い？」「卵の値段の推移」「よく買う物は？」「お菓子に月いくら？」など、品目単位の分析。レシートを撮らずに記録した支払いには品目が無い。',
      inputSchema: {
        from: date.optional().describe('始まりの日。省くと90日前'),
        to: date.optional().describe('終わりの日。省くと今日'),
        query: z.string().max(60).optional().describe('品名に含まれる言葉(例: 牛乳)'),
        store: z.string().max(60).optional().describe('お店でしぼる(部分一致)'),
        category: z.string().max(40).optional().describe('品目のカテゴリでしぼる(部分一致)'),
        limit: z.number().int().min(1).max(200).optional().describe('返す品目の行の数(既定50)'),
      },
      annotations: readOnly,
    },
    (input) => call(() => receiptItemsData(input)),
  );

  server.registerTool(
    'get_overview',
    {
      title: '家計簿の概要',
      description:
        '【何があるか】記録の始まりの日・最後の日・件数、今期(目標の期間)、カテゴリの一覧と目標額、口座・カードの一覧(種類・用途・残高・締め日・支払日)。使うとき:分析を始める前に、どの期間のデータがあるか・どんなカテゴリや口座があるかを知るとき。「カードは何枚？」「口座の残高は？」と聞かれたとき。',
      annotations: readOnly,
    },
    () => call(() => overviewData()),
  );

  server.registerTool(
    'add_record',
    {
      title: '記録する',
      description: `【1件記録する】本人が言った支出・収入・返金を1件記録する(例「ランチ 1200円」「昨日コンビニ 540円」)。支出と返金はカテゴリが要る(get_categories の名前)。レシートの写真なら preview_receipt を使う。${confirmFirst}`,
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
