/**
 * LINE で受け取った文字と、ボタン(ポストバック)の読み方(v4-2「LINEで完結」、ADR-130)。
 * DBにもネットワークにも触れない。
 *
 * 金額と言葉だけの短い文(「ランチ 1200」「コーヒー450円」)は、AIを使わずに決まった形で読む
 * (速く、費用もかからない)。読めないものだけ AI(アプリのAIタブと同じ)に回す。
 */

/** 1件で記録できる上限(円)。これを超える数字は記録ではなく、AIに回す。 */
export const MAX_LINE_RECORD_YEN = 10_000_000;

export type LineIntent =
  | { kind: 'record'; label: string; amountYen: number }
  | { kind: 'remaining' }
  | { kind: 'what_if'; amountYen: number }
  | { kind: 'check' }
  | { kind: 'ai'; text: string };

const yen = (digits: string): number | null => {
  const n = Number(digits.replace(/,/g, ''));
  return Number.isInteger(n) && n >= 1 && n <= MAX_LINE_RECORD_YEN ? n : null;
};

export function parseLineText(raw: string): LineIntent {
  const text = raw.normalize('NFKC').trim();
  const flat = text.replace(/\s+/g, ' ');

  if (/^(今日の)?答え合わせ(する|したい)?[!?。]*$/.test(flat)) return { kind: 'check' };
  if (
    /^(今日)?\s*(あと|残り|のこり)\s*(いくら|何円|なんえん)/.test(flat) ||
    /(今日|きょう).{0,6}(あと|残り|のこり).{0,4}(いくら|何円|なんえん)/.test(flat)
  ) {
    return { kind: 'remaining' };
  }

  const whatIf =
    flat.match(/^(?:今日)?\s*あと\s*[¥]?\s*(\d[\d,]*)\s*円?\s*(?:使|つか)/) ??
    flat.match(/^[¥]?\s*(\d[\d,]*)\s*円\s*(?:使|つか)\S*\s*(?:いい|大丈夫|平気|ok|OK|\?)/);
  if (whatIf) {
    const amount = yen(whatIf[1]!);
    if (amount !== null) return { kind: 'what_if', amountYen: amount };
  }

  // 質問は記録にしない(「1200円のランチどう？」など)。
  if (!/[?？]/.test(flat)) {
    const tail = flat.match(/^(.{1,40}?)\s*[¥]?\s*(\d[\d,]*)\s*円?$/);
    const head = flat.match(/^[¥]?\s*(\d[\d,]*)\s*円?\s+(.{1,40})$/);
    const label = (tail?.[1] ?? head?.[2] ?? '').trim();
    const digits = tail?.[2] ?? head?.[1];
    const amount = digits ? yen(digits) : null;
    if (amount !== null && label !== '' && !/^\d/.test(label) && !/\d$/.test(label)) {
      return { kind: 'record', label, amountYen: amount };
    }
  }
  return { kind: 'ai', text: raw.trim() };
}

/** ボタンが運ぶ値。受け取った側で本人の記録か・正しい値かを確かめてから使う。 */
export type LinePostback =
  | { action: 'undo'; id: string }
  | { action: 'genre'; id: string }
  | { action: 'set_genre'; id: string; genreId: string }
  | { action: 'check_sure' }
  | { action: 'plan'; amountYen: number }
  | { action: 'noop' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function postbackData(p: LinePostback): string {
  const params = new URLSearchParams({ a: p.action });
  if ('id' in p) params.set('id', p.id);
  if (p.action === 'set_genre') params.set('g', p.genreId);
  if (p.action === 'plan') params.set('y', String(p.amountYen));
  return params.toString();
}

export function parsePostback(data: string): LinePostback | null {
  const params = new URLSearchParams(data);
  const action = params.get('a');
  const id = params.get('id') ?? '';
  switch (action) {
    case 'undo':
    case 'genre':
      return UUID.test(id) ? { action, id } : null;
    case 'set_genre': {
      const genreId = params.get('g') ?? '';
      return UUID.test(id) && UUID.test(genreId) ? { action, id, genreId } : null;
    }
    case 'check_sure':
    case 'noop':
      return { action };
    case 'plan': {
      const amount = yen(params.get('y') ?? '');
      return amount === null ? null : { action, amountYen: amount };
    }
    default:
      return null;
  }
}

/** 夜の答え合わせ・「答え合わせ」の返事(件数・合計・最大3件の一覧。自信のないものには「？」)。 */
export function checkSummaryText(
  items: readonly {
    storeName: string;
    amountYen: number;
    genreName: string | null;
    unsure: boolean;
  }[],
): string {
  const total = items.reduce((sum, i) => sum + i.amountYen, 0);
  const lines = [
    `今日の答え合わせ ${items.length}件・合計 ${total.toLocaleString('ja-JP')}円`,
    ...items
      .slice(0, 3)
      .map(
        (i) =>
          `${i.unsure ? '？' : '・'}${i.storeName} ${i.amountYen.toLocaleString('ja-JP')}円(${i.genreName ?? '未分類'})`,
      ),
  ];
  if (items.length > 3) lines.push(`ほか${items.length - 3}件`);
  return lines.join('\n');
}

/**
 * 夜の答え合わせを今送るか(毎時の定期ジョブから呼ぶ、ADR-130)。設定の時刻(日本時間、既定 21:00)の
 * 「時」になったら、その日まだ送っていなければ送る。オフなら送らない。0件の日に送らないのは呼び出し側。
 */
export function isEveningCheckDue(input: {
  enabled: boolean;
  /** 'HH:MM' または 'HH:MM:SS'(app_settings.evening_check_at)。 */
  at: string;
  /** 日本時間の今の「時」(0〜23)。 */
  hourJst: number;
  sentToday: boolean;
}): boolean {
  if (!input.enabled || input.sentToday) return false;
  const hour = Number(input.at.slice(0, 2));
  return Number.isInteger(hour) && hour === input.hourJst;
}
