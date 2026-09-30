import type { DateOnly } from '@/lib/date';

/** カテゴリ×日の学習データ1行。支出が無い日も count=0, amountYen=0 で持つ(M1)。 */
export type CategoryDayRecord = { date: DateOnly; count: number; amountYen: number };

export type VariableTrainingData = {
  categoryId: string;
  categoryName: string;
  days: readonly CategoryDayRecord[];
};

export type OutlierExclusion = {
  categoryId: string;
  categoryName: string;
  occurredOn: DateOnly;
  amountYen: number;
};

export type MissingRecordDay = {
  date: DateOnly;
  weekday: number;
  categoryId: string;
  categoryName: string;
};

export type DecomposedSpending = {
  trainingWindow: { from: DateOnly; to: DateOnly };
  period: { from: DateOnly; to: DateOnly };
  today: DateOnly;
  /** 実績:今日までに記録された通常支出(入力待ちは含めない)。 */
  actualYen: number;
  /** 確定:予定支出 + 残り期間に見込まれる固定費。 */
  committed: {
    scheduledYen: number;
    fixedYen: number;
    fixedItems: readonly { key: string; label: string; amountYen: number; occurrences: number }[];
  };
  /** 特別:特別費(kind='special')の実績・予定と、外れ値として除外した候補。 */
  special: {
    actualYen: number;
    scheduledYen: number;
    excluded: readonly OutlierExclusion[];
  };
  /** 変動費のカテゴリ×日学習データ。 */
  variable: readonly VariableTrainingData[];
  missingRecordDays: readonly MissingRecordDay[];
  /** 学習に使えた実際の日数(記録開始日・学習窓の短い方)。 */
  dataDays: number;
};

/** M2: カテゴリごとに推定したモデルのパラメータ。 */
export type CategoryModelParams = {
  categoryId: string;
  categoryName: string;
  /** ガンマ・ポアソン事後分布(回数)。lambda ~ Gamma(alphaPost, betaPost)(rateパラメータ化)。 */
  countPosterior: { alpha: number; beta: number };
  /** 対数正規の事後平均・分散(金額)。 */
  amountPosterior: { mu: number; sigmaSq: number };
  /** 曜日係数(0=日〜6=土)。1.0が「効果なし」。 */
  weekdayFactor: readonly number[];
  paydayFactor: number;
  holidayFactor: number;
  dataDays: number;
};

/** ブロック・ブートストラップ用の「1日ぶんの全カテゴリの実績」(M2)。 */
export type DayBundle = {
  date: DateOnly;
  /** 直近ほど大きい重み(半減期30日)。ブートストラップの再標本化確率に使う。 */
  weight: number;
  amountsByCategory: ReadonlyMap<string, number>;
};

export type FittedModel = {
  categories: readonly CategoryModelParams[];
  dayBundles: readonly DayBundle[];
  /** 全体で見た1日あたりの回数(カテゴリ横断の事前分布の中心)。 */
  pooledDailyRate: number;
  dataDays: number;
};

export type ForecastCategoryBand = {
  categoryId: string;
  categoryName: string;
  p10: number;
  p50: number;
  p90: number;
};

export type ForecastDriver = { categoryId: string; categoryName: string; shareOfRisk: number };

export type Forecast = {
  periodId: string;
  asOf: DateOnly;
  remainingDays: number;
  total: { p10: number; p50: number; p90: number; mean: number };
  byCategory: readonly ForecastCategoryBand[];
  committed: { scheduledYen: number; fixedYen: number };
  special: { expected: number; p90: number };
  probWithinBudget: number | null;
  expectedOvershoot: number;
  drivers: readonly ForecastDriver[];
  safeDailyAllowance: number | null;
  status: 'learning' | 'ready';
  dataDays: number;
  method: 'bayes' | 'bootstrap' | 'ensemble' | 'mixed';
  calibration: { widthFactor: number; sampleSize: number } | null;
};
