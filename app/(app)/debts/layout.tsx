import { OwnerOnlyNotice } from '@/components/ui/owner-only-notice';
import { isCurrentUserOwner } from '@/features/auth/owner';

/** 負債(借金)まわりの画面は、オーナーだけ。それ以外には、URL を直接開かれても案内だけを出す(ADR-066)。 */
export default async function DebtsLayout({ children }: { children: React.ReactNode }) {
  if (!(await isCurrentUserOwner())) return <OwnerOnlyNotice title="負債" />;
  return children;
}
