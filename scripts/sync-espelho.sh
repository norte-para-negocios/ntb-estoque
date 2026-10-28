#!/bin/bash
# Crons do espelho completo ("nosso Omie": kardex da loja inteira, OPs abertas, fichas), SEPARADOS do sync-cron.sh
# desde o D5 (20/10/2026). Motivo: o sync-cron.sh principal já leva ~7 dos 10 min do ciclo (retry-ajustes-movimentos
# estoura os 240 s do curl); com o espelho em 3 lojas ele passaria de 10 min e o `flock -n` pularia ciclos inteiros,
# inclusive o retry da integração de vendas. Aqui o espelho tem trava e log próprios e roda 5 min depois do principal:
#
#   5-59/10 * * * * /usr/bin/flock -n /tmp/sync-espelho.lock /bin/bash /opt/ntb-estoque/scripts/sync-espelho.sh
#
# Cada rota já tem orçamento de tempo próprio (kardex 200 s, OPs abertas 120 s, fichas 120 s), roda as lojas uma de
# cada vez em rodízio e pula loja bloqueada/pausada (lib/omie/espelho-ciclo.ts). Sem loja com lojas.espelho_completo,
# as 3 respondem 200 na hora sem chamar o Omie. O sync-ajustes (janela de data das lojas com a flag) continua no
# sync-cron.sh, porque a mesma rota serve às outras lojas.
set -euo pipefail
cd /opt/ntb-estoque

SECRET=$(grep '^CRON_SECRET=' .env.local | head -1 | cut -d'=' -f2- | tr -d '"')
BASE="http://127.0.0.1:3002"
LOG=/opt/ntb-estoque/sync-espelho.log

# Grava o código HTTP e o começo do corpo (o resumo por loja: páginas, parouPor, pulado), para acompanhar a ativação.
hit() {
  local tmp codigo
  tmp=$(mktemp)
  codigo=$(curl -s -m "$2" -o "$tmp" -w '%{http_code}' -H "Authorization: Bearer $SECRET" "$BASE$1" || echo "ERR")
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1 -> $codigo $(head -c 1500 "$tmp" | tr '\n' ' ')" >> "$LOG"
  rm -f "$tmp"
}

# OPs abertas primeiro: a tela de OPs abertas e a sugestão de compra só passam a usar aberta_omie depois da 1ª lista.
hit /api/cron/sync-ops-abertas 150
hit /api/cron/sync-kardex 280
hit /api/cron/sync-fichas 150

# Financeiro A0 (27/10/2026): espelho do financeiro do Omie (omie_fin_*). 1) avisos Financas.* já gravados em webhooks
# -> espelho (só banco, não chama o Omie, roda também de madrugada); 2) carga inicial/conferência pela API (só leitura,
# 8 chamadas por loja e ciclo, orçamento de 90 s, nunca 00–07h da Bahia). Aqui e não no sync-cron.sh, que já leva ~7 min.
# Desligar: OMIE_FIN_DESLIGADO=1 no .env.local (ou OMIE_FIN_API_DESLIGADA=1 só para a parte da API).
hit /api/cron/sync-financeiro-avisos 150
hit /api/cron/sync-financeiro 150

tail -n 3000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
