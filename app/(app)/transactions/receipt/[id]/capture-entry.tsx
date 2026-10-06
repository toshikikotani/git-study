'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ImageEditor } from '@/components/receipt/image-editor';
import { ZoomableImage } from '@/components/receipt/zoomable-image';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import {
  CAPTURE_FIELD_LABEL,
  applyConflict,
  draftHasInput,
  initialValuesFor,
  judgeReadResult,
  mergeRescan,
  validateManualEntry,
  type CaptureField,
  type ManualEntryValues,
  type RescanConflict,
} from '@/domain/receipt-capture';
import { resizeToJpegBase64 } from '@/features/import/resize-image';
import type { CaptureView } from '@/features/receipt-captures/types';
import { hapticFor } from '@/lib/haptics';
import { markJustSaved } from '@/lib/just-saved';
import { checkReceiptDuplicatesAction, undoReceiptSaveAction } from '../../actions';
import {
  attachCaptureToTransactionAction,
  discardCaptureAction,
  recordRescanAction,
  replaceCaptureImageAction,
  resolveCaptureAction,
  restoreCaptureAction,
  saveCaptureDraftAction,
  saveEditedCaptureImageAction,
} from '../capture-actions';
import {
  ManualEntryForm,
  type ManualEntryAccount,
  type ManualEntryGenre,
} from '../../manual-entry-form';

type Duplicate = { id: string; occurredOn: string; amountYen: number };
type Done =
  { kind: 'saved'; ids: string[]; label: string } | { kind: 'discarded' } | { kind: 'attached' };

const localKey = (id: string) => `capture-draft:${id}`;

/**
 * 入力待ちのレシートを手で入力する画面(F7)。
 * 上に画像(固定・ズーム可)、下に入力フォームを置き、画像を見ながら入力できる。
 * 入力途中は自動で下書き保存され、離れても消えない。破棄は確認を挟み、あとで元に戻せる。
 */
