# Reunião NTB — 03/08/2026 (Ramon Carneiro)

Fonte: `Reunião com Ramon  Carneiro-20260803_200922-Gravação de Reunião.mp4`
(transcrita via `/etl-audio`, Mistral Voxtral). Duração: 1h11min12s.

**Nota sobre a transcrição:** a separação de vozes (diarization) falhou —
o áudio inteiro saiu como 1 speaker só, apesar de ser uma conversa entre
duas pessoas (Ramon mostrando o sistema/Omie pra outra pessoa). O texto
abaixo foi reconstruído lendo a transcrição inteira (1008 segmentos) e
inferindo quem fala o quê pelo conteúdo — sem diarização real, então
alguma atribuição de fala pode estar imprecisa, mas o CONTEÚDO (o que foi
pedido/discutido) está completo.

**Achado incidental:** em vários pontos, Ramon menciona já estar
prototipando a lógica de correção de estoque numa conversa separada com
"Cláudio" (transcrição — nome real incerto). **Correção após reler a
transcrição inteira uma segunda vez:** perto do fim eles tentam
compartilhar essa conversa e mencionam explicitamente *"no Google tem um
botão de share"* e *"navegadores conectados"* — isso não bate com a
interface do Claude, soa mais como Gemini/AI Studio ou outra ferramenta
do Google. Não conseguiram achar o botão de compartilhar e desistiram por
ora ("melhor fazer do zero depois"; Ramon disse que ia ver o notebook em
pessoa). **Não afirmar que é o Claude sem confirmar com o Ramon** — vale
perguntar qual ferramenta ele usou antes de pedir o link.

## Tabela resumo

