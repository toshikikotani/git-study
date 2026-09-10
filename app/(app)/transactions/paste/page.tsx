'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Card } from '@/components/ui/card';
import { TransactionRow } from '@/components/ui/transaction-row';
import type { ClassifyResult } from '@/features/classification/store';
import {
  parseNotificationEmail,
  type EmailParseResult,
  type ParsedEmailTransaction,
} from '@/features/import/email';
import { requestAiClassification } from '@/features/transactions/classify-client';
import { buildPreview, saveBatch } from '@/features/transactions/import-pipeline';
import type { StoredTransaction } from '@/features/transactions/store';

/**
 * 通知メールの貼り付け取り込み。
 *
 * ── これは主経路ではない ────────────────────────────────────
 * 設計原則2は「記録の手間を最小化。手入力は例外」。毎回貼り付けさせるのは
 * 離脱理由の1位(入力の手間)そのものなので、本来は Gmail 自動取得
 * (ADR-018)が働く。この画面は次の3つの場合のための逃げ道:
 *
 *   1. Gmail 連携をまだ設定していない
 *   2. 連携していない別のアドレスに届いた
 *   3. 自動取得が取りこぼした1通を今すぐ入れたい
 *
 * 画面上でもその位置づけを明示し、自動取得への導線を必ず置く。
 */

export default function PastePage() {
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState<{ imported: number; duplicates: number } | null>(null);
  /** 辞書で読めなかったときに AI が読み取った結果(ADR-019)。 */
  const [rescued, setRescued] = useState<EmailParseResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [aiResults, setAiResults] = useState<Map<string, ClassifyResult>>(new Map());
  const [classifying, setClassifying] = useState(false);
  const [classifyWarnings, setClassifyWarnings] = useState<string[]>([]);

  const byLabels = useMemo(() => (body.trim() ? parseNotificationEmail(body) : null), [body]);
  const parsed = rescued ?? byLabels;

  /**
   * AI に読み取らせる。
   *
   * 自動では呼ばない。読めているメールで API を叩くのは無駄だし、
   * 入力のたびに課金が走るのは本人にとって不意打ちになる。
   * 「辞書で読めなかった」ときにだけボタンを出し、押されたら呼ぶ。
   */
  const askAi = async () => {
    setAsking(true);
    try {
      const response = await fetch('/api/import/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!response.ok) {
        setRescued({ transactions: [], warnings: ['AI での読み取りに失敗しました。'] });
        return;
      }
      const result = (await response.json()) as {
        transactions: ParsedEmailTransaction[];
        warnings: string[];
      };
      setRescued({ transactions: result.transactions, warnings: result.warnings });
    } catch {
      setRescued({ transactions: [], warnings: ['AI での読み取りに失敗しました。'] });
    } finally {
      setAsking(false);
    }
  };

  const rulePreview = useMemo<StoredTransaction[]>(() => {
    if (!parsed) return [];
    return buildPreview(parsed.transactions, 'email', (i) => `paste-${i}`);
  }, [parsed]);

  // AI 分類の結果を id で重ねる。本文を書き換えると rulePreview の内容が
  // 総入れ替えになるため、古い aiResults は自然に参照されなくなる。
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
    const outcome = await saveBatch(preview, {
      fileName: 'メール貼り付け',
      failedCount: parsed?.warnings.length ?? 0,
    });
    setSaved(outcome);
    setBody('');
  };

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          メールを貼り付ける
        </h1>
        <Link href="/transactions" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          やめる
        </Link>
      </header>

      {/* 主経路ではないことを画面で明示する */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'var(--accent-track)', boxShadow: 'var(--card-shadow)' }}
      >
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          これは一時的な手段です。毎回貼り付ける必要はありません。
          <br />
          Gmail 連携を設定すると、通知メールは自動で取り込まれます。
        </p>
        <Link
          href="/settings/gmail"
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          自動取得を設定する
          <span aria-hidden>→</span>
        </Link>
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

      <Card>
        <label
          className="text-[11px] font-medium tracking-[0.08em] uppercase"
          style={{ color: 'var(--ink-muted)' }}
        >
          メール本文
        </label>
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setSaved(null);
            setRescued(null);
          }}
          rows={8}
          placeholder={
            'ご利用日: 2026/09/03\nご利用先: ローソン渋谷\nご利用金額: 3,500円\n支払方法: 1回払い'
          }
          className="mt-2 w-full resize-y rounded-2xl p-3 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />

        {preview.length > 0 ? (
          <>
            <ul
              className="mt-4 divide-y overflow-hidden rounded-2xl"
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
              className="mt-4 w-full rounded-full py-3 text-sm font-semibold"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {preview.length} 件を取り込む
            </button>
          </>
        ) : null}

        {/* 辞書で読めなかったメールは AI に回せる。押されたときだけ呼ぶ。 */}
        {byLabels && byLabels.transactions.length === 0 && rescued === null ? (
          <button
            type="button"
            onClick={() => void askAi()}
            disabled={asking}
            className="mt-4 w-full rounded-full py-3 text-sm font-semibold"
            style={{
              background: 'var(--plane)',
              color: 'var(--accent)',
              border: '1px solid var(--hairline)',
              opacity: asking ? 0.6 : 1,
            }}
          >
            {asking ? '読み取っています…' : 'AI に読み取らせる'}
          </button>
        ) : null}

        {rescued && rescued.transactions.length > 0 ? (
          <p className="mt-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
            AI が読み取りました。金額と日付が合っているか確認してください。
          </p>
        ) : null}

        {/* 読めなかった理由を黙って捨てない */}
        {parsed && parsed.warnings.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {parsed.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
