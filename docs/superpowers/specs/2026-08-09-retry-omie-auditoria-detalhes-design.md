# Retry de sync Omie + Auditoria de completude + Páginas de detalhe — Design

**Data:** 2026-08-09

**Gatilho:** usuário trouxe um pacote de 5 pedidos numa mensagem só. Depois
de mapear o código atual e confirmar escopo com o usuário, ficou definido
como 5 blocos, executados como um plano único (mesmo formato da auditoria
de relatórios de 2026-08-05: várias tasks independentes, um plano só).

## Bloco 1 — Retry automático de sync Omie (inventário + transferência + movimentação)

**Situação atual (confirmada lendo o código):** existe hoje um padrão
completo de retry só para conclusão de Ordem de Produção
(`lib/actions/ordem-producao.ts`: campos `conclusao_status`,
`conclusao_erro_msg`, `conclusao_tentativas`, `conclusao_ultima_tentativa_em`,
cron dedicado `app/api/cron/retry-op-conclusao/route.ts`, throttle de 1h
entre tentativas de "Sem CMC").

As 3 chamadas que fazem `IncluirAjusteEstoque` na Omie — `lib/actions/
inventario.ts` (`processarItemInventario`), `lib/actions/movimentacoes.ts`,
`lib/actions/transferencia.ts` — **não têm retry automático**.
`inventario.ts` tem hoje só um campo simples `status` em `inventario_items`
(`Sem CMC` / `Processando` / `Concluido` / `Erro`), sem contador de
tentativas nem timestamp. Há um comentário explícito no código dizendo que
o processamento é sequencial e sem retry item a item "de propósito, corrige
o bug do sistema antigo" — decisão deliberada, não esquecimento. O usuário
confirmou que quer reverter essa decisão conscientemente, para os 3 fluxos
(inventário, transferência, movimentação), não só inventário.

**Arquitetura:** replicar o padrão já validado de OP nos 3 fluxos:
- Adicionar campos de controle equivalentes aos de `conclusao_*` de OP
  (status de erro, mensagem, contador de tentativas, timestamp da última
  tentativa) nas tabelas relevantes. Ler o schema real (`\d inventario_items`,
  `\d transferencias`, `\d movimentos` no Contabo) antes de decidir nomes
  exatos de coluna — não presumir.
- Um cron de retry por fluxo (ou um cron único que varre os 3, a decidir na
  implementação conforme overhead), com teto de tentativas (evita loop
  infinito) e respeitando o throttle já estabelecido entre chamadas à Omie
  (300-800ms conforme leitura/escrita, ~240 req/min) — nunca reenviar mais
  rápido que isso, para não estourar cota.
- Idempotência: usar a mesma chave natural que a Omie já usa para evitar
  duplicar ajuste em caso de reenvio (`cod_int_ajuste` — confirmar na
  implementação se a Omie já rejeita/ignora duplicata por essa chave, ou se
  é preciso checar antes de reenviar).

## Bloco 2 — Lista de Ordens de Produção: filtro de período

**Situação atual (confirmada lendo o código):** a lista já mostra
pendentes e concluídas juntas por padrão — não há filtro de status
aplicado por padrão. O único filtro default é o de **período** (sempre
abre no mês corrente), e o próprio código documenta que isso foi um
pedido explícito do cliente antes ("Atende o pedido do cliente").

**Decisão:** manter o default de mês atual como está — não reverter uma
decisão anterior do usuário sem confirmação explícita. Usuário aprovou o
design sem pedir mudança neste ponto; nenhuma ação de código neste bloco.
Se o usuário sentir que o problema era outra coisa, ajusta depois.

## Bloco 3 — Auditoria de completude de dados + cancelados visíveis

Duas partes:

**3a. Cancelados visíveis no Faturamento.** Hoje `lib/omie/faturamento.ts`
exclui cupom/item cancelado (`cCupomCancelado === 'S'` / `cItemCancelado
=== 'S'`) da agregação que abastece a tela (`faturamento_importado`) — o
cupom cancelado fica gravado no fato bruto do Contabo (`fat_cupons`, campo
`cancelado`) só para auditoria, mas não aparece em lugar nenhum da UI.
Adicionar exibição explícita na tela de Faturamento (ex: contador e valor
total "excluído por cancelamento" no período, visível, não escondido) —
não muda o total faturado (que deve continuar sem cancelados), só torna
visível o que está sendo descartado.

