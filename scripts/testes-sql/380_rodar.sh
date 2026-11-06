#!/bin/bash
# Roda o teste da migration 380 no Postgres de produção (Contabo) DENTRO de uma transação que termina em ROLLBACK:
# a 380 entra sem o begin/commit dela, o teste roda e tudo é desfeito. Nada fica
# gravado. Só a loja 19 (laboratório) recebe escrita (vendas sintéticas); a ODARA (15) só é LIDA (prévia).
# Espera: NOTICE "380 CONTAS A RECEBER DAS VENDAS OK". NUNCA rodar o 308_ledger_blindado.sql em produção.
set -euo pipefail
cd "$(dirname "$0")/../.."
{
  echo 'begin;'
  echo "set local statement_timeout = '60s';"
  sed -e '/^begin;$/d' -e '/^commit;$/d' -e '/^notify pgrst/d' supabase/migrations/380_contas_receber_vendas.sql
  cat scripts/testes-sql/380_contas_receber_vendas.sql
  echo 'rollback;'
} | ssh -i "$HOME/.ssh/notebook_contabo_key" -o BatchMode=yes root@185.193.66.240 \
    "docker exec -i supabase-db psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres"
