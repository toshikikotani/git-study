import { BackLink } from '@/components/ui/back-header';
import { STARTER_GENRES } from '@/domain/onboarding';
import { listGenres } from '@/features/genre/store';
import { getIncomeSettings } from '@/features/onboarding/store';
import { knownBackTarget } from '@/lib/back-target';
import { todayJst } from '@/lib/date';
import { WelcomeFlow } from './welcome-flow';

/**
 * はじめての設定(ADR-084)。新しく登録した人が、何を決めればいいか迷わないように、
 * 最低限の3つだけを順に聞く:手取りと給料日 → 今日からの目標 → 貯金目標(任意)。
 * 今日の画面から、目標も明細もまだ無い人だけをここへ送る(app/(app)/page.tsx)。設定から開いたときだけ、
 * 「キャンセル」で設定へ戻れる(はじめて開いた人は、戻る先がまだ無いので出さない、ADR-127)。
 */

export const dynamic = 'force-dynamic';

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const back = knownBackTarget((await searchParams).from);
  const [income, genres] = await Promise.all([getIncomeSettings(), listGenres().catch(() => [])]);
  const byName = new Map(genres.map((g) => [g.name, g.id]));
  const starters = STARTER_GENRES.flatMap((g) => {
    const id = byName.get(g.name);
    return id === undefined ? [] : [{ genreId: id, name: g.name, share: g.shareOfTakeHome }];
  });

  return (
    <div className="hm-page">
      {back ? <BackLink back={{ ...back, cancel: true }} /> : null}
      <WelcomeFlow
        today={todayJst()}
        initialTakeHomeYen={income.takeHomeYen}
        initialPayday={income.payday}
        starters={starters}
      />
    </div>
  );
}
