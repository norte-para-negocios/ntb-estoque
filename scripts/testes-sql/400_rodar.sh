#!/bin/bash
# Roda o teste da migration 400 no Postgres de produção (Contabo) DENTRO de uma transação que termina em ROLLBACK:
# a 400 entra sem o begin/commit dela, o teste escreve só na loja 19 (laboratório) e tudo é desfeito. Nada fica gravado.
# A ODARA (15) só é LIDA (tempo das duas funções). Espera: NOTICE "400 CONSUMO TEORICO REAL OK".
# NUNCA rodar o 308_ledger_blindado.sql em produção.
set -euo pipefail
cd "$(dirname "$0")/../.."
{
  echo 'begin;'
  echo "set local statement_timeout = '60s';"
  sed -e '/^begin;$/d' -e '/^commit;$/d' -e '/^notify pgrst/d' supabase/migrations/400_consumo_teorico_real.sql
  cat scripts/testes-sql/400_consumo_teorico_real.sql
  echo 'rollback;'
} | ssh -i "$HOME/.ssh/notebook_contabo_key" -o BatchMode=yes root@185.193.66.240 \
    "docker exec -i supabase-db psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres"
