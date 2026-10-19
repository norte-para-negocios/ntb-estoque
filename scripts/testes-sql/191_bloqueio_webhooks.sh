#!/bin/bash
# Teste da revisão I2 da 191 (só no banco local de teste): com outra sessão segurando webhooks por 7 s, a 191
# desiste do bloqueio a cada 3 s (lock_timeout), avisa e tenta de novo, sem deixar inserts esperando atrás dela,
# e termina aplicada. Rodar da raiz do repo: bash scripts/testes-sql/191_bloqueio_webhooks.sh [banco]
set -u
DB="${1:-fi}"
C=ntb-teste-sql
docker exec "$C" rm -rf /work && docker exec "$C" mkdir -p /work/supabase && docker cp supabase/migrations "$C":/work/supabase/ >/dev/null
P() { docker exec -i -w /work "$C" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 "$@"; }
P -q -c "drop trigger if exists webhooks_n_id_receb on webhooks; drop index if exists webhooks_loja_n_id_receb_idx; alter table webhooks drop column if exists n_id_receb;"
# sessão que segura AccessShareLock em webhooks por 7 s
P -q -c "begin; select count(*) from webhooks; select pg_sleep(7); commit;" >/dev/null &
sleep 1
# enquanto a 191 espera, um insert de webhook não pode ficar parado atrás dela por mais que o lock_timeout
( sleep 2; t0=$(date +%s%N); P -q -c "insert into webhooks (loja_id, message_id, message) values (5, 'fi-i2-'||clock_timestamp(), '{}')"; echo "insert durante a espera: $(( ($(date +%s%N) - t0) / 1000000 )) ms" ) &
inicio=$(date +%s)
P -f supabase/migrations/191_indices_telas_fase_i.sql 2>&1 | grep -E "NOTICE|ERROR" | sed 's/^psql:[^ ]* //'
wait
echo "191 levou $(( $(date +%s) - inicio )) s"
P -At -c "select 'coluna: ' || count(*) from information_schema.columns where table_name = 'webhooks' and column_name = 'n_id_receb'"
P -At -c "select 'gatilho: ' || count(*) from pg_trigger where tgname = 'webhooks_n_id_receb'"
