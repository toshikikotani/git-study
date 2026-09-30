import { GenreStyleProvider } from '@/components/ui/genre-style-context';
import { OwnerProvider } from '@/components/ui/owner-context';
import { isCurrentUserOwner } from '@/features/auth/owner';
import { loadGenreStyleOverrides } from '@/features/genre/style-store';
import { AppShell } from './app-shell';

/**
 * アプリの土台。利用者が選んだカテゴリの見た目(アイコン・色)をここで読み、どの画面の
 * カテゴリのバッジ・バーにも同じ見た目が出るようにする(読めなければ既定の見た目)。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [overrides, isOwner] = await Promise.all([loadGenreStyleOverrides(), isCurrentUserOwner()]);
  return (
    <GenreStyleProvider overrides={overrides}>
      <OwnerProvider isOwner={isOwner}>
        <AppShell>{children}</AppShell>
      </OwnerProvider>
    </GenreStyleProvider>
  );
}
