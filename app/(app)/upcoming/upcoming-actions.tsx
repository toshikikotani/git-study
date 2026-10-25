'use client';

import { useEffect, useState } from 'react';

import {
  confirmDetectedFixedAction,
  releaseCategoryFixedAction,
  restoreCategoryFixedAction,
} from './actions';

function yen(n: number): string {
  return `${n.toLocaleString('ja-JP')}円`;
}

type MixedCategory = { genreId: string; genreName: string; amountYen: number };

/**
 * カテゴリごと固定費に毎月ちがう出費が入っているときの「固定費から外しますか？」(デザイン v3-7)。
 * 外したら「元に戻す」を出す。「このままにする」はこの端末で次から聞かない。
 */
export function CategoryFixedBanner({
  categories,
  fixedTotalYen,
}: {
  categories: readonly MixedCategory[];
  fixedTotalYen: number;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // 「このままにする」はこの端末に残す。サーバーの表示とそろえるため、読むのは表示のあと。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(readDismissed());
  }, []);
  const [released, setReleased] = useState<MixedCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = categories.filter((c) => !hidden.has(c.genreId));

  // 押したらすぐ変える(保存はうしろで。できなければ戻して理由を出す、ADR-117)。画面の数字は
  // アクションの返事で作り直される(router.refresh() は要らない)。
  const release = async (c: MixedCategory) => {
    setError(null);
    setReleased(c);
    const result = await releaseCategoryFixedAction(c.genreId);
    if (result.error) {
      setReleased(null);
      setError(result.error);
    }
  };
  const undo = async () => {
    if (!released) return;
    const target = released;
    setError(null);
    setReleased(null);
    const result = await restoreCategoryFixedAction(target.genreId);
    if (result.error) {
      setReleased(target);
      setError(result.error);
    }
  };
  const dismiss = (c: MixedCategory) => {
    const next = new Set(hidden).add(c.genreId);
    setHidden(next);
    writeDismissed(next);
  };

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="rounded-xl px-3 py-2 text-[13px]"
          style={{ background: 'var(--note)', color: 'var(--over)' }}
        >
          {error}
        </p>
      ) : null}
      {released ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2"
          style={{ background: 'var(--income-track)' }}
        >
          <span className="text-[13px] font-semibold" style={{ color: 'var(--income)' }}>
            {released.genreName}を固定費から外しました
          </span>
          <button
            type="button"
            onClick={() => void undo()}
            className="min-h-11 shrink-0 px-1 text-[13px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            元に戻す
          </button>
        </div>
      ) : null}
      {shown
        .filter((c) => c.genreId !== released?.genreId)
        .map((c) => (
          <section
            key={c.genreId}
            className="flex flex-col gap-2 rounded-2xl px-4 py-4"
            style={{ background: 'var(--state-caution-track)' }}
          >
            <span className="text-[15px] font-bold" style={{ color: 'var(--state-caution)' }}>
              {c.genreName}がカテゴリごと固定費になっています
            </span>
            <span className="text-[13px] leading-normal" style={{ color: 'var(--ink-secondary)' }}>
              固定費 {yen(fixedTotalYen)} のうち {yen(c.amountYen)} は{c.genreName}
              の支払いです。毎月ちがう出費が固定費に入ると、「最近の勢い」や1日の目安から外れてしまいます。
            </span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void release(c)}
                className="btn-primary min-h-11 rounded-full text-[15px] font-semibold"
              >
                固定費から外す
              </button>
              <button
                type="button"
                onClick={() => dismiss(c)}
                className="min-h-11 rounded-full text-[15px] font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--ink)' }}
              >
                このままにする
              </button>
            </div>
          </section>
        ))}
    </>
  );
}

type Detected = { key: string; label: string; amountYen: number; nextOn: string };

/** 見つけた定期支払い(同じ店・同じくらいの額が2か月続いたもの)。「固定費にする」で、その店・額だけ固定費に。 */
export function DetectedPayments({ detected }: { detected: readonly Detected[] }) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const confirm = async (d: Detected) => {
    setError(null);
    setDone((prev) => new Set(prev).add(d.key));
    const result = await confirmDetectedFixedAction(d.key);
    if (result.error) {
      setDone((prev) => {
        const next = new Set(prev);
        next.delete(d.key);
        return next;
      });
      setError(result.error);
    }
  };
  return (
    <div className="flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
      {error ? (
        <p role="alert" className="px-4 pt-3 text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
      {detected.length === 0 ? (
        <p className="px-4 py-3 text-[13px] leading-normal" style={{ color: 'var(--ink-muted)' }}>
          まだありません。同じ店・同じくらいの金額の記録が2か月続くと、ここで「固定費にしますか？」と聞きます。
        </p>
      ) : (
        detected.map((d, i) => (
          <div
            key={d.key}
            className="flex items-center gap-3 px-4 py-2"
            style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
                {d.label}
              </span>
              <span className="tabular text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                毎月 {yen(d.amountYen)} · 次は{Number(d.nextOn.slice(5, 7))}月
                {Number(d.nextOn.slice(8, 10))}日ごろ
              </span>
            </span>
            {done.has(d.key) ? (
              <span className="text-[13px] font-semibold" style={{ color: 'var(--income)' }}>
                固定費にしました
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void confirm(d)}
                className="min-h-11 shrink-0 rounded-full px-4 text-[13px] font-semibold"
                style={{ background: 'var(--plane)', color: 'var(--accent)' }}
              >
                固定費にする
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

const DISMISSED_KEY = 'upcoming-category-fixed-dismissed';

function readDismissed(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // 端末に残せなくても、この画面のあいだは隠したまま。
  }
}
