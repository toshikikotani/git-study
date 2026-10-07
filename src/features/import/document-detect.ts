/**
 * レシートの輪郭の自動検出と、自動撮影の判定(ブラウザのカメラ映像用の純粋関数)。
 *
 * 映像を縮小した輝度(グレースケール)の配列だけを受け取る。DOM・canvas には
 * 触れないため、単体テストできる。
 *
 * 方式:大津の二値化で「明るい紙」と背景を分け、行・列ごとの明るい画素の割合から
 * 外接の矩形を求める。斜めに置かれたレシートの遠近補正(台形補正)は行わず、
 * 外接矩形で撮影のタイミングとトリミングを決める(DECISIONS.md のフォールバック)。
 */

export type GrayImage = { width: number; height: number; data: ArrayLike<number> };

/** 正規化(0〜1)した矩形。 */
export type Box = { x0: number; y0: number; x1: number; y1: number };

export type Detection = {
  box: Box;
  /** 画面に占める面積の割合。 */
  coverage: number;
  /** 紙と背景の分離の良さ(0〜1)。 */
  confidence: number;
};

/** 大津の方法でしきい値を求める。 */
export function otsuThreshold(gray: GrayImage): number {
  const hist = new Array<number>(256).fill(0);
  const n = gray.width * gray.height;
  for (let i = 0; i < n; i += 1) hist[Math.max(0, Math.min(255, Math.round(gray.data[i]!)))]! += 1;
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * hist[t]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

const MIN_COVERAGE = 0.12;
const MIN_FILL = 0.55;

/** レシート(明るい紙)の外接矩形を探す。見つからなければ null。 */
export function detectDocument(gray: GrayImage): Detection | null {
  const { width: w, height: h, data } = gray;
  if (w < 8 || h < 8) return null;
  const threshold = otsuThreshold(gray);

  // 平均輝度の差が小さい(一様な画面)なら紙と背景の区別が無い。
  let brightSum = 0;
  let brightN = 0;
  let darkSum = 0;
  let darkN = 0;
  for (let i = 0; i < w * h; i += 1) {
    if (data[i]! > threshold) {
      brightSum += data[i]!;
      brightN += 1;
    } else {
      darkSum += data[i]!;
      darkN += 1;
    }
  }
  if (brightN === 0 || darkN === 0) return null;
  const separation = (brightSum / brightN - darkSum / darkN) / 255;
  if (separation < 0.15) return null;

  const rowBright = new Array<number>(h).fill(0);
  const colBright = new Array<number>(w).fill(0);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[y * w + x]! > threshold) {
        rowBright[y]! += 1;
        colBright[x]! += 1;
      }
    }
  }

  // 行・列の明るい画素が一定割合を超える範囲を紙とみなす(細かなノイズは無視)。
  const RATIO = 0.3;
  const firstLast = (counts: number[], size: number): [number, number] | null => {
    let a = -1;
    let b = -1;
    for (let i = 0; i < counts.length; i += 1) {
      if (counts[i]! / size >= RATIO) {
        if (a < 0) a = i;
        b = i;
      }
    }
    return a < 0 ? null : [a, b];
  };
  const rows = firstLast(rowBright, w);
  const cols = firstLast(colBright, h);
  if (!rows || !cols) return null;

  const box: Box = {
    x0: cols[0] / w,
    x1: (cols[1] + 1) / w,
    y0: rows[0] / h,
    y1: (rows[1] + 1) / h,
  };
  const coverage = (box.x1 - box.x0) * (box.y1 - box.y0);
  if (coverage < MIN_COVERAGE) return null;

  // 矩形の中が明るい画素で満たされているか(満たされていなければ紙ではない)。
  let inside = 0;
  const px0 = cols[0];
  const px1 = cols[1];
  for (let y = rows[0]; y <= rows[1]; y += 1) {
    for (let x = px0; x <= px1; x += 1) if (data[y * w + x]! > threshold) inside += 1;
  }
  const fill = inside / ((rows[1] - rows[0] + 1) * (px1 - px0 + 1));
  if (fill < MIN_FILL) return null;

  return { box, coverage, confidence: Math.min(1, separation * 1.5) * fill };
}

