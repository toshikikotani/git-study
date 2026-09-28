'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { saveImportBatchAction } from '../actions';
import { Card } from '@/components/ui/card';
import { TransactionRow } from '@/components/ui/transaction-row';
import {
  parseNotificationEmail,
  type EmailParseResult,
  type ParsedEmailTransaction,
} from '@/features/import/email';
import { fetchAccounts, type AccountOption } from '@/features/transactions/accounts-client';
import { fetchGenreOptions, type GenreOption } from '@/features/transactions/genres-client';
import { buildPreview } from '@/features/transactions/import-pipeline';
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
  const [genreOptions, setGenreOptions] = useState<GenreOption[]>([]);
  /** 行ごとに本人が選び直したジャンル(未選択の行は id をキーに持たない)。 */
  const [genreOverrides, setGenreOverrides] = useState<Map<string, string>>(new Map());
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // ジャンル一覧(ADR-057)。取り込み時にAIで確定させることはしない。
  useEffect(() => {
    void fetchGenreOptions().then(setGenreOptions);
  }, []);

  // 口座(M6-2)。取得できたら最初の1件を既定にする(選び直せる)
  useEffect(() => {
    void fetchAccounts().then((fetched) => {
      setAccounts(fetched);
      setAccountId((current) => current || (fetched[0]?.id ?? ''));
    });
  }, []);

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
    if (!parsed || !accountId) return [];
    return buildPreview(parsed.transactions, accountId, (i) => `paste-${i}`, 'manual');
  }, [parsed, accountId]);

  // 本人がその場で選び直したジャンルを重ねる。本文を書き換えると
  // rulePreview の内容が総入れ替えになるため、古い genreOverrides は
  // 自然に参照されなくなる。
  const preview = useMemo<StoredTransaction[]>(() => {
    if (genreOverrides.size === 0) return rulePreview;
    return rulePreview.map((t) => {
      const genreId = genreOverrides.get(t.id);
      if (genreId === undefined) return t;
      return {
        ...t,
        genreId,
        genreName: genreOptions.find((g) => g.id === genreId)?.name ?? null,
        classifiedBy: 'manual',
      };
    });
  }, [rulePreview, genreOverrides, genreOptions]);

  function setRowGenre(transactionId: string, genreId: string): void {
    setGenreOverrides((prev) => {
      const next = new Map(prev);
      if (genreId === '') {
        next.delete(transactionId);
      } else {
        next.set(transactionId, genreId);
      }
      return next;
    });
  }

  const save = async () => {
    if (!accountId) return;
    setSaveError(null);
    const outcome = await saveImportBatchAction(preview, {
      fileName: 'メール貼り付け',
      source: 'manual',
      accountId,
      failedCount: parsed?.warnings.length ?? 0,
    });
    if (outcome.error) {
      setSaveError(outcome.error);
      return;
    }
    setSaved(outcome);
    setBody('');
  };

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          メールを貼り付ける
        </h1>
        <Link href="/spending" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
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
            href="/spending"
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
                <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <TransactionRow transaction={t} />
                  </div>
                  <select
                    value={t.genreId ?? ''}
                    onChange={(e) => setRowGenre(t.id, e.target.value)}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs"
                    style={{
                      background: 'var(--surface)',
                      color: 'var(--ink)',
                      border: '1px solid var(--hairline)',
                    }}
                  >
                    <option value="">未分類</option>
                    {genreOptions.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>

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