**3b. Auditoria ampla de completude.** Mesmo espírito da auditoria de
2026-08-05 (que achou migrations nunca aplicadas, bug de SLD tratado como
movimento assinado, 414 por URL longa em filtros), mas agora focada em
**completude/correção de dado silenciosamente perdido ou incorreto**
(não em filtro/URL), nos 10 relatórios existentes: Resumo do dia,
Movimentação, Dashboard de Produção, Compras, Estoque Valorizado, Margem,
Faturamento, Faturamento×Compras (rota `relatorio-indicadores`),
Auditoria Fiscal, Pendências de Classificação. Para cada um: verificar se
existe alguma exclusão silenciosa de dado (cancelado, erro engolido,
status não tratado, campo nulo tratado como zero, etc.) que produza total
errado sem sinalizar ao usuário. Reportar achados por relatório; corrigir
os que forem bugs reais (célula vazia/errada), documentar como decisão
de produto os que forem exclusão intencional mas hoje invisível (aplicar
o mesmo padrão do 3a onde fizer sentido).

## Bloco 4 — Página de detalhe de Ordem de Produção (nova)

**Situação atual:** não existe página de detalhe dedicada. O "detalhe" é
só a linha expandida na lista (`components/ordem-producao/
OrdemProducaoRow.tsx`), mostrando produto, quantidade, ingredientes da
ficha técnica, validade.

**Nova rota:** `app/(app)/ordem-producao/[id]/page.tsx`. Seções:
- Dados básicos (os que já existem na linha expandida hoje).
- **Inventários relacionados** — itens de inventário que geraram ajuste
  desse produto/loja (cruzar por produto + loja + janela de tempo próxima
  à OP; investigar na implementação se existe vínculo mais direto via
  `cod_int_ajuste`/`id_ajuste`).
- **Nota fiscal vinculada** — se a OP tiver relação com entrada/saída de
  NF (investigar como esse vínculo existe hoje, se existir).
- **Histórico de sync com a Omie** — os campos `conclusao_status`/
  `conclusao_tentativas`/`conclusao_erro_msg` já existem no banco (Bloco 1
  estende esse padrão) mas não aparecem em lugar nenhum da UI hoje; expor
  aqui.
- **Histórico de edições** — quem alterou quantidade/validade/data e
  quando, via `audit_log` (tabela que já existe e já registra esse tipo de
  evento, usada nesta mesma sessão para reconciliação forense).

## Bloco 5 — Página de detalhe de Nota Fiscal (enriquecer existente)

**Situação atual:** `app/(app)/nota-fiscal/[id]/page.tsx` já mostra dados
fiscais (`DetalhesFiscaisNF`), itens (`ItensNotaFiscal`), ações de
manifestação, download de XML/DANFE.

**Adicionar:**
- **Ordens de produção relacionadas** — via produto (mesmo critério de
  cruzamento do Bloco 4, na direção oposta).
- **Movimentações de estoque geradas** — o que essa NF gerou de
  entrada/saída em `movimentos`.
- **Histórico de status/manifestação** — linha do tempo de quando mudou
  de etapa e quem manifestou, via `audit_log`/`webhooks`.

## Fora de escopo deste plano

- Mudar o filtro de período default da lista de OP (Bloco 2 — decisão
  explícita de não mexer, ver acima).
- Qualquer mudança no valor final do Faturamento (cancelados continuam
  fora do total — só ficam visíveis como informação separada).
- Retry automático para qualquer outra integração Omie fora das 3 listadas
  no Bloco 1 (ex: conclusão de OP já tem seu próprio retry, não precisa
  refazer).

## Ordem de execução recomendada

1. Bloco 1 (retry) — maior risco técnico (grava em produção sem staging),
   fazer primeiro e com calma, seguindo o mesmo rigor de revisão da
   reconciliação de 2026-08-08 (testar com 1-2 registros antes de lote).
2. Bloco 3a (cancelados visíveis) — pequeno, isolado, baixo risco.
3. Bloco 3b (auditoria ampla) — pode rodar em paralelo conceitual ao
   Bloco 1, mas como plano é uma task por relatório.
4. Bloco 4 e 5 (páginas de detalhe) — mais trabalho de UI, dependem de
   entender os vínculos de dado (produto↔inventário↔NF↔OP), fazer por
   último para aproveitar o que os blocos anteriores já expuserem sobre
   esses vínculos.
