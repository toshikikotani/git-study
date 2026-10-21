'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MdCheck } from 'react-icons/md';

import { GenreBadge, ICONS } from '@/components/ui/genre-badge';
import { useGenreOverride, useGenreOverrides } from '@/components/ui/genre-style-context';
import {
  ICON_LABELS,
  SELECTABLE_ICONS,
  genreStyle,
  selectableColorIndexes,
  type GenreIconKey,
} from '@/domain/genre-style';
import type { CategorySettingsData } from '@/features/category/settings-loader';
import { hapticFor } from '@/lib/haptics';
import {
  deleteCategoryAction,
  deleteRuleAction,
  listRulesAction,
  renameCategoryAction,
  saveCategoryStyleAction,
  setCategoryFixedAction,
  setCategoryForecastClosedAction,
  updateCategoryBudgetAction,
  updateRuleGenreAction,
} from '../../../spending/category/actions';
import { GoalTargetEdit } from '../../../spending/category/[genreKey]/goal-target-edit';

type Rule = { id: string; storeKey: string; itemKey: string; hits: number };

const sectionTitle = 'text-sm font-semibold';
const sectionNote = 'text-xs leading-relaxed';

/**
 * 1つのカテゴリの設定(「設定 > カテゴリ」と、カテゴリ詳細の「設定」から開く唯一の場所)。
 *
 * - 保存は「押したら保存」にそろえる(入力欄から離れただけでは保存しない)。
 * - お金の枠は2つだけ:目標の期間中は「目標額」、目標が無いときは「月の目安」。
 *   お金に関わる変更は、前後の額を見せて確かめてから保存する。
 */
