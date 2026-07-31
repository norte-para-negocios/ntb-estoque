#!/bin/bash
# scripts/backup-postgres-contabo.sh
# Backup noturno do Postgres self-hosted do Contabo (stack em
# /opt/ntb-estoque-standby/), com retencao de 14 dias. Necessario a
# partir da virada pra Contabo como principal -- o Supabase cloud cobria
# esse papel antes, sem custo pra nos gerenciar.
#
# Agendamento: systemd timer no servidor (NAO crontab -- o cron do Ubuntu
# 24.04 aqui ignora CRON_TZ silenciosamente, testado ao vivo e confirmado
# na doc do proprio pacote). Units ficam so no servidor, fora deste repo
# git (mesmo padrao do systemd service ntb-frio-api, ver AGENTS.md):
#   /etc/systemd/system/ntb-backup-postgres.service
#   /etc/systemd/system/ntb-backup-postgres.timer
# O timer usa OnCalendar=*-*-* 03:00:00 America/Sao_Paulo (fuso dentro da
# propria expressao de calendario, gramatica do systemd.time(7) -- NAO a
# chave TimeZone= em [Timer], que nao existe nesta versao do systemd/255).
set -euo pipefail

DEST_DIR="/root/backups-ntb-estoque"
# Fuso explicito: o servidor roda em Europe/Berlin, nao Brasilia (~5h de
# diferenca). Sem isso, o nome do arquivo pode carregar uma data adiantada
# em relacao ao dia civil brasileiro perto da virada da meia-noite.
DATA=$(TZ=America/Sao_Paulo date +%Y%m%d)
SENHA=$(grep '^POSTGRES_PASSWORD=' /opt/ntb-estoque-standby/.env | cut -d= -f2)

mkdir -p "$DEST_DIR"

docker exec -e PGPASSWORD="$SENHA" supabase-db \
  pg_dump -U postgres -d postgres --schema=public --schema=auth --schema=storage \
  | gzip > "$DEST_DIR/ntb-estoque-$DATA.sql.gz"

# retencao: apaga backups com mais de 14 dias
find "$DEST_DIR" -name 'ntb-estoque-*.sql.gz' -mtime +14 -delete

echo "backup ok: $DEST_DIR/ntb-estoque-$DATA.sql.gz ($(du -h "$DEST_DIR/ntb-estoque-$DATA.sql.gz" | cut -f1))"
