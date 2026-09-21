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
import {
  subscribePendingReceiptFiles,
  takePendingReceiptFiles,
} from '@/features/import/pending-receipt-files';

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
 * ── 複数枚まとめて取り込み(本人発案) ─────────────────────────
 * 1回の選択で複数枚を渡せる(`<input multiple>`)。「1回の撮影=1バッチ」
 * (P9-3)の設計はそのまま保つ——写真ごとに個別の `import_batches` 行・
 * `receipt_image_path` を持たせるため、内部的には1枚=1エントリとして
 * 抽出・保存する(1枚の写真に複数の買い物が写っていても複製しない、という
 * P9-3 の前提を崩さない)。AI分類だけは全エントリをまとめて1回のリクエストに
 * する(枚数が増えても分類の呼び出し回数は増えない)。保存は1枚ずつ
 * `saveImportBatchAction` を呼び、1枚の失敗が残りの取り込みを止めない
 * (NFR-06)。
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

/** 写真1枚分の状態。「1枚=1バッチ」を保つため、抽出・保存の単位もここで揃える。 */
type ReceiptEntry = {
  id: string;
  previewUrl: string;
  imageBase64: string | null;
  imageError: string | null;
  extracted: ReceiptParseResult | null;
};

/** 写真1枚分の、派生したプレビュー行(ルール分類済み)。 */
type EntryPreview = {
  entry: ReceiptEntry;
  splitEligible: boolean[];
  rulePreview: StoredTransaction[];
  itemRulePreviewByIndex: Map<number, StoredTransaction[]>;
};

