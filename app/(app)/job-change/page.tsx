import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { listMilestones, type Milestone, type MilestonePhase } from '@/features/job-change/store';
import { MilestoneRow } from './milestone-row';
import { NewMilestoneForm } from './new-milestone-form';

/**
 * 転職準備チェックリスト(P3-2、FR-41)。
 *
 * MVP 対象外(フェーズ2以降)だが、本人の希望で着手。市場調査→職務経歴書→
 * 応募→面接→内定の5段階(milestone_phase)ごとに項目をまとめて表示する。
 */

const PHASES: readonly MilestonePhase[] = ['research', 'resume', 'apply', 'interview', 'offer'];
const PHASE_LABEL: Record<MilestonePhase, string> = {
  research: '市場調査',
  resume: '職務経歴書',
  apply: '応募',
  interview: '面接',
  offer: '内定',
};

export default async function JobChangePage() {
  const milestones = await listMilestones();
  const byPhase = new Map<MilestonePhase, Milestone[]>();
  for (const phase of PHASES) byPhase.set(phase, []);
  for (const m of milestones) byPhase.get(m.phase)?.push(m);

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          転職準備
        </h1>
        <Link href="/" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          ホームへ
        </Link>
      </header>

      {PHASES.map((phase) => {
        const items = byPhase.get(phase) ?? [];
        return (
          <section key={phase} className="space-y-2">
            <h2 className="px-1 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {PHASE_LABEL[phase]}
            </h2>
            {items.length === 0 ? (
              <p className="px-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                項目はまだありません
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((m) => (
                  <MilestoneRow key={m.id} milestone={m} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <Card>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          項目を追加
        </h2>
        <div className="mt-3">
          <NewMilestoneForm defaultPhase="research" />
        </div>
      </Card>
    </div>
  );
}
