/**
 * 読み取りに失敗したレシートの手動入力(F7)の判断を担う純粋関数。
 *
 * レシートの読み取り結果は4つの状態に分ける(receiptStatus):
 *   parsed  : 金額・日付・店名がすべて読めた(そのまま確認画面へ)
 *   partial : 一部だけ読めた(読めた項目を入れた状態で手入力へ。読めなかった項目を強調する)
 *   failed  : 何も読めなかった(手入力へ)
 *   manual  : 最初から手で入力した(読み取りを介さない)
 *
 * partial・failed のレシートは「入力待ち」(needs_input)として明細・要確認に出るが、
 * 入力が終わるまで集計・目標には一切入らない(明細とは別のテーブル。receipt_captures)。
 */

import { RECEIPT_ABSORB_YEN, taxIncludedIn, type TaxRate } from '@/domain/receipt-reconcile';
import { normalizeStoreName } from '@/domain/store-name';
import type { ParsedReceiptTransaction } from '@/features/import/receipt-ai';
import { addMonths, assertDateOnly, type DateOnly } from '@/lib/date';

export type ReceiptStatus = 'parsed' | 'partial' | 'failed' | 'manual';
export type CaptureStatus = 'needs_input' | 'resolved' | 'discarded';

/** 手入力の対象になる項目(入力の順番どおり)。 */
export const CAPTURE_FIELDS = ['amountYen', 'occurredOn', 'storeName'] as const;
export type CaptureField = (typeof CAPTURE_FIELDS)[number];

export const CAPTURE_FIELD_LABEL: Record<CaptureField, string> = {
  amountYen: '金額',
  occurredOn: '日付',
  storeName: '店名',
};

/** 読み取れた値(読めなかった項目は入らない)。 */
export type ReadFields = {
  amountYen?: number;
  occurredOn?: DateOnly;
  storeName?: string;
  genreId?: string;
};

/** この確信度を下回る項目は「読めていない」と扱う(推測した値で埋めない)。 */
export const MIN_FIELD_CONFIDENCE = 0.5;

export type ReadJudgement = {
  receiptStatus: ReceiptStatus;
  readFields: ReadFields;
  unreadFields: CaptureField[];
};

/**
 * 読み取り結果から、レシートの状態と「読めた項目/読めなかった項目」を決める。
 * 複数の買い物が写っている(明細が2件以上)ときは、従来どおり確認画面で扱う(parsed)。
 */
export function judgeReadResult(transactions: readonly ParsedReceiptTransaction[]): ReadJudgement {
  if (transactions.length === 0) {
    return { receiptStatus: 'failed', readFields: {}, unreadFields: [...CAPTURE_FIELDS] };
  }
  if (transactions.length > 1) {
    return { receiptStatus: 'parsed', readFields: {}, unreadFields: [] };
  }
  const t = transactions[0]!;
  const conf = t.fieldConfidence;
  const readFields: ReadFields = {};

  if (t.amountYen !== 0 && (conf === undefined || conf.total >= MIN_FIELD_CONFIDENCE)) {
    readFields.amountYen = Math.abs(t.amountYen);
  }
  if (isValidDate(t.occurredOn) && (conf === undefined || conf.date >= MIN_FIELD_CONFIDENCE)) {
    readFields.occurredOn = t.occurredOn;
  }
  const store = (t.storeName ?? '').trim() || normalizeStoreName(t.description).name.trim();
  if (store !== '' && (conf === undefined || conf.store >= MIN_FIELD_CONFIDENCE)) {
    readFields.storeName = store;
  }

  const unreadFields = CAPTURE_FIELDS.filter((f) => readFields[f] === undefined);
  const receiptStatus: ReceiptStatus =
    unreadFields.length === 0
      ? 'parsed'
      : unreadFields.length === CAPTURE_FIELDS.length
        ? 'failed'
        : 'partial';
  return { receiptStatus, readFields, unreadFields };
}

function isValidDate(value: string | undefined): value is DateOnly {
  if (!value) return false;
  try {
    assertDateOnly(value);
    return true;
  } catch {
    return false;
  }
}

/** 入力待ちにするか(全部読めたなら確認画面へ進む)。 */
export function needsManualInput(status: ReceiptStatus): boolean {
  return status === 'partial' || status === 'failed';
}

// ---- 手入力のフォーム ---------------------------------------------------------

export type ManualItem = {
  id: string;
  name: string;
  /** 税込の金額(正の整数円)。 */
  amountYen: number | null;
  taxRate: 8 | 10;
};

/** フォームの値(下書きとして保存する形と同じ)。金額は入力中なので空を許す。 */
export type ManualEntryValues = {
  amountYen: number | null;
  occurredOn: string;
  storeName: string;
  genreId: string | null;
  accountId: string;
  memo: string;
  items: ManualItem[];
};

