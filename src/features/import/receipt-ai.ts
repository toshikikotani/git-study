/**
 * レシート・領収書の画像からの AI 抽出(新機能、ADR-021)。
 *
 * ── なぜ画像なのか ──────────────────────────────────────────
 * 明細の取り込み経路(CSV・メール通知)は、いずれもカード払いの記録を前提に
 * している。現金払い・電子マネー払いにはそもそも通知メールが届かず、
 * カード明細にも載らない。この抜け穴を埋めるには、レシートの写真を直接
 * 読み取る経路が要る(設計原則2「記録の手間を最小化」)。
 *
 * ── email-ai.ts との違い ────────────────────────────────────
 * メール通知にはラベル辞書という費用ゼロの経路があり、AI は「辞書が読めな
 * かったときだけ」の救済役だった(ADR-019)。レシート画像には辞書に相当する
 * ものが無い(画像からの決定的な文字抽出手段を持たない)ため、この経路は
 * 呼ばれた時点で必ず AI を使う。ADR-010 の「リボ・キャッシングの判定は
 * AI にやらせない」という役割分担はここでも変えない。payment_method_text は
 * レシートにそう書かれていた文字列そのままを返させ、判定は従来どおり
 * readPaymentMethod の正規表現が行う。
 *
 * ── 商品行(items)は常に返す(ADR-034) ──────────────────────
 * 「レシートというのは店と品目を全て合わせた概念」という本人の指摘どおり、
 * ここでは商品行(品名・金額)を書き写すだけにとどめ、カテゴリの判定は
 * しない。1点だけの買い物でも、内訳の合計が支払額と一致しなくても items は
 * 返す——呼び出し側(receipt/page.tsx)がこれを常に `receipt_items` として
 * 保存する。カテゴリごとに分割できるか(2件以上・合計一致)は別の判断で、
 * items を返すかどうかとは独立している。
 *
 * ── 品目の商品分類・生活費の小分類(本人発案、ADR-036) ────────────
 * 「レシートの商品の分類と、生活費の何系かの小分類も、AIの自由判断で
 * 付けてほしい」という追加要望。`category_id`(既存の固定カテゴリ一覧
 * からの分類、ADR-035)とは別に、ここでは商品ごとの品目名(`product_type`、
 * 例:飲料・調味料・菓子)と、レシート全体としての生活費の内訳
 * (`expense_subtype`、例:食費・日用品・外食)を、固定語彙を与えず
 * モデルの自由記述で返させる。固定カテゴリと違い「選択肢の中から選ぶ」
 * のではなく「一言で言い表す」タスクのため、あえて選択肢を渡さない
 * (表記ゆれは許容し、新しい言い回しが自然に増えていくことを是とする)。
 * 判断できない・当てはまらない場合は空文字を返させ、こちら側で null に
 * 変換する(空文字のまま保存しない)。
 *
 * ── 振込/送金の完了画面も対象にする(本人発案、ADR-038) ─────────
 * 銀行アプリの「送金明細」画面のスクリーンショットも同じ経路で読み取れる
 * ようにした。レシートの店名に相当するのは送金先(受取人)の名前、
 * 金額に相当するのは送金金額。商品の内訳(items)・生活費の小分類は
 * 無いため、どちらも自然に空(null/空配列)になる。判定・変換ロジック
 * (buildFromAiRows)自体はレシートと振込を区別しない——どちらも
 * 「日付・金額・相手・内訳」の同じ形に落とし込めるため、違いはモデルへの
 * 指示(プロンプト)だけで吸収する。
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { parseStructured } from '@/lib/anthropic';
import type { DateOnly } from '@/lib/date';
import { readPaymentMethod, type PaymentMethod } from './adapters';
import { parseDateOnly } from './date-parse';

/** 抽出に使うモデル(ADR-010/019 と同じコスト方針)。日付サフィックスは付けない。 */
export const RECEIPT_EXTRACTION_MODEL = 'claude-haiku-4-5';

