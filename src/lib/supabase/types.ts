/**
 * 自動生成(M0-2)。手で編集しない。
 *
 * 再生成:
 *   SUPABASE_ACCESS_TOKEN=<個人アクセストークン> \
 *     npx supabase gen types typescript --project-id ajeezsnwzhjauhukaxrg --schema public \
 *     > src/lib/supabase/types.ts
 *
 * supabase/migrations/ を変更したら、適用後にこのコマンドで再生成すること。
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      accounts: {
        Row: {
          balance_updated_on: string | null;
          closing_day: number | null;
          created_at: string;
          currency: string;
          current_balance_yen: number;
          frozen_reason: string | null;
          id: string;
          institution_name: string | null;
          is_active: boolean;
          is_frozen: boolean;
          kind: Database['public']['Enums']['account_kind'];
          name: string;
          note: string | null;
          payment_day: number | null;
          purpose: Database['public']['Enums']['account_purpose'];
          sort_order: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          balance_updated_on?: string | null;
          closing_day?: number | null;
          created_at?: string;
          currency?: string;
          current_balance_yen?: number;
          frozen_reason?: string | null;
          id?: string;
          institution_name?: string | null;
          is_active?: boolean;
          is_frozen?: boolean;
          kind: Database['public']['Enums']['account_kind'];
          name: string;
          note?: string | null;
          payment_day?: number | null;
          purpose?: Database['public']['Enums']['account_purpose'];
          sort_order?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          balance_updated_on?: string | null;
          closing_day?: number | null;
          created_at?: string;
          currency?: string;
          current_balance_yen?: number;
          frozen_reason?: string | null;
          id?: string;
          institution_name?: string | null;
          is_active?: boolean;
          is_frozen?: boolean;
          kind?: Database['public']['Enums']['account_kind'];
          name?: string;
          note?: string | null;
          payment_day?: number | null;
          purpose?: Database['public']['Enums']['account_purpose'];
          sort_order?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      alerts: {
        Row: {
          acknowledged_at: string | null;
          body: string | null;
          category_id: string | null;
          channel: Database['public']['Enums']['notification_channel'];
          created_at: string;
          debt_id: string | null;
          dedup_key: string;
          error_message: string | null;
          id: string;
          job_run_id: string | null;
          kind: Database['public']['Enums']['alert_kind'];
          sent_at: string | null;
          severity: Database['public']['Enums']['alert_severity'];
          status: Database['public']['Enums']['alert_status'];
          title: string;
          transaction_id: string | null;
          triggered_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          acknowledged_at?: string | null;
          body?: string | null;
          category_id?: string | null;
          channel?: Database['public']['Enums']['notification_channel'];
          created_at?: string;
          debt_id?: string | null;
          dedup_key: string;
          error_message?: string | null;
          id?: string;
          job_run_id?: string | null;
          kind: Database['public']['Enums']['alert_kind'];
          sent_at?: string | null;
          severity?: Database['public']['Enums']['alert_severity'];
          status?: Database['public']['Enums']['alert_status'];
          title: string;
          transaction_id?: string | null;
          triggered_at?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          acknowledged_at?: string | null;
          body?: string | null;
          category_id?: string | null;
          channel?: Database['public']['Enums']['notification_channel'];
          created_at?: string;
          debt_id?: string | null;
          dedup_key?: string;
          error_message?: string | null;
          id?: string;
          job_run_id?: string | null;
          kind?: Database['public']['Enums']['alert_kind'];
          sent_at?: string | null;
          severity?: Database['public']['Enums']['alert_severity'];
          status?: Database['public']['Enums']['alert_status'];
          title?: string;
          transaction_id?: string | null;
          triggered_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'alerts_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'alerts_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'v_current_month_budget_status';
            referencedColumns: ['category_id'];
          },
          {
            foreignKeyName: 'alerts_debt_id_fkey';
            columns: ['debt_id'];
            isOneToOne: false;
            referencedRelation: 'debts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'alerts_job_run_id_fkey';
            columns: ['job_run_id'];
            isOneToOne: false;
            referencedRelation: 'job_runs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'alerts_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      app_checkins: {
        Row: {
          checked_on: string;
          created_at: string;
          source: string;
          user_id: string;
        };
        Insert: {
          checked_on: string;
          created_at?: string;
          source?: string;
          user_id: string;
        };
        Update: {
          checked_on?: string;
          created_at?: string;
          source?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          brief_channel: Database['public']['Enums']['notification_channel'];
          brief_send_at: string;
          classification_confidence_threshold: number;
          classification_model: string;
          created_at: string;
          discord_webhook_env_key: string;
          gmail_address_env_key: string;
          gmail_app_password_env_key: string;
          gmail_enabled: boolean;
          gmail_fetch_limit: number;
          gmail_from_addresses: string[];
          gmail_last_synced_on: string | null;
          high_risk_allocation_ratio: number;
          inactivity_alert_days: number;
          investment_ratio_of_repayment: number;
          is_high_risk_unlocked: boolean;
          line_token_env_key: string | null;
          monthly_repayment_target_yen: number;
          monthly_take_home_yen: number;
          payday: number;
          payment_due_reminder_days: number;
          repayment_strategy: Database['public']['Enums']['repayment_strategy'];
          side_income_repayment_ratio: number;
          timezone: string;
          updated_at: string;
          user_id: string;
          waste_alert_threshold: number;
        };
        Insert: {
          brief_channel?: Database['public']['Enums']['notification_channel'];
          brief_send_at?: string;
          classification_confidence_threshold?: number;
          classification_model?: string;
          created_at?: string;
          discord_webhook_env_key?: string;
          gmail_address_env_key?: string;
          gmail_app_password_env_key?: string;
          gmail_enabled?: boolean;
          gmail_fetch_limit?: number;
          gmail_from_addresses?: string[];
          gmail_last_synced_on?: string | null;
          high_risk_allocation_ratio?: number;
          inactivity_alert_days?: number;
          investment_ratio_of_repayment?: number;
          is_high_risk_unlocked?: boolean;
          line_token_env_key?: string | null;
          monthly_repayment_target_yen?: number;
          monthly_take_home_yen?: number;
          payday?: number;
          payment_due_reminder_days?: number;
          repayment_strategy?: Database['public']['Enums']['repayment_strategy'];
          side_income_repayment_ratio?: number;
          timezone?: string;
          updated_at?: string;
          user_id: string;
          waste_alert_threshold?: number;
        };
        Update: {
          brief_channel?: Database['public']['Enums']['notification_channel'];
          brief_send_at?: string;
          classification_confidence_threshold?: number;
          classification_model?: string;
          created_at?: string;
          discord_webhook_env_key?: string;
          gmail_address_env_key?: string;
          gmail_app_password_env_key?: string;
          gmail_enabled?: boolean;
          gmail_fetch_limit?: number;
          gmail_from_addresses?: string[];
          gmail_last_synced_on?: string | null;
          high_risk_allocation_ratio?: number;
          inactivity_alert_days?: number;
          investment_ratio_of_repayment?: number;
          is_high_risk_unlocked?: boolean;
          line_token_env_key?: string | null;
          monthly_repayment_target_yen?: number;
          monthly_take_home_yen?: number;
          payday?: number;
          payment_due_reminder_days?: number;
          repayment_strategy?: Database['public']['Enums']['repayment_strategy'];
          side_income_repayment_ratio?: number;
          timezone?: string;
          updated_at?: string;
          user_id?: string;
          waste_alert_threshold?: number;
        };
        Relationships: [];
      };
      brief_excluded_items: {
        Row: {
          brief_id: string;
          created_at: string;
          id: string;
          reason: Database['public']['Enums']['brief_exclusion_reason'];
          reason_detail: string | null;
          source_name: string | null;
          title: string;
          url: string | null;
          user_id: string;
        };
        Insert: {
          brief_id: string;
          created_at?: string;
          id?: string;
          reason: Database['public']['Enums']['brief_exclusion_reason'];
          reason_detail?: string | null;
          source_name?: string | null;
          title: string;
          url?: string | null;
          user_id: string;
        };
        Update: {
          brief_id?: string;
          created_at?: string;
          id?: string;
          reason?: Database['public']['Enums']['brief_exclusion_reason'];
          reason_detail?: string | null;
          source_name?: string | null;
          title?: string;
          url?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'brief_excluded_items_brief_id_fkey';
            columns: ['brief_id'];
            isOneToOne: false;
            referencedRelation: 'daily_briefs';
            referencedColumns: ['id'];
          },
        ];
      };
      brief_items: {
        Row: {
          benefit_yen: number | null;
          brief_id: string;
          conditions: string | null;
          created_at: string;
          expires_on: string | null;
          id: string;
          kind: Database['public']['Enums']['brief_item_kind'];
          priority: number | null;
          sort_order: number;
          source_name: string | null;
          summary: string | null;
          title: string;
          url: string | null;
          user_id: string;
        };
        Insert: {
          benefit_yen?: number | null;
          brief_id: string;
          conditions?: string | null;
          created_at?: string;
          expires_on?: string | null;
          id?: string;
          kind: Database['public']['Enums']['brief_item_kind'];
          priority?: number | null;
          sort_order?: number;
          source_name?: string | null;
          summary?: string | null;
          title: string;
          url?: string | null;
          user_id: string;
        };
        Update: {
          benefit_yen?: number | null;
          brief_id?: string;
          conditions?: string | null;
          created_at?: string;
          expires_on?: string | null;
          id?: string;
          kind?: Database['public']['Enums']['brief_item_kind'];
          priority?: number | null;
          sort_order?: number;
          source_name?: string | null;
          summary?: string | null;
          title?: string;
          url?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'brief_items_brief_id_fkey';
            columns: ['brief_id'];
            isOneToOne: false;
            referencedRelation: 'daily_briefs';
            referencedColumns: ['id'];
          },
        ];
      };
      budgets: {
        Row: {
          amount_yen: number;
          carry_over_yen: number;
          category_id: string;
          created_at: string;
          id: string;
          month: string;
          note: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount_yen: number;
          carry_over_yen?: number;
          category_id: string;
          created_at?: string;
          id?: string;
          month: string;
          note?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount_yen?: number;
          carry_over_yen?: number;
          category_id?: string;
          created_at?: string;
          id?: string;
          month?: string;
          note?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budgets_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'budgets_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'v_current_month_budget_status';
            referencedColumns: ['category_id'];
          },
        ];
      };
      categories: {
        Row: {
          code: string;
          color: string | null;
          created_at: string;
          default_monthly_budget_yen: number | null;
          id: string;
          is_active: boolean;
          is_system: boolean;
          kind: Database['public']['Enums']['category_kind'];
          merged_into_id: string | null;
          name: string;
          parent_id: string | null;
          show_on_home: boolean;
          sort_order: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          code: string;
          color?: string | null;
          created_at?: string;
          default_monthly_budget_yen?: number | null;
          id?: string;
          is_active?: boolean;
          is_system?: boolean;
          kind: Database['public']['Enums']['category_kind'];
          merged_into_id?: string | null;
          name: string;
          parent_id?: string | null;
          show_on_home?: boolean;
          sort_order?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          code?: string;
          color?: string | null;
          created_at?: string;
          default_monthly_budget_yen?: number | null;
          id?: string;
          is_active?: boolean;
          is_system?: boolean;
          kind?: Database['public']['Enums']['category_kind'];
          merged_into_id?: string | null;
          name?: string;
          parent_id?: string | null;
          show_on_home?: boolean;
          sort_order?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'categories_merged_into_id_fkey';
            columns: ['merged_into_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'categories_merged_into_id_fkey';
            columns: ['merged_into_id'];
            isOneToOne: false;
            referencedRelation: 'v_current_month_budget_status';
            referencedColumns: ['category_id'];
          },
          {
            foreignKeyName: 'categories_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'categories_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'v_current_month_budget_status';
            referencedColumns: ['category_id'];
          },
        ];
      };
      classification_rules: {
        Row: {
          account_id: string | null;
          category_id: string | null;
          created_at: string;
          hit_count: number;
          id: string;
          is_active: boolean;
          is_learned: boolean;
          last_hit_at: string | null;
          learned_from_transaction_id: string | null;
          match_type: Database['public']['Enums']['rule_match_type'];
          max_amount_yen: number | null;
          min_amount_yen: number | null;
          name: string;
          pattern: string | null;
          priority: number;
          set_merchant_name: string | null;
          set_payment_method: Database['public']['Enums']['payment_method'] | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id?: string | null;
          category_id?: string | null;
          created_at?: string;
          hit_count?: number;
          id?: string;
          is_active?: boolean;
          is_learned?: boolean;
          last_hit_at?: string | null;
          learned_from_transaction_id?: string | null;
          match_type: Database['public']['Enums']['rule_match_type'];
          max_amount_yen?: number | null;
          min_amount_yen?: number | null;
          name: string;
          pattern?: string | null;
          priority?: number;
          set_merchant_name?: string | null;
          set_payment_method?: Database['public']['Enums']['payment_method'] | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          category_id?: string | null;
          created_at?: string;
          hit_count?: number;
          id?: string;
          is_active?: boolean;
          is_learned?: boolean;
          last_hit_at?: string | null;
          learned_from_transaction_id?: string | null;
          match_type?: Database['public']['Enums']['rule_match_type'];
          max_amount_yen?: number | null;
          min_amount_yen?: number | null;
          name?: string;
          pattern?: string | null;
          priority?: number;
          set_merchant_name?: string | null;
          set_payment_method?: Database['public']['Enums']['payment_method'] | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'classification_rules_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'classification_rules_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'classification_rules_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'v_current_month_budget_status';
            referencedColumns: ['category_id'];
          },
          {
            foreignKeyName: 'classification_rules_learned_from_transaction_id_fkey';
            columns: ['learned_from_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      daily_briefs: {
        Row: {
          body_md: string | null;
          brief_on: string;
          channel: Database['public']['Enums']['notification_channel'];
          created_at: string;
          days_to_payoff: number | null;
          delivered_at: string | null;
          error_message: string | null;
          generated_at: string | null;
          id: string;
          input_tokens: number | null;
          job_run_id: string | null;
          model: string | null;
          output_tokens: number | null;
          remaining_debt_yen: number | null;
          spendable_living_yen: number | null;
          spendable_sanctuary_yen: number | null;
          status: Database['public']['Enums']['brief_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body_md?: string | null;
          brief_on: string;
          channel?: Database['public']['Enums']['notification_channel'];
          created_at?: string;
          days_to_payoff?: number | null;
          delivered_at?: string | null;
          error_message?: string | null;
          generated_at?: string | null;
          id?: string;
          input_tokens?: number | null;
          job_run_id?: string | null;
          model?: string | null;
          output_tokens?: number | null;
          remaining_debt_yen?: number | null;
          spendable_living_yen?: number | null;
          spendable_sanctuary_yen?: number | null;
          status?: Database['public']['Enums']['brief_status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body_md?: string | null;
          brief_on?: string;
          channel?: Database['public']['Enums']['notification_channel'];
          created_at?: string;
          days_to_payoff?: number | null;
          delivered_at?: string | null;
          error_message?: string | null;
          generated_at?: string | null;
          id?: string;
          input_tokens?: number | null;
          job_run_id?: string | null;
          model?: string | null;
          output_tokens?: number | null;
          remaining_debt_yen?: number | null;
          spendable_living_yen?: number | null;
          spendable_sanctuary_yen?: number | null;
          status?: Database['public']['Enums']['brief_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_briefs_job_run_id_fkey';
            columns: ['job_run_id'];
            isOneToOne: false;
            referencedRelation: 'job_runs';
            referencedColumns: ['id'];
          },
        ];
      };
      debt_payments: {
        Row: {
          amount_yen: number;
          balance_after_yen: number | null;
          created_at: string;
          debt_id: string;
          id: string;
          interest_yen: number | null;
          is_extra: boolean;
          note: string | null;
          paid_on: string;
          principal_yen: number | null;
          transaction_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount_yen: number;
          balance_after_yen?: number | null;
          created_at?: string;
          debt_id: string;
          id?: string;
          interest_yen?: number | null;
          is_extra?: boolean;
          note?: string | null;
          paid_on: string;
          principal_yen?: number | null;
          transaction_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount_yen?: number;
          balance_after_yen?: number | null;
          created_at?: string;
          debt_id?: string;
          id?: string;
          interest_yen?: number | null;
          is_extra?: boolean;
          note?: string | null;
          paid_on?: string;
          principal_yen?: number | null;
          transaction_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'debt_payments_debt_id_fkey';
            columns: ['debt_id'];
            isOneToOne: false;
            referencedRelation: 'debts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'debt_payments_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      debts: {
        Row: {
          account_id: string | null;
          annual_rate: number;
          balance_as_of: string;
          created_at: string;
          current_balance_yen: number;
          id: string;
          is_estimated: boolean;
          kind: Database['public']['Enums']['debt_kind'];
          lender_name: string;
          minimum_payment_yen: number;
          note: string | null;
          opened_on: string | null;
          original_principal_yen: number | null;
          paid_off_on: string | null;
          payment_day: number;
          refinanced_into_id: string | null;
          sort_order: number;
          status: Database['public']['Enums']['debt_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id?: string | null;
          annual_rate: number;
          balance_as_of?: string;
          created_at?: string;
          current_balance_yen: number;
          id?: string;
          is_estimated?: boolean;
          kind: Database['public']['Enums']['debt_kind'];
          lender_name: string;
          minimum_payment_yen: number;
          note?: string | null;
          opened_on?: string | null;
          original_principal_yen?: number | null;
          paid_off_on?: string | null;
          payment_day: number;
          refinanced_into_id?: string | null;
          sort_order?: number;
          status?: Database['public']['Enums']['debt_status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          annual_rate?: number;
          balance_as_of?: string;
          created_at?: string;
          current_balance_yen?: number;
          id?: string;
          is_estimated?: boolean;
          kind?: Database['public']['Enums']['debt_kind'];
          lender_name?: string;
          minimum_payment_yen?: number;
          note?: string | null;
          opened_on?: string | null;
          original_principal_yen?: number | null;
          paid_off_on?: string | null;
          payment_day?: number;
          refinanced_into_id?: string | null;
          sort_order?: number;
          status?: Database['public']['Enums']['debt_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'debts_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'debts_refinanced_into_id_fkey';
            columns: ['refinanced_into_id'];
            isOneToOne: false;
            referencedRelation: 'debts';
            referencedColumns: ['id'];
          },
        ];
      };
      import_adapters: {
        Row: {
          account_id: string | null;
          amount_column: string | null;
          amount_in_column: string | null;
          amount_out_column: string | null;
          amount_sign: string;
          balance_column: string | null;
          created_at: string;
          date_column: string;
          date_formats: string[];
          delimiter: string;
          description_column: string;
          encoding: string;
          has_header: boolean;
          id: string;
          is_active: boolean;
          name: string;
          payment_method_column: string | null;
          skip_rows: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id?: string | null;
          amount_column?: string | null;
          amount_in_column?: string | null;
          amount_out_column?: string | null;
          amount_sign?: string;
          balance_column?: string | null;
          created_at?: string;
          date_column: string;
          date_formats?: string[];
          delimiter?: string;
          description_column: string;
          encoding?: string;
          has_header?: boolean;
          id?: string;
          is_active?: boolean;
          name: string;
          payment_method_column?: string | null;
          skip_rows?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          amount_column?: string | null;
          amount_in_column?: string | null;
          amount_out_column?: string | null;
          amount_sign?: string;
          balance_column?: string | null;
          created_at?: string;
          date_column?: string;
          date_formats?: string[];
          delimiter?: string;
          description_column?: string;
          encoding?: string;
          has_header?: boolean;
          id?: string;
          is_active?: boolean;
          name?: string;
          payment_method_column?: string | null;
          skip_rows?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'import_adapters_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      import_batches: {
        Row: {
          account_id: string | null;
          adapter_id: string | null;
          checksum: string | null;
          completed_at: string | null;
          created_at: string;
          duplicate_count: number;
          error_message: string | null;
          failed_count: number;
          file_name: string | null;
          id: string;
          imported_count: number;
          period_from: string | null;
          period_to: string | null;
          row_count: number;
          source: Database['public']['Enums']['transaction_source'];
          status: Database['public']['Enums']['import_status'];
          user_id: string;
        };
        Insert: {
          account_id?: string | null;
          adapter_id?: string | null;
          checksum?: string | null;
          completed_at?: string | null;
          created_at?: string;
          duplicate_count?: number;
          error_message?: string | null;
          failed_count?: number;
          file_name?: string | null;
          id?: string;
          imported_count?: number;
          period_from?: string | null;
          period_to?: string | null;
          row_count?: number;
          source: Database['public']['Enums']['transaction_source'];
          status?: Database['public']['Enums']['import_status'];
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          adapter_id?: string | null;
          checksum?: string | null;
          completed_at?: string | null;
          created_at?: string;
          duplicate_count?: number;
          error_message?: string | null;
          failed_count?: number;
          file_name?: string | null;
          id?: string;
          imported_count?: number;
          period_from?: string | null;
          period_to?: string | null;
          row_count?: number;
          source?: Database['public']['Enums']['transaction_source'];
          status?: Database['public']['Enums']['import_status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'import_batches_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'import_batches_adapter_id_fkey';
            columns: ['adapter_id'];
            isOneToOne: false;
            referencedRelation: 'import_adapters';
            referencedColumns: ['id'];
          },
        ];
      };
      investment_contributions: {
        Row: {
          account_id: string | null;
          amount_yen: number;
          contributed_on: string;
          created_at: string;
          id: string;
          is_high_risk: boolean;
          note: string | null;
          product_name: string | null;
          transaction_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id?: string | null;
          amount_yen: number;
          contributed_on: string;
          created_at?: string;
          id?: string;
          is_high_risk?: boolean;
          note?: string | null;
          product_name?: string | null;
          transaction_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          amount_yen?: number;
          contributed_on?: string;
          created_at?: string;
          id?: string;
          is_high_risk?: boolean;
          note?: string | null;
          product_name?: string | null;
          transaction_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'investment_contributions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'investment_contributions_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      investment_snapshots: {
        Row: {
          account_id: string | null;
          as_of: string;
          cost_basis_yen: number | null;
          created_at: string;
          id: string;
          market_value_yen: number;
          product_name: string | null;
          user_id: string;
        };
        Insert: {
          account_id?: string | null;
          as_of: string;
          cost_basis_yen?: number | null;
          created_at?: string;
          id?: string;
          market_value_yen: number;
          product_name?: string | null;
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          as_of?: string;
          cost_basis_yen?: number | null;
          created_at?: string;
          id?: string;
          market_value_yen?: number;
          product_name?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'investment_snapshots_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      job_change_milestones: {
        Row: {
          created_at: string;
          done_on: string | null;
          due_on: string | null;
          id: string;
          note: string | null;
          phase: Database['public']['Enums']['milestone_phase'];
          sort_order: number;
          status: Database['public']['Enums']['milestone_status'];
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          done_on?: string | null;
          due_on?: string | null;
          id?: string;
          note?: string | null;
          phase: Database['public']['Enums']['milestone_phase'];
          sort_order?: number;
          status?: Database['public']['Enums']['milestone_status'];
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          done_on?: string | null;
          due_on?: string | null;
          id?: string;
          note?: string | null;
          phase?: Database['public']['Enums']['milestone_phase'];
          sort_order?: number;
          status?: Database['public']['Enums']['milestone_status'];
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      job_runs: {
        Row: {
          detail: Json | null;
          duration_ms: number | null;
          error_message: string | null;
          finished_at: string | null;
          id: string;
          items_processed: number;
          job_name: string;
          started_at: string;
          status: Database['public']['Enums']['job_status'];
          trigger_source: Database['public']['Enums']['job_trigger_source'];
          user_id: string;
        };
        Insert: {
          detail?: Json | null;
          duration_ms?: number | null;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          items_processed?: number;
          job_name: string;
          started_at?: string;
          status?: Database['public']['Enums']['job_status'];
          trigger_source: Database['public']['Enums']['job_trigger_source'];
          user_id: string;
        };
        Update: {
          detail?: Json | null;
          duration_ms?: number | null;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          items_processed?: number;
          job_name?: string;
          started_at?: string;
          status?: Database['public']['Enums']['job_status'];
          trigger_source?: Database['public']['Enums']['job_trigger_source'];
          user_id?: string;
        };
        Relationships: [];
      };
      repayment_scenarios: {
        Row: {
          computed_at: string | null;
          created_at: string;
          id: string;
          is_baseline: boolean;
          monthly_budget_yen: number | null;
          months_to_payoff: number | null;
          name: string;
          override_annual_rate: number | null;
          payoff_on: string | null;
          sort_order: number;
          strategy: Database['public']['Enums']['repayment_strategy'];
          total_interest_yen: number | null;
          total_paid_yen: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          computed_at?: string | null;
          created_at?: string;
          id?: string;
          is_baseline?: boolean;
          monthly_budget_yen?: number | null;
          months_to_payoff?: number | null;
          name: string;
          override_annual_rate?: number | null;
          payoff_on?: string | null;
          sort_order?: number;
          strategy?: Database['public']['Enums']['repayment_strategy'];
          total_interest_yen?: number | null;
          total_paid_yen?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          computed_at?: string | null;
          created_at?: string;
          id?: string;
          is_baseline?: boolean;
          monthly_budget_yen?: number | null;
          months_to_payoff?: number | null;
          name?: string;
          override_annual_rate?: number | null;
          payoff_on?: string | null;
          sort_order?: number;
          strategy?: Database['public']['Enums']['repayment_strategy'];
          total_interest_yen?: number | null;
          total_paid_yen?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      rescued_emails: {
        Row: {
          body: string;
          created_at: string;
          extracted_count: number;
          id: string;
          source: Database['public']['Enums']['transaction_source'];
          subject: string | null;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          extracted_count?: number;
          id?: string;
          source: Database['public']['Enums']['transaction_source'];
          subject?: string | null;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          extracted_count?: number;
          id?: string;
          source?: Database['public']['Enums']['transaction_source'];
          subject?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      side_incomes: {
        Row: {
          account_id: string | null;
          allocated_to_investment_yen: number | null;
          allocated_to_repayment_yen: number | null;
          amount_yen: number;
          created_at: string;
          id: string;
          note: string | null;
          project_id: string | null;
          received_on: string;
          transaction_id: string | null;
          transfer_run_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id?: string | null;
          allocated_to_investment_yen?: number | null;
          allocated_to_repayment_yen?: number | null;
          amount_yen: number;
          created_at?: string;
          id?: string;
          note?: string | null;
          project_id?: string | null;
          received_on: string;
          transaction_id?: string | null;
          transfer_run_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          allocated_to_investment_yen?: number | null;
          allocated_to_repayment_yen?: number | null;
          amount_yen?: number;
          created_at?: string;
          id?: string;
          note?: string | null;
          project_id?: string | null;
          received_on?: string;
          transaction_id?: string | null;
          transfer_run_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'side_incomes_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'side_incomes_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'side_projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'side_incomes_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'side_incomes_transfer_run_id_fkey';
            columns: ['transfer_run_id'];
            isOneToOne: false;
            referencedRelation: 'transfer_runs';
            referencedColumns: ['id'];
          },
        ];
      };
      side_projects: {
        Row: {
          client_name: string | null;
          created_at: string;
          ended_on: string | null;
          id: string;
          is_active: boolean;
          kind: string | null;
          name: string;
          note: string | null;
          started_on: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          client_name?: string | null;
          created_at?: string;
          ended_on?: string | null;
          id?: string;
          is_active?: boolean;
          kind?: string | null;
          name: string;
          note?: string | null;
          started_on?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          client_name?: string | null;
          created_at?: string;
          ended_on?: string | null;
          id?: string;
          is_active?: boolean;
          kind?: string | null;
          name?: string;
          note?: string | null;
          started_on?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      side_work_logs: {
        Row: {
          created_at: string;
          id: string;
          minutes: number;
          project_id: string;
          summary: string | null;
          updated_at: string;
          user_id: string;
          worked_on: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          minutes: number;
          project_id: string;
          summary?: string | null;
          updated_at?: string;
          user_id: string;
          worked_on: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          minutes?: number;
          project_id?: string;
          summary?: string | null;
          updated_at?: string;
          user_id?: string;
          worked_on?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'side_work_logs_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'side_projects';
            referencedColumns: ['id'];
          },
        ];
      };
      transactions: {
        Row: {
          account_id: string;
          amount_yen: number;
          category_id: string | null;
          classified_by: Database['public']['Enums']['classified_by'];
          confidence: number | null;
          counter_transaction_id: string | null;
          created_at: string;
          description: string;
          fingerprint: string;
          id: string;
          import_batch_id: string | null;
          is_expense: boolean | null;
          is_transfer: boolean;
          matched_rule_id: string | null;
          merchant_name: string | null;
          note: string | null;
          occurred_on: string;
          payment_method: Database['public']['Enums']['payment_method'];
          posted_on: string | null;
          raw: Json | null;
          review_status: Database['public']['Enums']['review_status'];
          reviewed_at: string | null;
          source: Database['public']['Enums']['transaction_source'];
          source_ref: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          amount_yen: number;
          category_id?: string | null;
          classified_by?: Database['public']['Enums']['classified_by'];
          confidence?: number | null;
          counter_transaction_id?: string | null;
          created_at?: string;
          description: string;
          fingerprint: string;
          id?: string;
          import_batch_id?: string | null;
          is_expense?: boolean | null;
          is_transfer?: boolean;
          matched_rule_id?: string | null;
          merchant_name?: string | null;
          note?: string | null;
          occurred_on: string;
          payment_method?: Database['public']['Enums']['payment_method'];
          posted_on?: string | null;
          raw?: Json | null;
          review_status?: Database['public']['Enums']['review_status'];
          reviewed_at?: string | null;
          source: Database['public']['Enums']['transaction_source'];
          source_ref?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          amount_yen?: number;
          category_id?: string | null;
          classified_by?: Database['public']['Enums']['classified_by'];
          confidence?: number | null;
          counter_transaction_id?: string | null;
          created_at?: string;
          description?: string;
          fingerprint?: string;
          id?: string;
          import_batch_id?: string | null;
          is_expense?: boolean | null;
          is_transfer?: boolean;
          matched_rule_id?: string | null;
          merchant_name?: string | null;
          note?: string | null;
          occurred_on?: string;
          payment_method?: Database['public']['Enums']['payment_method'];
          posted_on?: string | null;
          raw?: Json | null;
          review_status?: Database['public']['Enums']['review_status'];
          reviewed_at?: string | null;
          source?: Database['public']['Enums']['transaction_source'];
          source_ref?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_transactions_matched_rule';
            columns: ['matched_rule_id'];
            isOneToOne: false;
            referencedRelation: 'classification_rules';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'v_current_month_budget_status';
            referencedColumns: ['category_id'];
          },
          {
            foreignKeyName: 'transactions_counter_transaction_id_fkey';
            columns: ['counter_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_import_batch_id_fkey';
            columns: ['import_batch_id'];
            isOneToOne: false;
            referencedRelation: 'import_batches';
            referencedColumns: ['id'];
          },
        ];
      };
      transfer_rules: {
        Row: {
          amount_type: Database['public']['Enums']['transfer_amount_type'];
          amount_yen: number | null;
          category_id: string | null;
          created_at: string;
          debt_id: string | null;
          execution_order: number;
          from_account_id: string | null;
          id: string;
          is_active: boolean;
          name: string;
          note: string | null;
          percentage: number | null;
          to_account_id: string | null;
          trigger: Database['public']['Enums']['transfer_trigger'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount_type: Database['public']['Enums']['transfer_amount_type'];
          amount_yen?: number | null;
          category_id?: string | null;
          created_at?: string;
          debt_id?: string | null;
          execution_order: number;
          from_account_id?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          note?: string | null;
          percentage?: number | null;
          to_account_id?: string | null;
          trigger?: Database['public']['Enums']['transfer_trigger'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount_type?: Database['public']['Enums']['transfer_amount_type'];
          amount_yen?: number | null;
          category_id?: string | null;
          created_at?: string;
          debt_id?: string | null;
          execution_order?: number;
          from_account_id?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          note?: string | null;
          percentage?: number | null;
          to_account_id?: string | null;
          trigger?: Database['public']['Enums']['transfer_trigger'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'transfer_rules_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transfer_rules_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'v_current_month_budget_status';
            referencedColumns: ['category_id'];
          },
          {
            foreignKeyName: 'transfer_rules_debt_id_fkey';
            columns: ['debt_id'];
            isOneToOne: false;
            referencedRelation: 'debts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transfer_rules_from_account_id_fkey';
            columns: ['from_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transfer_rules_to_account_id_fkey';
            columns: ['to_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      transfer_run_items: {
        Row: {
          actual_amount_yen: number | null;
          created_at: string;
          done_at: string | null;
          execution_order: number;
          id: string;
          is_done: boolean;
          label: string;
          planned_amount_yen: number;
          rule_id: string | null;
          run_id: string;
          transaction_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          actual_amount_yen?: number | null;
          created_at?: string;
          done_at?: string | null;
          execution_order: number;
          id?: string;
          is_done?: boolean;
          label: string;
          planned_amount_yen: number;
          rule_id?: string | null;
          run_id: string;
          transaction_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          actual_amount_yen?: number | null;
          created_at?: string;
          done_at?: string | null;
          execution_order?: number;
          id?: string;
          is_done?: boolean;
          label?: string;
          planned_amount_yen?: number;
          rule_id?: string | null;
          run_id?: string;
          transaction_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'transfer_run_items_rule_id_fkey';
            columns: ['rule_id'];
            isOneToOne: false;
            referencedRelation: 'transfer_rules';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transfer_run_items_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'transfer_runs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transfer_run_items_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      transfer_runs: {
        Row: {
          completed_at: string | null;
          created_at: string;
          id: string;
          run_on: string;
          source_amount_yen: number;
          status: Database['public']['Enums']['transfer_run_status'];
          trigger: Database['public']['Enums']['transfer_trigger'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          run_on: string;
          source_amount_yen: number;
          status?: Database['public']['Enums']['transfer_run_status'];
          trigger: Database['public']['Enums']['transfer_trigger'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          run_on?: string;
          source_amount_yen?: number;
          status?: Database['public']['Enums']['transfer_run_status'];
          trigger?: Database['public']['Enums']['transfer_trigger'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      v_checkin_streak: {
        Row: {
          current_streak_days: number | null;
          last_checkin_on: string | null;
          longest_streak_days: number | null;
          user_id: string | null;
        };
        Relationships: [];
      };
      v_current_month_budget_status: {
        Row: {
          budget_yen: number | null;
          carry_over_yen: number | null;
          category_id: string | null;
          code: string | null;
          kind: Database['public']['Enums']['category_kind'] | null;
          name: string | null;
          remaining_yen: number | null;
          spent_yen: number | null;
          usage_ratio: number | null;
          user_id: string | null;
        };
        Relationships: [];
      };
      v_debt_overview: {
        Row: {
          active_debt_count: number | null;
          has_estimated_values: boolean | null;
          max_annual_rate: number | null;
          next_payment_day: number | null;
          total_balance_yen: number | null;
          total_minimum_payment_yen: number | null;
          user_id: string | null;
          weighted_annual_rate: number | null;
        };
        Relationships: [];
      };
      v_monthly_category_spend: {
        Row: {
          category_code: string | null;
          category_id: string | null;
          category_kind: Database['public']['Enums']['category_kind'] | null;
          category_name: string | null;
          month: string | null;
          received_yen: number | null;
          spent_yen: number | null;
          transaction_count: number | null;
          user_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'transactions_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'v_current_month_budget_status';
            referencedColumns: ['category_id'];
          },
        ];
      };
    };
    Functions: {
      month_start_jst: { Args: { p_offset_months?: number }; Returns: string };
      seed_defaults: { Args: { p_user_id: string }; Returns: undefined };
      simulate_debt_payoff: {
        Args: {
          p_debt_id: string;
          p_max_months?: number;
          p_monthly_payment_yen: number;
        };
        Returns: {
          closing_balance_yen: number;
          due_on: string;
          interest_yen: number;
          month_index: number;
          opening_balance_yen: number;
          payment_yen: number;
          principal_yen: number;
        }[];
      };
      simulate_total_payoff: {
        Args: {
          p_max_months?: number;
          p_monthly_budget_yen: number;
          p_strategy?: Database['public']['Enums']['repayment_strategy'];
          p_user_id: string;
        };
        Returns: {
          closing_total_yen: number;
          debts_remaining: number;
          interest_total_yen: number;
          month_index: number;
          month_on: string;
          opening_total_yen: number;
          payment_total_yen: number;
          principal_total_yen: number;
        }[];
      };
      today_jst: { Args: never; Returns: string };
    };
    Enums: {
      account_kind: 'bank' | 'credit_card' | 'cash' | 'securities' | 'e_money' | 'other';
      account_purpose:
        'salary' | 'repayment' | 'investment' | 'sanctuary' | 'living' | 'emergency' | 'other';
      alert_kind:
        | 'waste_budget_70'
        | 'budget_exceeded'
        | 'revolving_detected'
        | 'cashing_detected'
        | 'installment_detected'
        | 'inactivity'
        | 'payment_due'
        | 'import_needed'
        | 'job_failure'
        | 'debt_paid_off'
        | 'other';
      alert_severity: 'info' | 'warn' | 'critical';
      alert_status: 'pending' | 'sent' | 'failed' | 'acknowledged' | 'suppressed';
      brief_exclusion_reason:
        | 'info_product'
        | 'unverified_income'
        | 'suspected_scam'
        | 'affiliate_primary'
        | 'no_evidence'
        | 'expired'
        | 'duplicate'
        | 'off_topic'
        | 'other';
      brief_item_kind: 'headline' | 'income_tip' | 'market' | 'campaign';
      brief_status: 'pending' | 'generated' | 'delivered' | 'failed';
      category_kind:
        | 'fixed_cost'
        | 'living'
        | 'sanctuary'
        | 'waste'
        | 'investment_spending'
        | 'repayment'
        | 'investment'
        | 'income'
        | 'transfer'
        | 'other';
      classified_by: 'unclassified' | 'rule' | 'ai' | 'manual';
      debt_kind:
        | 'revolving'
        | 'cashing'
        | 'installment'
        | 'card_loan'
        | 'consumer_finance'
        | 'bank_loan'
        | 'other';
      debt_status: 'active' | 'paid_off' | 'refinanced' | 'closed';
      import_status: 'pending' | 'succeeded' | 'partial' | 'failed';
      job_status: 'running' | 'succeeded' | 'failed' | 'cancelled';
      job_trigger_source: 'github_actions' | 'pg_cron' | 'manual' | 'webhook';
      milestone_phase: 'research' | 'resume' | 'apply' | 'interview' | 'offer';
      milestone_status: 'todo' | 'doing' | 'done' | 'dropped';
      notification_channel: 'discord' | 'line' | 'email' | 'none';
      payment_method:
        'one_time' | 'revolving' | 'cashing' | 'installment' | 'debit' | 'transfer' | 'unknown';
      repayment_strategy: 'avalanche' | 'snowball' | 'minimum' | 'custom';
      review_status: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
      rule_match_type: 'keyword' | 'regex' | 'exact' | 'amount_range' | 'merchant';
      transaction_source: 'csv' | 'gmail' | 'manual' | 'api';
      transfer_amount_type: 'fixed' | 'percentage' | 'remainder';
      transfer_run_status: 'pending' | 'completed' | 'skipped';
      transfer_trigger: 'payday' | 'side_income' | 'manual';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      account_kind: ['bank', 'credit_card', 'cash', 'securities', 'e_money', 'other'],
      account_purpose: [
        'salary',
        'repayment',
        'investment',
        'sanctuary',
        'living',
        'emergency',
        'other',
      ],
      alert_kind: [
        'waste_budget_70',
        'budget_exceeded',
        'revolving_detected',
        'cashing_detected',
        'installment_detected',
        'inactivity',
        'payment_due',
        'import_needed',
        'job_failure',
        'debt_paid_off',
        'other',
      ],
      alert_severity: ['info', 'warn', 'critical'],
      alert_status: ['pending', 'sent', 'failed', 'acknowledged', 'suppressed'],
      brief_exclusion_reason: [
        'info_product',
        'unverified_income',
        'suspected_scam',
        'affiliate_primary',
        'no_evidence',
        'expired',
        'duplicate',
        'off_topic',
        'other',
      ],
      brief_item_kind: ['headline', 'income_tip', 'market', 'campaign'],
      brief_status: ['pending', 'generated', 'delivered', 'failed'],
      category_kind: [
        'fixed_cost',
        'living',
        'sanctuary',
        'waste',
        'investment_spending',
        'repayment',
        'investment',
        'income',
        'transfer',
        'other',
      ],
      classified_by: ['unclassified', 'rule', 'ai', 'manual'],
      debt_kind: [
        'revolving',
        'cashing',
        'installment',
        'card_loan',
        'consumer_finance',
        'bank_loan',
        'other',
      ],
      debt_status: ['active', 'paid_off', 'refinanced', 'closed'],
      import_status: ['pending', 'succeeded', 'partial', 'failed'],
      job_status: ['running', 'succeeded', 'failed', 'cancelled'],
      job_trigger_source: ['github_actions', 'pg_cron', 'manual', 'webhook'],
      milestone_phase: ['research', 'resume', 'apply', 'interview', 'offer'],
      milestone_status: ['todo', 'doing', 'done', 'dropped'],
      notification_channel: ['discord', 'line', 'email', 'none'],
      payment_method: [
        'one_time',
        'revolving',
        'cashing',
        'installment',
        'debit',
        'transfer',
        'unknown',
      ],
      repayment_strategy: ['avalanche', 'snowball', 'minimum', 'custom'],
      review_status: ['auto_ok', 'pending', 'confirmed', 'corrected', 'ignored'],
      rule_match_type: ['keyword', 'regex', 'exact', 'amount_range', 'merchant'],
      transaction_source: ['csv', 'gmail', 'manual', 'api'],
      transfer_amount_type: ['fixed', 'percentage', 'remainder'],
      transfer_run_status: ['pending', 'completed', 'skipped'],
      transfer_trigger: ['payday', 'side_income', 'manual'],
    },
  },
} as const;
