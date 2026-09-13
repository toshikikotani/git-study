'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { saveImportBatchAction } from '../actions';
import { Card } from '@/components/ui/card';
import { TransactionRow } from '@/components/ui/transaction-row';
import { DEFAULT_DETECTION_RULES, type ClassificationRule } from '@/features/classification/rules';
import type { ClassifyResult } from '@/features/classification/store';
import type { ParsedReceiptTransaction, ReceiptParseResult } from '@/features/import/receipt-ai';
import { fetchAccounts, type AccountOption } from '@/features/transactions/accounts-client';
import { requestAiClassification } from '@/features/transactions/classify-client';
import { buildPreview } from '@/features/transactions/import-pipeline';
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

export default function ReceiptPage() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ReceiptParseResult | null>(null);
  const [saved, setSaved] = useState<{ imported: number; duplicates: number } | null>(null);
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

  const preview = useMemo<StoredTransaction[]>(() => {
    if (aiResults.size === 0) return rulePreview;
    return rulePreview.map((t) => {
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
  }, [rulePreview, aiResults]);

  const unclassifiedCount = preview.filter((t) => t.classifiedBy === 'unclassified').length;

  const classify = async () => {
    const targets = preview.filter((t) => t.classifiedBy === 'unclassified');
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
    const outcome = await saveImportBatchAction(preview, {
      fileName: 'レシート撮影',
      source: 'manual',
      accountId,
      failedCount: extracted?.warnings.length ?? 0,
    });
    if (outcome.error) {
      setSaveError(outcome.error);
      return;
    }
    setSaved(outcome);
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
              {preview.map((t) => (
                <TransactionRow key={t.id} transaction={t} />
              ))}
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
