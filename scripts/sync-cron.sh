#!/bin/bash
# Roda no Contabo via crontab do sistema, a cada 10 min de verdade (o GitHub
# Actions, que fazia esse papel antes, so disparava a cada ~60-240min na
# pratica -- GH nao garante schedule preciso, so "melhor esforco"). Bate
# direto em localhost:3002 (mesma porta do systemd ntb-estoque.service),
# sem depender de rede externa nem do Vercel. Mesma logica de "bloco" de
# 10min que o .github/workflows/sync-omie.yml (desativado) tinha.
set -euo pipefail
cd /opt/ntb-estoque

SECRET=$(grep '^CRON_SECRET=' .env.local | head -1 | cut -d'=' -f2- | tr -d '"')
BASE="http://127.0.0.1:3002"
LOG=/opt/ntb-estoque/sync-cron.log

hit() {
  local codigo
  codigo=$(curl -s -m 120 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SECRET" "$BASE$1" || echo "ERR")
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1 -> $codigo" >> "$LOG"
}

min=$(date -u +%M)
bloco=$(( 10#$min / 10 ))

hit /api/cron/sync-nfs
hit /api/cron/sync-ops
hit /api/cron/retry-op-conclusao
hit /api/cron/sync-posicao
# Achado real (30/07): todos os jobs "1x/hora" abaixo caiam juntos no mesmo
# bloco 0 (:00-:09 de cada hora), empilhando 7 syncs pesados de uma vez em
# cima dos 4 que ja rodam a cada 10min -- pico real de CPU/DB medido ao vivo
# (load average do servidor saltando pra 5+ em 6 nucleos nesse instante).
# Sem mudar a frequencia de nenhum (continuam 1x/hora), so espalhados por
# bloco diferente pra nao competir entre si pelo mesmo minuto.
if [ "$bloco" -eq 0 ] || [ "$bloco" -eq 3 ]; then hit /api/cron/sync-locais; fi
if [ "$bloco" -eq 0 ]; then hit /api/cron/sync-produtos; fi
if [ "$bloco" -eq 1 ]; then hit /api/cron/sync-previsao; fi
if [ "$bloco" -eq 2 ]; then hit /api/cron/sync-movimentos; fi
# Achado real (usuario reportou "Importado em 18/07" ao vivo, hoje e' 26/07):
# /api/cron/sync-faturamento existe desde 06/07 mas nunca foi incluido aqui --
# ficou de fora silenciosamente quando o cron migrou do GitHub Actions pra
# este script (commit d9e0373). 5 das 6 lojas ativas nao atualizavam
# faturamento_importado ha mais de uma semana. Roda a cada hora.
if [ "$bloco" -eq 3 ]; then hit /api/cron/sync-faturamento; fi
# Achado real (usuario reportou "Movimentacao so ate abril" 27/07): a RPC
# relatorio_movimentacao_matriz calculava "preco mais recente por produto" ao
# vivo (CTE cara, estourava timeout de 8s ocasionalmente e a tela caia em
# silencio pro historico frio). Migration 090 tirou isso do caminho de leitura
# pra uma tabela cache (produto_preco_recente) -- esse endpoint mantem ela
# atualizada. E so um refresh local (nao chama o Omie), roda rapido.
if [ "$bloco" -eq 4 ]; then hit /api/cron/sync-preco-movimentacao; fi
# Achado real (usuario reportou erro ao excluir uma OP "fantasma", 30/07): o
# endpoint /api/cron/sync-reconciliar-op existe desde 10/07 (acha OPs abertas
# e atrasadas que foram excluidas direto no Omie sem o sync normal detectar)
# mas, igual sync-faturamento antes dele, nunca foi incluido aqui -- ficou de
# fora silenciosamente na migracao do GitHub Actions pra este script. A OP
# que o usuario tentou excluir estava atrasada desde 14/07, 16 dias sem essa
# limpeza automatica rodar nem uma vez.
if [ "$bloco" -eq 5 ]; then hit /api/cron/sync-reconciliar-op; fi

# Mantem o log enxuto (ultimas ~2000 linhas, uns poucos dias).
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
