#!/bin/bash
# Roda o teste das migrations 370 e 371 no Postgres de produção (Contabo) DENTRO de uma transação que termina em ROLLBACK:
# as duas entram sem o begin/commit delas, o teste roda e tudo é desfeito. Nada fica gravado. Só a loja 19 (laboratório)
# recebe escrita; a ODARA (15) só é LIDA. Espera: NOTICE "370 APROVACAO RECORRENTES LANCAMENTOS OK".
# NUNCA rodar o 308_ledger_blindado.sql em produção.
set -euo pipefail
cd "$(dirname "$0")/../.."
{
  echo 'begin;'
  echo "set local statement_timeout = '120s';"
  for f in supabase/migrations/370_financeiro_aprovacao_recorrentes_lancamentos.sql supabase/migrations/371_financeiro_aprovacao_cargos.sql; do
    sed -e '/^begin;$/d' -e '/^commit;$/d' -e '/^notify pgrst/d' "$f"
  done
  cat scripts/testes-sql/370_financeiro_aprovacao_recorrentes_lancamentos.sql
  echo 'rollback;'
} | ssh -i "$HOME/.ssh/notebook_contabo_key" -o BatchMode=yes root@185.193.66.240 \
    "docker exec -i supabase-db psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres"
