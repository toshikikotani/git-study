import { OwnerOnlyNotice } from '@/components/ui/owner-only-notice';
import { isCurrentUserOwner } from '@/features/auth/owner';

/** 転職準備の画面は、オーナーだけ。それ以外には、URL を直接開かれても案内だけを出す(ADR-065)。 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (!(await isCurrentUserOwner())) return <OwnerOnlyNotice title="転職準備" />;
  return children;
}
