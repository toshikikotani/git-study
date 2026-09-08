import { Card } from '@/components/ui/card';
import { PasswordForm } from './password-form';

/**
 * パスワード設定(ADR-011)。
 *
 * Magic Link ログイン後の着地点。次回からはここで設定したパスワードで
 * ログインできる(/login のパスワードタブ)。
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