export function CaptureEntry({
  capture,
  genres,
  accounts,
  recentStores,
  today,
}: {
  capture: CaptureView;
  genres: readonly ManualEntryGenre[];
  accounts: readonly ManualEntryAccount[];
  recentStores: readonly string[];
  today: string;
}) {
  const defaultAccount = accounts[0]?.id ?? '';
  const [values, setValues] = useState<ManualEntryValues>(() => {
    if (capture.draft) return capture.draft.values;
    try {
      const raw = window.localStorage.getItem(localKey(capture.id));
      if (raw) return (JSON.parse(raw) as { values: ManualEntryValues }).values;
    } catch {
      // ローカルの下書きは補助
    }
    return initialValuesFor(capture.readFields, today, defaultAccount);
  });
  const [touched, setTouched] = useState<Set<CaptureField>>(new Set(capture.draft?.touched ?? []));
  const [unread, setUnread] = useState<CaptureField[]>(capture.unreadFields);
  const [autofilled, setAutofilled] = useState<CaptureField[]>(
    capture.draft ? [] : (Object.keys(capture.readFields) as CaptureField[]),
  );
  const [imageUrl, setImageUrl] = useState(capture.imageUrl);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'rescan' | 'image'>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<RescanConflict[]>([]);
  const [duplicateHits, setDuplicateHits] = useState<Duplicate[]>([]);
  const [editing, setEditing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const takeRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  const openTake = () => takeRef.current?.click();
  const openPick = () => pickRef.current?.click();

  const errors = useMemo(() => validateManualEntry(values, today), [values, today]);

  // 下書きの自動保存(入力が止まって0.7秒後)。端末にも即座に写しておく。
  useEffect(() => {
    if (done !== null || !draftHasInput(values)) return;
    const draft = { values, touched: [...touched] };
    try {
      window.localStorage.setItem(localKey(capture.id), JSON.stringify(draft));
    } catch {
      // 保存できなくても下書き(サーバー)は残る
    }
    const timer = window.setTimeout(() => void saveCaptureDraftAction(capture.id, draft), 700);
    return () => window.clearTimeout(timer);
  }, [values, touched, capture.id, done]);

  // 重複の警告(同じ日・同じ店・近い金額)。金額と店名がそろったときだけ確かめる。
  const canProbe =
    values.amountYen !== null && values.amountYen > 0 && values.storeName.trim() !== '';
  useEffect(() => {
    if (!canProbe) return;
    const timer = window.setTimeout(() => {
      void checkReceiptDuplicatesAction([
        {
          key: 'k',
          storeName: values.storeName,
          occurredOn: values.occurredOn,
          amountYen: -values.amountYen!,
        },
      ]).then((r) => setDuplicateHits(r.duplicates.k ?? []));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [canProbe, values.amountYen, values.storeName, values.occurredOn]);
  const duplicates = canProbe ? duplicateHits : [];

  const onChange = (next: ManualEntryValues, field?: CaptureField) => {
    setValues(next);
    if (field) {
      setTouched((prev) => new Set(prev).add(field));
      setUnread((prev) => prev.filter((f) => f !== field));
      setAutofilled((prev) => prev.filter((f) => f !== field));
    }
  };

  /** 画像を読み取り直し、入力中の値は上書きせずに取り込む(差分は本人に選ばせる)。 */
  const rescan = async (imageBase64: string) => {
    setBusy('rescan');
    setMessage(null);
    try {
      const response = await fetch('/api/import/receipt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: imageBase64, mediaType: 'image/jpeg' }),
      });
      if (!response.ok) throw new Error('read failed');
      const result = (await response.json()) as { transactions: never[]; warnings: string[] };
      const judged = judgeReadResult(result.transactions);
      void recordRescanAction(capture.id, result);
      const merged = mergeRescan(values, touched, judged.readFields, today);
      setValues(merged.values);
      setUnread(
        judged.unreadFields.filter((f) => merged.values[f] === '' || merged.values[f] === null),
      );
      setAutofilled((prev) => [...new Set([...prev, ...merged.filled])]);
      setConflicts(merged.conflicts);
      setMessage(
        merged.filled.length + merged.conflicts.length === 0
          ? '新しく読み取れた項目はありませんでした。'
          : merged.filled.length > 0
            ? `${merged.filled.map((f) => CAPTURE_FIELD_LABEL[f]).join('・')}を読み取って入れました。`
            : '入力済みの内容と違う項目があります。',
      );
    } catch {
      setMessage('読み取れませんでした。通信状況を確かめて、もう一度お試しください。');
    } finally {
      setBusy(null);
    }
  };

  const rescanCurrent = async () => {
    if (imageUrl === null) return;
    setBusy('rescan');
    try {
      const blob = await (await fetch(imageUrl)).blob();
      await rescan(await resizeToJpegBase64(new File([blob], 'receipt.jpg', { type: blob.type })));
    } catch {
      setMessage('画像を読み込めませんでした。');
      setBusy(null);
    }
  };

  const replaceImage = async (file: File | undefined) => {
    if (!file) return;
    setBusy('image');
    setMessage(null);
    try {
      const base64 = await resizeToJpegBase64(file);
      const result = await replaceCaptureImageAction(capture.id, base64);
      if (result.error) {
        setMessage(result.error);
        setBusy(null);
        return;
      }
      setImageUrl(URL.createObjectURL(file));
      await rescan(base64);
    } catch {
      setMessage('画像を読み込めませんでした。');
      setBusy(null);
    }
  };

  const save = async () => {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return;
    setBusy('save');
    const result = await resolveCaptureAction({ id: capture.id, values });
    setBusy(null);
    if (result.error !== null) {
      setMessage(result.error);
      return;
    }
    hapticFor('save');
    markJustSaved(result.insertedIds);
    try {
      window.localStorage.removeItem(localKey(capture.id));
    } catch {
      // 何もしない
    }
    setDone({
      kind: 'saved',
      ids: result.insertedIds,
      label: `${values.storeName.trim() || 'レシート'} ${(values.amountYen ?? 0).toLocaleString('ja-JP')}円`,
    });
  };

  const undo = async () => {
    if (done === null) return;
    if (done.kind === 'saved') {
      const r = await undoReceiptSaveAction(done.ids);
      if (r.error) return setMessage(r.error);
    }
    if (done.kind !== 'attached') {
      const r = await restoreCaptureAction(capture.id);
      if (r.error) return setMessage(r.error);
    }
    setDone(null);
    setMessage('元に戻しました。入力を続けられます。');
  };

  const discard = async () => {
    setConfirmDiscard(false);
    const r = await discardCaptureAction(capture.id);
    if (r.error) return setMessage(r.error);
    setDone({ kind: 'discarded' });
  };

  const attach = async (transactionId: string) => {
    setBusy('save');
    const r = await attachCaptureToTransactionAction(capture.id, transactionId);
    setBusy(null);
    if (r.error) return setMessage(r.error);
    setDone({ kind: 'attached' });
  };

  if (done !== null) {
    return (
      <div className="space-y-4 py-8 text-center" role="status">
        <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          {done.kind === 'saved'
            ? `${done.label} を保存しました`
            : done.kind === 'attached'
              ? '既存の明細に画像を添付しました'
              : 'このレシートを破棄しました'}
        </p>
        {done.kind === 'attached' ? null : (
          <button
            type="button"
            onClick={() => void undo()}
            className="min-h-11 px-4 text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            元に戻す
          </button>
        )}
        <div>
          <Link
            href="/spending"
            className="inline-flex min-h-11 items-center px-4 text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            家計簿へ →
          </Link>
        </div>
        {message ? (
          <p className="text-xs" style={{ color: 'var(--over)' }}>
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 画像は上に固定して、見ながら入力できるようにする(ズーム・ピンチ可) */}
      <div
        className="sticky top-0 z-20 -mx-4 overflow-hidden"
        style={{ background: 'var(--plane)' }}
      >
        {imageUrl ? (
          <ZoomableImage
            src={imageUrl}
            alt="レシート画像"
            highlightRatio={null}
            className="h-[34dvh]"
          />
        ) : (
          <p className="p-6 text-center text-xs" style={{ color: 'var(--ink-secondary)' }}>
            画像を表示できませんでした
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="画像の操作">
        <ActionChip
          label="もう一度読み取る"
          onClick={() => void rescanCurrent()}
          disabled={busy !== null || imageUrl === null}
        />
        <ActionChip label="撮り直す" onClick={openTake} disabled={busy !== null} />
        <ActionChip label="写真から選ぶ" onClick={openPick} disabled={busy !== null} />
        <ActionChip
          label="画像を補正"
          onClick={() => setEditing(true)}
          disabled={busy !== null || imageUrl === null}
        />
        <input
          ref={takeRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void replaceImage(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={pickRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void replaceImage(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {busy === 'rescan' ? (
        <p role="status" className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          読み取り中…(入力した内容はそのまま残ります)
        </p>
      ) : message ? (
        <p role="status" className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {message}
        </p>
      ) : null}

      {conflicts.length > 0 ? (
        <div
          role="region"
          aria-label="読み取り結果との違い"
          className="space-y-2 rounded-2xl p-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--state-caution)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            <span aria-hidden>▲ </span>読み取り結果と、入力済みの内容が違います
          </p>
          {conflicts.map((c) => (
            <div key={c.field} className="flex items-center justify-between gap-2 text-sm">
              <span className="tabular min-w-0" style={{ color: 'var(--ink)' }}>
                {CAPTURE_FIELD_LABEL[c.field]}:{c.current} → {c.rescanned}
              </span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setValues((v) => applyConflict(v, c));
                    setConflicts((prev) => prev.filter((x) => x.field !== c.field));
                  }}
                  className="min-h-11 px-2 text-xs font-semibold"
                  style={{ color: 'var(--ink)' }}
                >
                  置き換える
                </button>
                <button
                  type="button"
                  onClick={() => setConflicts((prev) => prev.filter((x) => x.field !== c.field))}
                  className="min-h-11 px-2 text-xs"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  そのまま
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <ManualEntryForm
        values={values}
        onChange={onChange}
        genres={genres}
        accounts={accounts}
        recentStores={recentStores}
        unread={unread}
        autofilled={autofilled}
        errors={errors}
        showErrors={showErrors}
      />

      {duplicates.length > 0 ? (
        <div
          role="alert"
          className="space-y-2 rounded-2xl p-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--state-caution)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            <span aria-hidden>▲ </span>同じ日・同じ店・近い金額の明細が既にあります
          </p>
          {duplicates.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="tabular" style={{ color: 'var(--ink-secondary)' }}>
                {d.occurredOn.slice(5).replace('-', '/')}{' '}
                {Math.abs(d.amountYen).toLocaleString('ja-JP')}円
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void attach(d.id)}
                className="min-h-11 px-2 text-xs font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                この明細に添付する
              </button>
            </div>
          ))}
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            別の買い物なら、そのまま保存できます。
          </p>
        </div>
      ) : null}

      <div className="sticky bottom-24 z-20">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== null}
          className="min-h-12 w-full rounded-2xl text-base font-semibold disabled:opacity-50"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          {busy === 'save' ? '保存しています…' : '保存する'}
        </button>
      </div>

      <div className="pt-6 text-center">
        <button
          type="button"
          onClick={() => setConfirmDiscard(true)}
          className="min-h-11 px-4 text-xs font-semibold"
          style={{ color: 'var(--over)' }}
        >
          このレシートを破棄する
        </button>
      </div>

      <BottomSheet open={confirmDiscard} onClose={() => setConfirmDiscard(false)} role="dialog">
        <div className="space-y-3 px-4 pt-2 pb-4">
          <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            このレシートを破棄しますか?
          </p>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            入力待ちから外れます。画像は残り、破棄した直後なら元に戻せます。
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className="min-h-11 flex-1 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--plane)', color: 'var(--ink)' }}
            >
              やめる
            </button>
            <button
              type="button"
              onClick={() => void discard()}
              className="min-h-11 flex-1 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--over)', color: 'var(--on-accent)' }}
            >
              破棄する
            </button>
          </div>
        </div>
      </BottomSheet>

      {editing && imageUrl ? (
        <ImageEditor
          src={imageUrl}
          onClose={() => setEditing(false)}
          onSave={async (base64) => {
            const r = await saveEditedCaptureImageAction(capture.id, base64);
            if (r.error) throw new Error(r.error);
            setImageUrl(`data:image/jpeg;base64,${base64}`);
            setEditing(false);
            await rescan(base64);
          }}
        />
      ) : null}
    </div>
  );
}

function ActionChip({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-11 rounded-full px-4 text-xs font-semibold disabled:opacity-40"
      style={{
        background: 'var(--surface)',
        color: 'var(--ink)',
        border: '1px solid var(--hairline)',
      }}
    >
      {label}
    </button>
  );
}
