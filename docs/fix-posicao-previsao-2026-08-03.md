# Fix: loja quebrada travava sync de todas as lojas — 03/08/2026

## O que estava acontecendo

`sync-posicao` (CMC / posição de estoque) e `sync-previsao` (previsão de
venda) escolhem **uma única loja por execução** — sempre a mais
desatualizada — pra não estourar o tempo da função rodando as 6 de uma vez.

Como a loja 7 (VINHAS & VINHETOS) está com a credencial da Omie inválida
desde 31/07, ela nunca conseguia atualizar — e por nunca atualizar, ela
**ficava para sempre em primeiro lugar** na fila de "mais desatualizada".
O erro não tratado derrubava a requisição inteira (500) antes de tentar
qualquer outra loja.

**Resultado:** as 6 lojas ficaram 3 dias (31/07 a 03/08) sem atualizar CMC
nem previsão de venda — não só a loja quebrada. Isso contamina margem,
estoque valorizado e qualquer relatório que dependa desses dados, de forma
silenciosa (sem erro visível na tela, só dado desatualizado).

## Fix

`app/api/cron/sync-posicao/route.ts` e `app/api/cron/sync-previsao/route.ts`:
em vez de tentar só a loja mais desatualizada e falhar, agora tentam em
ordem (mais desatualizada primeiro) até uma funcionar, registrando as que
falharam na resposta (`puladas`).

## Verificação

Testado ao vivo contra produção: `sync-posicao` puxou 4.102 registros da
loja 3 pulando a loja 7 corretamente; rodado mais 4x pra desatrasar as
demais lojas de uma vez (em vez de esperar o rodízio natural de ~50min).
`sync-previsao` mesma coisa.

Confirmado depois: as 5 lojas saudáveis atualizadas hoje (03/08, entre
16:56 e 17:05); só a loja 7 continua parada em 31/07 — exatamente o
esperado até a credencial dela ser renovada.

## Ainda pendente

A causa raiz de tudo isso é a **loja 7 com credencial da Omie suspensa**
(já reportado no relatório de validação de 01/08) — o fix de hoje evita
que ela contamine as outras, mas ela mesma continua sem sincronizar nada
até alguém renovar a chave/app no painel da Omie.
