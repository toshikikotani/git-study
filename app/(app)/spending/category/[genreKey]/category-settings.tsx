'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MdCheck } from 'react-icons/md';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { GenreBadge, ICONS } from '@/components/ui/genre-badge';
import { useGenreOverride, useGenreOverrides } from '@/components/ui/genre-style-context';
import { Yen } from '@/components/ui/money';
import {
  ICON_LABELS,
  SELECTABLE_ICONS,
  genreStyle,
  selectableColorIndexes,
  type GenreIconKey,
} from '@/domain/genre-style';
import type { CategoryDetailData } from '@/features/category/loader';
import { hapticFor } from '@/lib/haptics';
import {
  deleteRuleAction,
  listRulesAction,
  renameCategoryAction,
  saveCategoryStyleAction,
  setCategoryFixedAction,
  setCategoryForecastClosedAction,
  updateCategoryBudgetAction,
  updateRuleGenreAction,
} from '../actions';
import { EditPlanSection } from '../../../plan/edit-plan-section';

type Rule = { id: string; storeKey: string; itemKey: string; hits: number };

/**
 * カテゴリの設定シート(P8)。名前・アイコン・色を変え、月の目安(予算)と、目標の配分を直し、
 * このカテゴリに固定した分類ルールを見直す。
 * - アイコンは既存の一式から、色は既存の10色のうちコントラストを満たすものから選ぶ。
 * - 目標の期間中は、目標画面と同じ「配分・総額を調整する」をここで開く(別の入れ物を作らない)。
 * - カテゴリの削除は、ここではできない(明細が「未分類」に戻るため)。統合は今後の課題。
 */
export function CategorySettings({
  open,
  onClose,
  data,
  genreId,
}: {
  open: boolean;
  onClose: () => void;
  data: CategoryDetailData;
  genreId: string;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} role="dialog">
      {open ? <SettingsBody data={data} genreId={genreId} onClose={onClose} /> : null}
    </BottomSheet>
  );
}

const sectionTitle = 'text-sm font-semibold';

