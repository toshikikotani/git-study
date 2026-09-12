import Link from 'next/link';

import { computeHourlyRateYen } from '@/domain/side-hustle';
import { getAppSettings } from '@/features/settings/store';
import { listIncomes, listProjects, listWorkLogs } from '@/features/side-hustle/store';
import { IncomeSection } from './income-section';
import { ProjectSection } from './project-section';
import { WorkLogSection } from './work-log-section';

/**
 * 副業トラッカー(P3-1、FR-40, FR-42)。
 *
 * MVP 対象外(フェーズ2以降)だが、本人の希望で着手。作業時間・入金を
 * 記録し、時給換算(FR-40)と返済:投資への自動振り分け(FR-42、既定7:3)
 * を表示する。実際の送金操作はアプリの対象外(他の資金移動と同じく
 * 手動で行い、ここに出す金額は「いくら動かせばよいか」の指示)。
 */
export default async function SideHustlePage() {
  const [projects, workLogs, incomes, settings] = await Promise.all([
    listProjects(),
    listWorkLogs(),
    listIncomes(),
    getAppSettings(),
  ]);

  const minutesByProject = new Map<string, number>();
  for (const log of workLogs) {
    minutesByProject.set(log.projectId, (minutesByProject.get(log.projectId) ?? 0) + log.minutes);
  }
  const incomeByProject = new Map<string, number>();
  for (const income of incomes) {
    if (income.projectId === null) continue;
    incomeByProject.set(
      income.projectId,
      (incomeByProject.get(income.projectId) ?? 0) + income.amountYen,
    );
  }

  const projectSummaries = projects.map((project) => {
    const totalMinutes = minutesByProject.get(project.id) ?? 0;
    const totalIncomeYen = incomeByProject.get(project.id) ?? 0;
    return {
      project,
      totalMinutes,
      hourlyRateYen: computeHourlyRateYen(totalMinutes, totalIncomeYen),
    };
  });

  return (
    <div className="rise space-y-5">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          副業トラッカー
        </h1>
        <Link href="/" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          ホームへ
        </Link>
      </header>

      <ProjectSection summaries={projectSummaries} />
      <WorkLogSection projects={projects} workLogs={workLogs} />
      <IncomeSection
        projects={projects}
        incomes={incomes}
        repaymentRatio={settings.sideIncomeRepaymentRatio}
      />
    </div>
  );
}