/** 1枚あたりの上限。書き写すだけの作業なので、長い出力は異常。 */
const MAX_OUTPUT_TOKENS = 2048;

/**
 * 明らかに桁を外した金額を弾くための上限(1件 1000万円)。
 * email-ai.ts と同じ理由(カンマの読み違い等の事故を本人の目に触れる前に止める)。
 */
const MAX_AMOUNT_YEN = 10_000_000;

export const SUPPORTED_RECEIPT_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ReceiptMediaType = (typeof SUPPORTED_RECEIPT_MEDIA_TYPES)[number];

export type ParsedReceiptItem = {
  /** レシートに印字された品名。 */
  description: string;
  /** 支出が負(ADR-008)。親の明細と同じ符号。 */
  amountYen: number;
  /** 商品の種類のAIによる自由記述(例:飲料・調味料、ADR-036)。判断できなければ null。 */
  productType: string | null;
};

export type ParsedReceiptTransaction = {
  occurredOn: DateOnly;
  description: string;
  /** 支出が負(ADR-008)。レシートは常に支出として扱う。 */
  amountYen: number;
  paymentMethod: PaymentMethod;
  /**
   * 商品行(本人発案)。2件以上あり、合計が amountYen と一致する場合のみ
   * 入る。それ以外(内訳が無い、1件しかない、合計が合わない)は空配列。
   * ここに何も入らなくても取り込み自体は今までどおり1件のまま行える。
   */
  items: readonly ParsedReceiptItem[];
  /**
   * 生活費の何系かのAIによる自由記述(例:食費・日用品・外食、ADR-036)。
   * 生活費に当てはまらなそうなレシートは null。実際に「生活費」カテゴリ
   * として分類されたときだけ画面に出す(呼び出し側の判断、receipt-ai.ts
   * ではカテゴリ分類そのものを行わない)。
   */
  expenseSubtype: string | null;
};

export type ReceiptParseResult = {
  transactions: ParsedReceiptTransaction[];
  /** 取りこぼしを黙って捨てないための記録。画面に出す。 */
  warnings: string[];
};

export type AiReceiptExtractInput = {
  imageBase64: string;
  mediaType: ReceiptMediaType;
};

export interface AiReceiptExtractor {
  extract(input: AiReceiptExtractInput): Promise<ReceiptParseResult>;
}

/**
 * モデルに返させる形。
 *
 * payment_method_text が enum ではなく string なのが要点(email-ai.ts と同じ理由)。
 */
const itemSchema = z.object({
  name: z.string().describe('商品名・品名。レシートに印字された表記のまま。'),
  amount_yen: z.number().describe('その商品の金額(値引き後の実際の請求額)。円単位の整数。'),
  product_type: z
    .string()
    .describe(
      'その商品の種類を一言で(例:飲料、調味料、菓子、日用品、書籍)。固定の選択肢は無い。' +
        '自由に判断してよい。何の商品か判断できなければ空文字。',
    ),
});

const rowSchema = z.object({
  occurred_on: z
    .string()
    .describe('レシートの日付、または振込の送金日。YYYY-MM-DD 形式。時刻は含めない。'),
  amount_yen: z
    .number()
    .describe(
      '実際に支払った、または送金した合計金額(レシートなら「合計」「お会計」' +
        '「お預り」ではなく実際の支払額。振込なら「送金金額」)。' +
        '小計・税抜金額ではなく、最終的に動いた金額を返す。手数料は含めない。円単位の整数。',
    ),
  store_name: z
    .string()
    .describe(
      '店名・発行元。振込の場合は送金先(受取人)の名前。書かれていた表記のまま。' +
        '読み取れなければ空文字。',
    ),
  payment_method_text: z
    .string()
    .describe(
      '支払方法としてレシートに書かれていた文字列を、そのまま写す。振込の場合は空文字。' +
        '言い換えや翻訳や要約はしない。書かれていなければ空文字。',
    ),
  items: z
    .array(itemSchema)
    .describe(
      'レシートに印字された商品行。小計・合計・お預り・お釣り・消費税・ポイントの行は' +
        '含めない。内訳が印字されていない、商品が1点しかない、または振込明細の場合は空配列。',
    ),
  expense_subtype: z
    .string()
    .describe(
      'この支払いが生活費(食費・日用品・外食・交通費のような暮らしの支出)だとすれば、' +
        '具体的に何系かを一言で。固定の選択肢は無い。生活費に当てはまらなそうな支払い' +
        '(投資・趣味・交際費など)や、振込明細、判断が難しい場合は空文字。',
    ),
});

