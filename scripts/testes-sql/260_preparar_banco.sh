#!/bin/bash
# Prepara o banco LOCAL de teste da NF-e de saída (nunca produção): cópia do `fb` no container ntb-teste-sql com as
# migrations que a 260/261 pressupõem (187, 188, 190–195, 200, 201, 230–232, 240–242) e depois 260 e 261 (duas vezes,
# para provar que são reaplicáveis).
# Uso: bash scripts/testes-sql/260_preparar_banco.sh [nome_do_banco]   (padrão: nf1)
set -e
cd "$(dirname "$0")/../.."
DB=${1:-nf1}
docker exec ntb-teste-sql psql -q -U postgres -c "drop database if exists $DB;"
docker exec ntb-teste-sql psql -q -U postgres -c "create database $DB template fb;"
for n in 187 188 190 191 192 193 194 195 200 201 230 231 232 240 241 242 260 261 260 261; do
  f=$(ls supabase/migrations/${n}_*.sql 2>/dev/null | head -1)
  [ -z "$f" ] && continue
  echo "== $f"
  docker exec -i ntb-teste-sql psql -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" < "$f" 2>&1 | grep -v '^NOTICE' | tail -3
done
