/**
 * AIが出した記録の案(add_transaction)を、確認カードの上で直せるようにする(ADR-105)。
 * 案の中身を「記録する」と同じ形(種類・金額・カテゴリ・日付・レシート名・メモ)で持ち、
 * 直したら同じ関数で確認カードの文言とサーバーへ戻す入力を作り直す(サーバーと画面で文言がずれない)。
 * DBにもネットワークにも触れない(画面からも読み込める)。反映するときはサーバーがもう一度確かめる。
 */

import type { ProposedChange } from './plan';

export type RecordProposalKind = 'expense' | 'income' | 'refund';

export type ProposedRecord = {
  kind: RecordProposalKind;
  /** 正の数(支出も正で持つ)。 */
  amountYen: number;
  genreId: string | null;
  genreName: string | null;
  date: string;
  /** レシート名。AIが付けなかったら空(空なら、記録するときにカテゴリ名などが入る)。 */
  name: string;
  memo: string;
};

/**
 * お店の候補(過去の記録から、ADR-107)。確認カードのボタンを押すと、記録の名前をこのお店にし、
 * カテゴリはこのお店でいつも使うものにする(無ければそのまま)。
 */
export type StoreCandidate = { name: string; genreId: string | null; genreName: string | null };

const KIND_LABELS = { expense: '支出', income: '収入', refund: '返金' } as const;

/**
 * 記録される名前。レシート名が空なら「記録する」と同じ名前にする(収入は「収入」、返金は「〇〇の返金」、
 * 支出はカテゴリ名、カテゴリも無ければ「手入力」)。
 */
export function recordNameOf(r: ProposedRecord): string {
  const name = r.name.trim();
  if (name !== '') return name;
  if (r.kind === 'income') return '収入';
  if (r.kind === 'refund') return r.genreName ? `${r.genreName}の返金` : '返金';
  return r.genreName ?? '手入力';
}

/** 確認カードの2行目。「10月16日 支出 500円 · 食料品 · 予定 · メモ「…」」 */
export function recordDetailOf(r: ProposedRecord, today: string): string {
  const [, m, d] = r.date.split('-');
  const memo = r.memo.trim();
  return `${Number(m)}月${Number(d)}日 ${KIND_LABELS[r.kind]} ${r.amountYen.toLocaleString('ja-JP')}円${
    r.genreName ? ` · ${r.genreName}` : ''
  }${r.date > today ? ' · 予定' : ''}${memo ? ` · メモ「${memo}」` : ''}`;
}

/** サーバーへ戻す add_transaction の入力(反映するときに、サーバーがもう一度確かめる)。 */
export function recordInputOf(r: ProposedRecord): Record<string, unknown> {
  const name = r.name.trim();
  const memo = r.memo.trim();
  return {
    occurred_on: r.date,
    amount_yen: r.amountYen,
    kind: r.kind,
    ...(name !== '' ? { store_name: name } : {}),
    ...(r.genreName ? { genre_name: r.genreName } : {}),
    ...(memo !== '' ? { memo } : {}),
  };
}

/** 記録の案から、確認カードの1件を作る(AIが作ったときも、本人が直したときも同じ)。 */
export function recordChangeOf(r: ProposedRecord, today: string): ProposedChange {
  return {
    tool: 'add_transaction',
    input: recordInputOf(r),
    kind: 'created',
    target: recordNameOf(r),
    detail: recordDetailOf(r, today),
    record: r,
  };
}

/**
 * 「記録する」と同じ画面で直した値から、記録の案を作り直す。genreName はその画面で選んだカテゴリの名前
 * (選べるタイルに無いカテゴリのまま変えなかったときは、前の名前を使う)。収入はカテゴリを持たない。
 */
export function recordFromEdit(
  before: ProposedRecord,
  values: Omit<ProposedRecord, 'genreName'>,
  genreName: string | null,
): ProposedRecord {
  const keptName =
    values.genreId !== null && values.genreId === before.genreId ? before.genreName : null;
  const name = values.kind === 'income' ? null : (genreName ?? keptName);
  const next: ProposedRecord = {
    kind: values.kind,
    amountYen: values.amountYen,
    genreId: name === null ? null : values.genreId,
    genreName: name,
    date: values.date,
    name: values.name.trim(),
    memo: values.memo.trim(),
  };
  // レシート名を空のまま終えると、画面が記録すると同じ名前を入れて返す。空に戻しておき、
  // あとでカテゴリを変えたら名前もついてくるようにする。
  return next.name === recordNameOf({ ...next, name: '' }) ? { ...next, name: '' } : next;
}

/** お店の候補を選んだ記録(名前をそのお店に、カテゴリはそのお店でいつも使うもの)。 */
export function recordWithStore(r: ProposedRecord, store: StoreCandidate): ProposedRecord {
  return {
    ...r,
    name: store.name,
    ...(store.genreId !== null && store.genreName !== null
      ? { genreId: store.genreId, genreName: store.genreName }
      : {}),
  };
}
