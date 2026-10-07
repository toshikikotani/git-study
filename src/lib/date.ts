/**
 * 日付の扱いを1箇所に閉じ込める(ADR-015)。
 *
 * Vercel は UTC、本人の端末は JST。素の Date を使うと深夜の取引が前日に計上され、
 * 金額と日付がずれる。この種の不具合は発見が遅い。
 *
 * 規約:
 *   - 「今日」「今月」は必ず JST で判定する
 *   - 日付は 'YYYY-MM-DD' 文字列(DateOnly)で持ち回る。DB の date 列と同じ形
 *   - new Date() を domain/ や features/ で直接呼ばない。ここを経由する
 */

export const TIMEZONE = 'Asia/Tokyo';

/** 'YYYY-MM-DD'。DB の date 列と1対1で対応する。 */
export type DateOnly = string;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const jstFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const jstTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function assertDateOnly(value: string): DateOnly {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error(`日付は YYYY-MM-DD 形式である必要があります: ${value}`);
  }
  return value;
}

/** JST における今日。引数で基準時刻を渡せるようにして、テストを決定的にする。 */
export function todayJst(now: Date = new Date()): DateOnly {
  // en-CA ロケールは YYYY-MM-DD を返す
  return jstFormatter.format(now);
}

/** JST における当月の初日。offsetMonths で前後の月を取る。 */
export function monthStartJst(offsetMonths = 0, now: Date = new Date()): DateOnly {
  const [year, month] = splitDateOnly(todayJst(now));
  return addMonthsToParts(year, month, 1, offsetMonths);
}

/** 'YYYY-MM-DD' を [年, 月, 日] に分解する。 */
export function splitDateOnly(date: DateOnly): [number, number, number] {
  assertDateOnly(date);
  const [y, m, d] = date.split('-');
  return [Number(y), Number(m), Number(d)];
}

/**
 * 月を加算する。日付は指定した day に固定する。
 * 月末差異(31日 → 2月)を避けたい呼び出し側は day に 28 以下を渡す。
 */
export function addMonthsToParts(
  year: number,
  month: number,
  day: number,
  offsetMonths: number,
): DateOnly {
  const zeroBased = year * 12 + (month - 1) + offsetMonths;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12) + 1;
  const daysInMonth = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  const safeDay = Math.min(day, daysInMonth);
  return `${pad(newYear, 4)}-${pad(newMonth, 2)}-${pad(safeDay, 2)}`;
}

/** DateOnly に月を足す。 */
export function addMonths(date: DateOnly, offsetMonths: number): DateOnly {
  const [y, m, d] = splitDateOnly(date);
  return addMonthsToParts(y, m, d, offsetMonths);
}

/**
 * date を含む月の n 日目(月末に無い日は月末に丸める、ADR-015と同じ考え方)。
 * 給料日・締め日のような「毎月のn日目」全般に使う汎用の計算(同じ計算を
 * 給料日サイクル(paydayCycleFor)と締め日サイクル(billingCycleStartFor 等)の
 * 両方から使うため、片方の名前(旧 paydayInMonthOf)に固定しない)。
 */
export function nthDayOfMonth(date: DateOnly, day: number): DateOnly {
  const [year, month] = splitDateOnly(date);
  return addMonthsToParts(year, month, day, 0);
}

/**
 * 給料日〜次の給料日前日までの期間(FR-17, M6-3)。
 *
 * 保存は暦月のまま(ADR-015)で、ここは表示のためだけに給料日基準の期間へ
 * 変換する純粋関数。today が今月の給料日以降なら「今月の給料日〜来月の給料日前日」、
 * まだなら「先月の給料日〜今月の給料日前日」を返す。
 */
export function paydayCycleFor(
  today: DateOnly,
  payday: number,
): { startOn: DateOnly; endOn: DateOnly } {
  const currentPayday = nthDayOfMonth(today, payday);

  if (today >= currentPayday) {
    const nextPayday = nthDayOfMonth(addMonths(today, 1), payday);
    return { startOn: currentPayday, endOn: addDays(nextPayday, -1) };
  }
  const previousPayday = nthDayOfMonth(addMonths(today, -1), payday);
  return { startOn: previousPayday, endOn: addDays(currentPayday, -1) };
}

