#!/bin/bash
# Roda o teste da migration 360 no Postgres de produção (Contabo) DENTRO de uma transação que termina em ROLLBACK:
# a 360 entra sem o begin/commit dela (a 340 já está aplicada em produção), o teste roda e tudo é desfeito. Nada fica
# gravado. Só a loja 19 (laboratório) e uma loja Omie criada no próprio teste recebem escrita; a ODARA (15) só é LIDA.
# Espera: NOTICE "360 DECISOES CONTA A PAGAR DA NOTA OK". NUNCA rodar o 308_ledger_blindado.sql em produção.
set -euo pipefail
cd "$(dirname "$0")/../.."
{
  echo 'begin;'
  echo "set local statement_timeout = '60s';"
  sed -e '/^begin;$/d' -e '/^commit;$/d' -e '/^notify pgrst/d' supabase/migrations/360_conta_pagar_nota_decisoes.sql
  cat scripts/testes-sql/360_conta_pagar_nota_decisoes.sql
  echo 'rollback;'
} | ssh -i "$HOME/.ssh/notebook_contabo_key" -o BatchMode=yes root@185.193.66.240 \
    "docker exec -i supabase-db psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres"
