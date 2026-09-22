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
 * ── 商品行(items)も同じ役割分担 ────────────────────────────
 * スーパーのレシート1枚に食費と日用品が混ざっていても、店名と合計だけでは
 * 1カテゴリにしかならない(本人発案のもったいなさの指摘)。ここでは商品行
 * (品名・金額)を書き写すだけにとどめ、カテゴリの判定はしない。分類は
 * features/classification の既存パイプライン(ルール→本人操作でのAI)に
 * 商品行を1件ずつ通す(features/transactions 側の責務)。ここで返す items は
 * 「合計と一致した」場合のみ呼び出し側が transaction_splits の元にする。
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
});

const rowSchema = z.object({
  occurred_on: z.string().describe('レシートに印字された日付。YYYY-MM-DD 形式。時刻は含めない。'),
  amount_yen: z
    .number()
    .describe(
      '実際に支払った合計金額(「合計」「お会計」「お預り」ではなく実際の支払額)。' +
        '小計・税抜金額ではなく、レシートの最終的な支払金額を返す。円単位の整数。',
    ),
  store_name: z
    .string()
    .describe('店名・発行元。レシートに書かれていた表記のまま。読み取れなければ空文字。'),
  payment_method_text: z
    .string()
    .describe(
      '支払方法としてレシートに書かれていた文字列を、そのまま写す。' +
        '言い換えや翻訳や要約はしない。書かれていなければ空文字。',
    ),
  items: z
    .array(itemSchema)
    .describe(
      'レシートに印字された商品行。小計・合計・お預り・お釣り・消費税・ポイントの行は' +
        '含めない。内訳が印字されていない、または商品が1点しかない場合は空配列。',
    ),
});

const extractionSchema = z.object({
  is_receipt: z
    .boolean()
    .describe('この画像がレシート・領収書であれば true。無関係な写真や読み取れない画像は false。'),
  transactions: z
    .array(rowSchema)
    .describe('読み取れた明細。1枚に複数の取引が写っていれば複数。無ければ空配列。'),
});

type ExtractionRow = z.infer<typeof rowSchema>;

const SYSTEM_PROMPT = [
  'あなたはレシート・領収書の画像から、支払い明細を書き写す担当です。',
  '',
  '守ること:',
  '- 画像に写っていることだけを返す。推測で補わない。',
  '- 金額は絶対値の整数。カンマや「円」は取り除く。小計や税抜額ではなく、実際に支払った合計を返す。',
  '- 日付は YYYY-MM-DD。和暦(令和・平成)や「9/3」のような表記は西暦に直すが、',
  '  年が画像のどこにも無ければその明細は返さない。',
  '- payment_method_text はレシートの文字列をそのまま写す。',
  '  「クレジット」を「credit card」に直すようなことはしない。',
  '- items には商品行を1行ずつ書き写す。小計・合計・お預り・お釣り・消費税・',
  '  ポイント付与/使用の行は商品ではないので含めない。内訳が印字されていない、',
  '  または商品が1点しかないレシートは items を空配列にしてよい。',
  '- 1枚に複数のレシートが写っていれば、すべて返す。',
  '- レシート・領収書でない画像(無関係な写真、読み取れないほど不鮮明な画像など)は',
  '  is_receipt を false にして transactions を空にする。',
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
    if (!parsed.is_receipt) {
      return { transactions: [], warnings: ['レシート・領収書として認識できませんでした。'] };
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
      items: buildItems(row.items, amount, label, warnings),
    });
  }

  if (transactions.length === 0 && warnings.length === 0) {
    warnings.push('AI もこの画像から明細を読み取れませんでした。');
  }

  return { transactions, warnings };
}

/**
 * 商品行を検証する。2件以上あり、かつ合計が明細の金額(絶対値)と一致する
 * 場合だけ items を返す。それ以外は「分割は使えない」を警告として残し、
 * 空配列を返す(取り込み自体は今までどおり1件のまま続けられる)。
 *
 * 1件しかない行(内訳が無い/1点だけの買い物)は AI にとって自然な結果
 * なので、警告なしで静かに空配列を返す。
 */
function buildItems(
  rawItems: readonly { name: string; amount_yen: number }[],
  totalAmountAbsYen: number,
  transactionLabel: string,
  warnings: string[],
): ParsedReceiptItem[] {
  if (rawItems.length < 2) return [];

  const items = rawItems
    .map((it) => ({
      description: it.name.trim(),
      amountYen: -Math.abs(Math.round(it.amount_yen)),
    }))
    .filter((it) => Number.isFinite(it.amountYen) && it.amountYen !== 0);

  const sum = items.reduce((acc, it) => acc + it.amountYen, 0);
  if (items.length < 2 || sum !== -totalAmountAbsYen) {
    warnings.push(
      `「${transactionLabel}」の商品ごとの内訳が支払合計と一致しないため、カテゴリの分割は使えません(通常の1件としては取り込めます)。`,
    );
    return [];
  }

  return items.map((it) => ({
    description: it.description === '' ? '(品名不明)' : it.description,
    amountYen: it.amountYen,
  }));
}