| # | Item | Detalhe | Status |
|---|------|---------|--------|
| 1 | Manifestação de NF-e — onde o dado mora | Ramon mostra, no banco de dados que ele puxa da Omie, um campo "Manifestação do destinatário" com os estados "operação não realizada / confirmada / desconhecida (ND)", dentro de Documentos → Número de parcela. Ele afirma que esse campo EXISTE e é acessível. **Contradiz a conclusão desta sessão** (de que manifestação SEFAZ não é exposta pela API da Omie) — precisa reverificar com ele exatamente qual fonte/tela ele está usando antes de descartar ou retomar essa investigação. | **Precisa esclarecer com Ramon** — qual sistema/exportação exatamente mostra isso |
| 2 | Certificado digital + CSC da loja Sertão | Ramon confirma que já mandou o certificado digital do Sertão por e-mail e o CSC pelo WhatsApp. Teste de emissão de nota com esse certificado numa outra loja ("MJ") falhou — mesmo resultado de antes. A contabilidade afirma que ELES conseguem emitir com aquele CSC — perguntar/testar se o CSC cadastrado no Omie bate com o que a contabilidade está usando. | Em aberto — Ramon quer feedback **hoje** pra repassar à contabilidade |
| 3 | Impressão de programação de produção — bug | Ao filtrar "imprimir atrasadas" por local de estoque numa loja específica, o relatório não traz dados mesmo havendo OPs atrasadas ali. Ramon disse que vai investigar ele mesmo. | Ramon investiga — não é ação nossa por enquanto |
| 4 | Impressão de programação de produção — formato | Pedido de ajuste visual: quer as datas "aqui embaixo" num formato específico que ele já tinha mandado antes (referência a um PDF de Ordem de Produção que ele já enviou). | A esclarecer — pedir o exemplo/print que ele já mandou |
| 5 | **Lista de inventário para impressão em PDF** (feature nova) | Quer imprimir um PDF com: código do produto, descrição, quantidade a inventariar — filtrável por tipo/família/local de estoque (ex: só matéria-prima, só PDV/frente de loja). Cabeçalho com data e local de estoque. Objetivo: equipe conta manualmente e confronta depois. Indeciso se fica na tela de Produtos ou de Inventários — a favor de reaproveitar o filtro de produtos que já existe, pra não duplicar. | **Feature nova, não implementada** |
| 6 | **Correção automática de estoque negativo** (tópico principal, ~40min) | Ver seção detalhada abaixo — é o maior pedido da reunião. | **Fase 1 (produto em processo) a construir esta semana**, conforme regra detalhada |
| 7 | Automação futura: correção ligada ao inventário | Ideia para depois: quando alguém lança um inventário, o sistema detecta a baixa manual resultante e verifica automaticamente se o inventário anterior teve padrão de entrada/saída condizente — se não, aponta como provável erro de contagem anterior OU nota fiscal não lançada, antes de around simplesmente lançar OP. | Watch item — fase 2, sem prioridade definida |
| 8 | Relatório de Faturamento — separar processado de cancelado | Ramon diz que o relatório "não traz ainda o que foi processado x cancelado" e que "nem tem filtro aqui". **Conferir se isso já não foi resolvido** nesta sessão (já existe filtro de status/cancelado em "Ver cupons") — pode ser um ponto de vista diferente do que ele quer, ou pode já estar resolvido e ele não percebeu. | **Precisa verificar contra o que já foi entregue** |
| 9 | Relatório de Compras — não traz todas as compras do ano | Ramon afirma que o relatório de Compras não está trazendo todas as compras do ano inteiro, em todas as lojas. Contradiz trabalho recente nesta sessão (chips de status, filtros). **Precisa investigar com dado real** antes de assumir que é bug — pode ser mal-entendido de filtro padrão. | **Investigar** — alta prioridade dado o volume de trabalho já feito ali |
| 10 | Relatório de Movimentações — poluído com dado que já existe em outro lugar | O relatório atual mistura vendas (PDV) e compras com movimento manual — Ramon quer que ele mostre **só** movimento manual de estoque (entrada/saída), já que vendas e compras já têm relatório próprio. | **Corrigido e em produção** (commit `8cbd21f`) — toggle "Só manual" em `/relatorio-movimentacao`, fonte `movimentos` filtrada por `ehMovimentoManual` (exclui PDV disfarçado de ajuste e transferência entre locais) |
| 11 | Relatório de Movimentações — falta detalhe por produto | Ao filtrar "movimento manual de estoque" + saída, período de 1 ano inteiro, o relatório mostra só ~R$5 mil — Ramon acha que deveria ser bem mais, e o relatório **não mostra quais produtos** compõem esse valor (só agrega). Quer poder ver por local de estoque, por produto, por família, por tipo, tanto entrada quanto saída. | **Corrigido e em produção** (commits `8cbd21f`/`b888a82`) — drill-down família/tipo/local → produto (`lib/drill.ts`). Fix round 1 (revisão independente) achou 2 bugs no cálculo do valor (custo unitário somado sem multiplicar por quantidade + ajuste de inventário classificado incondicionalmente como saída) — corrigidos. Valor real depois do fix (loja 3, 01/08/25–05/08/26): **saída R$3.295,43** (bem mais perto do "~R$5mil" que o Ramon lembrava — pode não haver "número escondido" nenhum do lado da saída) e **entrada R$1.747.937,29** (nunca antes mostrada, majoritariamente ajuste de inventário — classificação como "entrada" ainda **não confirmada com o Ramon**, ver `task-6-report.md` seção "Fix round 1" antes de tratar como definitivo) |
| 12 | Nota fiscal — pendência a resolver hoje | Ramon pede prioridade na "questão da nota fiscal" hoje, pra poder repassar resposta à contabilidade ainda hoje. Conecta com os itens #2 (certificado/CSC) — provavelmente sobre emissão de NF-e usando o certificado do Sertão. | **Urgente, hoje** — mas o escopo exato (emissão de NF-e) já foi marcado nesta sessão como alto risco/fora de escopo sem decisão explícita — confirmar com Ramon o que exatamente ele quer antes de agir |
| 13 | Botão/ação "reprocessar estoque" | Durante a correção de estoque, Ramon sugere explicitamente um botão/ação com esse nome, que force o sistema a reprocessar e verificar o saldo de um produto — ideia concreta de UI, não só o conceito de automação do item #6. | Ideia de UI a considerar junto com o item #6 |
| 14 | Menção solta: "Ela vai questionar compras" | Logo após falar de "Ana, Praia do Forte", uma fala solta sem contexto completo — parece um comentário sobre uma pessoa (gerente da loja?) que vai auditar/questionar compras, mas a transcrição não permite confirmar. **Registrado como ruído, não como pedido** — só por transparência de que existe no áudio. | Sem ação — contexto insuficiente |
| 15 | Movimentações: dimensão "situação" (frase incompleta) | Ramon começa a pedir que o relatório de Movimentações traga também "a situação", mas a frase é cortada antes de explicar o que isso significa (status de nota? de movimento?). Ficou em aberto. | **Não implementado, pendente de esclarecer com Ramon** — pedido cortado na transcrição, frase incompleta, não dá pra inferir se é status de nota ou de movimento |

