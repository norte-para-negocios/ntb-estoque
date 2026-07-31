#!/usr/bin/env bash
# Liga a stack de failover do Supabase self-hosted (Docker) so quando o
# Supabase cloud (plano gratuito) estiver de verdade fora do ar, desliga
# sozinho quando ele volta -- sem isso, a stack fica sempre ligada
# consumindo ~2GB RAM + CPU a toa (achado real 2026-07-30, investigando
# lentidao do sistema). Roda via cron a cada 5min (ver Step 4).
set -euo pipefail

SUPABASE_URL="https://waubqgkftwrufepwhctc.supabase.co"
STATE_FILE=/opt/ntb-estoque/.failover-state   # "up" ou "down": estado atual do failover local
COUNT_FILE=/opt/ntb-estoque/.failover-count   # checagens seguidas discordantes do estado atual
LOG=/opt/ntb-estoque/failover-watch.log
CONTAINERS="supabase-kong supabase-pooler supabase-storage supabase-edge-functions realtime-dev.supabase-realtime supabase-meta supabase-auth supabase-rest supabase-db supabase-studio supabase-imgproxy"
LIMIAR=3   # 3 checagens seguidas (cron de 5min = 15min) pra trocar de estado -- evita flapping num blip transitorio
# O gateway Kong deste projeto exige header apikey em /auth/v1/health -- sem
# ele responde sempre 401 (mesmo saudavel), o que faria o script achar que o
# Supabase esta sempre fora do ar. Le a anon key do .env.local, mesmo padrao
# de scripts/sync-cron.sh pro CRON_SECRET.
ANON_KEY=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' /opt/ntb-estoque/.env.local | head -1 | cut -d'=' -f2- | tr -d '"')

estado=$(cat "$STATE_FILE" 2>/dev/null || echo "up")
contagem=$(cat "$COUNT_FILE" 2>/dev/null || echo "0")

codigo=$(curl -s -o /dev/null -m 8 -w '%{http_code}' -H "apikey: $ANON_KEY" "$SUPABASE_URL/auth/v1/health" || echo "000")
saudavel="nao"
[ "$codigo" = "200" ] && saudavel="sim"

if { [ "$estado" = "up" ] && [ "$saudavel" = "nao" ]; } || { [ "$estado" = "down" ] && [ "$saudavel" = "sim" ]; }; then
  contagem=$((contagem + 1))
else
  contagem=0
fi
echo "$contagem" > "$COUNT_FILE"

if [ "$contagem" -ge "$LIMIAR" ]; then
  if [ "$estado" = "up" ]; then
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') Supabase cloud fora do ar ha $LIMIAR checagens seguidas (HTTP $codigo) -- ligando failover local" >> "$LOG"
    docker start $CONTAINERS >> "$LOG" 2>&1
    echo "down" > "$STATE_FILE"
  else
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') Supabase cloud saudavel ha $LIMIAR checagens seguidas -- desligando failover local" >> "$LOG"
    docker stop $CONTAINERS >> "$LOG" 2>&1
    echo "up" > "$STATE_FILE"
  fi
  echo "0" > "$COUNT_FILE"
fi
