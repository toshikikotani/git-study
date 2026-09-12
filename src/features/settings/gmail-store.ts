/**
 * Gmail 自動取得の設定(app_settings の gmail_* 列)のデータアクセス(T-22)。
 *
 * 資格情報そのもの(GMAIL_ADDRESS/GMAIL_APP_PASSWORD)や取り込み先口座
 * (GMAIL_IMPORT_ACCOUNT_ID)は環境変数のみで扱う(ADR-018、M2-7c)。
 * ここで読み書きするのは DB に置いてよい3列だけ。
 */

import { createClient } from '@/lib/supabase/server';

export class GmailSettingsStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailSettingsStoreError';
  }
}

export type GmailSettings = {
  gmailEnabled: boolean;
  gmailFromAddresses: string[];
  gmailFetchLimit: number;
};

export async function getGmailSettings(): Promise<GmailSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('gmail_enabled, gmail_from_addresses, gmail_fetch_limit')
    .single();
  if (error) throw new GmailSettingsStoreError(`設定を取得できませんでした: ${error.message}`);

  return {
    gmailEnabled: data.gmail_enabled,
    gmailFromAddresses: data.gmail_from_addresses,
    gmailFetchLimit: data.gmail_fetch_limit,
  };
}

export async function updateGmailSettings(input: GmailSettings): Promise<void> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new GmailSettingsStoreError('ログイン状態を確認できませんでした');
  }

  const { error } = await supabase
    .from('app_settings')
    .update({
      gmail_enabled: input.gmailEnabled,
      gmail_from_addresses: input.gmailFromAddresses,
      gmail_fetch_limit: input.gmailFetchLimit,
    })
    .eq('user_id', auth.user.id);
  if (error) throw new GmailSettingsStoreError(`設定を保存できませんでした: ${error.message}`);
}
