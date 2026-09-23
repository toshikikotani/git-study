'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { saveImportBatchAction, type ReceiptSplitInput } from '../actions';
import { Card } from '@/components/ui/card';
import { TransactionRow } from '@/components/ui/transaction-row';
import { DEFAULT_DETECTION_RULES, type ClassificationRule } from '@/features/classification/rules';
import type { ClassifyResult } from '@/features/classification/store';
import { formatYen } from '@/domain/money';
import type { ParsedReceiptTransaction, ReceiptParseResult } from '@/features/import/receipt-ai';
import { fetchAccounts, type AccountOption } from '@/features/transactions/accounts-client';
import { requestAiClassification } from '@/features/transactions/classify-client';
import { buildPreview, type ImportableRow } from '@/features/transactions/import-pipeline';
import { fetchLearnedRules } from '@/features/transactions/rules-client';
import type { StoredTransaction } from '@/features/transactions/store';

/**
 * レシート・領収書の撮影取り込み(新機能、ADR-021)。
 *
 * ── なぜこの画面が要るのか ──────────────────────────────────
 * CSV・メール通知はどちらもカード払いを前提にしている。現金・電子マネーの
 * 支払いはそのどちらにも記録が残らず、本人が気づかない限り記録から漏れる。
 * 設計原則2(記録の手間を最小化)に沿うと、レシートを撮るだけで済む経路が
 * 現金払いの「主経路」になる(貼り付け画面のような一時的な逃げ道ではない)。
 *
 * ── なぜ選択後すぐに AI を呼ばないのか ──────────────────────
 * この経路には辞書のような費用ゼロの手段が無く、呼べば必ず課金される。
 * 貼り付け画面と同じく、写真を選んだだけでは呼ばず、押されたときだけ呼ぶ。
 *
 * ── 商品行(items)がある明細は分割して取り込む(本人発案) ──────
 * receipt-ai.ts が商品ごとの内訳を返せた明細は、店名+合計の1件ではなく
 * 商品行1つずつを既存の分類パイプライン(ルール→本人操作でのAI)に通し、
 * 保存時に transaction_splits として自動生成する(features/transactions/
 * splits-store.ts、P8-2 で追加済み)。明細本体(親)の分類は変えない。
 * ただし親が「確認待ち」のまま残ると、確認待ちキューで本人が1カテゴリだけ
 * 選んだ瞬間にその店名の学習ルールができ、次の同じ店の買い物が(実際は
 * 食費+日用品の混在でも)全部そのカテゴリに誤爆する。実際の分類は商品行
 * (=splits)側にあるため、親は保存時に auto_ok へ倒す(save() 参照)。
 */

const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.85;

async function resizeToJpegBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('画像を読み込めませんでした'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('画像を読み込めませんでした'));
    el.src = dataUrl;
  });

  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を処理できませんでした');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const jpegDataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const base64 = jpegDataUrl.split(',')[1];
  if (!base64) throw new Error('画像を変換できませんでした');
  return base64;
}

/** AI分類の結果(押されたときだけ)を、ルール分類済みの行に上書きで反映する。 */
function applyAiResults(
  rows: readonly StoredTransaction[],
  aiResults: ReadonlyMap<string, ClassifyResult>,
): StoredTransaction[] {
  if (aiResults.size === 0) return [...rows];
  return rows.map((t) => {
    const applied = aiResults.get(t.id);
    if (!applied) return t;
    return {
      ...t,
      categoryId: applied.categoryId,
      categoryName: applied.categoryName,
      classifiedBy: applied.classifiedBy,
      confidence: applied.confidence,
      reviewStatus: applied.reviewStatus,
    };
  });
}

