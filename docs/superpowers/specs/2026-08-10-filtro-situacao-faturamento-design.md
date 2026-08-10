# Filtro de Situação no Faturamento — Design

**Data:** 2026-08-10

**Gatilho:** usuário reportou (com print da tela) que o painel principal de
Filtros do relatório de Faturamento (`app/(app)/relatorio-faturamento/
page.tsx`) não tem como filtrar por Normal/Cancelada/Devolvida — só existe
um filtro de status escondido dentro do modo "Ver cupons", que troca a
tela inteira pra uma lista cupom-por-cupom em vez do resumo por Tipo/
Família/Forma de pagamento que o usuário normalmente usa.

## Situação atual (confirmada lendo o código)

- Painel de Filtros (`FiltrosGaveta`) tem 5 campos: Data inicial, Data
  final, Tipo, Família, Forma de pagamento. Sem status.
- O modo padrão (agregado) usa `buscarFatAgregado` → endpoint `/fat_agregado`
  na API do Contabo (`ntb-frio-api`, fora deste repo git, deploy manual
  separado). Esse endpoint tem `and c.cancelado = false` **fixo no SQL**,
  sem parâmetro pra mudar — e não referencia `devolvido` em lugar nenhum.
  Estruturalmente incapaz de filtrar por situação sem alterar o servidor
  externo.
- O modo "Ver cupons" (`?ver=cupons`) já tem os dados reais —
  `CupomFat.cancelado`/`CupomFat.devolvido` (booleans, vindos direto de
  `cCupomCancelado`/`cCupomDevolvido` da Omie, gravados em `fat_cupons`) —
  e já tem um filtro de status funcional (`ChipsStatus`,
  `cupomBateStatus`/`statusCupomSel`, parâmetro de URL `status`). Mas é
  visualmente separado do painel de Filtros, só aparece depois de um
  clique em "Ver cupons", e troca a visão inteira pra tabela de cupons.
- Performance não é um bloqueio: paginação de `buscarFatCupons` já está
  corrigida (confirmado ao vivo: 13.758 cupons/ano numa loja grande, sem
  cortar). O limite existente (`LIMITE_LINHAS_CUPONS = 1000`) é só de
  exibição de tabela, não de busca — a soma usa o dado completo.

## Decisões confirmadas com o usuário

1. Ao escolher um status, o usuário quer **continuar vendo o mesmo resumo
   de hoje** (Tipo/Família/Forma de pagamento), não pular pra uma lista
   cupom-por-cupom.
2. Opções do filtro: **Normal / Devolvido / Cancelado**, escolha única
   (um cupom só tem 1 status). Sem seleção = comportamento atual (Normal +
   Devolvido somados, cancelado sempre fora do total) — nada muda por
   padrão.
3. Sem mexer no endpoint externo (`/fat_agregado`, `ntb-frio-api`) nesta
   primeira versão.

## Arquitetura

Quando o parâmetro de URL `status` estiver definido (Normal/Devolvido/
Cancelado), a tela deixa de chamar `buscarFatAgregado` (agregado
pré-calculado) e passa a calcular o mesmo resumo **em JavaScript**, a
partir do fato linha-a-linha já disponível (`buscarFatCupons` +
`buscarFatCupomItens`/`buscarFatCupomPagamentos`, dependendo da dimensão
ativa — item pra Tipo/Família/Produto, pagamento pra Forma de pagamento):

1. Busca os cupons do período (já paginado corretamente), monta um mapa
   `n_id_cupom → situação` a partir de `cancelado`/`devolvido`.
2. Busca as linhas de item ou pagamento (dependendo do `dim` ativo) do
   mesmo período.
3. Junta cada linha ao status do seu cupom (via `n_id_cupom`), filtra só
   as do status escolhido.
4. Agrupa e soma exatamente como o agregado faz hoje (mesma lógica de
   `group`/`group2` do endpoint atual), produzindo o mesmo formato de
   saída (`LinhaFatAgregado[]`) — pra cair nas mesmas tabelas já
   existentes, sem precisar mudar a renderização.

Sem `status` na URL: comportamento idêntico ao de hoje, `buscarFatAgregado`
continua sendo usado normalmente.

**Reuso do parâmetro de URL:** o novo campo escreve o mesmo `status` que o
`ChipsStatus` do "Ver cupons" já lê — os dois ficam sincronizados de
graça. Escolher "Cancelado" no painel principal e depois abrir "Ver
cupons" já mostra a lista filtrada igual.

**Detalhe a confirmar na implementação (não presumir agora):** como a
dimensão `tipo`/`família` de cada item é resolvida hoje (join com
`produtos` ou classificação já embutida no dado do fato) — replicar
exatamente essa lógica na nova agregação em JS, não inventar uma nova.

## UI

Novo campo "Situação" (`select` de escolha única: Normal / Devolvido /
Cancelado) no array `campos` de `FiltrosGaveta`, mesmo estilo visual dos
campos existentes (Tipo, Família, Forma de pagamento). Também aparece nos
chips de filtros ativos (`ChipsFiltrosAtivos`), mesmo padrão dos outros.

## Fora de escopo desta primeira versão

- **Drill-down** (clique numa linha do resumo pra abrir detalhe): sua
  lógica de navegação atual não foi desenhada para uma segunda fonte de
  dado (fato filtrado por status); ficará ignorando o filtro de Situação
  por enquanto — se o usuário clicar num drill enquanto o filtro está
  ativo, o comportamento exato (manter o filtro? resetar?) fica como
  decisão de implementação, documentada no relatório da task, não
  resolvida aqui. Candidato a follow-up dedicado se fizer falta.
- **Export/Excel**: verificar durante a implementação se dá pra estender
  o export pra respeitar o filtro de Situação sem custo extra relevante
  (reaproveitando a mesma função de agregação JS); se o custo for baixo,
  incluir; se exigir refazer a lógica do export do zero, documentar como
  fora de escopo e reportar antes de decidir sozinho.

## Verificação obrigatória antes de fechar como pronto

Comparar, para pelo menos 1 loja e 1 período reais, o total calculado pela
nova agregação JS (filtrando por um status específico) contra uma soma
manual via SQL direto no Postgres do Contabo (`fat_cupons`/
`fat_cupom_itens`/`fat_cupom_pagamentos`) — mesmo padrão de validação já
usado nesta sessão pros outros relatórios híbridos.
