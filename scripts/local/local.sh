#!/usr/bin/env bash
# Cópia local do Norte ERP. Uso: scripts/local/local.sh <subir|baixar|restaurar|resetar|usuarios|dev|parar|status>
# Portas: Postgres 54420, API Supabase 54421, frio-api 54422, ERP (next dev) 3107. NUNCA fala com a produção,
# exceto `baixar`, que só lista (ls) e copia (scp) o backup noturno já pronto no servidor.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
DADOS="$RAIZ/.local-data"
[ -f "$DADOS/env" ] && { set -a; . "$DADOS/env"; set +a; }
DC=(docker compose -f "$RAIZ/scripts/local/docker-compose.yml" --env-file "$DADOS/env")
SERVIDOR="root@185.193.66.240"
CHAVE="$HOME/.ssh/notebook_contabo_key"
PSQL=(docker exec -i -e PGOPTIONS="-c client_min_messages=warning" -e PGPASSWORD="${POSTGRES_PASSWORD:-}" ntb-erp-local-db psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q)

docker_ok() { docker info >/dev/null 2>&1 || { echo "Docker parado: rode 'colima start --cpu 4 --memory 8 --disk 60'."; exit 1; }; }
esperar_db() { for _ in $(seq 1 90); do docker exec ntb-erp-local-db pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && return 0; sleep 2; done; echo "Postgres não subiu"; exit 1; }
sql_admin() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" -e PGPASSWORD="${POSTGRES_PASSWORD:-}" ntb-erp-local-db psql -h 127.0.0.1 -U supabase_admin -d "${2:-postgres}" -v ON_ERROR_STOP=1 -q -c "$1"; }

cmd="${1:-}"
case "$cmd" in
  subir)
    docker_ok; node "$RAIZ/scripts/local/gerar-env.mjs"
    if docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" ntb-erp-local-db psql -h 127.0.0.1 -U postgres -h 127.0.0.1 -d postgres -tAc "select 1 from public.lojas limit 1" 2>/dev/null | grep -q 1; then
      "${DC[@]}" up -d
    else
      "${DC[@]}" up -d db; esperar_db
      echo "Banco vazio: rode 'scripts/local/local.sh baixar' (se não houver dump) e depois 'restaurar'."
    fi
    ;;
  baixar)
    # SOMENTE LEITURA no servidor: ls + scp do último backup noturno. Nenhum outro comando remoto.
    mkdir -p "$DADOS/dump"
    ULTIMO="$(ssh -i "$CHAVE" -o BatchMode=yes "$SERVIDOR" 'ls -t /root/backups-ntb-estoque/ntb-estoque-*.sql.gz | head -1')"
    echo "Copiando $ULTIMO"
    scp -i "$CHAVE" -o BatchMode=yes "$SERVIDOR:$ULTIMO" "$DADOS/dump/"
    ;;
  restaurar)
    docker_ok; node "$RAIZ/scripts/local/gerar-env.mjs"
    DUMP="$(ls -t "$DADOS"/dump/ntb-estoque-*.sql.gz 2>/dev/null | head -1 || true)"
    [ -n "$DUMP" ] || { echo "Sem dump em .local-data/dump (rode 'baixar')."; exit 1; }
    "${DC[@]}" up -d db; esperar_db
    "${DC[@]}" stop auth rest proxy frio >/dev/null 2>&1 || true
    echo "Restaurando $DUMP (alguns minutos)..."
    sql_admin "create extension if not exists pg_trgm with schema extensions;"
    sql_admin "drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists public cascade;"
    gunzip -c "$DUMP" | docker exec -i -e PGOPTIONS="-c client_min_messages=warning" -e PGPASSWORD="${POSTGRES_PASSWORD:-}" ntb-erp-local-db psql -h 127.0.0.1 -U supabase_admin -d postgres -q > "$DADOS/restaura.log" 2>&1 || true
    echo "Erros/avisos do restore: $(grep -c -i 'error' "$DADOS/restaura.log" || true) (ver .local-data/restaura.log)"
    echo "Senhas dos papéis internos..."
    sql_admin "alter role authenticator with password '$POSTGRES_PASSWORD'; alter role supabase_auth_admin with password '$POSTGRES_PASSWORD'; alter role supabase_storage_admin with password '$POSTGRES_PASSWORD'; alter role postgres with password '$POSTGRES_PASSWORD';"
    echo "Limpando segredos..."
    "${PSQL[@]}" < "$RAIZ/scripts/local/limpar-segredos.sql"
    echo "Criando logins de teste..."
    node "$RAIZ/scripts/local/gerar-usuarios.mjs" | "${PSQL[@]}"
    echo "Banco frio (faturamento)..."
    sql_admin "drop database if exists frio" template1; sql_admin "create database frio" template1
    docker exec -i -e PGOPTIONS="-c client_min_messages=warning" -e PGPASSWORD="${POSTGRES_PASSWORD:-}" ntb-erp-local-db psql -h 127.0.0.1 -U supabase_admin -d frio -q < "$RAIZ/desktop/schema/frio.sql" >> "$DADOS/restaura.log" 2>&1 || echo "  (aviso: frio.sql com erros, ver restaura.log)"
    "${DC[@]}" up -d
    echo "Pronto. Logins de teste: .local-data/logins.txt"
    ;;
  resetar)
    # Volta ao estado inicial: refaz o restore a partir do dump já baixado (cerca de 1 a 2 minutos; sem nova ida ao servidor).
    exec "$0" restaurar
    ;;
  usuarios)
    cat "$DADOS/logins.txt"
    ;;
  dev)
    cd "$RAIZ"; [ -d node_modules ] || npm ci
    exec npx next dev -p 3107 -H 127.0.0.1
    ;;
  parar) docker_ok; "${DC[@]}" stop ;;
  status) docker_ok; "${DC[@]}" ps ;;
  *) echo "Uso: $0 <subir|baixar|restaurar|resetar|usuarios|dev|parar|status>"; exit 1 ;;
esac
