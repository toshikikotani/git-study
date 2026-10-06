import { Card } from '@/components/ui/card';
import { PasswordForm } from './password-form';

/**
 * パスワード変更(ADR-011改定)。
 *
 * ログイン中に自分でパスワードを変更するための画面。アカウントの作成は
 * /login の「新規登録」タブ(actions.ts の `signUpAction`)が担う。
 * パスワードを忘れた場合の復旧は、いまは管理者(Supabase のダッシュボード)が行う。
 */
export default function PasswordSettingsPage() {
  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          パスワードを設定
        </h1>
      </header>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        次回からはメールを開かずに、このパスワードでログインできます。
      </p>

      <Card>
        <PasswordForm />
      </Card>
    </div>
  );
}
