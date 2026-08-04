# Auditoria de filtros e completude de dados nos relatórios — Design

**Data:** 2026-08-04
**Gatilho:** queixa verbal do dono do projeto ("NTB Stock não está aparecendo
certinho os relatórios — Compras, está faltando os meses atuais, faturamento...
tem os filtros de produção, esse tipo de coisa") + itens ainda abertos da
reunião com Ramon Carneiro de 03/08/2026
(`docs/reuniao-2026-08-03-ramon-pedidos.md`, itens #8, #9, #10, #11, #15).

## Objetivo

Investigar, com dado real de produção (sem staging neste projeto), se e onde
cada um dos 9 relatórios do sistema está com filtro incompleto, filtro que
esconde dado sem avisar, ou dado incompleto/incorreto — e corrigir o que for
confirmado como bug real, especificar o que for feature/redesenho pedido, e
sinalizar (sem implementar por suposição) o que depende de esclarecimento do
Ramon.

## Escopo

Os 9 relatórios do sistema: Compras, Faturamento, Produção, Movimentações,
Auditoria Fiscal, Margem, Indicadores, Estoque Valorizado, Nota Fiscal.

## Arquitetura do plano

### Bloco 0 — Causa raiz compartilhada (investigar primeiro)

`lib/historico-contabo.ts` define `JANELA_QUENTE_DIAS = 90`, escrito quando o
Supabase cloud (free tier, 500MB) guardava só os últimos 90 dias e o histórico
completo morava num Postgres à parte no Contabo. Nesta mesma sessão de
trabalho o Supabase cloud foi descontinuado e o projeto passou a rodar
self-hosted no próprio Contabo — a premissa original desse corte pode não
valer mais. Esse corte é consumido por 6 dos 9 relatórios (Compras,
Movimentação, Auditoria Fiscal, Indicadores, Nota Fiscal, e indiretamente
Faturamento).

Task de investigação: comparar com SQL direto, para uma loja de volume
conhecido e um período que cruza os 90 dias, o que o Supabase self-hosted já
tem vs. o que o Contabo-frio tem. Três desfechos previstos:
- Self-hosted já tem o ano inteiro → simplificar a leitura, aposentar o desvio
  pro Contabo-frio nesses relatórios.
- Corte ainda existe mas está desalinhado → corrigir a constante/lógica.
- Está correto, sintoma é outra coisa → descartar a hipótese, seguir pro
  Bloco 1 sem mudança aqui.

### Bloco 1 — Por relatório (uma task por tela, 9 no total)

Cada task segue o mesmo formato:
1. **Investigar com dado real** — SQL direto comparado ao que a tela
   renderiza, para loja(s) reais, testado com a conta QA — antes de tocar em
   código.
2. **Classificar o achado**: bug confirmado (corrigir), filtro/feature
   faltando (implementar só o que já foi pedido — YAGNI, sem inventar filtro
   novo por conta própria), ou pendente de esclarecimento com Ramon
   (documentar e não implementar por suposição).
3. Só então o código, se aplicável.

## Achados já conhecidos por relatório (requisitos de entrada de cada task)

| # | Relatório | Queixa/achado já registrado | Classificação provável |
|---|---|---|---|
| 1 | Compras | "Falta meses atuais" / não traz o ano todo em todas as lojas (queixa de hoje + item #9 da reunião) | Bug suspeito — ligado ao Bloco 0 ou a sync atrasado por loja |
| 2 | Faturamento | "Não separa processado x cancelado, nem tem filtro" (item #8) — mas já existe filtro de status dentro de "Ver cupons" | Possível desalinhamento de expectativa — ver achado do Indicadores (linha 7), pode ser o mesmo problema em tela errada |
| 3 | Produção | Queixa de hoje ("filtros uma merda") — confirmado no código: só tem filtro de mês/granularidade, zero filtro de tipo/família/produto/local | Feature faltando (confirmado) |
| 3b | Produção (item #3 da reunião) | "Imprimir atrasadas" por local não traz OPs mesmo havendo atrasadas ali — Ramon disse que ia investigar sozinho | Reconfirmar se ainda está quebrado antes de assumir resolvido |
| 4 | Movimentações | Poluído com venda/compra (item #10, quer só manual) + falta detalhe por produto, valor parece baixo (item #11) + dimensão "situação" incompleta (item #15) | #10/#11 = feature/redesenho pedido; #15 = pendente de esclarecer com Ramon |
| 5 | Auditoria Fiscal | Sem queixa direta — filtro de status só existe como chips, não na gaveta de filtros (inconsistente com as outras telas) | Provável não-bug, UX menor |
| 6 | Margem | Sem queixa direta — filtro de "local" é um proxy (produtos com estoque ali), não uma dimensão direta | Investigar se engana o usuário na prática |
| 7 | Indicadores | Sem queixa direta, mas achado concreto: lado Compras tem `status: 'CONCLUIDA'` hardcoded, sem toggle — esconde Pendente/Manifestada/Cancelada sem avisar | Bug real confirmado no código — candidato forte a ser a raiz real da queixa #8 |
| 8 | Estoque Valorizado | Sem queixa — foto do momento (sem filtro de data por design), paginação já correta | Baixa prioridade, confirmação rápida |
| 9 | Nota Fiscal | Já documentado no `AGENTS.md`: quando o período cruza 90 dias, filtro de tipo/família/produto/local não cruza corretamente com a fatia fria | Bug já conhecido, nunca corrigido |

## Regras globais

- Nunca simular/mockar dado — toda investigação usa SQL direto contra o
  Postgres de produção (Contabo) e todo teste de correção usa a conta QA da
  aplicação.
- Nenhum valor citado num achado pode ser chutado — toda alegação vem
  acompanhada da query que confirmou ou refutou.
- Bug vs. feature vs. pendente-Ramon nunca se misturam numa mesma sub-etapa
  sem rótulo claro.
- Itens marcados "pendente de esclarecer com Ramon" não são implementados por
  suposição — entram no plano como item documentado e param aí, mesmo que o
  restante do relatório seja corrigido.
- Qualquer mudança em RPC de relatório híbrido precisa ser replicada no
  espelho frio equivalente (`relatorio-frio-nf.ts`, `faturamento-frio.ts`).
- Deploy no Contabo sempre via
  `nohup bash deploy.sh > /tmp/log 2>&1 < /dev/null &` (detached), nunca em
  foreground.

## Critério de conclusão

Por relatório: achado confirmado com query real → corrigido → testado de novo
com a mesma query/conta QA mostrando o resultado esperado → marcado concluído.
Relatório sem achado real confirmado é marcado "auditado, sem correção
necessária" com a evidência da checagem anexada.