export function SettingsBody({
  data,
  genreId,
  onClose,
}: {
  data: CategoryDetailData;
  genreId: string;
  onClose: () => void;
}) {
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
  const [budget, setBudget] = useState(
    data.genreBudgetYen === null ? '' : String(data.genreBudgetYen),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [confirmRule, setConfirmRule] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listRulesAction(genreId).then((r) => {
      if (alive) setRules(r.error ? [] : r.rules);
    });
    return () => {
      alive = false;
    };
  }, [genreId]);

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
    router.refresh();
    return true;
  };

  const styleChanged = icon !== current.icon || colorIndex !== (current.colorIndex ?? -1);
  const nameChanged = name.trim() !== data.genreName;
  const budgetNumber = budget.trim() === '' ? null : Number(budget);
  const budgetValid =
    budgetNumber === null || (Number.isInteger(budgetNumber) && budgetNumber >= 0);

  return (
    <div className="max-h-[80dvh] space-y-6 overflow-y-auto px-4 pb-6">
      <div className="flex items-center gap-3">
        <GenreBadge name={data.genreName} size={40} />
        <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          カテゴリの設定
        </h2>
      </div>

      <section aria-label="このカテゴリ" className="space-y-2">
        <button
          type="button"
          onClick={() =>
            void setCategoryFixedAction(genreId, !data.isFixed).then(() => router.refresh())
          }
          className="flex min-h-11 w-full items-center justify-between rounded-xl px-4 text-sm font-semibold"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
        >
          <span>{data.isFixed ? '固定費をやめる' : '固定費にする'}</span>
          <span style={{ color: 'var(--ink-muted)' }}>{data.isFixed ? '固定費' : ''}</span>
        </button>
        {!data.isFixed ? (
          <button
            type="button"
            onClick={() =>
              void setCategoryForecastClosedAction(genreId, !data.forecastClosed).then(() =>
                router.refresh(),
              )
            }
            className="flex min-h-11 w-full items-center justify-between rounded-xl px-4 text-sm font-semibold"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
          >
            <span>{data.forecastClosed ? '予測を戻す' : '予測を止める'}</span>
            <span style={{ color: 'var(--ink-muted)' }}>
              {data.forecastClosed ? '止めている' : ''}
            </span>
          </button>
        ) : (
          <p className="px-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            固定費なので、予測は止めています。
          </p>
        )}
        <a
          href="/reports/genres"
          className="flex min-h-11 w-full items-center rounded-xl px-4 text-sm font-semibold"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
        >
          カテゴリを追加・削除
        </a>
      </section>

      <section aria-labelledby="cs-name" className="space-y-2">
        <h3 id="cs-name" className={sectionTitle}>
          名前
        </h3>
        <div className="flex gap-2">
          <input
            aria-labelledby="cs-name"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 flex-1 rounded-xl px-3 text-base"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
          />
          <button
            type="button"
            disabled={busy || !nameChanged || name.trim() === ''}
            onClick={() => void run(() => renameCategoryAction(genreId, name), '名前を変えました')}
            className="min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            変更
          </button>
        </div>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          これまでの明細はそのまま、新しい名前で表示されます。
        </p>
      </section>

      <section aria-labelledby="cs-icon" className="space-y-2">
        <h3 id="cs-icon" className={sectionTitle}>
          アイコン
        </h3>
        <div role="group" aria-labelledby="cs-icon" className="grid grid-cols-6 gap-2">
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
      </section>

      <section aria-labelledby="cs-color" className="space-y-2">
        <h3 id="cs-color" className={sectionTitle}>
          色
        </h3>
        <div role="group" aria-labelledby="cs-color" className="flex flex-wrap gap-2">
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
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {allowReuse
            ? '空いている色がないので、同じ色も選べます。'
            : 'ほかのカテゴリが使っている色は選べません。'}
        </p>
        <button
          type="button"
          disabled={busy || !styleChanged}
          onClick={() =>
            void run(
              () => saveCategoryStyleAction(genreId, { icon, colorIndex }),
              '見た目を変えました',
            )
          }
          className="min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          見た目を保存
        </button>
      </section>

      <section aria-labelledby="cs-budget" className="space-y-2">
        <h3 id="cs-budget" className={sectionTitle}>
          予算
        </h3>
        {data.goal?.plan ? (
          <div className="space-y-2">
            <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
              目標の期間中は、目標の配分で決まります。
              {data.goal.row ? (
                <>
                  {' '}
                  いまの配分は <Yen value={data.goal.row.targetYen ?? 0} /> です。
                </>
              ) : null}
            </p>
            <EditPlanSection
              planId={data.goal.plan.id}
              periodStart={data.goal.plan.periodStart}
              periodEnd={data.goal.plan.periodEnd}
              rows={data.goal.plan.rows}
            />
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              aria-labelledby="cs-budget"
              inputMode="numeric"
              value={budget}
              placeholder="月の目安(円)。空ならなし"
              onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))}
              className="min-h-11 flex-1 rounded-xl px-3 text-base"
              style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
            />
            <button
              type="button"
              disabled={busy || !budgetValid}
              onClick={() =>
                void run(
                  () => updateCategoryBudgetAction(genreId, budgetNumber),
                  '予算を変えました',
                )
              }
              className="min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--action)', color: 'var(--on-action)' }}
            >
              保存
            </button>
          </div>
        )}
      </section>

      <section aria-labelledby="cs-rules" className="space-y-2">
        <h3 id="cs-rules" className={sectionTitle}>
          このカテゴリのルール
        </h3>
        {rules === null ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            読み込み中…
          </p>
        ) : rules.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            固定したルールはまだありません。カテゴリを移したときに作れます。
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

      <section className="space-y-1">
        <button
          type="button"
          disabled
          className="min-h-11 rounded-xl px-4 text-sm font-semibold opacity-40"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
        >
          このカテゴリを削除
        </button>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          明細が「未分類」に戻ってしまうため、いまは削除できません。ほかのカテゴリへの統合は今後対応します。
        </p>
      </section>

      <div aria-live="polite" className="min-h-5 text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {message}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="min-h-12 w-full rounded-2xl text-base font-semibold"
        style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
      >
        閉じる
      </button>
    </div>
  );
}

/** 選択肢のアイコン(名前ではなくキーで描く)。 */
function KeyIcon({ icon }: { icon: GenreIconKey }) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden size={22} />;
}
