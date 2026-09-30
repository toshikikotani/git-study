'use client';

/**
 * 「話して記録」「文字で記録」(N3)。
 *
 * 音声入力は端末の音声認識(Web Speech API)でテキスト化するだけで、
 * サーバーには音声そのものを送らない(N1「端末内で処理できるものは
 * 端末内で処理する」)。テキスト化したあとは、打って入力した場合と
 * まったく同じ経路(extractFromTextAction)で解析する。
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MdMic, MdMicOff } from 'react-icons/md';

import { fingerprintOf, type StoredTransaction } from '@/features/transactions/types';
import { fetchAccounts, type AccountOption } from '@/features/transactions/accounts-client';
import { hapticFor } from '@/lib/haptics';
import { pushUndo } from '@/lib/undo';
import { resolveGenreHint } from '@/domain/genre-hint';
import { saveImportBatchAction, undoReceiptSaveAction } from '../actions';
import {
  extractFromTextAction,
  fetchGenreNameOptionsAction,
  type GenreNameOption,
} from '../capture-actions';
import { CaptureCandidateCard, type EditableCandidate } from '../capture-candidate-card';

type Row = EditableCandidate & { key: string; status: 'idle' | 'saving' | 'saved' | 'error' };

// 標準化前のブラウザ実装(Safari 等)向け。
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
};

export function CaptureTextForm() {
  const [text, setText] = useState('');
  const [genres, setGenres] = useState<GenreNameOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);

  useEffect(() => {
    void fetchGenreNameOptionsAction().then(setGenres);
    void fetchAccounts().then(setAccounts);
    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .webkitSpeechRecognition;
    if (Ctor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザAPIの対応可否は一度きりの判定
      setSpeechSupported(true);
      const recognition = new Ctor();
      recognition.lang = 'ja-JP';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognitionRef.current = recognition;
    }
  }, []);

  function toggleListening(): void {
    const recognition = recognitionRef.current;
    if (recognition === null) return;
    if (listening) {
      recognition.stop();
      return;
    }
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0]?.transcript ?? '')
        .join('');
      setText((t) => (t.trim() === '' ? transcript : `${t} ${transcript}`));
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  }

  async function analyze(): Promise<void> {
    if (text.trim() === '') return;
    setAnalyzing(true);
    setError(null);
    setWarnings([]);
    const result = await extractFromTextAction(text);
    setAnalyzing(false);
    setWarnings(result.warnings);
    if (result.error) {
      setError(result.error);
      return;
    }
    setRows(
      result.candidates.map((c, i) => ({
        key: `${Date.now()}-${i}`,
        occurredOn: c.occurredOn,
        amountYen: c.amountYen,
        storeName: c.storeName,
        genreId: resolveGenreHint(c.genreHint, genres),
        confidence: c.confidence,
        status: 'idle' as const,
      })),
    );
  }

  async function save(row: Row): Promise<void> {
    const account = accounts[0];
    if (!account) return;
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, status: 'saving' } : r)));
    const genre = genres.find((g) => g.id === row.genreId);
    const store = row.storeName.trim() === '' ? '文字で記録' : row.storeName.trim();
    const amountYen = -Math.abs(row.amountYen);
    const preview: StoredTransaction = {
      id: 'capture-0',
      accountId: account.id,
      occurredOn: row.occurredOn,
      description: store,
      merchantName: store,
      amountYen,
      paymentMethod: 'one_time',
      genreId: row.genreId,
      genreName: genre?.name ?? null,
      classifiedBy: row.genreId ? 'manual' : 'unclassified',
      confidence: null,
      reviewStatus: 'auto_ok',
      mustPay: false,
      kind: 'normal',
      source: 'manual',
      fingerprint: fingerprintOf({ occurredOn: row.occurredOn, amountYen, description: store }),
      batchId: null,
      sourceRef: null,
      memo: null,
    };
    const outcome = await saveImportBatchAction([preview], {
      fileName: '文字で記録',
      source: 'manual',
      accountId: account.id,
      failedCount: 0,
    });
    if (outcome.error) {
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, status: 'error' } : r)));
      return;
    }
    hapticFor('save');
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, status: 'saved' } : r)));
    if (outcome.insertedIds.length > 0) {
      const ids = outcome.insertedIds;
      pushUndo(`${store} を登録しました`, async () => {
        const r = await undoReceiptSaveAction(ids);
        if (r.error === null) {
          setRows((prev) =>
            prev.map((row2) => (row2.key === row.key ? { ...row2, status: 'idle' } : row2)),
          );
        }
        return r.error;
      });
    }
  }

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          話して記録・文字で記録
        </h1>
        <Link
          href="/transactions"
          className="min-h-11 flex items-center text-xs"
          style={{ color: 'var(--ink-muted)' }}
        >
          やめる
        </Link>
      </header>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        普通の文章で書くと取引を読み取ります。例:「昨日ローソンでコーヒー150円とパン200円」
      </p>

      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="例:今日スタバでコーヒー500円"
          className="w-full rounded-2xl p-4 pr-14 text-sm outline-none"
          style={{
            background: 'var(--surface)',
            color: 'var(--ink)',
            boxShadow: 'var(--card-shadow)',
          }}
        />
        {speechSupported ? (
          <button
            type="button"
            aria-pressed={listening}
            aria-label={listening ? '音声入力を止める' : '音声で入力する'}
            onClick={toggleListening}
            className="absolute top-3 right-3 flex min-h-11 min-w-11 items-center justify-center rounded-full"
            style={{
              background: listening ? 'var(--over)' : 'var(--accent-track)',
              color: listening ? '#fff' : 'var(--accent)',
            }}
          >
            {listening ? <MdMicOff aria-hidden size={18} /> : <MdMic aria-hidden size={18} />}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void analyze()}
        disabled={analyzing || text.trim() === ''}
        className="min-h-11 w-full rounded-2xl text-sm font-semibold disabled:opacity-40"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        {analyzing ? '解析しています…' : '解析する'}
      </button>

      {error ? (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-3">
        {rows.map((row) => (
          <CaptureCandidateCard
            key={row.key}
            candidate={row}
            onChange={(next) =>
              setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, ...next } : r)))
            }
            genres={genres}
            accountName={accounts[0]?.name ?? '(口座未登録)'}
            status={row.status}
            onSave={() => void save(row)}
            onDiscard={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
          />
        ))}
      </div>

      {rows.length === 0 && !analyzing && text.trim() === '' ? (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          文章を入力して「解析する」を押すと、ここに取引の候補が出ます。
        </p>
      ) : null}
    </div>
  );
}
