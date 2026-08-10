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

# -m 120 -> -m 240 (Important #3, auditoria 2026-08-09/10): os 3 crons novos de
# retry/sync-ajustes estouravam o timeout de 120s EM TODO CICLO desde o deploy
# (log sempre "000ERR", indistinguivel de falha real -- cegava o log e quase
# colidia com o proximo ciclo de 10 min). `hit()` usa um -m fixo pra todas as
# chamadas deste script; diferenciar por endpoint exigiria reescrever a funcao
# (ex.: um segundo parametro de timeout) so pra 3 das ~20 chamadas -- optou-se por
# subir o timeout global em vez disso (mitigacao complementar a reducao de
# limitePorLoja 30->10 nos 2 crons de retry, que ja deve encurtar a maioria dos
# ciclos bem abaixo de 120s de qualquer forma).
hit() {
  local codigo
  codigo=$(curl -s -m 240 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SECRET" "$BASE$1" || echo "ERR")
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1 -> $codigo" >> "$LOG"
}

min=$(date -u +%M)
bloco=$(( 10#$min / 10 ))

hit /api/cron/sync-nfs
hit /api/cron/sync-ops
hit /api/cron/retry-op-conclusao
# Retry automatico de ajuste de estoque (inventario/movimentacao/transferencia)
# sem estourar cota da Omie -- achado real (auditoria 2026-08-09): as 3
# chamadas de IncluirAjusteEstoque nao tinham retry nenhum, so reenvio manual.
hit /api/cron/retry-ajustes-inventario
hit /api/cron/retry-ajustes-movimentos
# Achado real (Task 17 da auditoria 2026-08-09): sync-ajustes nunca foi
# migrado pro crontab do Contabo -- so existia no vercel.json (inativo desde
# que producao saiu do Vercel), morto ha 7+ dias sem nenhum sinal de erro.
hit /api/cron/sync-ajustes
hit /api/cron/sync-posicao
# Achado real (usuario reportou 01/08: ficava excluindo OP direto no Omie e o
# NTB Estoque nao sumia com ela) -- reconciliarOPsFantasmas agora tambem cobre
# a fatia "recente" (created_at desc, sem exigir 3+ dias de atraso), entao
# precisa rodar a cada 10min (nao mais 1x/hora) pra dar feedback rapido pra
# quem esta testando/limpando OPs ao vivo no Omie. E leve (Promise.allSettled
# entre lojas, ~16s de parede no total mesmo com 6 lojas em paralelo).
hit /api/cron/sync-reconciliar-op
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

# Snapshot diario de CMC/margem (migration 101) -- precisa rodar so 1x/DIA
# (arquivo append-only, uma linha por produto/dia; rodar a cada 10min como os
# outros jobs so reescreveria a mesma data_snapshot repetidas vezes por nada).
# Nao ha precedente de "1x/dia" dentro deste script (o unico outro job diario,
# o backup do Postgres, roda via systemd timer separado, fora daqui -- ver
# AGENTS.md). Resolvido com hora UTC: casa "bloco 0" (min 00-09) com hora 06
# (03h em America/Sao_Paulo, fora do horario de pico de sync) pra disparar 1x
# por dia de verdade, sem depender de infra nova so pra este job.
hora=$(date -u +%H)
if [ "$bloco" -eq 0 ] && [ "$hora" = "06" ]; then hit /api/cron/snapshot-margem-diario; fi

# Snapshot do PLANEJADO das OPs abertas (migration 103). Mesma logica de 1x/dia
# do job acima, meia hora depois (bloco 3 = min 30-39) so pra nao empilhar os
# dois no mesmo minuto. Precisa rodar antes das conclusoes do dia comecarem:
# ao concluir, a Omie sobrescreve nQtde com o produzido e o planejado se perde
# pra sempre -- e a Omie nao guarda os dois (confirmado ao vivo na API).
if [ "$bloco" -eq 3 ] && [ "$hora" = "06" ]; then hit /api/cron/snapshot-op-planejada; fi

# Mantem o log enxuto (ultimas ~2000 linhas, uns poucos dias).
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