/** レシートらしさの判定の結果。receipt が true のときだけ自動で撮ってよい。 */
export type ReceiptAssessment = {
  receipt: boolean;
  /** 自動で撮らない理由(画面に出す。receipt が true なら null)。 */
  reason: 'edge' | 'shape' | 'no-text' | 'weak' | null;
  /** 紙の中に見つけた、印字の行のまとまりの数。 */
  textBands: number;
};

/** 自動撮影に必要な、紙と背景の分かれ方・紙の詰まり具合(手動のシャッターより厳しい)。 */
const AUTO_MIN_CONFIDENCE = 0.3;
const AUTO_MIN_FILL = 0.75;
/** 紙が画面の端に触れていたら、壁・机・画面など「紙より大きいもの」の一部とみなす。 */
const EDGE_MARGIN = 0.02;
/** 印字の行として数える、行の中の濃い点の割合。 */
const TEXT_ROW_RATIO = 0.03;
/** レシートとみなす印字の行のまとまりの数。 */
const MIN_TEXT_BANDS = 3;

/**
 * 見つけた紙が「レシート」だと言えるか(自動のシャッターを切ってよいか)。誤って撮らないよう、
 * 次を全部満たすときだけ true にする(本人の希望:レシートと確定できるときだけ自動で撮る)。
 *   1. 紙が画面の端に触れていない(紙の全体が枠の中にある。白い壁・机・画面を除く)
 *   2. 縦長か、少なくとも横長すぎない(実際の画素で 高さ ≥ 0.9 × 幅)
 *   3. 紙と背景がはっきり分かれ、紙が外接矩形をよく満たす
 *   4. 紙の中に、印字の行のまとまりが3つ以上ある(白紙・光の反射を除く)
 */
export function assessReceipt(gray: GrayImage, detection: Detection): ReceiptAssessment {
  const { width: w, height: h, data } = gray;
  const { box } = detection;
  if (
    box.x0 < EDGE_MARGIN ||
    box.y0 < EDGE_MARGIN ||
    box.x1 > 1 - EDGE_MARGIN ||
    box.y1 > 1 - EDGE_MARGIN
  ) {
    return { receipt: false, reason: 'edge', textBands: 0 };
  }
  const pxW = (box.x1 - box.x0) * w;
  const pxH = (box.y1 - box.y0) * h;
  if (pxH < 0.9 * pxW) return { receipt: false, reason: 'shape', textBands: 0 };
  if (detection.confidence < AUTO_MIN_CONFIDENCE) {
    return { receipt: false, reason: 'weak', textBands: 0 };
  }

  // 紙の内側(縁を少し除く)で、紙の明るさより十分に暗い点を「印字」として数える。
  const x0 = Math.ceil(box.x0 * w + pxW * 0.06);
  const x1 = Math.floor(box.x1 * w - pxW * 0.06);
  const y0 = Math.ceil(box.y0 * h + pxH * 0.04);
  const y1 = Math.floor(box.y1 * h - pxH * 0.04);
  if (x1 - x0 < 4 || y1 - y0 < 8) return { receipt: false, reason: 'weak', textBands: 0 };
  let paperSum = 0;
  let paperN = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      paperSum += data[y * w + x]!;
      paperN += 1;
    }
  }
  const paper = paperSum / paperN;
  const ink = paper - Math.max(35, paper * 0.22);
  let bright = 0;
  let inkTotal = 0;
  let bands = 0;
  let inBand = false;
  for (let y = y0; y < y1; y += 1) {
    let rowInk = 0;
    for (let x = x0; x < x1; x += 1) {
      const v = data[y * w + x]!;
      if (v < ink) rowInk += 1;
      else bright += 1;
    }
    inkTotal += rowInk;
    const isText = rowInk / (x1 - x0) >= TEXT_ROW_RATIO;
    if (isText && !inBand) bands += 1;
    inBand = isText;
  }
  const fill = bright / paperN;
  if (fill < AUTO_MIN_FILL - 0.2) return { receipt: false, reason: 'weak', textBands: bands };
  const inkRatio = inkTotal / paperN;
  if (bands < MIN_TEXT_BANDS || inkRatio < 0.01 || inkRatio > 0.4) {
    return { receipt: false, reason: 'no-text', textBands: bands };
  }
  return { receipt: true, reason: null, textBands: bands };
}

