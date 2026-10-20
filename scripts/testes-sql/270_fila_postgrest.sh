#!/bin/bash
# C1: sobe um PostgREST LOCAL apontado para o banco de teste (ntb-teste-sql, nunca produção) e roda os filtros da fila de
# gravação no Omie (os mesmos do código, lib/compras/pedido-omie-gravar-puro.ts). Nenhuma chamada ao Omie.
# Uso: bash scripts/testes-sql/270_fila_postgrest.sh [banco com a 270]   (padrão c1)
set -e
cd "$(dirname "$0")/../.."
DB=${1:-c1}
IP=$(docker inspect ntb-teste-sql --format '{{range $k,$v := .NetworkSettings.Networks}}{{$v.IPAddress}}{{end}}')
PW=$(docker inspect ntb-teste-sql --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_PASSWORD=//p')
docker rm -f ntb-teste-pgrst >/dev/null 2>&1 || true
docker run -d --name ntb-teste-pgrst -p 127.0.0.1:54399:3000 \
  -e PGRST_DB_URI="postgres://postgres:${PW}@${IP}:5432/${DB}" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=postgres \
  postgrest/postgrest:v14.12 >/dev/null
trap 'docker rm -f ntb-teste-pgrst >/dev/null 2>&1' EXIT
for _ in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:54399/ && break; sleep 0.5; done
DB=$DB node scripts/testes-sql/270_fila_postgrest.mjs
