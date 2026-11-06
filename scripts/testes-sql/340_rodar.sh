#!/bin/bash
# Roda o teste da migration 340 no Postgres de produção (Contabo) DENTRO de uma transação que termina em ROLLBACK, contra
# as funções que JÁ estão no banco (340 e 360 aplicadas em 05/11/2026). Não reaplica a 340: dentro da transação ela
# trocaria as funções da 360 pelas antigas. Nada fica gravado. Só a loja 19 (laboratório) e uma loja Omie criada no
# próprio teste são usadas. Espera: NOTICE "340 CONTA A PAGAR DA NOTA OK". NUNCA rodar o 308_ledger_blindado.sql em produção.
set -euo pipefail
cd "$(dirname "$0")/../.."
{
  echo 'begin;'
  echo "set local statement_timeout = '60s';"
  cat scripts/testes-sql/340_conta_pagar_da_nota.sql
  echo 'rollback;'
} | ssh -i "$HOME/.ssh/notebook_contabo_key" -o BatchMode=yes root@185.193.66.240 \
    "docker exec -i supabase-db psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres"
