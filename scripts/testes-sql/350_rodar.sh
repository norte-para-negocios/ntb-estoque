#!/bin/bash
# Roda o teste da migration 350 no Postgres de produção (Contabo) DENTRO de uma transação que termina em ROLLBACK:
# a 350 entra sem o begin/commit dela, o teste roda e tudo é desfeito. Nada fica gravado. Só a loja 19 (laboratório)
# é usada. Espera: NOTICE "350 DEVOLUCAO REABRE PEDIDO OK".
set -euo pipefail
cd "$(dirname "$0")/../.."
{
  echo 'begin;'
  sed -e '/^begin;$/d' -e '/^commit;$/d' -e '/^notify pgrst/d' supabase/migrations/350_devolucao_reabre_pedido.sql
  cat scripts/testes-sql/350_devolucao_reabre_pedido.sql
  echo 'rollback;'
} | ssh -i "$HOME/.ssh/notebook_contabo_key" -o BatchMode=yes root@185.193.66.240 \
    "docker exec -i supabase-db psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres"
