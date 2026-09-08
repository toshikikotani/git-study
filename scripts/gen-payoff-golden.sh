#!/usr/bin/env bash
#
# SQL 側の完済シミュレーション関数の出力を固定値として書き出す。
#
#   出力: tests/domain/fixtures/payoff-golden.json
#
# tests/domain/payoff.test.ts がこのファイルと TypeScript 版の出力を突き合わせ、
# 二重実装が乖離していないことを検証する(docs/architecture.md §3.1)。
# DB を用意できない CI でも parity を検査できるようにするための仕組み。
#
# schema.sql のシミュレーション関数を変更したら、このスクリプトを再実行して
# fixture を更新し、差分をレビューすること。差分が出るなら TS 側も直す。
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO_ROOT/tests/domain/fixtures/payoff-golden.json"

# shellcheck source=lib/pg-sandbox.sh
source "$REPO_ROOT/scripts/lib/pg-sandbox.sh"

PG_SANDBOX_PORT="${PG_SANDBOX_PORT:-5436}"
PG_SANDBOX_DB="payoff_golden"

trap pg_sandbox_stop EXIT

echo "==> 一時 PostgreSQL に schema.sql を適用"
pg_sandbox_start "$REPO_ROOT"

echo "==> シミュレーション結果を書き出し"
mkdir -p "$(dirname "$OUT")"

pg_sandbox_psql -tAq <<'SQL' > "$OUT"
-- 基準日を固定する。これをしないと fixture が毎月変わり、CI の差分検出が
-- 「月が変わった」だけで落ちるようになる。TS 側は baseMonth を合わせて比較する。
create or replace function public.today_jst() returns date
language sql immutable as $$ select date '2026-09-08' $$;

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'golden@example.com');

-- ADR-006 の仮置き負債。id は並び順が決まるよう固定値を使う。
insert into public.debts (id, user_id, lender_name, kind, current_balance_yen,
                          minimum_payment_yen, annual_rate, payment_day)
values
 ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
  'カードA','revolving',400000,10000,0.1500,27),
 ('dddddddd-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
  'カードB','revolving',300000, 8000,0.1500,27),
 ('dddddddd-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
  '消費者金融C','consumer_finance',300000,9000,0.1800, 5);

-- 借り換え比較用に、金利を一律 8% にした状態も別ユーザーで持つ
insert into auth.users (id, email)
values ('22222222-2222-2222-2222-222222222222', 'refinanced@example.com');
insert into public.debts (id, user_id, lender_name, kind, current_balance_yen,
                          minimum_payment_yen, annual_rate, payment_day)
select replace(id::text, 'dddddddd', 'eeeeeeee')::uuid,
       '22222222-2222-2222-2222-222222222222',
       lender_name, kind, current_balance_yen, minimum_payment_yen, 0.0800, payment_day
from public.debts
where user_id = '11111111-1111-1111-1111-111111111111';

select jsonb_pretty(jsonb_build_object(
  'note', 'scripts/gen-payoff-golden.sh が生成。手で編集しないこと。',
  'source', 'docs/schema.sql の simulate_debt_payoff() / simulate_total_payoff()',
  'baseMonth', public.month_start_jst()::text,
  'debts', (
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'balanceYen', d.current_balance_yen,
             'annualRate', d.annual_rate::text,
             'minimumPaymentYen', d.minimum_payment_yen,
             'paymentDay', d.payment_day) order by d.id)
    from public.debts d
    where d.user_id = '11111111-1111-1111-1111-111111111111'
  ),
  'refinancedAnnualRate', '0.0800',
  'cases', jsonb_build_array(
    -- 単一債務
    jsonb_build_object(
      'name', 'single: カードA / 月20,000円',
      'kind', 'single',
      'debtId', 'dddddddd-0000-0000-0000-000000000001',
      'monthlyPaymentYen', 20000,
      'rows', (select jsonb_agg(to_jsonb(r) order by r.month_index)
               from public.simulate_debt_payoff(
                      'dddddddd-0000-0000-0000-000000000001', 20000) r)
    ),
    jsonb_build_object(
      'name', 'single: 消費者金融C / 月15,000円(金利18%)',
      'kind', 'single',
      'debtId', 'dddddddd-0000-0000-0000-000000000003',
      'monthlyPaymentYen', 15000,
      'rows', (select jsonb_agg(to_jsonb(r) order by r.month_index)
               from public.simulate_debt_payoff(
                      'dddddddd-0000-0000-0000-000000000003', 15000) r)
    ),
    -- 合算・戦略別
    jsonb_build_object(
      'name', 'total: アバランチ / 月100,000円',
      'kind', 'total', 'strategy', 'avalanche', 'monthlyBudgetYen', 100000,
      'rows', (select jsonb_agg(to_jsonb(r) order by r.month_index)
               from public.simulate_total_payoff(
                      '11111111-1111-1111-1111-111111111111', 100000, 'avalanche') r)
    ),
    jsonb_build_object(
      'name', 'total: スノーボール / 月100,000円',
      'kind', 'total', 'strategy', 'snowball', 'monthlyBudgetYen', 100000,
      'rows', (select jsonb_agg(to_jsonb(r) order by r.month_index)
               from public.simulate_total_payoff(
                      '11111111-1111-1111-1111-111111111111', 100000, 'snowball') r)
    ),
    jsonb_build_object(
      'name', 'total: 最低返済のみ(比較の基準)',
      'kind', 'total', 'strategy', 'minimum', 'monthlyBudgetYen', null,
      'rows', (select jsonb_agg(to_jsonb(r) order by r.month_index)
               from public.simulate_total_payoff(
                      '11111111-1111-1111-1111-111111111111', null, 'minimum') r)
    ),
    jsonb_build_object(
      'name', 'total: アバランチ / 月80,000円(端数が出る額)',
      'kind', 'total', 'strategy', 'avalanche', 'monthlyBudgetYen', 80000,
      'rows', (select jsonb_agg(to_jsonb(r) order by r.month_index)
               from public.simulate_total_payoff(
                      '11111111-1111-1111-1111-111111111111', 80000, 'avalanche') r)
    ),
    -- FR-04 借り換え(全債務を年8%へ)
    jsonb_build_object(
      'name', 'total: 借り換え年8% / 月100,000円',
      'kind', 'refinanced', 'strategy', 'avalanche', 'monthlyBudgetYen', 100000,
      'rows', (select jsonb_agg(to_jsonb(r) order by r.month_index)
               from public.simulate_total_payoff(
                      '22222222-2222-2222-2222-222222222222', 100000, 'avalanche') r)
    )
  )
));
SQL

echo "==> 書き出し完了: ${OUT#"$REPO_ROOT/"}"
node -e "
const j = require('$OUT');
console.log('baseMonth:', j.baseMonth);
for (const c of j.cases) console.log('  -', c.name, '=>', c.rows.length, 'ヶ月');
"
