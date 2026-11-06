#!/bin/bash
# Roda o teste da migration 390 no Postgres de produção (Contabo) DENTRO de uma transação que termina em ROLLBACK:
# antes da 390, a loja 19 (laboratório) ganha uma categoria padrão "mexida à mão" (energia em administrativas) para
# provar que a 390 não sobrescreve escolha do usuário; depois a 390 entra sem o begin/commit dela, o teste roda e tudo
# é desfeito. Nada fica gravado. A ODARA (15) só é LIDA depois da reclassificação dentro da transação.
# Espera: NOTICE "390 DRE OCUPACAO OK". NUNCA rodar o 308_ledger_blindado.sql em produção.
set -euo pipefail
cd "$(dirname "$0")/../.."
{
  echo 'begin;'
  echo "set local statement_timeout = '60s';"
  echo "update fin_categorias set grupo_dre = 'despesa_administrativa' where loja_id = 19 and padrao = 'oper_energia';"
  sed -e '/^begin;$/d' -e '/^commit;$/d' -e '/^notify pgrst/d' supabase/migrations/390_financeiro_dre_ocupacao.sql
  cat scripts/testes-sql/390_financeiro_dre_ocupacao.sql
  echo 'rollback;'
} | ssh -i "$HOME/.ssh/notebook_contabo_key" -o BatchMode=yes root@185.193.66.240 \
    "docker exec -i supabase-db psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres"
