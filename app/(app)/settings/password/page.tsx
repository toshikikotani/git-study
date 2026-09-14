import { Card } from '@/components/ui/card';
import { PasswordForm } from './password-form';

/**
 * パスワード変更(ADR-011改定)。
 *
 * ログイン中に自分でパスワードを変更するための画面。初回設定・
 * 失念時の復旧は /login の「新規登録」タブ(actions.ts の
 * `registerPasswordAction`)が担う。
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