export default function ReceiptPage() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ReceiptParseResult | null>(null);
  const [saved, setSaved] = useState<{ imported: number; duplicates: number } | null>(null);
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);
  const [aiResults, setAiResults] = useState<Map<string, ClassifyResult>>(new Map());
  const [classifying, setClassifying] = useState(false);
  const [classifyWarnings, setClassifyWarnings] = useState<string[]>([]);
  const [learnedRules, setLearnedRules] = useState<ClassificationRule[]>([]);
  const [categoryNameById, setCategoryNameById] = useState<Map<string, string>>(new Map());
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // 学習済みルール(M2-5)。取得に失敗しても固定の検知ルールだけで取り込みは動く
  useEffect(() => {
    void fetchLearnedRules().then((fetched) => {
      setLearnedRules(fetched.rules);
      setCategoryNameById(fetched.categoryNameById);
    });
  }, []);

  // 口座(M6-2)。取得できたら最初の1件を既定にする(選び直せる)
  useEffect(() => {
    void fetchAccounts().then((fetched) => {
      setAccounts(fetched);
      setAccountId((current) => current || (fetched[0]?.id ?? ''));
    });
  }, []);

  // 選び直したときに前の画像のURLを解放する
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const rules = useMemo<ClassificationRule[]>(
    () => [...DEFAULT_DETECTION_RULES, ...learnedRules],
    [learnedRules],
  );

  const onFile = async (file: File) => {
    setImageError(null);
    setExtracted(null);
    setSaved(null);
    setSaveWarnings([]);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    try {
      const base64 = await resizeToJpegBase64(file);
      setImageBase64(base64);
    } catch (e) {
      setImageBase64(null);
      setImageError(e instanceof Error ? e.message : String(e));
    }
  };

  // 抽出結果(AI が読み取った日付)は本人の確認が前提(preview の直前に出す
  // 注記「金額と日付が合っているか確認してください」参照)。合っていなければ
  // ここで直せるようにする(本人発案)。preview は extracted から都度組み立て
  // 直されるため、ここを直すだけで保存内容にも反映される。
  const updateExtractedDate = (index: number, occurredOn: string) => {
    setExtracted((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        transactions: prev.transactions.map((t, i) => (i === index ? { ...t, occurredOn } : t)),
      };
    });
  };

  const extract = async () => {
    if (!imageBase64) return;
    setExtracting(true);
    try {
      const response = await fetch('/api/import/receipt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: imageBase64, mediaType: 'image/jpeg' }),
      });
      if (!response.ok) {
        setExtracted({ transactions: [], warnings: ['読み取りに失敗しました。'] });
        return;
      }
      const result = (await response.json()) as {
        transactions: ParsedReceiptTransaction[];
        warnings: string[];
      };
      setExtracted({ transactions: result.transactions, warnings: result.warnings });
    } catch {
      setExtracted({ transactions: [], warnings: ['読み取りに失敗しました。'] });
    } finally {
      setExtracting(false);
    }
  };

  // 商品行(items)が2件以上ある明細だけ、店名+合計の1件ではなく商品ごとに
  // 分割して取り込む(本人発案)。receipt-ai.ts が合計と一致しないと判断した
  // ものは items が空で返るため、ここでは長さだけ見ればよい。
  const splitEligible = useMemo(
    () => extracted?.transactions.map((t) => t.items.length >= 2) ?? [],
    [extracted],
  );

  const rulePreview = useMemo<StoredTransaction[]>(() => {
    if (!extracted || !accountId) return [];
    return buildPreview(
      extracted.transactions,
      accountId,
      (i) => `receipt-${i}`,
      rules,
      categoryNameById,
      'manual',
    );
  }, [extracted, rules, categoryNameById, accountId]);

  // 商品行ごとの分類プレビュー(本人発案)。既存の分類パイプラインに商品名を
  // そのまま通す(店名向けのルールが当たらなくても、押されたときだけの
  // AI 分類で埋められる。分類の仕組み自体は増やさない)。
  const itemRulePreviewByIndex = useMemo<Map<number, StoredTransaction[]>>(() => {
    const map = new Map<number, StoredTransaction[]>();
    if (!extracted || !accountId) return map;
    extracted.transactions.forEach((t, i) => {
      if (!splitEligible[i]) return;
      const itemRows: ImportableRow[] = t.items.map((item) => ({
        occurredOn: t.occurredOn,
        description: item.description,
        amountYen: item.amountYen,
        paymentMethod: t.paymentMethod,
      }));
      map.set(
        i,
        buildPreview(
          itemRows,
          accountId,
          (j) => `receipt-${i}-item-${j}`,
          rules,
          categoryNameById,
          'manual',
        ),
      );
    });
    return map;
  }, [extracted, splitEligible, rules, categoryNameById, accountId]);

  const preview = useMemo<StoredTransaction[]>(
    () => applyAiResults(rulePreview, aiResults),
    [rulePreview, aiResults],
  );

  const itemPreviewByIndex = useMemo<Map<number, StoredTransaction[]>>(() => {
    const map = new Map<number, StoredTransaction[]>();
    for (const [i, rows] of itemRulePreviewByIndex) map.set(i, applyAiResults(rows, aiResults));
    return map;
  }, [itemRulePreviewByIndex, aiResults]);

  // 分割対象の親(明細本体)自身の分類は「AIに回す」の対象にしない。
  // 実際の分類は商品行(=splits)側にあり、親の分類は保存時に無効化する
  // (save() 参照)ため、ここで数えても本人が確認する意味が無い。
  const topLevelUnclassified = preview.filter(
    (t, i) => t.classifiedBy === 'unclassified' && !splitEligible[i],
  );
  const itemUnclassified = [...itemPreviewByIndex.values()].flatMap((rows) =>
    rows.filter((t) => t.classifiedBy === 'unclassified'),
  );
  const unclassifiedCount = topLevelUnclassified.length + itemUnclassified.length;

  const classify = async () => {
    const targets = [...topLevelUnclassified, ...itemUnclassified];
    if (targets.length === 0) return;
    setClassifying(true);
    try {
      const outcome = await requestAiClassification(targets);
      setAiResults((prev) => {
        const next = new Map(prev);
        for (const r of outcome.results) next.set(r.id, r);
        return next;
      });
      setClassifyWarnings(outcome.warnings);
    } finally {
      setClassifying(false);
    }
  };

  const save = async () => {
    if (!accountId) return;
    setSaveError(null);

    // 画像の保存(本人発案)。抽出時ではなく、本人が取り込みを確定した
    // ここでだけ Storage へ送る(結局取り込まなかった写真まで溜めない)。
    // 失敗しても取り込み自体は続ける(splits-store.ts と同じ考え方)。
    let receiptImagePath: string | null = null;
    const preSaveWarnings: string[] = [];
    if (imageBase64) {
      try {
        const uploadRes = await fetch('/api/import/receipt/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ image: imageBase64, mediaType: 'image/jpeg' }),
        });
        const uploaded = (await uploadRes.json()) as { path: string | null; error: string | null };
        receiptImagePath = uploaded.path;
        if (uploaded.error) preSaveWarnings.push(uploaded.error);
      } catch {
        preSaveWarnings.push('レシート画像を保存できませんでした。取り込みは続けます。');
      }
    }

    const receiptSplits: ReceiptSplitInput[] = [];
    const previewToSave = preview.map((t, i) => {
      const items = itemPreviewByIndex.get(i);
      if (!splitEligible[i] || !items || items.length < 2) return t;

      const sourceRef = crypto.randomUUID();
      receiptSplits.push({
        sourceRef,
        splits: items.map((item) => ({
          categoryId: item.categoryId,
          amountYen: item.amountYen,
          note: item.description,
        })),
      });
      return {
        ...t,
        sourceRef,
        // 商品ごとに分割するので、明細本体は確認待ちに出さない。ここで
        // 「確認待ち」を残すと、確認待ちキューで本人が1カテゴリだけ選んだ
        // 瞬間にその店名の学習ルールができ、次の同じ店の買い物(実際は
        // カテゴリが混在していても)を丸ごと誤って分類してしまう。
        reviewStatus: t.reviewStatus === 'pending' ? ('auto_ok' as const) : t.reviewStatus,
      };
    });

    const outcome = await saveImportBatchAction(
      previewToSave,
      {
        fileName: 'レシート撮影',
        source: 'manual',
        accountId,
        failedCount: extracted?.warnings.length ?? 0,
        receiptImagePath,
      },
      receiptSplits,
    );
    if (outcome.error) {
      setSaveError(outcome.error);
      return;
    }
    setSaved({ imported: outcome.imported, duplicates: outcome.duplicates });
    setSaveWarnings([...preSaveWarnings, ...outcome.splitWarnings]);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setImageBase64(null);
    setExtracted(null);
  };

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          レシートを撮る
        </h1>
        <Link href="/transactions" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          やめる
        </Link>
      </header>

      <div
        className="rounded-2xl p-4"
        style={{ background: 'var(--accent-track)', boxShadow: 'var(--card-shadow)' }}
      >
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          現金・電子マネーなど、通知メールもカード明細も無い支払いはここから記録します。
        </p>
      </div>

      {saved ? (
        <Card>
          <p className="text-sm" style={{ color: 'var(--ink)' }}>
            {saved.imported} 件を取り込みました
            {saved.duplicates > 0 ? `(重複 ${saved.duplicates} 件を除外)` : ''}
          </p>
          {saveWarnings.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {saveWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          <Link
            href="/transactions"
            className="mt-4 block w-full rounded-full py-3 text-center text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            明細を見る
          </Link>
        </Card>
      ) : null}

      {/* 口座(M6-2) */}
      <Card>
        <label
          className="text-[11px] font-medium tracking-[0.08em] uppercase"
          style={{ color: 'var(--ink-muted)' }}
        >
          口座
        </label>
        {accounts === null ? (
          <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            読み込んでいます…
          </p>
        ) : accounts.length === 0 ? (
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            口座がまだ登録されていません。
            <Link
              href="/accounts"
              className="ml-1 font-semibold underline decoration-dotted underline-offset-4"
              style={{ color: 'var(--accent)' }}
            >
              先に登録する →
            </Link>
          </p>
        ) : (
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mt-2 w-full rounded-xl px-3 py-2 text-sm"
            style={{
              background: 'var(--plane)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        )}
      </Card>

      <Card>
        <label
          className="mt-3 block cursor-pointer rounded-2xl border border-dashed px-4 py-8 text-center"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
            {previewUrl ? '撮り直す' : 'レシートを撮る・選ぶ'}
          </span>
        </label>

        {imageError ? (
          <p className="mt-3 text-sm" style={{ color: 'var(--over)' }}>
            {imageError}
          </p>
        ) : null}

        {previewUrl ? (
          <div className="mt-3 overflow-hidden rounded-2xl" style={{ background: 'var(--plane)' }}>
            {/* ローカルの blob URL(本人が選んだ画像のプレビュー)なので next/image の
                最適化対象にならない。素の img で表示する。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="撮影したレシート"
              className="max-h-80 w-full object-contain"
            />
          </div>
        ) : null}

        {previewUrl && !extracted ? (
          <button
            type="button"
            onClick={() => void extract()}
            disabled={extracting || !imageBase64}
            className="mt-4 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {extracting ? '読み取っています…' : 'AI に読み取らせる'}
          </button>
        ) : null}

        {extracted && extracted.warnings.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {extracted.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}

        {preview.length > 0 ? (
          <>
            <p className="mt-4 text-xs" style={{ color: 'var(--ink-muted)' }}>
              金額と日付が合っているか確認してください。
            </p>
            <ul
              className="mt-2 divide-y overflow-hidden rounded-2xl"
              style={{ borderColor: 'var(--hairline)', background: 'var(--plane)' }}
            >
              {preview.map((t, i) => {
                const items = itemPreviewByIndex.get(i);
                const dateEditor = (
                  <input
                    type="date"
                    value={extracted?.transactions[i]?.occurredOn ?? ''}
                    onChange={(e) => updateExtractedDate(i, e.target.value)}
                    className="tabular mb-1.5 rounded-lg px-2 py-1 text-xs"
                    style={{
                      background: 'var(--surface)',
                      color: 'var(--ink-secondary)',
                      border: '1px solid var(--hairline)',
                    }}
                  />
                );
                if (!splitEligible[i] || !items || items.length < 2) {
                  return <TransactionRow key={t.id} transaction={t} dateEditor={dateEditor} />;
                }
                // 商品ごとに分割して取り込む明細(本人発案)。親自体は分類の
                // 対象にしない(分類は商品行=splits 側にある)ため、通常の
                // TransactionRow ではなく専用の見た目にする。商品行は親と同じ
                // 日付を使う(receipt-ai.ts が1明細=1日付で返すため)ので、
                // 日付編集は親側だけに置けば十分。
                return (
                  <li key={t.id} className="px-4 py-3">
                    {dateEditor}
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-[15px]" style={{ color: 'var(--ink)' }}>
                        {t.description}
                      </p>
                      <span
                        className="tabular shrink-0 text-[15px] font-semibold"
                        style={{ color: 'var(--ink)' }}
                      >
                        −{formatYen(Math.abs(t.amountYen))}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      商品ごとに{items.length}件のカテゴリへ分けて取り込みます
                    </p>
                    <ul
                      className="mt-2 divide-y overflow-hidden rounded-xl"
                      style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}
                    >
                      {items.map((item) => (
                        <TransactionRow key={item.id} transaction={item} />
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>

            {/* ルールに当たらなかった分だけ AI に回せる(M2-3b)。押されたときだけ呼ぶ */}
            {unclassifiedCount > 0 ? (
              <button
                type="button"
                onClick={() => void classify()}
                disabled={classifying}
                className="mt-4 w-full rounded-full py-3 text-sm font-semibold"
                style={{
                  background: 'var(--plane)',
                  color: 'var(--accent)',
                  border: '1px solid var(--hairline)',
                  opacity: classifying ? 0.6 : 1,
                }}
              >
                {classifying
                  ? '分類しています…'
                  : `分類できなかった ${unclassifiedCount} 件を AI に回す`}
              </button>
            ) : null}

            {classifyWarnings.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                {classifyWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}

            <button
              type="button"
              onClick={() => void save()}
              disabled={!accountId}
              className="mt-4 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {preview.length} 件を取り込む
            </button>

            {saveError ? (
              <p className="mt-2 text-center text-xs" style={{ color: 'var(--over)' }}>
                {saveError}
              </p>
            ) : null}
          </>
        ) : null}
      </Card>
    </div>
  );
}