export function SettingsBody({ data, genreId }: { data: CategorySettingsData; genreId: string }) {
  const router = useRouter();
  const override = useGenreOverride(data.genreName);
  const overrides = useGenreOverrides();
  const current = genreStyle(data.genreName, override);
  const colors = selectableColorIndexes();
  const taken = new Set(
    data.genres
      .filter((g) => g.name !== data.genreName)
      .map((g) => genreStyle(g.name, overrides[g.name]).colorIndex)
      .filter((i): i is number => i !== null),
  );
  const allowReuse = colors.every((i) => taken.has(i));
  const [name, setName] = useState(data.genreName);
  const [icon, setIcon] = useState<GenreIconKey>(current.icon);
  const [colorIndex, setColorIndex] = useState<number>(current.colorIndex ?? colors[0] ?? 1);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [confirmRule, setConfirmRule] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    void listRulesAction(genreId).then((r) => {
      if (alive) setRules(r.error ? [] : r.rules);
    });
    return () => {
      alive = false;
    };
  }, [genreId]);

  // 保存したら画面はアクションの返事で作り直される(ここで router.refresh() をもう一度呼ぶと、往復が
  // 2回になって待つ時間がのびる、ADR-117)。
  const run = async (job: () => Promise<{ error: string | null }>, done: string) => {
    setBusy(true);
    setMessage(null);
    const r = await job();
    setBusy(false);
    if (r.error) {
      setMessage(r.error);
      return false;
    }
    hapticFor('save');
    setMessage(done);
    return true;
  };

  // 固定費・見込みのスイッチは押したらすぐ切り替える(保存はうしろで。できなければ戻して理由を出す、
  // ADR-117)。以前は保存と画面の作り直しが終わるまで動かず、ほかのボタンも押せなかった。
  const [isFixed, setIsFixed] = useState(data.isFixed);
  const [forecastClosed, setForecastClosed] = useState(data.forecastClosed);
  const [synced, setSynced] = useState(data);
  if (synced !== data) {
    setSynced(data);
    setIsFixed(data.isFixed);
    setForecastClosed(data.forecastClosed);
  }
  const toggle = (
    next: boolean,
    set: (v: boolean) => void,
    job: () => Promise<{ error: string | null }>,
    done: string,
  ) => {
    set(next);
    setMessage(null);
    void job()
      .catch(() => ({ error: '保存できませんでした。もう一度押してください。' }))
      .then((r) => {
        if (r.error) {
          set(!next);
          setMessage(r.error);
          return;
        }
        hapticFor('save');
        setMessage(done);
      });
  };

  const styleChanged = icon !== current.icon || colorIndex !== (current.colorIndex ?? -1);
  const nameChanged = name.trim() !== data.genreName;
  const plan = data.goal?.plan ?? null;
  // 名前・アイコンと色は、右上の「保存」1か所でまとめて保存する(項目ごとの保存ボタンをやめた、ADR-131)。
  const canSave = !busy && (styleChanged || (nameChanged && name.trim() !== ''));
  const saveLook = async () => {
    if (!canSave) return;
    if (styleChanged) {
      const ok = await run(
        () => saveCategoryStyleAction(genreId, { icon, colorIndex }),
        'アイコンと色を変えました',
      );
      if (!ok) return;
    }
    if (nameChanged && name.trim() !== '') {
      await run(
        () => renameCategoryAction(genreId, name),
        styleChanged ? '保存しました' : '名前を変えました',
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <GenreBadge name={data.genreName} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
            {data.genreName}
          </h1>
          <Link
            href={`/spending/category/${genreId}` as Route}
            className="inline-flex min-h-11 items-center self-start text-[13px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            明細を見る
          </Link>
        </div>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void saveLook()}
          className="-mr-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-[17px] font-bold disabled:opacity-40"
          style={{ color: 'var(--accent)' }}
        >
          保存
        </button>
      </div>

      <section aria-labelledby="cs-name" className="space-y-2">
        <h2 id="cs-name" className={sectionTitle}>
          名前
        </h2>
        <input
          aria-labelledby="cs-name"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          className="min-h-11 w-full min-w-0 rounded-xl px-3 text-base"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
        />
        <p className={sectionNote} style={{ color: 'var(--ink-muted)' }}>
          これまでの明細はそのまま、新しい名前で表示されます。
        </p>
      </section>

      <section aria-labelledby="cs-look" className="space-y-3">
        <h2 id="cs-look" className={sectionTitle}>
          アイコンと色
        </h2>
        <div role="group" aria-label="アイコン" className="grid grid-cols-6 gap-2">
          {SELECTABLE_ICONS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={icon === key}
              aria-label={ICON_LABELS[key]}
              onClick={() => {
                hapticFor('tabChange');
                setIcon(key);
              }}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl"
              style={{
                background: icon === key ? 'var(--accent-track)' : 'var(--surface-raised)',
                color: 'var(--ink)',
                outline: icon === key ? '2px solid var(--ink-secondary)' : 'none',
              }}
            >
              <KeyIcon icon={key} />
            </button>
          ))}
        </div>
        <div role="group" aria-label="色" className="flex flex-wrap gap-2">
          {colors.map((i) => {
            const used = taken.has(i) && i !== current.colorIndex;
            const blocked = used && !allowReuse;
            return (
              <button
                key={i}
                type="button"
                aria-pressed={colorIndex === i}
                aria-label={`色${i}${colorIndex === i ? '(選択中)' : ''}${blocked ? '(使用中)' : ''}`}
                disabled={blocked}
                onClick={() => {
                  hapticFor('tabChange');
                  setColorIndex(i);
                }}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full disabled:opacity-25"
                style={{ background: `var(--genre-${i})`, color: 'var(--on-action)' }}
              >
                {colorIndex === i ? <MdCheck aria-hidden size={20} /> : null}
              </button>
            );
          })}
        </div>
        <p className={sectionNote} style={{ color: 'var(--ink-muted)' }}>
          {allowReuse
            ? '空いている色がないので、同じ色も選べます。'
            : 'ほかのカテゴリが使っている色は選べません。'}
        </p>
      </section>

      <section aria-labelledby="cs-money" className="space-y-2">
        <h2 id="cs-money" className={sectionTitle}>
          {plan ? '目標額' : '月の目安'}
        </h2>
        {plan ? (
          <>
            <p className={sectionNote} style={{ color: 'var(--ink-secondary)' }}>
              目標の期間中({plan.periodStart.slice(5).replace('-', '/')}〜
              {plan.periodEnd.slice(5).replace('-', '/')}
              )は、この目標額で見ます。変えると目標の総額も変わります。
            </p>
            <GoalTargetEdit planId={plan.id} genreId={genreId} rows={plan.rows} />
            {data.genreBudgetYen !== null ? (
              <div className="flex items-center gap-3">
                <p className={`flex-1 ${sectionNote}`} style={{ color: 'var(--ink-secondary)' }}>
                  目標が無いときの月の目安({data.genreBudgetYen.toLocaleString()}
                  円)は、目標の期間中は使いません。
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => updateCategoryBudgetAction(genreId, null),
                      '月の目安を消しました',
                    )
                  }
                  className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-semibold disabled:opacity-40"
                  style={{ color: 'var(--accent)' }}
                >
                  目安を消す
                </button>
              </div>
            ) : null}
            <Link
              href="/plan"
              className="inline-flex min-h-11 items-center text-xs font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              目標の配分・期間は目標画面で変える
            </Link>
          </>
        ) : (
          <>
            <p className={sectionNote} style={{ color: 'var(--ink-secondary)' }}>
              目標が無いときに、家計簿でこの額と比べます。空にすると「なし」。
            </p>
            <MonthGuideEdit
              genreId={genreId}
              currentYen={data.genreBudgetYen}
              onSaved={(text) => setMessage(text)}
            />
          </>
        )}
      </section>

      <section aria-labelledby="cs-kind" className="space-y-2">
        <h2 id="cs-kind" className={sectionTitle}>
          扱い
        </h2>
        <SwitchRow
          label="固定費"
          note="家賃・保険など、毎月ほぼ同じ額のもの。固定費にすると、月末の見込みも出しません。"
          checked={isFixed}
          disabled={false}
          onChange={(next) =>
            toggle(
              next,
              setIsFixed,
              () => setCategoryFixedAction(genreId, next),
              next ? '固定費にしました' : '固定費をやめました',
            )
          }
        />
        <SwitchRow
          label="月末の見込みを出す"
          note={
            isFixed
              ? '固定費なので、見込みは出しません。'
              : 'まとめて払うことが多いなど、見込みが当てにならないときは切ります。'
          }
          checked={!isFixed && !forecastClosed}
          disabled={isFixed}
          onChange={(next) =>
            toggle(
              !next,
              setForecastClosed,
              () => setCategoryForecastClosedAction(genreId, !next),
              next ? '見込みを出すようにしました' : '見込みを止めました',
            )
          }
        />
      </section>

      <section aria-labelledby="cs-rules" className="space-y-2">
        <h2 id="cs-rules" className={sectionTitle}>
          このカテゴリのルール
        </h2>
        {rules === null ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            読み込み中…
          </p>
        ) : rules.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            固定したルールはまだありません。明細のカテゴリを移したときに作れます。
          </p>
        ) : (
          <ul className="divider-list">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                    {r.storeKey === '' ? 'どの店でも' : r.storeKey}
                    {' / '}
                    {r.itemKey === '*' ? 'すべて' : r.itemKey}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {r.hits}回使われました
                  </p>
                </div>
                {confirmRule === r.id ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() => deleteRuleAction(r.id), 'ルールを削除しました').then((ok) => {
                        if (ok) setRules((prev) => (prev ?? []).filter((x) => x.id !== r.id));
                        setConfirmRule(null);
                      })
                    }
                    className="min-h-11 rounded-xl px-3 text-sm font-semibold"
                    style={{ background: 'var(--over)', color: 'var(--on-action)' }}
                  >
                    削除する
                  </button>
                ) : (
                  <>
                    <label className="sr-only" htmlFor={`rule-${r.id}`}>
                      移し先のカテゴリ
                    </label>
                    <select
                      id={`rule-${r.id}`}
                      value={genreId}
                      onChange={(e) => {
                        const to = e.target.value;
                        if (to === genreId) return;
                        void run(
                          () => updateRuleGenreAction(r.id, to),
                          'ルールの移し先を変えました',
                        ).then((ok) => {
                          if (ok) setRules((prev) => (prev ?? []).filter((x) => x.id !== r.id));
                        });
                      }}
                      className="min-h-11 max-w-32 rounded-xl px-2 text-sm"
                      style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
                    >
                      {data.genres.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setConfirmRule(r.id)}
                      className="min-h-11 rounded-xl px-3 text-sm font-semibold"
                      style={{ color: 'var(--over)' }}
                    >
                      削除
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cs-delete" className="space-y-2">
        <h2 id="cs-delete" className={sectionTitle}>
          カテゴリを削除
        </h2>
        {confirmDelete ? (
          <div role="alertdialog" aria-label="カテゴリを削除します" className="space-y-2">
            <p className="text-sm" style={{ color: 'var(--ink)' }}>
              「{data.genreName}」を削除します。このカテゴリの明細は「未分類」に戻ります。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="min-h-11 flex-1 rounded-full text-sm font-semibold"
                style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
              >
                やめる
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => deleteCategoryAction(genreId), 'カテゴリを削除しました').then(
                    (ok) => {
                      if (ok) router.replace('/settings/categories');
                    },
                  )
                }
                className="min-h-11 flex-1 rounded-full text-sm font-semibold disabled:opacity-40"
                style={{ background: 'var(--over)', color: 'var(--on-action)' }}
              >
                削除する
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="min-h-11 rounded-xl px-4 text-sm font-semibold"
            style={{ background: 'var(--surface-raised)', color: 'var(--over)' }}
          >
            このカテゴリを削除
          </button>
        )}
      </section>

      <div aria-live="polite" className="min-h-5 text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {message}
      </div>
    </div>
  );
}