const extractionSchema = z.object({
  is_recognized: z
    .boolean()
    .describe(
      'この画像がレシート・領収書、または振込/送金の完了画面であれば true。' +
        '無関係な写真や読み取れない画像は false。',
    ),
  transactions: z
    .array(rowSchema)
    .describe('読み取れた明細。1枚に複数の取引が写っていれば複数。無ければ空配列。'),
});

type ExtractionRow = z.infer<typeof rowSchema>;

const SYSTEM_PROMPT = [
  'あなたはレシート・領収書、または銀行アプリの振込/送金完了画面の画像から、',
  'お金の動きを書き写す担当です。',
  '',
  '守ること:',
  '- 画像に写っていることだけを返す。推測で補わない。',
  '- 金額は絶対値の整数。カンマや「円」は取り除く。',
  '  レシートなら小計や税抜額ではなく実際に支払った合計を、振込なら送金金額を返す',
  '  (振込手数料は含めない)。',
  '- 日付は YYYY-MM-DD。和暦(令和・平成)や「9/3」のような表記、',
  '  「2026年09月23日(水)」のような曜日付きの表記も西暦の日付だけに直すが、',
  '  年が画像のどこにも無ければその明細は返さない。',
  '- store_name はレシートなら店名・発行元、振込なら送金先(受取人)の名前を写す。',
  '- payment_method_text はレシートに書かれていた支払方法の文字列をそのまま写す。',
  '  「クレジット」を「credit card」に直すようなことはしない。振込の場合は空文字にする。',
  '- items には商品行を1行ずつ書き写す。小計・合計・お預り・お釣り・消費税・',
  '  ポイント付与/使用の行は商品ではないので含めない。内訳が印字されていない、',
  '  商品が1点しかない、または振込明細の場合は items を空配列にしてよい。',
  '- 1枚に複数のレシート・振込明細が写っていれば、すべて返す。',
  '- レシート・領収書でも振込/送金の完了画面でもない画像(無関係な写真、',
  '  読み取れないほど不鮮明な画像など)は is_recognized を false にして',
  '  transactions を空にする。',
  '',
  '例外(ここだけは推測してよい):',
  '- product_type(商品の種類)と expense_subtype(生活費の何系か)は、',
  '  レシートに印字されている文字ではなく、店名・商品名から判断するあなた自身の',
  '  判断です。固定の選択肢は渡さないので、自然な日本語の一言で自由に答えて',
  '  ください。自信が無くても、無理に空文字にせず一番近いと思う言葉を返して',
  '  よい。本当に判断のしようがない場合だけ空文字にする。',
].join('\n');

/**
 * Claude を使う実装。
 *
 * サーバー側でのみ生成すること。API キーがブラウザへ渡ることは無い(NFR-04)。
 */
export class ClaudeReceiptExtractor implements AiReceiptExtractor {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async extract(input: AiReceiptExtractInput): Promise<ReceiptParseResult> {
    const result = await parseStructured({
      client: this.client,
      model: RECEIPT_EXTRACTION_MODEL,
      maxTokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 },
            },
            { type: 'text', text: '上の画像から支払い明細を書き写してください。' },
          ],
        },
      ],
      schema: extractionSchema,
    });
    if (!result.ok) return { transactions: [], warnings: [result.message] };

    const parsed = result.value;
    if (!parsed.is_recognized) {
      return {
        transactions: [],
        warnings: ['レシート・領収書、または振込明細として認識できませんでした。'],
      };
    }

    return buildFromAiRows(parsed.transactions);
  }
}

