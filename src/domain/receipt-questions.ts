/**
 * レシートの確認で、何を聞くか・どの順で聞くか(v5 変更5、ADR-133)。
 *
 * 項目ごとに「間違えたときの痛さ」を決め、読み取りの自信と組み合わせて
 * 「必ず聞く(must)・聞く(ask)・聞かない(skip)」に分ける。
 *   must : 答えるまで「保存」を押せない
 *   ask  : 上に出すが、答えずに保存すると「合っている」とみなす
 *   skip : 要約にそのまま入れる(押せば直せる)
 *
 * 自信の分け方:自信あり ≥ 0.9、少し不安 0.7〜0.9、自信なし < 0.7(確認画面の 0.7 と、
 * カテゴリの予測の 0.9 をそのまま使う)。DB にも画面にも触れない純粋関数。
 */

export type ConfidenceBand = 'sure' | 'unsure' | 'doubt';

/** 自信あり / 少し不安 の境目。 */
export const SURE_CONFIDENCE = 0.9;
/** 少し不安 / 自信なし の境目。 */
export const DOUBT_CONFIDENCE = 0.7;

/** 自信(0〜1)を3つに分ける。自信が返ってこなかった項目は「自信あり」(いままでどおり聞かない)。 */
export function bandOf(confidence: number | null | undefined): ConfidenceBand {
  if (confidence === null || confidence === undefined || Number.isNaN(confidence)) return 'sure';
  if (confidence >= SURE_CONFIDENCE) return 'sure';
  if (confidence >= DOUBT_CONFIDENCE) return 'unsure';
  return 'doubt';
}

/** 確かめる細かさ(レシートの設定)。既定は「ふつう」。 */
export type CheckLevel = 'thorough' | 'normal' | 'light';
export const CHECK_LEVELS: readonly CheckLevel[] = ['thorough', 'normal', 'light'];
export const CHECK_LEVEL_LABEL: Record<CheckLevel, string> = {
  thorough: 'しっかり',
  normal: 'ふつう',
  light: '少なめ',
};
export const CHECK_LEVEL_SUB: Record<CheckLevel, string> = {
  thorough: '少し不安なものも、すべて必ず聞く',
  normal: 'カテゴリと合計は自信がないときだけ必ず聞く',
  light: '自信のないカテゴリと合計だけを聞く',
};

export function parseCheckLevel(value: unknown): CheckLevel {
  return value === 'thorough' || value === 'light' ? value : 'normal';
}

export type Ask = 'skip' | 'ask' | 'must';
export type QuestionField = 'category' | 'total' | 'date' | 'account' | 'store' | 'item';

/** 間違えたときの痛さ(大きいほど痛い)。自信が同じくらいのとき、痛いほうを先に聞く。 */
export const PAIN: Record<QuestionField, number> = {
  category: 3,
  total: 3,
  date: 2,
  account: 2,
  store: 1,
  item: 1,
};

/**
 * 「ふつう」の表(項目 × 自信 → 聞き方)。
 *   カテゴリ:聞かない / 聞く(おすすめを当てておく)/ 必ず選ぶ(何も当てない)
 *   合計    :聞かない / 聞く / 必ず聞く
 *   日付    :聞かない / 聞く(期をまたぐなら必ず)/ 必ず聞く
 *   支払い  :聞かない / 聞かない / 聞く
 *   お店    :聞かない / 聞かない / 聞く
 *   品目    :聞かない / 聞かない / 合計と合わないときだけ聞く
 */
function normalAsk(field: QuestionField, band: ConfidenceBand, ctx: AskContext): Ask {
  if (band === 'sure') return 'skip';
  switch (field) {
    case 'category':
    case 'total':
      return band === 'unsure' ? 'ask' : 'must';
    case 'date':
      return band === 'doubt' || ctx.crossesPeriod ? 'must' : 'ask';
    case 'account':
    case 'store':
      return band === 'doubt' ? 'ask' : 'skip';
    case 'item':
      return band === 'doubt' && ctx.itemsMismatch ? 'ask' : 'skip';
  }
}

export type AskContext = {
  /** 日付の候補が目標の期間をまたぐ(間違えると別の期に数えてしまう)。 */
  crossesPeriod?: boolean;
  /** 品目の合計と合計が合っていない。 */
  itemsMismatch?: boolean;
};

/** 項目の聞き方を決める(確かめる細かさで変える)。 */
export function askFor(
  field: QuestionField,
  band: ConfidenceBand,
  level: CheckLevel,
  ctx: AskContext = {},
): Ask {
  if (level === 'light') {
    // 少なめ:必ず聞くのは、自信なしのカテゴリと自信なしの合計だけ。ほかは聞かない。
    return (field === 'category' || field === 'total') && band === 'doubt' ? 'must' : 'skip';
  }
  if (level === 'thorough') {
    // しっかり:少し不安なものも、すべて必ず聞く(品目は合計と合わないときだけ)。
    if (band === 'sure') return 'skip';
    if (field === 'item') return ctx.itemsMismatch ? 'must' : 'skip';
    return 'must';
  }
  return normalAsk(field, band, ctx);
}

export type QuestionInput = {
  id: string;
  field: QuestionField;
  confidence: number;
  ctx?: AskContext;
};

export type OrderedQuestion<T extends QuestionInput = QuestionInput> = T & {
  ask: Exclude<Ask, 'skip'>;
};

/** 自信が同じくらい(この幅に入る)なら、痛さで並べる。 */
const SAME_CONFIDENCE_STEP = 0.05;

/**
 * 聞くものを選んで並べる:「必ず聞く」を先に、その中は自信の低い順。続けて「聞く」を、自信の低い順。
 * 自信が同じくらいなら、痛さの大きいほうを先にする。
 */
export function orderQuestions<T extends QuestionInput>(
  inputs: readonly T[],
  level: CheckLevel,
): OrderedQuestion<T>[] {
  const asked = inputs.flatMap((q) => {
    const ask = askFor(q.field, bandOf(q.confidence), level, q.ctx);
    return ask === 'skip' ? [] : [{ ...q, ask }];
  });
  const bucket = (c: number) => Math.floor(c / SAME_CONFIDENCE_STEP + 1e-9);
  return asked.sort(
    (a, b) =>
      (a.ask === 'must' ? 0 : 1) - (b.ask === 'must' ? 0 : 1) ||
      bucket(a.confidence) - bucket(b.confidence) ||
      PAIN[b.field] - PAIN[a.field] ||
      a.confidence - b.confidence,
  );
}

/** カテゴリの予測の出どころごとの自信(v5 変更5)。 */
export const CATEGORY_SOURCE_CONFIDENCE = {
  /** 自分で決めたルール。 */
  rule: 1,
  /** 品名の辞書。 */
  dictionary: 0.8,
  /** お店の種類だけ。 */
  store_type: 0.6,
  /** よく使うだけ(ほかに手がかりがない)。 */
  frequency: 0.3,
} as const;

/** 品目の合計と合計が合えば、合計は「自信あり」に上げる。 */
export function totalConfidence(read: number | null | undefined, itemsMatch: boolean): number {
  if (itemsMatch) return 1;
  return read ?? 1;
}
