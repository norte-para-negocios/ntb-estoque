#!/bin/bash
# Prepara o banco LOCAL de teste da Fase F (nunca produção): cópia do `fb` (migrations até 186) no container
# ntb-teste-sql, com 187, 188, 190–195, 200, 201, as da Fase F (230–232) e as da Fase C2 (240–242).
# Uso: bash scripts/testes-sql/230_preparar_banco.sh [nome_do_banco]   (padrão: f1)
set -e
cd "$(dirname "$0")/../.."
DB=${1:-f1}
docker exec ntb-teste-sql psql -q -U postgres -c "drop database if exists $DB;"
docker exec ntb-teste-sql psql -q -U postgres -c "create database $DB template fb;"
for n in 187 188 190 191 192 193 194 195 200 201 230 231 232 240 241 242; do
  f=$(ls supabase/migrations/${n}_*.sql 2>/dev/null | head -1)
  [ -z "$f" ] && continue
  echo "== $f"
  docker exec -i ntb-teste-sql psql -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" < "$f" 2>&1 | grep -v '^NOTICE' | tail -3
done
