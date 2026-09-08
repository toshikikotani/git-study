'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { Card } from '@/components/ui/card';
import { TransactionRow } from '@/components/ui/transaction-row';
import {
  GENERIC_ADAPTER,
  guessMapping,
  importCsv,
  inspectCsv,
  type ImportAdapter,
} from '@/features/import/adapters';
import { buildPreview, saveBatch } from '@/features/transactions/import-pipeline';
import type { StoredTransaction } from '@/features/transactions/store';

/**
 * CSV 取り込み(FR-10, M2-2)。
 *
 * 仕様書 13章はこの作業を「月1の整理の儀式」と位置づけている。
 * 儀式である以上、途中で詰まらないことが最優先になる。
 *   - 列は自動で推測し、外れたら直せる
 *   - 1行の失敗で全体を止めない。失敗行は行番号と理由を出す
 *   - 取り込む前に結果を見せる。確定は本人が押す
 */

type Loaded = {
  fileName: string;
  bytes: Uint8Array;
  encoding: string;
  header: string[] | null;
  totalRows: number;
};

export default function ImportPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saved, setSaved] = useState<{ imported: number; duplicates: number } | null>(null);
  const [adapter, setAdapter] = useState<ImportAdapter>(GENERIC_ADAPTER);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = inspectCsv(bytes);
      const guess = guessMapping(info.header);

      setLoaded({
        fileName: file.name,
        bytes,
        encoding: info.encoding,
        header: info.header,
        totalRows: info.totalRows,
      });
      // 推測できた列だけを上書きする。推測できなかった項目は既定値のまま
      setAdapter({ ...GENERIC_ADAPTER, ...guess, name: file.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoaded(null);
    }
  }, []);

  const result = useMemo(() => {
    if (!loaded) return null;
    try {
      return importCsv(loaded.bytes, adapter);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  }, [loaded, adapter]);

  const preview = useMemo<StoredTransaction[]>(() => {
    if (!result || 'error' in result) return [];
    const rows = result.transactions;
    return buildPreview(rows, 'pending', (i) => `${rows[i]!.lineNumber}-${i}`);
  }, [result]);

  const save = async () => {
    if (!loaded || preview.length === 0) return;
    setSaving(true);
    const outcome = await saveBatch(preview, {
      fileName: loaded.fileName,
      failedCount: result && !('error' in result) ? result.errors.length : 0,
    });
    // 一覧へ飛ばさず結果を出す。重複で0件だったとき、黙って戻ると
    // 壊れているのか取り込めたのか区別が付かない。
    setSaved(outcome);
    setSaving(false);
  };

  if (saved) {
    return <SavedResult {...saved} />;
  }

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          CSV を取り込む
        </h1>
        <Link href="/transactions" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          やめる
        </Link>
      </header>

      {/* 1. ファイル */}
      <Card>
        <Step n={1} title="ファイルを選ぶ" />
        <label
          className="mt-3 block cursor-pointer rounded-2xl border border-dashed px-4 py-8 text-center"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
            {loaded ? loaded.fileName : 'CSV ファイルを選ぶ'}
          </span>
          <span className="mt-1 block text-xs" style={{ color: 'var(--ink-muted)' }}>
            Shift_JIS のままで構いません
          </span>
        </label>

        {loaded ? (
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <Meta label="文字コード" value={loaded.encoding} />
            <Meta label="行数" value={`${loaded.totalRows} 行`} />
            <Meta label="列数" value={`${loaded.header?.length ?? 0} 列`} />
          </dl>
        ) : null}

        {error ? (
          <p className="mt-3 text-sm" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        ) : null}
      </Card>

      {/* 2. 列の対応 */}
      {loaded ? (
        <Card>
          <Step n={2} title="列の対応を確かめる" />
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            ヘッダから推測しています。違っていれば選び直してください。
          </p>

          <div className="mt-3 space-y-2">
            <ColumnSelect
              label="日付"
              header={loaded.header}
              value={adapter.dateColumn}
              onChange={(v) => setAdapter({ ...adapter, dateColumn: v })}
            />
            <ColumnSelect
              label="摘要"
              header={loaded.header}
              value={adapter.descriptionColumn}
              onChange={(v) => setAdapter({ ...adapter, descriptionColumn: v })}
            />
            {adapter.amountColumn !== undefined ? (
              <>
                <ColumnSelect
                  label="金額"
                  header={loaded.header}
                  value={adapter.amountColumn}
                  onChange={(v) => setAdapter({ ...adapter, amountColumn: v })}
                />
                <label className="flex items-center gap-2 pt-1 text-xs">
                  <input
                    type="checkbox"
                    checked={adapter.amountSign === 'expense_positive'}
                    onChange={(e) =>
                      setAdapter({
                        ...adapter,
                        amountSign: e.target.checked ? 'expense_positive' : 'as_is',
                      })
                    }
                  />
                  <span style={{ color: 'var(--ink-secondary)' }}>
                    金額が正の数で支出を表している(カード明細に多い)
                  </span>
                </label>
              </>
            ) : (
              <>
                <ColumnSelect
                  label="出金"
                  header={loaded.header}
                  value={adapter.amountOutColumn ?? ''}
                  onChange={(v) => setAdapter({ ...adapter, amountOutColumn: v })}
                />
                <ColumnSelect
                  label="入金"
                  header={loaded.header}
                  value={adapter.amountInColumn ?? ''}
                  onChange={(v) => setAdapter({ ...adapter, amountInColumn: v })}
                />
              </>
            )}
          </div>
        </Card>
      ) : null}

      {/* 3. プレビュー */}
      {result && 'error' in result ? (
        <Card>
          <p className="text-sm" style={{ color: 'var(--over)' }}>
            {result.error}
          </p>
        </Card>
      ) : null}

      {result && !('error' in result) ? (
        <Card>
          <Step n={3} title="取り込む内容を確かめる" />

          <div className="mt-3 flex gap-2">
            <Count label="取り込む" value={result.transactions.length} tone="accent" />
            <Count label="読めない行" value={result.errors.length} tone="over" />
          </div>

          {preview.length > 0 ? (
            <ul
              className="mt-4 divide-y overflow-hidden rounded-2xl"
              style={{ borderColor: 'var(--hairline)', background: 'var(--plane)' }}
            >
              {preview.slice(0, 6).map((t) => (
                <TransactionRow key={t.id} transaction={t} />
              ))}
            </ul>
          ) : null}

          {preview.length > 6 ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
              ほか {preview.length - 6} 件
            </p>
          ) : null}

          {/* 1行の失敗で全体を止めない。何行目がなぜ落ちたかを出す */}
          {result.errors.length > 0 ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs" style={{ color: 'var(--over)' }}>
                読めなかった {result.errors.length} 行を見る
              </summary>
              <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                {result.errors.slice(0, 10).map((e) => (
                  <li key={e.lineNumber}>
                    {e.lineNumber} 行目: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <button
            type="button"
            onClick={() => void save()}
            disabled={preview.length === 0 || saving}
            className="mt-5 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {saving ? '取り込み中…' : `${preview.length} 件を取り込む`}
          </button>

          <p className="mt-2 text-center text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Supabase 未接続のため、いまはブラウザに一時保存されます
          </p>
        </Card>
      ) : null}
    </div>
  );
}

/** 取り込み後の結果。何件入って何件が重複だったかを必ず示す。 */
function SavedResult({ imported, duplicates }: { imported: number; duplicates: number }) {
  return (
    <div className="rise space-y-4">
      <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        取り込みました
      </h1>

      <Card>
        <div className="flex gap-2">
          <Count label="取り込んだ" value={imported} tone="accent" />
          <Count label="重複で除いた" value={duplicates} tone="accent" />
        </div>

        {imported === 0 && duplicates > 0 ? (
          <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            すべて取り込み済みの明細でした。同じファイルを二度取り込んでも増えません。
          </p>
        ) : null}

        <Link
          href="/transactions"
          className="mt-5 block w-full rounded-full py-3 text-center text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          明細を見る
        </Link>
      </Card>
    </div>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="tabular flex size-5 items-center justify-center rounded-full text-[11px] font-semibold"
        style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
      >
        {n}
      </span>
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        {title}
      </h2>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline" style={{ color: 'var(--ink-muted)' }}>
        {label}{' '}
      </dt>
      <dd className="inline font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {value}
      </dd>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: 'accent' | 'over' }) {
  const color = tone === 'over' && value > 0 ? 'var(--over)' : 'var(--accent)';
  const bg = tone === 'over' && value > 0 ? 'var(--over-track)' : 'var(--accent-track)';
  return (
    <div className="flex-1 rounded-2xl px-3 py-2.5" style={{ background: bg }}>
      <p className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      <p className="tabular text-lg font-semibold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function ColumnSelect({
  label,
  header,
  value,
  onChange,
}: {
  label: string;
  header: string[] | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = header ?? [];
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm"
        style={{
          background: 'var(--plane)',
          color: 'var(--ink)',
          border: '1px solid var(--hairline)',
          maxWidth: '60%',
        }}
      >
        <option value="">(指定なし)</option>
        {options.map((h, i) => (
          <option key={`${h}-${i}`} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
}
