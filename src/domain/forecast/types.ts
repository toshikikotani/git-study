import type { DateOnly } from '@/lib/date';

/**
 * カテゴリ×日の学習データ1行。支出が無い日も count=0, amountYen=0 で持つ。
 * logSum・logSqSum は1回ごとの金額の対数の和と二乗和(無ければ、その日の平均額から近似する)。
 */
export type CategoryDayRecord = {
  date: DateOnly;
  count: number;
  amountYen: number;
  logSum?: number;
  logSqSum?: number;
};

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

/** カテゴリごとの、予測の前から決まっている額(実績・予定・固定費)。特別費も含む。 */
export type CategoryBase = {
  categoryId: string;
  categoryName: string;
  actualYen: number;
  scheduledYen: number;
  fixedYen: number;
};

/** 日付の決まった支払い(予定・確認済みの固定費)。試行によらず、その日に足す。 */
export type DatedEvent = {
  date: DateOnly;
  categoryId: string;
  amountYen: number;
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

/**
 * 残り期間に見込まれる、確率つきの支払い(規則的な来店・月払いの請求)。
 * fixedYen があれば金額はその値(毎回ほぼ同じ請求)、無ければ対数正規から引く。
 */
export type ProbableEvent = {
  key: string;
  label: string;
  categoryId: string;
  date: DateOnly;
  probability: number;
  logMu: number;
  logSigma: number;
  fixedYen: number | null;
};

/** @deprecated 名前の互換。ProbableEvent と同じ。 */
export type VisitEvent = ProbableEvent;

/** 月払いの請求(電気・ガス・カードの年会費の月割りなど、ほぼ毎月同じ日ごろに来る支払い)。 */
export type MonthlyBill = {
  key: string;
  label: string;
  categoryId: string;
  categoryName: string;
  lastPaid: DateOnly;
  occurrences: number;
  meanYen: number;
  probability: number;
  fixedYen: number | null;
};

/** 期間に入ってから今日までに記録された変動費(今月の水準と金額の更新に使う)。 */
export type PeriodObservation = {
  categoryId: string;
  count: number;
  /** 1回ごとの金額の対数。 */
  logAmounts: readonly number[];
};

export type DecomposedSpending = {
  trainingWindow: { from: DateOnly; to: DateOnly };
  period: { from: DateOnly; to: DateOnly };
  today: DateOnly;
  /** 実績:期間内の今日までに記録された支出(特別費も含む)。 */
  actualYen: number;
  /** 確定:予定支出(特別費も含む) + 残り期間に見込まれる固定費。日付ごとの内訳も持つ。 */
  committed: {
    scheduledYen: number;
    fixedYen: number;
    fixedItems: readonly { key: string; label: string; amountYen: number; occurrences: number }[];
    events: readonly DatedEvent[];
  };
  /** 特別:特別費(kind='special')の実績・予定と、外れ値として除外した候補。 */
  special: {
    actualYen: number;
    scheduledYen: number;
    excluded: readonly OutlierExclusion[];
    /** 学習窓内の特別費(kind='special' + 外れ値)の金額一覧(再標本化の母集団)。 */
    historicalAmounts: readonly number[];
    /** 学習窓の1日あたりの発生回数(ポアソン分布のλ)。 */
    occurrencesPerDay: number;
  };
  /** 変動費のカテゴリ×日学習データ。 */
  variable: readonly VariableTrainingData[];
  /** カテゴリごとの、すでに決まっている額(実績・予定・固定費)。 */
  baseByCategory: readonly CategoryBase[];
  /** 規則的に通う店と、残り期間の来店の見込み。 */
  regularMerchants: readonly RegularMerchant[];
  visits: readonly ProbableEvent[];
  /** 月払いの請求と、残り期間の見込み。 */
  bills: readonly MonthlyBill[];
  billEvents: readonly ProbableEvent[];
  /**
   * 期間の学習を、期間の前の記録だけで行ったか(true)。そのとき期間に入ってからの記録は
   * periodObservations として、今月の水準と金額の更新にだけ使う(二重に数えない)。
   */
  separatedPeriod: boolean;
  periodObservations: readonly PeriodObservation[];
  /** 期間の初日〜今日のうち、記録のある期間に入る日(水準の更新の分母)。 */
  elapsedDates: readonly DateOnly[];
  /**
   * 入力の遅れ:使った日から j 日後までに記録された割合 D(j)(j=0..30)。記録日時が
   * 足りなければ null(遅れなしとみなす)。
   */
  entryLag: readonly number[] | null;
  /** 直近14日の1日あたりの支出(固定費・予測を止めたジャンルを除く)。記録が無ければ null。 */
  recentPerDayYen: number | null;
  /** カテゴリごとの支出の型(設計書 v3 4.1)。 */
  categoryTypes: Readonly<Record<string, SpendingType>>;
  missingRecordDays: readonly MissingRecordDay[];
  /** 学習に使えた実際の日数(記録開始日・学習窓の短い方)。 */
  dataDays: number;
};

/** 給料日からの日数の区分(0〜2・3〜6・7〜13・14〜20・21日以上)の数。 */
export const PAY_CYCLE_BUCKETS = 5;

/** カテゴリごとに推定したモデルのパラメータ。 */
export type CategoryModelParams = {
  categoryId: string;
  categoryName: string;
  /** ガンマ・ポアソン事後分布(回数)。lambda ~ Gamma(alpha, beta)(rateパラメータ化)。 */
  countPosterior: { alpha: number; beta: number };
  /**
   * 対数正規の事後平均・分散(金額)。kappa は mu の確からしさ(相当する観測件数)。
   * 試行ごとに mu を引き直し、データが少ないほど試行間で mu がばらつくようにする。
   */
  amountPosterior: { mu: number; sigmaSq: number; kappa: number };
  /** 月ごとの1回の金額(対数の平均)の揺れの大きさ τ²(今月の金額の更新に使う)。 */
  monthTauSq: number;
  /**
   * 休み(土日祝)の1回の金額が平日よりどれだけ大きいか(対数の差、0=差なし)と、記録の中で
   * 休みの日の買い物が占める割合。差は、観測が少ないほど0へ寄せる。
   */
  dayOffAmount: { delta: number; share: number };
  /** 曜日係数(0=日〜6=土)。1.0が「効果なし」。 */
  weekdayFactor: readonly number[];
  /** 給料日からの日数の区分ごとの係数(PAY_CYCLE_BUCKETS 個)。給料日が無ければすべて1。 */
  payCycleFactor: readonly number[];
  holidayFactor: number;
  dataDays: number;
};

export type FittedModel = {
  categories: readonly CategoryModelParams[];
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

/** グラフの予測の線:今日より先の各日までに、今日の実績へ足される額(予定・固定費・請求を含む)。 */
export type PathPoint = {
  date: DateOnly;
  p10: number;
  /** 10回中5回の帯(25〜75%)。グラフの濃い帯(設計書 v3 3.4)。 */
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

/**
 * 支出の型(設計書 v3 4.1)。定常型=月に4回以上、間がそろっている(注意の対象)。
 * まとまり型=月に2回未満、またはまとめて払う(旅行・家電など)。決まった型=固定費・請求・
 * 予測を止めたもの(注意は出さない)。
 */
export type SpendingType = 'steady' | 'lumpy' | 'fixed';

/**
 * 理想の線の形:各日までに決まっている支払い(予定・固定費・請求の見込み)の累計と、
 * いつもの使い方での変動費の累計の割合(期間の初日0 → 最終日1)。
 */
export type TypicalProfilePoint = { date: DateOnly; committedYen: number; share: number };

export type ForecastCategoryBand = {
  categoryId: string;
  categoryName: string;
  /** 残り期間の変動する部分(変動費・来店・請求・特別費・未記録)だけの幅。 */
  p10: number;
  p50: number;
  p90: number;
  /** 期間全体の着地(実績 + 予定 + 固定費 + 残り)の幅。 */
  landing: Band;
  /** 予測の前から決まっている額(実績・予定・固定費)と、その内訳。 */
  baseYen: number;
  actualYen: number;
  scheduledYen: number;
  fixedYen: number;
  /** 目標額と、それを超える確率(目標が無ければ null)。 */
  targetYen: number | null;
  exceedance: number | null;
  /** 残りの変動する部分の平均(内訳の配分に使う)。 */
  meanYen: number;
  /** 残りの期間に見込まれる回数(変動費の部分。学習できないカテゴリは0)。 */
  expectedCount: number;
  type: SpendingType;
};

/**
 * 提案を1つ(設計書 v3 3.1・3.6):回数を週1回減らしたときの、予算に収まる確率と浮く額。
 * 試行を回し直さず、同じ試行のそのカテゴリの額に倍率を掛けて出す(目安)。
 */
export type ForecastSuggestion = {
  categoryId: string;
  categoryName: string;
  perWeek: number;
  savedYen: number;
  probBefore: number;
  probAfter: number;
};

/**
 * 着地の積み上げ(設計書 v3 3.5)。中央値どうしは足し算にならないので、残り全体は中央値で、
 * その内訳は平均の比で配る。合計は必ず total.p50 と同じ。
 */
export type ForecastBreakdown = {
  actualYen: number;
  committedYen: number;
  visitsYen: number;
  billsYen: number;
  unrecordedYen: number;
  specialYen: number;
  variableYen: number;
  totalYen: number;
  /** 残りの変動費のジャンル別(平均の比で配った額)。 */
  variableByCategory: readonly { categoryId: string; categoryName: string; yen: number }[];
};

export type ForecastDriver = { categoryId: string; categoryName: string; shareOfRisk: number };

/** 検証で求めた補正(中心は期間の時点帯ごと、幅は PIT の分布)。 */
export type ForecastCalibration = {
  /** 時点帯(序盤・中盤・終盤)ごとの、残りの支出に掛ける係数。 */
  centerByPhase: { early: number; mid: number; late: number };
  /** 検証の各時点で、実際の着地が予測分布のどこに入ったか(0〜1、昇順)。 */
  pit: readonly number[];
  /**
   * 時点帯ごとの PIT(序盤は広すぎ、中盤は狭すぎ、のように時点で外れ方が違うため)。
   * 点が少ない帯は、全体の pit と同じ。
   */
  pitByPhase: { early: readonly number[]; mid: readonly number[]; late: readonly number[] };
  /** PIT をどれだけ信じるか a = 月数 ÷ (月数 + 6)。 */
  pitWeight: number;
  /** 検証に使えた完了月の数。 */
  months: number;
  sampleSize: number;
};

export type Forecast = {
  periodId: string;
  asOf: DateOnly;
  remainingDays: number;
  /** 着地。p10〜p90 と中央値は補正後の分位(見出しは中央値)。mean は補正後の試行の平均。 */
  total: Band & { mean: number };
  /** グラフの線と帯(同じ試行の、日ごとの分位)。最終日の値 + 実績 = total。 */
  path: readonly PathPoint[];
  /** 理想の線の形(期間全体)。 */
  typicalProfile: readonly TypicalProfilePoint[];
  byCategory: readonly ForecastCategoryBand[];
  committed: { scheduledYen: number; fixedYen: number };
  /** 今日までの実績(特別費も含む)。 */
  actualYen: number;
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
  /** 月払いの請求の、残り期間の見込み。 */
  bills: { expectedYen: number; items: readonly { label: string; meanYen: number }[] };
  /** まだ記録されていない支出の見込み(入力の遅れから)。 */
  unrecordedYen: number;
  /** 残りの期間の見込み(中央)と1日あたり、直近のペース。 */
  pace: { remainingYen: number; perDayYen: number | null; recentPerDayYen: number | null };
  /** 季節の係数を使ったか、期間の月の係数。 */
  seasonal: { active: boolean; periodFactor: number | null };
  special: { expected: number; p90: number };
  probWithinBudget: number | null;
  expectedOvershoot: number;
  drivers: readonly ForecastDriver[];
  safeDailyAllowance: number | null;
  suggestion: ForecastSuggestion | null;
  breakdown: ForecastBreakdown;
  status: 'learning' | 'ready';
  dataDays: number;
  /** 今日が期間のどの時点帯か(中心の補正に使った帯)。 */
  phase: ForecastPhase;
  calibration: ForecastCalibration | null;
  /** 検証できた月が3か月未満なら true(画面に「目安」と出す)。 */
  provisional: boolean;
  /** 収入と収支(収入が分かるときだけ)。収支 = 収入 − 着地。 */
  balance: {
    incomeYen: number;
    source: 'setting' | 'salary' | 'none';
    p10: number;
    p50: number;
    p90: number;
  } | null;
};

export type ForecastPhase = 'early' | 'mid' | 'late';