/**
 * closingDay 起点の請求サイクルで、endOn を含む締め回の開始日
 * (前回の締め日の翌日、FR-18, M6-4)。
 */
export function billingCycleStartFor(endOn: DateOnly, closingDay: number): DateOnly {
  const previousClosing = nthDayOfMonth(addMonths(endOn, -1), closingDay);
  return addDays(previousClosing, 1);
}

/**
 * closingDay 起点で、today 時点までに直近で締まった請求サイクルの終了日
 * (FR-18, M6-4)。メールに締め日の記載が無いときのフォールバックに使う。
 */
export function mostRecentClosingOnOrBefore(today: DateOnly, closingDay: number): DateOnly {
  const thisMonthClosing = nthDayOfMonth(today, closingDay);
  return today >= thisMonthClosing
    ? thisMonthClosing
    : nthDayOfMonth(addMonths(today, -1), closingDay);
}

/** 曜日(0=日〜6=土)。カレンダーのグリッド組みに使う(本人発案、ADR-043)。 */
export function weekdayOf(date: DateOnly): number {
  const [y, m, d] = splitDateOnly(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** DateOnly に日を足す。 */
export function addDays(date: DateOnly, days: number): DateOnly {
  const [y, m, d] = splitDateOnly(date);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1, 2)}-${pad(
    shifted.getUTCDate(),
    2,
  )}`;
}

/** from から to までの日数。to が後なら正。 */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  const [fy, fm, fd] = splitDateOnly(from);
  const [ty, tm, td] = splitDateOnly(to);
  const msPerDay = 86_400_000;
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / msPerDay);
}

/** 表示用。「2026年9月8日」 */
export function formatDateJa(date: DateOnly): string {
  const [y, m, d] = splitDateOnly(date);
  return `${y}年${m}月${d}日`;
}

/** グラフの軸ラベル用。'2026-09' → 「9月」 */
export function formatMonthJa(monthKey: string): string {
  return `${Number(monthKey.slice(5, 7))}月`;
}

/**
 * 表示用の時刻(JST、'13:40')。ADR-029:画面は一度読み込んだ内容を
 * そのまま保持し、pull-to-refresh でしか最新化しないため、
 * 「いつ時点の数字か」を示す最終更新時刻の表示に使う。
 */
export function formatTimeJa(now: Date = new Date()): string {
  return jstTimeFormatter.format(now);
}

const jstHourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hour: 'numeric',
  hour12: false,
});

/**
 * JST の時(0〜23)。サーバーは UTC で動くため(Vercel)、`new Date().getHours()`
 * のような素の Date メソッドはサーバー環境のタイムゾーンに依存してしまう
 * ——「いつもの」予測(N2)の時間帯判定など、JST の時刻そのものが要る場面で使う。
 */
export function hourJst(now: Date = new Date()): number {
  const formatted = jstHourFormatter.format(now);
  // hour12: false でも en-US ロケールは深夜0時を "24" と表す実装があるため丸める。
  return Number(formatted) % 24;
}

/**
 * 「何日」という日にち番号(1〜31)として妥当か。
 * DateOnly ではなく、給料日・締め日のような整数入力の検証に使う
 * (29〜31 を指定した月に日が無ければ、計算側が丸めて扱う。ここでは範囲だけを見る)。
 */
export function isValidDayOfMonth(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 31;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * URL などの外から来た値を日付として読む。形式が正しくない・存在しない日付・文字列でない
 * 値は fallback にする(URL は本人が書き換えられるため信用しない)。
 */
export function parseDateOnlyOr(value: unknown, fallback: DateOnly): DateOnly {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) return fallback;
  // 形式が合っていても 2026-02-31 のような存在しない日付があるため、暦として確かめる。
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const exists =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  return exists ? value : fallback;
}

/**
 * 'YYYY-MM-DD' を、その日のローカル正午の Date にする(カレンダー部品向け)。
 * UTC 0時で作ると、UTC より西のタイムゾーンでは前日に見えるため使わない。
 */
export function dateOnlyToLocalDate(date: DateOnly): Date {
  const [year, month, day] = splitDateOnly(date);
  return new Date(year, month - 1, day, 12);
}

/** ローカルの Date が指す日を 'YYYY-MM-DD' にする(toISOString は UTC になるため使わない)。 */
export function localDateToDateOnly(date: Date): DateOnly {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}
