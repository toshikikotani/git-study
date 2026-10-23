'use client';

import { useEffect, useMemo, useState } from 'react';

import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import { GenreBadge } from '@/components/ui/genre-badge';
import { useGenreOverrides } from '@/components/ui/genre-style-context';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { groupGenres, matchesGenreQuery, shortGenreName } from '@/domain/genre-groups';
import { fetchGenreChoicesAction } from './transactions/new/actions';

/**
 * カテゴリを選ぶシート(v5 変更4、ADR-133)。レシートの確認・記録する・今日の答え合わせの「直す」・
 * 明細のカテゴリ変更で、同じシートを使う。上から:
 *   1. 当てる範囲(品目から開いたときだけ):「この品目だけ」「レシートの全部」と
 *      「次から同じ品名はこのカテゴリにする」(ふだんはオフ)。選んだ瞬間に閉じるので、先に決められるよう上に置く。
 *   2. おすすめ:大きく1〜2個、理由を添える。ほとんどはここを1回押すだけで済む。
 *   3. 最近使った:4個。
 *   4. さがす:名前の一部で絞り込む。
 *   5. すべて:グループに分けた絵のアイコンの並び(名前は折れない短い名前)。
 * 選んだ瞬間に当てて閉じる(「決定」は置かない)。間違えたときは、開いた側の「元に戻す」で戻す。
 */

export type GenreSuggestion = { genreId: string; reason: string };
export type GenreScope = 'item' | 'all';

type Choices = { genres: { id: string; name: string }[]; recentIds: string[] };
let cache: Choices | null = null;
let loading: Promise<Choices> | null = null;

