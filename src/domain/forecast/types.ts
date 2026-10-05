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

/** カテゴリごとの、予測の前から決まっている額(実績・予定・固定費)。 */
export type CategoryBase = {
  categoryId: string;
  categoryName: string;
  actualYen: number;
  scheduledYen: number;
  fixedYen: number;
};

/** 規則的に通う店(同じ店に、ほぼ決まった間隔で来店する)。変動費の学習からは外す。 */
export type RegularMerchant = {
  key: string;
  label: string;
  categoryId: string;
  categoryName: string;
  /** 来店の間隔(日、中央値)。 */
  everyDays: number;
  visitCount: number;
  lastVisit: DateOnly;
  meanYen: number;
  /** 1回の金額の対数正規(平均・標準偏差)。 */
  logMu: number;
  logSigma: number;
  /** 次回以降の来店が来る確率(間隔がそろっているほど高い)。 */
  probability: number;
};

/** 残り期間に見込まれる来店。日付ごとに、来る確率と金額の分布を持つ。 */
export type VisitEvent = {
  key: string;
  label: string;
  categoryId: string;
  date: DateOnly;
  probability: number;
  logMu: number;
  logSigma: number;
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
    /** 学習窓内の特別費(kind='special' + 外れ値)の金額一覧(再標本化の母集団、M2)。 */
    historicalAmounts: readonly number[];
    /** 学習窓の1日あたりの発生回数(ポアソン分布のλ、M2)。 */
    occurrencesPerDay: number;
  };
  /** 変動費のカテゴリ×日学習データ。 */
  variable: readonly VariableTrainingData[];
  /** カテゴリごとの、すでに決まっている額(実績・予定・固定費)。 */
  baseByCategory: readonly CategoryBase[];
  /** 規則的に通う店と、残り期間の来店の見込み。 */
  regularMerchants: readonly RegularMerchant[];
  visits: readonly VisitEvent[];
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
  /**
   * 対数正規の事後平均・分散(金額)。kappa は mu の確からしさ(相当する観測件数)。
   * 試行ごとに mu ~ Normal(mu, sigmaSq/kappa) を引き直し、データが少ないほど
   * 試行間で mu がばらつく(=帯が広がる)ようにする(M3)。
   */
  amountPosterior: { mu: number; sigmaSq: number; kappa: number };
  /** 曜日係数(0=日〜6=土)。1.0が「効果なし」。 */
  weekdayFactor: readonly number[];
  paydayFactor: number;
  holidayFactor: number;
  dataDays: number;
};

/** ブロック・ブートストラップ用の「1日ぶんの全カテゴリの実績」(M2)。 */
export type DayBundle = {
  date: DateOnly;
  /** 直近ほど大きい重み(半減期は学習時に決める)。ブートストラップの再標本化確率に使う。 */
  weight: number;
  amountsByCategory: ReadonlyMap<string, number>;
};

export type FittedModel = {
  categories: readonly CategoryModelParams[];
  dayBundles: readonly DayBundle[];
  /**
   * 月ごとの季節の係数(添字1〜12。1.0が平年並み)。12か月以上の記録があるときだけ
   * 1.0以外になり、残り期間の各日の回数に掛ける。
   */
  monthFactor: readonly number[];
  /** 季節の係数を使えたか(記録が12か月に満たなければ false)。 */
  seasonal: boolean;
  /** 全体で見た1日あたりの回数(カテゴリ横断の事前分布の中心)。 */
  pooledDailyRate: number;
  dataDays: number;
};

export type Band = { p10: number; p50: number; p70: number; p90: number };

export type ForecastCategoryBand = {
  categoryId: string;
  categoryName: string;
  /** 残り期間の変動費だけの幅。 */
  p10: number;
  p50: number;
  p90: number;
  /** 期間全体の着地(実績 + 予定 + 固定費 + 残りの変動費)の幅。 */
  landing: Band;
  /** 予測の前から決まっている額(実績・予定・固定費)と、その内訳。 */
  baseYen: number;
  actualYen: number;
  scheduledYen: number;
  fixedYen: number;
  /** 目標額と、それを超える確率(目標が無ければ null)。 */
  targetYen: number | null;
  exceedance: number | null;
};

export type ForecastDriver = { categoryId: string; categoryName: string; shareOfRisk: number };

export type Forecast = {
  periodId: string;
  asOf: DateOnly;
  remainingDays: number;
  total: Band & { mean: number };
  byCategory: readonly ForecastCategoryBand[];
  committed: { scheduledYen: number; fixedYen: number };
  /** 規則的に通う店の、残り期間の見込み(期待額と店ごとの内訳)。 */
  visits: {
    expectedYen: number;
    merchants: readonly {
      label: string;
      everyDays: number;
      probability: number;
      meanYen: number;
    }[];
  };
  /** 季節の係数を使ったか、期間の月の係数。 */
  seasonal: { active: boolean; periodFactor: number | null };
  special: { expected: number; p90: number };
  probWithinBudget: number | null;
  expectedOvershoot: number;
  drivers: readonly ForecastDriver[];
  safeDailyAllowance: number | null;
  status: 'learning' | 'ready';
  dataDays: number;
  method: 'bayes' | 'bootstrap' | 'ensemble' | 'mixed';
  calibration: { widthFactor: number; sampleSize: number; centerFactor: number } | null;
};
