import { BackHeader } from '@/components/ui/back-header';
import { Card } from '@/components/ui/card';
import { requireOwner } from '@/features/auth/owner';
import { listMcpTokens } from '@/features/mcp/tokens';
import { getAppBaseUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { McpKeys } from './mcp-keys';

export const dynamic = 'force-dynamic';

/**
 * 設定 › AI とつなぐ(MCP、ADR-142)。Claude Code・Claude のデスクトップ版などから家計簿を読むための
 * 個人用の鍵を発行・取り消す。読むだけ(記録・保存はアプリで本人がする)。持ち主だけが開ける。
 */
export default async function McpSettingsPage() {
  await requireOwner();
  const { data } = await (await createClient()).auth.getUser();
  const tokens = data.user
    ? await listMcpTokens(createAdminClient(), data.user.id).catch(() => [])
    : [];
  const base = getAppBaseUrl() ?? 'https://(家計簿のURL)';

  return (
    <div className="rise flex flex-col gap-4" style={{ color: 'var(--ink)' }}>
      <BackHeader back={{ href: '/settings', label: '設定' }} title="AI とつなぐ" />

      <p className="text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {
          'Claude などの AI から、今日の目安・カテゴリ・月の合計・明細・予定を読めるようにします。読むだけで、記録や保存はできません(保存はアプリで確かめて行います)。'
        }
      </p>

      <McpKeys tokens={tokens} endpoint={`${base}/api/mcp`} />

      <Card>
        <h2 className="text-[15px] font-semibold">AI で使える道具</h2>
        <ul
          className="mt-2 flex flex-col gap-1 text-[13px] leading-relaxed"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <li>今日の目安と今期の見通し</li>
          <li>カテゴリごとの今期(目標・使った額・見込み)</li>
          <li>月の合計(支出・収入・カテゴリごと)</li>
          <li>明細をさがす(期間・お店・カテゴリ・金額)</li>
          <li>これからの予定と固定費</li>
          <li>確かめること(答え合わせ・保存前のレシート)</li>
        </ul>
      </Card>
    </div>
  );
}
