'use client';

/**
 * ジャンル別支出のカード(本人発案「投資家目線で客観的にジャンル細分化する
 * AIを作ってほしい。第三者の分類があると第三者目線での分析ができる」、
 * ADR-056)。押されたときだけ AI を呼ぶ(diagnosis-card.tsx と同じ設計)。
 *
 * ── 内訳は開くまで畳んでおく(本人からのUX指摘「パンパンパンパン、
 *    詳細見たかったら詳細見るみたいな感じがいい」)──────────────────
 * 「絶対払わざるを得ないもの」の内訳(下記)は件数が伸びやすいため、
 * diagnosis-card.tsx と同じく「詳しく見る」を押すまで畳む。
 *
 * ── カテゴリ×ジャンルの内訳(旧)は廃止し、must_pay の分け方に置き換えた
 *    (ADR-057)──────────────────────────────────────────
 * ADR-057により主観的なカテゴリ(生活費・浪費など)自体が廃止されたため、
 * 「カテゴリ別にジャンルを分けて見る」というこのカード本来の分析軸が
 * 意味を持たなくなった。代わりに本人発案の「絶対払わざるを得ないものは
 * ラベルを付けてグラフで表示分けできるように」を実装し、ジャンルの内訳を
 * 必須(must_pay)/裁量の2軸でも見られるようにした。
 */

import { useState } from 'react';

import { formatYen } from '@/domain/money';
import { summarizeByGenre, summarizeMustPaySplit, type GenredEntry } from '@/domain/genre';
import { classifyGenresAction } from './actions';

export function GenreBreakdownCard({
  entries,
  initialPendingCount,
}: {
  entries: readonly GenredEntry[];
  initialPendingCount: number;
}) {
  const [pendingCount, setPendingCount] = useState(initialPendingCount);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const genreTotals = summarizeByGenre(entries);
  const mustPaySplit = summarizeMustPaySplit(entries);
  const maxGenreYen = Math.max(...genreTotals.map((g) => g.totalYen), 1);
  const mustPayTotalYen = mustPaySplit.mustPayYen + mustPaySplit.discretionaryYen;
  const mustPayRatio = mustPayTotalYen > 0 ? mustPaySplit.mustPayYen / mustPayTotalYen : 0;

  const run = async () => {
    setRunning(true);
    setError(null);
    const result = await classifyGenresAction();
    setRunning(false);
    setWarnings(result.warnings);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPendingCount((prev) => Math.max(prev - result.classifiedCount, 0));
  };

  return (
    <div
      className="rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        今月のジャンル別支出
      </h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        本人が付けたカテゴリとは別に、AIが内容から機械的に割り当てた客観的なジャンルです。
      </p>

      {genreTotals.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
          まだジャンル分類された支出がありません。
        </p>
      ) : (
        <>
          <ol className="mt-4 space-y-3">
            {genreTotals.map((g) => (
              <li key={g.genreId}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-medium" style={{ color: 'var(--ink)' }}>
                    {g.genreName}
                  </span>
                  <span className="tabular shrink-0 font-medium" style={{ color: 'var(--ink)' }}>
                    {formatYen(g.totalYen, { sign: 'never' })}
                  </span>
                </div>
                <div
                  className="mt-1 h-2 overflow-hidden rounded-full"
                  style={{ background: 'var(--accent-track)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round((g.totalYen / maxGenreYen) * 100)}%`,
                      background: 'var(--accent)',
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>

          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="mt-4 text-xs font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            {detailsOpen ? '閉じる' : '絶対払わざるを得ないものの内訳を見る'}
          </button>

          {detailsOpen ? (
            <div
              className="mt-3 space-y-3 border-t pt-3"
              style={{ borderColor: 'var(--hairline)' }}
            >
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                明細1件ごとに本人が付けた「絶対払わざるを得ないもの」のラベル
                (ジャンルとは独立)で、今月の支出を分けています。
              </p>

              <div
                className="flex h-3 overflow-hidden rounded-full"
                style={{ background: 'var(--over-track)' }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${Math.round(mustPayRatio * 100)}%`,
                    background: 'var(--accent)',
                  }}
                />
              </div>

              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span style={{ color: 'var(--ink)' }}>
                  <span
                    className="mr-1.5 inline-block size-2 rounded-full align-middle"
                    style={{ background: 'var(--accent)' }}
                  />
                  必須({Math.round(mustPayRatio * 100)}%)
                </span>
                <span className="tabular font-medium" style={{ color: 'var(--ink)' }}>
                  {formatYen(mustPaySplit.mustPayYen, { sign: 'never' })}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span style={{ color: 'var(--ink)' }}>
                  <span
                    className="mr-1.5 inline-block size-2 rounded-full align-middle"
                    style={{ background: 'var(--over-track)' }}
                  />
                  裁量({Math.round((1 - mustPayRatio) * 100)}%)
                </span>
                <span className="tabular font-medium" style={{ color: 'var(--ink)' }}>
                  {formatYen(mustPaySplit.discretionaryYen, { sign: 'never' })}
                </span>
              </div>
            </div>
          ) : null}
        </>
      )}

      {pendingCount > 0 ? (
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="mt-4 w-full rounded-full py-2.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {running ? 'ジャンル分類しています…' : `今月の${pendingCount}件をジャンル分類する`}
        </button>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