## Detalhe do item #6 — Correção de estoque negativo (produto em processo)

Regra de negócio descrita por Ramon, passo a passo, fazendo a correção
manualmente ao vivo durante a call (ele mesmo chamou de "treino" da
lógica, mencionando estar testando isso também numa conversa com
"Cláudio"/Claude em paralelo):

1. **Detectar** produto com estoque atual negativo (ex.: Abacaxi, -3,3).
2. **Antes de assumir falta de produção**, verificar duas coisas:
   - Falta de **transferência entre locais de estoque** — o produto pode
     estar positivo em um local (ex.: núcleo) e negativo em outro (ex.:
     cozinha) porque nunca foi transferido.
   - Falta de **movimento manual de estoque** não lançado, que explicaria
     a diferença sem ser produção.
3. Se confirmado que é falta de produção mesmo: calcular quanto precisa
   lançar = **estoque mínimo − estoque atual** (se o mínimo for zero,
   trazer só até zero).
4. **Distribuir em lançamentos semanais** (1 por semana), desde o
   primeiro mês em que o produto ficou negativo até o mês atual —
   dividindo a quantidade total igualmente entre as semanas de cada mês.
5. Cada lançamento = uma Ordem de Produção nova (pode duplicar uma OP
   pronta existente como modelo):
   - As **datas de previsão e conclusão têm que ser iguais** entre si.
   - Usar o **local de estoque onde está negativo** — não precisa criar
     em outro local e transferir depois.
   - Preferência por datas redondas (ex.: sempre dia 1º do mês, ou dias
     fixos tipo 1/8/15/20/22).
6. Depois de lançar, **reprocessar/atualizar** e conferir se o saldo
   bateu com o esperado antes de seguir pro próximo produto.
7. **Execução em massa (fase de automação futura)**: enviar os
   lançamentos intercalando — sempre as datas mais recentes primeiro,
   revezando entre produtos diferentes (nunca dois lançamentos seguidos
   do mesmo produto), com espera entre envios (produtos com ficha técnica
   maior demoram mais pra processar). Rodar em loop até zerar o backlog.
8. **Ordem de prioridade dos tipos de produto** (cada um com lógica
   diferente):
   - **Fase 1 (esta semana): produto em processo** — é o caso trabalhado
     na call.
   - Depois: **produto acabado** — lógica diferente, tem que ser diária
     (atrelada à venda no PDV); geralmente já fica preso a uma OP aberta
     automaticamente quando vendido, então muitas vezes só precisa
     **concluir** a OP já existente, não criar nova.
   - Depois: **matéria-prima** e **produto de revenda**.
9. Visão de produto (decisão futura, ainda sem spec): uma aba/tela
   "Corrigir estoque" que sugere as correções e deixa o usuário revisar
   antes de aplicar em massa — ou já fazer tudo automaticamente. Ramon
   quer **totalmente automático**, mas concordou em começar manual (ele
   mesmo acompanhando) e já deixar o processo pronto pra depois
   automatizar.

**Ação concreta antes de começar a construir:** perguntar a Ramon qual
ferramenta ele usou pra prototipar essa lógica (não confirmado se é Claude
ou outra IA — ver nota no topo do arquivo) e pedir o link/export da
conversa — ele mesmo ofereceu compartilhar, mas a call terminou antes de
resolver como.