export function emptyManualValues(today: DateOnly, accountId = ''): ManualEntryValues {
  return {
    amountYen: null,
    occurredOn: today,
    storeName: '',
    genreId: null,
    accountId,
    memo: '',
    items: [],
  };
}

/** 読み取れた項目を入れた初期値。読めなかった項目は空のまま(推測で埋めない)。 */
export function initialValuesFor(
  read: ReadFields,
  today: DateOnly,
  accountId = '',
): ManualEntryValues {
  return {
    ...emptyManualValues(today, accountId),
    amountYen: read.amountYen ?? null,
    occurredOn: read.occurredOn ?? today,
    storeName: read.storeName ?? '',
    genreId: read.genreId ?? null,
  };
}

export type ManualEntryErrors = Partial<Record<'amountYen' | 'occurredOn' | 'accountId', string>>;

/** 保存できる状態かを確かめる(金額・日付・口座)。店名は空でも保存できる(店名不明として残す)。 */
export function validateManualEntry(values: ManualEntryValues, today: DateOnly): ManualEntryErrors {
  const errors: ManualEntryErrors = {};
  if (values.amountYen === null || !Number.isInteger(values.amountYen) || values.amountYen <= 0) {
    errors.amountYen = '金額を入力してください';
  } else if (values.amountYen > 10_000_000) {
    errors.amountYen = '金額が大きすぎます(1,000万円まで)';
  }
  if (!isValidDate(values.occurredOn)) {
    errors.occurredOn = '日付を選んでください';
  } else if (values.occurredOn > addYearGuard(today)) {
    errors.occurredOn = '日付が先すぎます';
  }
  if (values.accountId === '') errors.accountId = '口座を選んでください';
  return errors;
}

/** 1年より先の日付は入力ミスとみなす。'YYYY-MM-DD' は辞書順で日付順になる(年は4桁)。 */
function addYearGuard(today: DateOnly): DateOnly {
  return addMonths(today, 12);
}

// ---- 品目と照合バー ------------------------------------------------------------

export type ItemsBar = {
  /** 品目の合計(税込)。 */
  sumYen: number;
  /** 合計金額 − 品目の合計(正=品目が足りない)。 */
  diffYen: number;
  status: 'empty' | 'ok' | 'short' | 'over';
  /** 税率ごとの税込合計と、その内税額(内訳の表示用)。 */
  byRate: { rate: TaxRate; grossYen: number; taxYen: number }[];
};

/** 品目(任意)と合計金額の照合。±1円は端数として一致とみなす。 */
export function itemsBar(items: readonly ManualItem[], totalYen: number | null): ItemsBar {
  const filled = items.filter((i) => i.amountYen !== null && i.amountYen > 0);
  const sumYen = filled.reduce((acc, i) => acc + i.amountYen!, 0);
  const byRate = ([8, 10] as const)
    .map((rate) => {
      const grossYen = filled
        .filter((i) => i.taxRate === rate)
        .reduce((a, i) => a + i.amountYen!, 0);
      return { rate, grossYen, taxYen: taxIncludedIn(grossYen, rate) };
    })
    .filter((g) => g.grossYen > 0);
  if (filled.length === 0 || totalYen === null) {
    return { sumYen, diffYen: 0, status: 'empty', byRate };
  }
  const diffYen = totalYen - sumYen;
  const status = Math.abs(diffYen) <= RECEIPT_ABSORB_YEN ? 'ok' : diffYen > 0 ? 'short' : 'over';
  return { sumYen, diffYen, status, byRate };
}

/** 照合バーの文言。 */
export function itemsBarMessage(bar: ItemsBar): string {
  switch (bar.status) {
    case 'empty':
      return '品目は任意です。入れると税率ごとの内訳を出します';
    case 'ok':
      return '品目の合計と一致しました';
    case 'short':
      return `品目があと ${bar.diffYen.toLocaleString('ja-JP')}円 足りません`;
    case 'over':
      return `品目が ${Math.abs(bar.diffYen).toLocaleString('ja-JP')}円 多いです`;
  }
}

// ---- 再読み取りの結果の取り込み --------------------------------------------------

export type RescanConflict = {
  field: CaptureField;
  current: string;
  rescanned: string;
};

export type RescanMerge = {
  /** 反映後の値。入力済みの項目は書き換えない。 */
  values: ManualEntryValues;
  /** 空欄だったので自動で埋めた項目。 */
  filled: CaptureField[];
  /** 入力済みの値と食い違う項目(上書きせず、差分として本人に見せる)。 */
  conflicts: RescanConflict[];
};

function fieldText(values: ManualEntryValues, field: CaptureField): string {
  switch (field) {
    case 'amountYen':
      return values.amountYen === null ? '' : String(values.amountYen);
    case 'occurredOn':
      return values.occurredOn;
    case 'storeName':
      return values.storeName.trim();
  }
}

function readText(read: ReadFields, field: CaptureField): string {
  const v = read[field];
  return v === undefined ? '' : String(v);
}

