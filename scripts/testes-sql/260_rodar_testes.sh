#!/bin/bash
# Roda os testes SQL da Fase F (230–232 e NF-e de saída 260/261) no banco LOCAL já preparado (260_preparar_banco.sh).
# Uso: bash scripts/testes-sql/260_rodar_testes.sh [nome_do_banco]   (padrão: nf1)
set -e
cd "$(dirname "$0")/../.."
DB=${1:-nf1}
for t in 230_fechamento_periodo 231_devolucao_fornecedor 232_contador 260_nfe_saida 260_nfe_saida_revisao; do
  echo "== $t"
  docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" < "scripts/testes-sql/$t.sql" 2>&1 | grep -E 'OK|passaram|ERROR|CONTEXT' | head -3
done
