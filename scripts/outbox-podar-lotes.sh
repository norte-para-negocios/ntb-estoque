#!/bin/bash
# Poda da outbox em lotes por id (Fase I, 19/10/2026). Substitui no crontab do servidor:
#   17 * * * * docker exec supabase-db psql -U supabase_admin -d postgres -c "delete from outbox where created_at < now() - interval '1 day'" >> /var/log/outbox-prune.log 2>&1
# por:
#   17 * * * * /usr/bin/flock -n /tmp/outbox-poda.lock /bin/bash /opt/ntb-estoque/scripts/outbox-podar-lotes.sh >> /var/log/outbox-prune.log 2>&1
#
# Por quê: um DELETE só, de ~15 mil linhas, segura bloqueio e gera WAL de uma vez (4 s em média, pico 20,6 s em
# produção, pg_stat_statements de 19/10); em lotes curtos de 5.000 por id (índice da PK) cada transação é rápida e
# o offline_compactar (a cada minuto) não espera. Nunca apaga o que o offline_compactar ainda pode reler: só ids
# abaixo de offline_meta.ultimo_outbox - 5000 (a folga de reprocessamento da migration 158).
# Para sozinho quando um lote apaga 0 ou depois de 200 lotes (1 milhão de linhas) num ciclo.
set -u
LOTE=${LOTE:-5000}
MAX_LOTES=${MAX_LOTES:-200}
SQL="with alvo as (
  select id from outbox
  where created_at < now() - interval '1 day'
    and id < coalesce((select (valor #>> '{}')::bigint from offline_meta where chave = 'ultimo_outbox'), 0) - 5000
  order by id
  limit $LOTE
), d as (delete from outbox o using alvo where o.id = alvo.id returning 1)
select count(*) from d"
total=0
for i in $(seq 1 "$MAX_LOTES"); do
  n=$(docker exec supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt -c "$SQL") || { echo "$(date -Is) ERRO no lote $i (apagadas ate aqui: $total)"; exit 1; }
  total=$((total + n))
  [ "$n" -lt "$LOTE" ] && break
  sleep 0.2
done
echo "$(date -Is) outbox: DELETE $total em $i lote(s)"