/** 目標が無いときの月の目安。前後の額を見せて確かめてから保存する。 */
function MonthGuideEdit({
  genreId,
  currentYen,
  onSaved,
}: {
  genreId: string;
  currentYen: number | null;
  onSaved: (message: string) => void;
}) {
  const [value, setValue] = useState(currentYen === null ? '' : String(currentYen));
  const [pending, setPending] = useState<{ yen: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = (yen: number | null) => (yen === null ? 'なし' : `${yen.toLocaleString()}円`);

  const review = () => {
    const trimmed = value.replace(/[,\s]/g, '');
    const yen = trimmed === '' ? null : Number(trimmed);
    if (yen !== null && (!Number.isInteger(yen) || yen < 0)) {
      setError('0円以上の整数で入れてください');
      return;
    }
    setError(null);
    if (yen === currentYen) return;
    setPending({ yen });
  };

  const confirm = async () => {
    if (pending === null) return;
    setSaving(true);
    const result = await updateCategoryBudgetAction(genreId, pending.yen);
    setSaving(false);
    setPending(null);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    hapticFor('save');
    onSaved('月の目安を変えました');
  };

  if (pending !== null) {
    return (
      <div role="alertdialog" aria-label="月の目安を変えます" className="space-y-2">
        <p className="tabular text-xl font-bold" style={{ color: 'var(--ink)' }}>
          {label(currentYen)} → {label(pending.yen)}
        </p>
        <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          月の目安をこの額に変えます。
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPending(null)}
            disabled={saving}
            className="min-h-11 flex-1 rounded-full text-sm font-semibold"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
          >
            やめる
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={saving}
            className="btn-primary min-h-11 flex-1 rounded-full text-sm font-semibold"
          >
            {saving ? '変更しています' : '変更する'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input
          aria-labelledby="cs-money"
          inputMode="numeric"
          value={value}
          placeholder="なし"
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
          className="min-h-11 min-w-0 flex-1 rounded-xl px-3 text-base"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
        />
        <button
          type="button"
          onClick={review}
          className="btn-primary min-h-11 rounded-xl px-4 text-sm font-semibold"
        >
          保存
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs" style={{ color: 'var(--state-caution)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SwitchRow({
  label,
  note,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  note: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 py-3 text-left disabled:opacity-60"
      style={{ background: 'var(--surface-raised)' }}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {label}
        </span>
        <span className="mt-1 block text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          {note}
        </span>
      </span>
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{ background: checked ? 'var(--action)' : 'var(--hairline)' }}
      >
        <span
          className="absolute top-1 h-5 w-5 rounded-full transition-all"
          style={{ left: checked ? '1.5rem' : '0.25rem', background: 'var(--surface)' }}
        />
      </span>
    </button>
  );
}

function KeyIcon({ icon }: { icon: GenreIconKey }) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden size={22} />;
}