/**
 * 自動撮影の判定。矩形が「一定のフレーム数、ほとんど動かずに検出され続けた」ら
 * 撮影してよいと返す(手ぶれ・検出の途切れの間は撮らない)。
 */
export function createStabilityTracker(options: { frames?: number; tolerance?: number } = {}) {
  // 2秒(8回 × 250ms)ほとんど動かないこと。手ぶれの途中で撮らない。
  const frames = options.frames ?? 8;
  const tolerance = options.tolerance ?? 0.015;
  let history: Box[] = [];

  const near = (a: Box, b: Box) =>
    Math.abs(a.x0 - b.x0) <= tolerance &&
    Math.abs(a.y0 - b.y0) <= tolerance &&
    Math.abs(a.x1 - b.x1) <= tolerance &&
    Math.abs(a.y1 - b.y1) <= tolerance;

  return {
    push(box: Box | null): { stable: boolean; progress: number } {
      if (box === null) {
        history = [];
        return { stable: false, progress: 0 };
      }
      if (history.length > 0 && !near(history[0]!, box)) history = [];
      history.push(box);
      if (history.length > frames) history.shift();
      return { stable: history.length >= frames, progress: Math.min(history.length / frames, 1) };
    },
    reset(): void {
      history = [];
    },
  };
}

/** 箱を余白つきで画像サイズの画素矩形にする(トリミング用)。 */
export function cropRect(
  box: Box,
  imageWidth: number,
  imageHeight: number,
  margin = 0.01,
): { x: number; y: number; width: number; height: number } {
  const x0 = Math.max(0, box.x0 - margin);
  const y0 = Math.max(0, box.y0 - margin);
  const x1 = Math.min(1, box.x1 + margin);
  const y1 = Math.min(1, box.y1 + margin);
  return {
    x: Math.round(x0 * imageWidth),
    y: Math.round(y0 * imageHeight),
    width: Math.max(1, Math.round((x1 - x0) * imageWidth)),
    height: Math.max(1, Math.round((y1 - y0) * imageHeight)),
  };
}

export type StitchPlacement = { x: number; y: number; width: number; height: number };

/**
 * 長いレシートを分けて撮った複数枚を、縦に1枚へ結合するときの配置。
 * 幅は最大の幅にそろえ(拡縮)、全体の高さが maxHeight を超えるなら全体を縮める
 * (AI へ送る画像の大きさの上限)。
 */
export function stitchLayout(
  sizes: readonly { width: number; height: number }[],
  maxHeight = 6000,
): { width: number; height: number; placements: StitchPlacement[] } {
  if (sizes.length === 0) return { width: 0, height: 0, placements: [] };
  const targetWidth = Math.max(...sizes.map((s) => s.width));
  const scaled = sizes.map((s) => ({
    width: targetWidth,
    height: Math.round((s.height * targetWidth) / s.width),
  }));
  const totalHeight = scaled.reduce((a, s) => a + s.height, 0);
  const shrink = totalHeight > maxHeight ? maxHeight / totalHeight : 1;
  let y = 0;
  const placements = scaled.map((s) => {
    const width = Math.round(s.width * shrink);
    const height = Math.round(s.height * shrink);
    const p = { x: 0, y, width, height };
    y += height;
    return p;
  });
  return { width: Math.round(targetWidth * shrink), height: y, placements };
}
