#!/bin/bash
# scripts/backup-postgres-contabo.sh
# Backup noturno do Postgres self-hosted do Contabo (stack em
# /opt/ntb-estoque-standby/), com retencao de 14 dias. Necessario a
# partir da virada pra Contabo como principal -- o Supabase cloud cobria
# esse papel antes, sem custo pra nos gerenciar.
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