/**
 * 「もう一度読み取る」の結果を入力中のフォームへ取り込む。
 * 入力途中の値は絶対に上書きしない。空欄だけを埋め、入力済みの値と違うものは
 * 差分(conflicts)として返す(画面が「読み取り結果に置き換える」を選ばせる)。
 * 日付は既定で今日が入っている(=空欄と同じ)ので、「日付を触っていない」ときは埋めてよい
 * (touched に含まれない)。
 */
export function mergeRescan(
  values: ManualEntryValues,
  touched: ReadonlySet<CaptureField>,
  rescanned: ReadFields,
  today: DateOnly,
): RescanMerge {
  const next: ManualEntryValues = { ...values };
  const filled: CaptureField[] = [];
  const conflicts: RescanConflict[] = [];

  for (const field of CAPTURE_FIELDS) {
    const incoming = readText(rescanned, field);
    if (incoming === '') continue;
    const current = fieldText(values, field);
    const isEmpty =
      current === '' || (field === 'occurredOn' && !touched.has(field) && current === today);
    if (isEmpty) {
      if (field === 'amountYen') next.amountYen = rescanned.amountYen ?? null;
      else if (field === 'occurredOn') next.occurredOn = rescanned.occurredOn!;
      else next.storeName = rescanned.storeName!;
      filled.push(field);
    } else if (current !== incoming) {
      conflicts.push({ field, current, rescanned: incoming });
    }
  }
  return { values: next, filled, conflicts };
}

/** 差分の1項目を「読み取り結果に置き換える」で採用する。 */
export function applyConflict(
  values: ManualEntryValues,
  conflict: RescanConflict,
): ManualEntryValues {
  switch (conflict.field) {
    case 'amountYen':
      return { ...values, amountYen: Number(conflict.rescanned) };
    case 'occurredOn':
      return { ...values, occurredOn: conflict.rescanned };
    case 'storeName':
      return { ...values, storeName: conflict.rescanned };
  }
}

// ---- 保存する形への変換 ----------------------------------------------------------

/** 手入力を、確認画面と同じ保存経路(buildReceiptSavePlan)に渡せる形へ。 */
export function toParsedReceipt(values: ManualEntryValues): ParsedReceiptTransaction {
  const total = values.amountYen ?? 0;
  const store = values.storeName.trim();
  const items = values.items.filter(
    (i) => i.amountYen !== null && i.amountYen > 0 && i.name.trim() !== '',
  );
  const itemsMatch =
    items.length >= 2 &&
    Math.abs(total - items.reduce((a, i) => a + i.amountYen!, 0)) <= RECEIPT_ABSORB_YEN;
  return {
    occurredOn: values.occurredOn as DateOnly,
    description: store === '' ? 'レシート(手入力)' : store,
    amountYen: -total,
    paymentMethod: 'unknown',
    // 品目は合計が支払額に一致するときだけ持つ(保存は「子の合計 = 親の金額」を守る)。
    items: itemsMatch
      ? items.map((i) => ({
          description: i.name.trim(),
          amountYen: -i.amountYen!,
          productType: null,
          lineId: i.id,
          taxRate: i.taxRate,
        }))
      : [],
    expenseSubtype: null,
    ...(store === '' ? {} : { storeName: normalizeStoreName(store).name || store }),
  };
}

// ---- 下書き --------------------------------------------------------------------

export type CaptureDraft = {
  values: ManualEntryValues;
  /** 本人が触った項目(再読み取りの取り込みで上書きしないための印)。 */
  touched: CaptureField[];
};

export function parseDraft(raw: unknown): CaptureDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { values?: unknown; touched?: unknown };
  if (typeof r.values !== 'object' || r.values === null) return null;
  const v = r.values as Partial<ManualEntryValues>;
  if (typeof v.occurredOn !== 'string' || typeof v.storeName !== 'string') return null;
  return {
    values: {
      amountYen: typeof v.amountYen === 'number' ? v.amountYen : null,
      occurredOn: v.occurredOn,
      storeName: v.storeName,
      genreId: typeof v.genreId === 'string' ? v.genreId : null,
      accountId: typeof v.accountId === 'string' ? v.accountId : '',
      memo: typeof v.memo === 'string' ? v.memo : '',
      items: Array.isArray(v.items) ? (v.items as ManualItem[]) : [],
    },
    touched: Array.isArray(r.touched)
      ? (r.touched as unknown[]).filter((f): f is CaptureField =>
          (CAPTURE_FIELDS as readonly unknown[]).includes(f),
        )
      : [],
  };
}

/** 下書きに実質的な入力があるか(空の下書きは保存しない)。 */
export function draftHasInput(values: ManualEntryValues): boolean {
  return (
    values.amountYen !== null ||
    values.storeName.trim() !== '' ||
    values.memo.trim() !== '' ||
    values.items.length > 0 ||
    values.genreId !== null
  );
}