/** シートの材料(すべてのカテゴリと最近使った4つ)。ページを開いているあいだは覚えておく。 */
export function useGenreChoices(): Choices | null {
  const [choices, setChoices] = useState<Choices | null>(cache);
  useEffect(() => {
    if (cache) return;
    loading ??= fetchGenreChoicesAction().catch(() => ({ genres: [], recentIds: [] }));
    let alive = true;
    void loading.then((c) => {
      cache = c.genres.length > 0 ? c : null;
      loading = null;
      if (alive) setChoices(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return choices;
}

/** すでに手元にある材料を入れておく(画面がカテゴリを持っているとき・テスト)。 */
export function primeGenreChoices(choices: Choices): void {
  cache = choices;
}

/** カテゴリを足したり名前を変えたりしたあと、次に開いたときに読み直す。 */
export function forgetGenreChoices(): void {
  cache = null;
}

export function GenrePickerSheet({
  open,
  onClose,
  title = 'カテゴリを選ぶ',
  selectedId = null,
  suggestions = [],
  scope,
  allowNone = false,
  note,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  selectedId?: string | null;
  /** おすすめ(1〜2個、理由つき)。 */
  suggestions?: readonly GenreSuggestion[];
  /** 品目から開いたときの当てる範囲。無ければ出さない。 */
  scope?: { itemName: string; canApplyToAll: boolean } | undefined;
  /** 「未分類にする」を出す(明細のカテゴリ変更)。 */
  allowNone?: boolean;
  /** タイトルの下に添える一言(「次から、同じお店はこのカテゴリにします」など)。 */
  note?: string | undefined;
  onPick: (genreId: string | null, options: { scope: GenreScope; remember: boolean }) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} role="dialog" label={title}>
      {open ? (
        <PickerBody
          title={title}
          selectedId={selectedId}
          suggestions={suggestions}
          scope={scope}
          allowNone={allowNone}
          note={note}
          onPick={(genreId, options) => {
            onPick(genreId, options);
            onClose();
          }}
        />
      ) : null}
    </BottomSheet>
  );
}

function PickerBody({
  title,
  selectedId,
  suggestions,
  scope,
  allowNone,
  note,
  onPick,
}: {
  title: string;
  selectedId: string | null;
  suggestions: readonly GenreSuggestion[];
  scope: { itemName: string; canApplyToAll: boolean } | undefined;
  allowNone: boolean;
  note: string | undefined;
  onPick: (genreId: string | null, options: { scope: GenreScope; remember: boolean }) => void;
}) {
  const choices = useGenreChoices();
  const overrides = useGenreOverrides();
  const [range, setRange] = useState<GenreScope>('item');
  const [remember, setRemember] = useState(false);
  const [query, setQuery] = useState('');

  const genres = useMemo(() => choices?.genres ?? [], [choices]);
  const nameOf = useMemo(() => new Map(genres.map((g) => [g.id, g.name])), [genres]);
  const recommended = suggestions.filter((s) => nameOf.has(s.genreId)).slice(0, 2);
  const recent = (choices?.recentIds ?? [])
    .filter((id) => nameOf.has(id) && !recommended.some((s) => s.genreId === id))
    .slice(0, 4);
  const groups = useMemo(
    () => groupGenres(genres, (name) => overrides[name] ?? null),
    [genres, overrides],
  );
  const searching = query.trim() !== '';
  const hits = searching ? genres.filter((g) => matchesGenreQuery(g.name, query)) : [];
  const pick = (genreId: string | null) => onPick(genreId, { scope: range, remember });

  return (
    <div className="flex flex-col gap-4 px-3 pb-4" style={{ color: 'var(--ink)' }}>
      <BottomSheetHeader>
        <p className="py-2 text-[17px] font-semibold">{title}</p>
        {note ? (
          <p className="pb-2 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {note}
          </p>
        ) : null}
      </BottomSheetHeader>

      {scope ? (
        <section aria-label="当てる範囲" className="flex flex-col gap-2">
          {scope.canApplyToAll ? (
            <Segmented
              label="当てる範囲"
              value={range}
              options={[
                { value: 'item', label: 'この品目だけ' },
                { value: 'all', label: 'レシートの全部' },
              ]}
              onChange={setRange}
              className="self-start"
            />
          ) : null}
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-[15px]">次から同じ品名はこのカテゴリにする</span>
            <Switch
              checked={remember}
              onChange={setRemember}
              label={`次から「${scope.itemName}」はこのカテゴリにする`}
            />
          </div>
        </section>
      ) : null}

      {choices === null ? (
        <p role="status" className="px-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          読み込んでいます
        </p>
      ) : (
        <>
          {!searching && recommended.length > 0 ? (
            <section aria-label="おすすめ" className="flex flex-col gap-2">
              <h3 className="px-1 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                おすすめ
              </h3>
              {recommended.map((s) => (
                <button
                  key={s.genreId}
                  type="button"
                  onClick={() => pick(s.genreId)}
                  aria-pressed={s.genreId === selectedId}
                  className="flex min-h-16 items-center gap-3 rounded-2xl px-4 py-3 text-left"
                  style={{
                    background: 'var(--surface)',
                    boxShadow:
                      s.genreId === selectedId
                        ? 'inset 0 0 0 2px var(--accent)'
                        : 'inset 0 0 0 1px var(--hairline)',
                  }}
                >
                  <GenreBadge name={nameOf.get(s.genreId)!} size={40} />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-[17px] font-semibold">{nameOf.get(s.genreId)}</span>
                    <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                      {s.reason}
                    </span>
                  </span>
                </button>
              ))}
            </section>
          ) : null}

          {!searching && recent.length > 0 ? (
            <Tiles
              title="最近使った"
              ids={recent}
              nameOf={nameOf}
              selectedId={selectedId}
              onPick={pick}
            />
          ) : null}

          <label
            className="flex h-11 items-center gap-2 rounded-xl px-3"
            style={{ background: 'var(--field)' }}
          >
            <span className="sr-only">カテゴリをさがす</span>
            <svg
              aria-hidden
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ color: 'var(--ink-muted)' }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="さがす(カフェ、保険など)"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
              style={{ color: 'var(--ink)' }}
            />
          </label>

          {searching ? (
            hits.length > 0 ? (
              <Tiles
                title={`見つかったカテゴリ · ${hits.length}`}
                ids={hits.map((g) => g.id)}
                nameOf={nameOf}
                selectedId={selectedId}
                onPick={pick}
              />
            ) : (
              <p className="px-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                「{query.trim()}」に合うカテゴリはありません
              </p>
            )
          ) : (
            <section aria-label={`すべて(${genres.length})`} className="flex flex-col gap-3">
              <h3 className="px-1 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                すべて({genres.length})
              </h3>
              {groups.map((group) => (
                <Tiles
                  key={group.key}
                  title={group.label}
                  ids={group.genres.map((g) => g.id)}
                  nameOf={nameOf}
                  selectedId={selectedId}
                  onPick={pick}
                  quiet
                />
              ))}
            </section>
          )}

          {allowNone ? (
            <button
              type="button"
              onClick={() => pick(null)}
              className="min-h-11 self-start px-1 text-[15px] font-semibold"
              style={{ color: 'var(--ink-secondary)' }}
            >
              未分類にする
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function Tiles({
  title,
  ids,
  nameOf,
  selectedId,
  onPick,
  quiet = false,
}: {
  title: string;
  ids: readonly string[];
  nameOf: ReadonlyMap<string, string>;
  selectedId: string | null;
  onPick: (genreId: string) => void;
  quiet?: boolean;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3
        className={`px-1 text-[13px] ${quiet ? 'font-normal' : 'font-semibold'}`}
        style={{ color: 'var(--ink-muted)' }}
      >
        {title}
      </h3>
      <div className="grid grid-cols-4 gap-2">
        {ids.map((id) => {
          const name = nameOf.get(id) ?? '';
          const on = id === selectedId;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              aria-label={name}
              onClick={() => onPick(id)}
              className="flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-xl px-1 py-2"
              style={{
                background: on ? 'var(--note)' : 'var(--surface)',
                boxShadow: on ? 'inset 0 0 0 2px var(--accent)' : 'inset 0 0 0 1px var(--hairline)',
                color: 'var(--ink)',
              }}
            >
              <GenreBadge name={name} size={36} />
              <span className="w-full truncate text-center text-[12px] leading-tight">
                {shortGenreName(name)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
