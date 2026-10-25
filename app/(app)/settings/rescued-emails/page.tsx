import { BackHeader } from '@/components/ui/back-header';
import { requireOwner } from '@/features/auth/owner';

import { listRescuedEmails, type RescuedEmail } from '@/features/import/rescue-store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { RescuedEmailRow } from './rescued-email-row';

/**
 * AI救済メールの見直し画面(T-11、ADR-019)。
 *
 * ラベル辞書(email.ts)で読めず AI に回ったメールを一覧する。同じ書式が
 * 繰り返し出てくるようなら、本文を見て `src/features/import/email.ts` の
 * `LABELS` に語を足すと、次からは費用ゼロの辞書経路で読めるようになる。
 *
 * 取得に失敗しても画面は落とさない(`accounts-client.ts` の
 * `fetchAccounts()` と同じ考え方)。診断用の副次的な画面のため、
 * マイグレーション未適用などの理由で読めない間も他の画面に影響させない。
 */
export default async function RescuedEmailsPage() {
  await requireOwner();
  let emails: RescuedEmail[] = [];
  let loadError: string | null = null;
  try {
    emails = await withMinDuration(listRescuedEmails());
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  return (
    <div className="rise space-y-4">
      <BackHeader back={{ href: '/settings', label: '設定' }} title="読み取れなかったメール" />

      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        ラベル辞書で読めず AI に回ったメールの本文です。同じ書式が繰り返し出てくるなら、
        辞書に語を足すと次からは費用のかからない経路で読めるようになります。
      </p>

      {loadError ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          まだ利用できません({loadError})
        </p>
      ) : emails.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          まだ記録がありません。
        </p>
      ) : (
        <div className="space-y-2">
          {emails.map((email) => (
            <RescuedEmailRow key={email.id} email={email} />
          ))}
        </div>
      )}
    </div>
  );
}