export default function ReceiptPage() {
  const [entries, setEntries] = useState<ReceiptEntry[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
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

  const rules = useMemo<ClassificationRule[]>(
    () => [...DEFAULT_DETECTION_RULES, ...learnedRules],
    [learnedRules],
  );

  const onFiles = async (files: readonly File[]) => {
    if (files.length === 0) return;
    setSaved(null);
    setSaveWarnings([]);
    setSaveError(null);

    const newEntries = await Promise.all(
      files.map(async (file): Promise<ReceiptEntry> => {
        const id = crypto.randomUUID();
        const previewUrl = URL.createObjectURL(file);
        try {
          const imageBase64 = await resizeToJpegBase64(file);
          return { id, previewUrl, imageBase64, imageError: null, extracted: null };
        } catch (e) {
          return {
            id,
            previewUrl,
            imageBase64: null,
            imageError: e instanceof Error ? e.message : String(e),
            extracted: null,
          };
        }
      }),
    );
    setEntries((prev) => [...prev, ...newEntries]);
  };

  // ボトムナビのカメラ FAB(app/(app)/layout.tsx)から撮ってきたファイルを
  // 取り込む(本人発案:カメラマークを押した瞬間にカメラアプリが開き、
  // 撮影後はそのままこの画面の処理に続く)。
  //
  // マウント時点で既に置かれているファイル(通常の初回遷移)を拾うのに加え、
  // `setPendingReceiptFiles()` の呼び出しを購読する。理由(本人からの不具合
  // 報告「画像渡して何の反応も無い」):ADR-029 の staleTimes により
  // Router Cache がこの画面を使い回すため、一度開いた後にまた FAB を押すと
  // この画面はマウントし直されず、マウント時1回きりの取得だけでは2回目
  // 以降のファイルに気づけなかった(pending-receipt-files.ts 参照)。
  // fetchAccounts()/fetchLearnedRules() と同じく、setState は Promise の
  // コールバック内で行う(react-hooks/set-state-in-effect:effect の中で
  // 直接 setState を呼ぶとカスケードするレンダーになるため)。購読側の
  // コールバックは effect の外(別のユーザー操作)から呼ばれるため対象外。
  useEffect(() => {
    const consume = () => {
      const pending = takePendingReceiptFiles();
      if (pending && pending.length > 0) void onFiles(pending);
    };
    void Promise.resolve().then(consume);
    return subscribePendingReceiptFiles(consume);
  }, []);

  const removeEntry = (id: string) => {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((e) => e.id !== id);
    });
  };

  const pendingExtraction = entries.filter((e) => e.imageBase64 && !e.extracted);

  const extractAll = async () => {
    if (pendingExtraction.length === 0) return;
    setExtracting(true);
    try {
      const results = await Promise.all(
        pendingExtraction.map(async (entry) => {
          try {
            const response = await fetch('/api/import/receipt', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ image: entry.imageBase64, mediaType: 'image/jpeg' }),
            });
            if (!response.ok) {
              return {
                id: entry.id,
                extracted: { transactions: [], warnings: ['読み取りに失敗しました。'] },
              };
            }
            const result = (await response.json()) as {
              transactions: ParsedReceiptTransaction[];
              warnings: string[];
            };
            return {
              id: entry.id,
              extracted: { transactions: result.transactions, warnings: result.warnings },
            };
          } catch {
            return {
              id: entry.id,
              extracted: { transactions: [], warnings: ['読み取りに失敗しました。'] },
            };
          }
        }),
      );
      const extractedById = new Map(results.map((r) => [r.id, r.extracted]));
      setEntries((prev) =>
        prev.map((e) =>
          extractedById.has(e.id) ? { ...e, extracted: extractedById.get(e.id)! } : e,
        ),
      );
    } finally {
      setExtracting(false);
    }
  };

  // 写真ごとに、ルール分類済みのプレビュー行を組み立てる(商品行の分割対象判定も含む)。
  const entryPreviews = useMemo<EntryPreview[]>(() => {
    return entries
      .filter((e): e is ReceiptEntry & { extracted: ReceiptParseResult } => e.extracted !== null)
      .map((entry) => {
        const { extracted } = entry;

        // 口座が未選択のあいだは明細(StoredTransaction は accountId が必須)を
        // 組み立てられない。ただし読み取り自体の警告(店名不明・合計不一致など、
        // extracted.warnings)は口座の有無と無関係なので、ここで entry ごと
        // 丸ごと弾くと「AI に読み取らせたのに何の反応も無い」状態になって
        // しまう(本人からの不具合報告)。口座が決まるまでは警告だけを見せ、
        // 明細プレビューは空のまま返す。
        if (!accountId) {
          return {
            entry,
            splitEligible: extracted.transactions.map(() => false),
            rulePreview: [],
            itemRulePreviewByIndex: new Map<number, StoredTransaction[]>(),
          };
        }

        // 商品行(items)が2件以上ある明細だけ、店名+合計の1件ではなく商品ごとに
        // 分割して取り込む(本人発案)。receipt-ai.ts が合計と一致しないと判断した
        // ものは items が空で返るため、ここでは長さだけ見ればよい。
        const splitEligible = extracted.transactions.map((t) => t.items.length >= 2);
        const rulePreview = buildPreview(
          extracted.transactions,
          accountId,
          (i) => `receipt-${entry.id}-${i}`,
          rules,
          categoryNameById,
          'manual',
        );

        const itemRulePreviewByIndex = new Map<number, StoredTransaction[]>();
        extracted.transactions.forEach((t, i) => {
          if (!splitEligible[i]) return;
          const itemRows: ImportableRow[] = t.items.map((item) => ({
            occurredOn: t.occurredOn,
            description: item.description,
            amountYen: item.amountYen,
            paymentMethod: t.paymentMethod,
          }));
          itemRulePreviewByIndex.set(
            i,
            buildPreview(
              itemRows,
              accountId,
              (j) => `receipt-${entry.id}-${i}-item-${j}`,
              rules,
              categoryNameById,
              'manual',
            ),
          );
        });

        return { entry, splitEligible, rulePreview, itemRulePreviewByIndex };
      });
  }, [entries, accountId, rules, categoryNameById]);

  // AI分類の結果(押されたときだけ)を写真ごとのプレビューへ反映する。
  const previews = useMemo(
    () =>
      entryPreviews.map((p) => ({
        ...p,
        preview: applyAiResults(p.rulePreview, aiResults),
        itemPreviewByIndex: new Map(
          [...p.itemRulePreviewByIndex].map(([i, rows]) => [i, applyAiResults(rows, aiResults)]),
        ),
      })),
    [entryPreviews, aiResults],
  );

  // 分割対象の親(明細本体)自身の分類は「AIに回す」の対象にしない(save() 参照)。
  function unclassifiedOf(p: (typeof previews)[number]): StoredTransaction[] {
    const topLevel = p.preview.filter(
      (t, i) => t.classifiedBy === 'unclassified' && !p.splitEligible[i],
    );
    const items = [...p.itemPreviewByIndex.values()].flatMap((rows) =>
      rows.filter((t) => t.classifiedBy === 'unclassified'),
    );
    return [...topLevel, ...items];
  }

  const unclassifiedCount = previews.reduce((sum, p) => sum + unclassifiedOf(p).length, 0);
  const totalPreviewCount = previews.reduce((sum, p) => sum + p.preview.length, 0);

  const classify = async () => {
    // 枚数が増えても呼び出し回数は増やさない。全写真分をまとめて1回で送る。
    const targets = previews.flatMap(unclassifiedOf);
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
    if (!accountId || previews.length === 0) return;
    setSaving(true);
    setSaveError(null);

    let totalImported = 0;
    let totalDuplicates = 0;
    const warnings: string[] = [];
    const failed: string[] = [];

    // 1枚ずつ保存する(「1回の撮影=1バッチ」、P9-3)。1枚の失敗が残りを止めない(NFR-06)。
    for (const p of previews) {
      let receiptImagePath: string | null = null;
      if (p.entry.imageBase64) {
        try {
          const uploadRes = await fetch('/api/import/receipt/upload', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ image: p.entry.imageBase64, mediaType: 'image/jpeg' }),
          });
          const uploaded = (await uploadRes.json()) as {
            path: string | null;
            error: string | null;
          };
          receiptImagePath = uploaded.path;
          if (uploaded.error) warnings.push(uploaded.error);
        } catch {
          warnings.push('レシート画像を保存できませんでした。取り込みは続けます。');
        }
      }

      const receiptSplits: ReceiptSplitInput[] = [];
      const previewToSave = p.preview.map((t, i) => {
        const items = p.itemPreviewByIndex.get(i);
        if (!p.splitEligible[i] || !items || items.length < 2) return t;

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
          // 商品ごとに分割するので、明細本体は確認待ちに出さない(理由は上部コメント参照)。
          reviewStatus: t.reviewStatus === 'pending' ? ('auto_ok' as const) : t.reviewStatus,
        };
      });

      const outcome = await saveImportBatchAction(
        previewToSave,
        {
          fileName: 'レシート撮影',
          source: 'manual',
          accountId,
          failedCount: p.entry.extracted?.warnings.length ?? 0,
          receiptImagePath,
        },
        receiptSplits,
      );
      if (outcome.error) {
        failed.push(outcome.error);
        continue;
      }
      totalImported += outcome.imported;
      totalDuplicates += outcome.duplicates;
      warnings.push(...outcome.splitWarnings);
    }

    setSaving(false);

    if (totalImported === 0 && totalDuplicates === 0 && failed.length > 0) {
      setSaveError(failed.join(' / '));
      return;
    }

    setSaved({ imported: totalImported, duplicates: totalDuplicates });
    setSaveWarnings([
      ...warnings,
      ...failed.map((e) => `一部の写真の取り込みに失敗しました: ${e}`),
    ]);
    for (const entry of entries) URL.revokeObjectURL(entry.previewUrl);
    setEntries([]);
    setAiResults(new Map());
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
          ギャラリーからは複数枚まとめて選べます。
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
        <div
          className="mt-3 rounded-2xl border border-dashed px-4 py-6 text-center"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <p className="mb-3 text-sm font-medium" style={{ color: 'var(--ink-secondary)' }}>
            {entries.length > 0 ? '写真を追加する' : 'レシートを撮る・選ぶ'}
          </p>
          <div className="flex justify-center gap-3">
            {/*
             * capture="environment" を付けると、モバイルのブラウザは選択肢を
             * 出さずカメラを直接開いてしまう(本人発案:「撮るか選ぶか選べる
             * ようにして」)。1つの input に両方を担わせず、カメラ起動専用と
             * ギャラリー選択専用の input を分けて、本人がボタンで選ぶ形にした。
             */}
            <label
              className="label-text cursor-pointer px-6 py-2.5"
              style={{
                borderRadius: 'var(--radius-full)',
                background: 'var(--accent)',
                color: 'var(--on-accent)',
              }}
            >
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void onFiles(files);
                  e.target.value = '';
                }}
              />
              撮る
            </label>
            <label
              className="label-text cursor-pointer px-6 py-2.5"
              style={{
                borderRadius: 'var(--radius-full)',
                border: '1px solid var(--hairline)',
                color: 'var(--accent)',
              }}
            >
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void onFiles(files);
                  e.target.value = '';
                }}
              />
              選ぶ
            </label>
          </div>
        </div>

        {entries.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {entries.map((entry) => (
              <li key={entry.id} className="relative">
                <div
                  className="size-16 overflow-hidden rounded-xl"
                  style={{ background: 'var(--plane)' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={entry.previewUrl}
                    alt="撮影したレシート"
                    className="size-full object-cover"
                  />
                </div>
                {entry.imageError ? (
                  <span
                    className="absolute inset-0 flex items-center justify-center rounded-xl text-[10px] font-semibold"
                    style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
                  >
                    失敗
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  aria-label="この写真を取り除く"
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full text-[11px]"
                  style={{ background: 'var(--ink)', color: 'var(--surface)' }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {pendingExtraction.length > 0 ? (
          <button
            type="button"
            onClick={() => void extractAll()}
            disabled={extracting}
            className="mt-4 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {extracting ? '読み取っています…' : `AI に読み取らせる(${pendingExtraction.length}枚)`}
          </button>
        ) : null}

        {previews.map((p) => (
          <div key={p.entry.id} className="mt-4">
            {p.entry.extracted && p.entry.extracted.warnings.length > 0 ? (
              <ul className="mb-2 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                {p.entry.extracted.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}

            {p.preview.length > 0 ? (
              <ul
                className="divide-y overflow-hidden rounded-2xl"
                style={{ borderColor: 'var(--hairline)', background: 'var(--plane)' }}
              >
                {p.preview.map((t, i) => {
                  const items = p.itemPreviewByIndex.get(i);
                  if (!p.splitEligible[i] || !items || items.length < 2) {
                    return <TransactionRow key={t.id} transaction={t} />;
                  }
                  // 商品ごとに分割して取り込む明細(本人発案)。親自体は分類の
                  // 対象にしない(分類は商品行=splits 側にある)ため、通常の
                  // TransactionRow ではなく専用の見た目にする。
                  return (
                    <li key={t.id} className="px-4 py-3">
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
            ) : p.entry.extracted && p.entry.extracted.transactions.length > 0 ? (
              // 読み取り自体は成功しているが、口座が未選択のため明細を組み立てて
              // いない状態(本人からの不具合報告:「AIに読み取らせても何も出ない」
              // への対応。理由が分からないまま放置されないよう明示する)。
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                {p.entry.extracted.transactions.length}
                件読み取れました。上の「口座」を選ぶと明細が表示されます。
              </p>
            ) : null}
          </div>
        ))}

        {totalPreviewCount > 0 ? (
          <>
            <p className="mt-4 text-xs" style={{ color: 'var(--ink-muted)' }}>
              金額と日付が合っているか確認してください。
            </p>

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
              disabled={!accountId || saving}
              className="mt-4 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {saving ? '取り込んでいます…' : `${totalPreviewCount} 件を取り込む`}
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
