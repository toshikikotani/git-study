import { normalizeStoreName } from '@/domain/store-name';

export type MerchantNameReviewReason = 'missing' | 'address' | 'normalization';

/** 保存時にも照合する、確認画面を開いた時点の名前。 */
export type MerchantNameSnapshot = {
  id: string;
  merchantName: string | null;
  description: string;
  branchName: string | null;
  updatedAt: string;
};

export type MerchantNameReviewEntry = MerchantNameSnapshot & {
  occurredOn: string;
  amountYen: number;
};

export type MerchantNameReviewGroup = {
  key: string;
  label: string;
  branchName: string | null;
  reasons: MerchantNameReviewReason[];
  suggestedName: string;
  suggestedBranch: string | null;
  entries: MerchantNameReviewEntry[];
};

const MISSING_NAME =
  /^(?:店名(?:なし|不明|未設定)?|店舗不明|名称(?:なし|不明|未設定)|不明|未入力|unknown|n\/?a|[-―ー]+)$/i;

function withoutCompanyPrefix(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/^(?:株式会社|\(株\)|㈱)\s*/, '')
    .trim();
}

/** 住所らしいものを確認候補にするだけで、住所から店名は推測しない。 */
function looksLikeAddress(value: string): boolean {
  const text = value.normalize('NFKC');
  return (
    /^(?:〒\s*)?\d{3}[-－]\d{4}(?:\s|$)/.test(text) ||
    /^(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県).*[市区町村].*\d/.test(text) ||
    /^[^\s]{1,15}[市区町村][^\s]*\d+(?:丁目|番地|番|号|[-－]\d)/.test(text)
  );
}

/** 明細原文は変えず、同じ表示名・支店の候補をまとめる。 */
export function groupMerchantNameReview(
  entries: readonly MerchantNameReviewEntry[],
): MerchantNameReviewGroup[] {
  const groups = new Map<string, MerchantNameReviewGroup>();
  for (const entry of entries) {
    const label = entry.merchantName?.trim() || entry.description.trim();
    const marker = label
      .normalize('NFKC')
      .replace(/^\((.*)\)$/u, '$1')
      .trim();
    const missing = marker === '' || MISSING_NAME.test(marker);
    const address = !missing && looksLikeAddress(label);
    const corrected = label.replace(/^スキ薬局/, 'スギ薬局');
    const normalized = normalizeStoreName(corrected);
    // 会社表記の省略だけでは確認待ちを増やさない。一覧の表示処理に任せる。
    const changed =
      !missing &&
      !address &&
      (withoutCompanyPrefix(label) !== normalized.name ||
        (normalized.branch !== null && entry.branchName === null));
    if (!missing && !address && !changed) continue;
    const reasons: MerchantNameReviewReason[] = missing
      ? ['missing']
      : address
        ? ['address']
        : ['normalization'];
    const key = JSON.stringify([label, entry.branchName]);
    const previous = groups.get(key);
    if (previous) {
      previous.entries.push(entry);
      continue;
    }
    groups.set(key, {
      key,
      label: label || '店名なし',
      branchName: entry.branchName,
      reasons,
      suggestedName: missing || address ? '' : normalized.name,
      suggestedBranch: entry.branchName ?? (missing || address ? null : normalized.branch),
      entries: [entry],
    });
  }
  return [...groups.values()];
}