/**
 * モデルの返答を明細に変換する。
 *
 * モデルの出力はスキーマに沿っているだけで、中身が正しい保証は無い。
 * 日付・金額はこちら側で必ず検証し、通らないものは理由を残して捨てる。
 * 支払方法はここで初めて正規表現にかけ、確率的な判定を混ぜない(ADR-010)。
 */
export function buildFromAiRows(rows: readonly ExtractionRow[]): ReceiptParseResult {
  const transactions: ParsedReceiptTransaction[] = [];
  const warnings: string[] = [];

  for (const row of rows) {
    let occurredOn: DateOnly;
    try {
      occurredOn = parseDateOnly(row.occurred_on);
    } catch {
      warnings.push(`AI が返した日付を解釈できませんでした: ${row.occurred_on}`);
      continue;
    }

    const amount = Math.abs(Math.round(row.amount_yen));
    if (!Number.isFinite(amount) || amount === 0) {
      warnings.push(`AI が返した金額が使えません(${row.amount_yen})`);
      continue;
    }
    if (amount > MAX_AMOUNT_YEN) {
      warnings.push(
        `AI が返した金額が大きすぎるため確認が要ります(${amount.toLocaleString('ja-JP')}円)`,
      );
      continue;
    }

    const description = row.store_name.trim();
    const label = description === '' ? '(店名不明)' : description;

    transactions.push({
      occurredOn,
      // レシートは支出(ADR-008)。符号はモデルに委ねない。
      amountYen: -amount,
      description: label,
      // ここが FR-21 の砦。判定するのはモデルではなく正規表現(ADR-010)。
      paymentMethod: readPaymentMethod(row.payment_method_text),
      items: buildItems(row.items),
      expenseSubtype: toNullableLabel(row.expense_subtype),
    });
  }

  if (transactions.length === 0 && warnings.length === 0) {
    warnings.push('AI もこの画像から明細を読み取れませんでした。');
  }

  return { transactions, warnings };
}

/**
 * 商品行を検証して返す(ADR-034)。「レシートは店と品目を合わせた概念」
 * という本人の指摘どおり、1点だけの買い物でも、内訳の合計が支払額と
 * 一致しなくても常に返す——ここでは名前・金額として使えるかだけを見る。
 *
 * カテゴリごとに分割できるか(2件以上・合計が一致)は呼び出し側
 * (receipt/page.tsx の itemsReconcile())が別に判断する。分割できるか
 * どうかで、品目そのものを記録するかどうかを左右しない。
 */
function buildItems(
  rawItems: readonly { name: string; amount_yen: number; product_type: string }[],
): ParsedReceiptItem[] {
  return rawItems
    .map((it) => ({
      description: it.name.trim(),
      amountYen: -Math.abs(Math.round(it.amount_yen)),
      productType: toNullableLabel(it.product_type),
    }))
    .filter((it) => Number.isFinite(it.amountYen) && it.amountYen !== 0)
    .map((it) => ({
      description: it.description === '' ? '(品名不明)' : it.description,
      amountYen: it.amountYen,
      productType: it.productType,
    }));
}

/** 自由記述のAI判断(product_type/expense_subtype、ADR-036)。空文字は null にする。 */
function toNullableLabel(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 商品行をカテゴリごとに分割できるか(receipt/page.tsx が使う)。
 * 2件以上あり、かつ合計が明細の金額と一致する場合だけ true——
 * それ以外は品目としては残るが(buildItems 参照)、カテゴリの分割対象には
 * ならない(transaction_splits は合計一致を必須とするため、ADR-034)。
 */
export function itemsReconcileWithTotal(
  items: readonly ParsedReceiptItem[],
  totalAmountYen: number,
): boolean {
  if (items.length < 2) return false;
  const sum = items.reduce((acc, it) => acc + it.amountYen, 0);
  return sum === totalAmountYen;
}
