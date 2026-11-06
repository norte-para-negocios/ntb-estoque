#!/bin/bash
# Roda o teste da migration 351 no Postgres de produção (Contabo) DENTRO de uma transação que termina em ROLLBACK:
# a 351 entra sem o begin/commit dela, o teste roda e tudo é desfeito. Nada fica gravado. Só a loja 19 (laboratório)
# é usada. Espera: NOTICE "351 CTE DEPOIS DA ENTRADA OK".
set -euo pipefail
cd "$(dirname "$0")/../.."
{
  echo 'begin;'
  sed -e '/^begin;$/d' -e '/^commit;$/d' -e '/^notify pgrst/d' supabase/migrations/351_cte_depois_da_entrada.sql
  cat scripts/testes-sql/351_cte_depois_da_entrada.sql
  echo 'rollback;'
} | ssh -i "$HOME/.ssh/notebook_contabo_key" -o BatchMode=yes root@185.193.66.240 \
    "docker exec -i supabase-db psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres"
