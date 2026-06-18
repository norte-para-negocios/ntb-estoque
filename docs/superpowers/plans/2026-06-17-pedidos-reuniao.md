# Pedidos e bugs da reunião NTB 17/06/2026 (Joaquim + Ramon) — COMPLETO

Releitura integral da transcrição (1.142 segmentos, 62 min). Áudio ruim em partes;
(?) = precisa confirmar. Quem mostra a tela e fala os pedidos é o Ramon; Joaquim anota.

================================================================================
## VISÃO ESTRATÉGICA (norteia TUDO)
================================================================================
**O OBJETIVO É SUBSTITUIR O OMIE COMPLETAMENTE no futuro.** Hoje o sistema é INTEGRADO ao Omie
(puxa e escreve), mas a meta é ser INDEPENDENTE: o banco próprio é a fonte da verdade, não ficar
dependente de puxar direto do Omie a todo momento (transcr.: "fazer de uma maneira que não fique
puxando direto lá; fica tudo salvo no banco"). **DECISÃO: preparar a arquitetura desde já pra essa
independência** — dados completos no banco, cadastros próprios (loja, produto, fornecedor, cliente,
família, CEST), histórico próprio (1 ano + arquivo morto), estrutura de produto própria. Integrado
agora, independente depois (mas já preparando).

================================================================================
## A. BUGS (corrigir)
================================================================================
1. **CMC / custo zerado** — JÁ CORRIGIDO (no main). Causa confirmada na reunião: "cada dia o
   CMC é autorizado; ele só buscava o CMC autorizado NO DIA. Hoje só 46 produtos trocaram o CMC;
   ontem (16/06) eram 2.125 de custo de 2.276 produtos; hoje 46." Ou seja, a posição do dia corrente
   vem quase sem CMC e a tela usava ela. Correção: tela pega o CMC não-zero mais recente + sync
   mantém 2 fotos. "90% dos produtos têm CMC em algum local."
2. **Transferência não "volta" / fica zerado** — ao transferir, o produto some/zera, não "inteira",
   precisa dar refresh e às vezes nem aparece. Frases: "ele está voltando sozinho", "tenho que apagar,
   ele não foi", "inteira zero, nem inteirando", "aí ele não volta, tem que botar um ponto / botar vivo".
   CRÍTICO. Investigar o fluxo de transferência (provável relacionado a CMC<=0 / estado do movimento).
3. **Inventário trava em "Iniciado"** — item dá erro e fica "iniciado", não conclui. Ver item C abaixo
   (a correção é o envio item-a-item). Tem botão "reprocessar"/"reenviar pendentes".
4. **OP com quantidade zerada** — produtos na OP aparecem com quantidade 0 ("tem uns que não tá vendo
   quantidade, tá com zero"; produto em processo "tá fazendo zero").
5. **NF faltando por loja** — Ramon vê: 1 loja sem jan/fev/mar/abr; loja 5 só junho; loja 6 só maio
   (parcial); loja 4 completa. A loja sem movimentação (7, distribuidora) é aceitável. Joaquim suspeita
   da forma de puxar ("se puxa da mesma maneira pra todas, não devia ter diferença"). "As fiscais
   também estão bugando." (Minha varredura no banco mostrou lojas 2-6 completas — então é a TELA ou a
   numeração da loja na fala. RE-CONFERIR comparando o total do Omie com o banco, mês a mês.)
6. **Estoque mínimo não trazendo** em alguns produtos ("não está trazendo estoque mínimo também").
7. **Sugestão de preço** — regra: se NÃO tem preço de venda (zerado), NÃO dar sugestão de preço mesmo
   tendo custo. Hoje aparenta dar/zoar. Conferir.
8. **Unidade de medida + quantidade não aparece às vezes** — ao adicionar produto em OP/transf/
   inventário, a unidade (UN/KG) às vezes não aparece e a quantidade fica ZERO mesmo o produto
   aparecendo (transcr.: "aparece com UN mas fica com zero; só se eu botar de novo é que coloca").
   Conferir (a) produtos com `unidade` vazia e (b) se as telas de operação exibem unidade na linha.
9. **CMC / estoque NEGATIVO sem aviso** — quando o produto fica negativo, o CMC fica negativo.
   Pedido: ter como VER/saber quando o produto está ficando negativo (alerta), pra fazer transferência
   ANTES de zerar. Mostrar o CMC total e sinalizar quando está negativo. (relacionado: estrutura que
   consome mais do que entra — ver D).
> Joaquim atribuiu vários a alterações locais ainda não subidas pro ar (mexeu no banco pra pegar
> histórico, deu conflito). Disse que sobe e testa amanhã 18/06 10h.

================================================================================
## B. MOVIMENTAÇÕES (a tela nova; ele detalhou MUITO)
================================================================================
- **Trazer VALOR (R$), não só quantidade.** "Interessa são valores, lá tá muito mais valor que
  quantidade." Opção de ALTERNAR: o usuário escolhe se quer ver quantidade OU valor.
- **Filtro por tipo de movimentação:** entrada, saída, **rejeito**, entrada de OP, saída de OP,
  movimentação/manual de estoque, transferência. ("o que gostaria de ver é a parte de rejeito.")
- **Filtro por local de estoque** — trabalham por local; quer saber, num local: o que entrou por
  transferência e quanto saiu por transferência (do depósito).
- **Filtro por origem** (compra de produto, consumo, transferência, entrada) — origem já aparece.
- **Filtro por tipo de produto e família.**
- **Agrupar/englobar por MÊS** (não só por data). Hoje fica "por data" e "por produto" e polui (muita
  água, embalagem). Quer **priorizar produtos com entrada**; "cada produto colocar um do mês".
- Filtro de **entradas** e filtro de **concluído**.
- **FILTROS COMPLETOS** (bateu forte nisso): poder **ESCOLHER ver POR MÊS ou POR DATA** (alternável),
  filtro por **família**, e a **movimentação de VALOR (R$/grana) TODA ali** — não faltar nada no filtro.
- **Deixar aberto pra criar mais filtros** depois.
- Contexto: é a tela que ele usa pra ADMINISTRAÇÃO (entrada x saída por valor).

================================================================================
## C. INVENTÁRIO e TRANSFERÊNCIA: envio ITEM A ITEM na hora
================================================================================
- Ao criar inventário/transferência e ir lançando **produto por produto**, CADA item já deve ser
  ENVIADO/integrado ao Omie na hora — NÃO esperar fechar a lista (uma lista de 100 de uma vez "é pior").
- Fluxo: digitou o item -> digitou a quantidade -> **saiu do campo de quantidade -> já envia.**
- **Toda vez que mexer na quantidade, REPROCESSA** (ex.: botou 10, depois 15 -> reenvia).
- Se um item dá erro, ele marca erro e PASSA pro próximo (não trava a lista toda em "iniciado").
- Vale pra inventário E transferência.
- **Imprimir direto da lista** do inventário (sem entrar no item).
- **Permitir editar/excluir item** do inventário (hoje finalizado fica só leitura/verde, não edita).

================================================================================
## D. CADASTRO DE PRODUTO
================================================================================
- Obrigatórios: código, descrição, unidade, NCM, família. Resto opcional. (já está assim)
- **ESTRUTURA DE PRODUTO (ficha técnica / BOM)** — produto "em processo" (70 mil) OU "acabado" deve
  permitir cadastrar a ESTRUTURA: escolher os itens que compõem o produto + quantidades. É a malha do
  Omie. Ex.: prato arrumadinho = base + farofa + vinagrete + feijão. É um Bill of Materials.
  - **Unidade dos itens:** trabalham em kg. Ex.: base de vatapá = 2,5 kg por base; ao produzir, lança em
    kg e o consumo dos itens é em kg.
  - **Rendimento/peso:** o arroz ganha peso (100 g cru -> 180 g cozido). Opção de PESO acumulado dos
    itens (somar o peso dos componentes) — "não pesa o produto, mas é bom ter a opção". Pode marcar um
    item pra NÃO entrar na conta.
  - **Ver o consumo de cada elemento** ao produzir/concluir a OP (ex.: o prato camarão a joel consome
    25 g de ervilha; outro consome 55 g). A estrutura pode estar **consumindo mais do que entra** ->
    gera saldo/CMC negativo (ligado ao bug A-9). Quer enxergar isso ("a gente consegue ver todos os
    elementos, o que está sendo consumido").
  - O necessário: **permitir cadastrar a estrutura.**

================================================================================
## E. CADASTRO VIA SINTEGRA / FORNECEDOR (pra integração fiscal futura)
================================================================================
- Tela onde se informa um endereço/CNPJ (ele chamou de "cindere" = SINTEGRA?) pra **puxar cadastros**:
  **produtos, clientes, fornecedor, CEST**.
- Quando entrar a integração fiscal (entrada de NF), vai precisar cadastrar/puxar o fornecedor.
- Pedido: criar o campo/fluxo de **cadastro de fornecedor e de cliente** (e puxar os já cadastrados).

================================================================================
## F. LOCAL DE ESTOQUE
================================================================================
- Omie NÃO exclui local por API (confirmado; locais de teste ZZ ficaram). Joaquim vai ver na API se
  dá pra inativar/bloquear de outra forma. (locais foram ativados -> por isso bloqueavam exclusão)
- No local de estoque NÃO se cadastra nada de produto: todo produto pode estar em todos os locais ao
  mesmo tempo, com quantidade em cada. O que é por produto: **uma família** e **um tipo** (revenda etc.).

================================================================================
## G. USUÁRIOS / PERMISSÕES / ONBOARDING
================================================================================
- **Esconder o seletor de loja** quando a pessoa só tem 1 loja (mostrar só o NOME da loja num canto,
  não o dropdown — senão revela que existem várias lojas). Só mostrar seletor pra quem tem 2+.
- **Esconder do MENU** o que a pessoa não tem permissão (NF, Produção...). Hoje aparece mas não deixa
  usar; ele quer que nem apareça.
- **Permissões granulares por módulo** ao criar usuário (a pessoa escolhe o que pode mexer).
- Cadastros: Produtos e Locais visíveis conforme permissão; **Saúde da integração e Logs só admin.**
- **Onboarding por CÓDIGO DE LOJA:** cada loja tem um código; o admin gera/manda o código; o funcionário
  se cadastra, escolhe o perfil (administrador/funcionário), informa o código da loja (identifica a
  loja), faz login; o chefe ajusta as permissões. Ou o próprio código já traz as permissões. (resolve o
  login/onboarding que estava em standby; vão alinhar com o André)
- **Um ADMINISTRADOR por loja** (multi-admin): cada loja pode ter seu próprio admin; aumentar as
  possibilidades de login/perfis por loja (não ficar só num admin global; mais logins por loja).
- Visual do cadastro de usuário "tá muito feio" — melhorar.

================================================================================
## H. OP (ordem de produção)
================================================================================
- **Reverter** a OP CONCLUÍDA (cancela a conclusão) e **Excluir** a OP em aberto/pendente. Confirmado
  de novo (A5/A10). "Concluída a gente permite reverter; a que está pendente, permite excluir."

================================================================================
## I. NOTAS FISCAIS
================================================================================
- **Total do período no topo** (nº de notas): ex. "24 notas, de 05 a 17". (faz parte dos totalizadores)
- Conferir os "dois status" de NF.

================================================================================
## J. ELOGIOS / CONFIRMAÇÕES
================================================================================
- "Saúde da integração" foi muito boa (achou a Brotas não puxando posição; lista os erros pra consertar).
- Lançar pelo sistema é MAIS RÁPIDO que lançar direto no Omie.
- Regra do banco confirmada pelo Joaquim na call: histórico de 1 ano vivo; >1 ano vai pro arquivo
  ("estante"); precisa de 1 ano pra previsão.
- Lojas 5/6: o bloqueio do Omie é só pra "puxar as informações da loja"; o resto funciona.
- Ramon autorizou: Joaquim pode TESTAR transferência/produção e depois APAGAR ("testa e apaga"), e
  mandar pro Ramon o que testou pra ele conferir a comunicação.

================================================================================
## L. UI / TABELAS (transversal, várias telas)
================================================================================
- **Cabeçalho fixo (sticky) ao rolar**, igual Excel/freeze: o topo da tabela tem que ficar "cravado"
  na tela pra continuar vendo o nome de cada coluna ao descer a lista. ATENÇÃO: eu removi o sticky do
  thead quando consertei os cantos arredondados (overflow-hidden quebra o sticky). Refazer mantendo OS
  DOIS (cantos curvos + cabeçalho fixo). Vale pra Lista e DataTable.
- **Botões rápidos de status** (chips) direto na tela: Concluídos / Pendentes / etc. (OP, inventário,
  transferência) — atalho de 1 clique em vez de abrir a gaveta de filtro.
- **Filtros de movimentação por família** (e tudo): garantir o filtro de família na tela de
  movimentações (além de tipo/local/origem/tipo de movimentação).
- **MELHORAR MUITO os filtros** em geral (todas as telas) + **botões rápidos em cima da tabela**.
- **Melhorar a BUSCA de produto** — ainda está precária ao adicionar produto, e NÃO só na OP: também
  em **transferência e inventário** (busca mais inteligente/rápida).
- **Scroll feio** — criar um **scroll customizado** próprio (estilizado, fino e bonito), pra todas as
  telas. O scroll padrão do navegador tá feio.
- **Produtos selecionados mais finos** (no local de estoque / nas listas) — deixar as linhas dos
  produtos já selecionados mais finas/compactas e refinadas.
- Ele citou "várias coisas pequenas" de polimento de tela — manter o olho em detalhes ao revisar
  cada tela RODANDO (ver no navegador antes de dar por pronto). Invocar skill de taste antes de UI.

================================================================================
## M. EXPORTAÇÃO (PDF + Excel) — pra TODAS as telas/relatórios
================================================================================
- **PDF bonito** (bem feito, não cru). E ao gerar o PDF, **poder ESCOLHER o que vai nele** ANTES de
  gerar — via os filtros (período, loja, colunas, tipo, etc.). Ou seja: aplica filtro -> escolhe o que
  entra -> gera o PDF só com aquilo.
- **Excel de verdade (.xlsx), NÃO CSV.** Melhorar muito a planilha exportada: **deixar LINDA e bem
  feita** (cabeçalho formatado, colunas, totais, visual caprichado).
- As duas opções (PDF e Excel) disponíveis nas telas/relatórios.

================================================================================
## N. CADASTROS (criar os que faltam)
================================================================================
- **Cadastro de fornecedor** (e puxar via SINTEGRA — ver E).
- **Cadastro de família.**
- Cadastro de cliente, CEST (ver E).
- **Endereço das lojas** — poder informar o endereço ao cadastrar a loja; e as lojas que JÁ existem,
  **puxar o endereço do Omie** se tiver. (parte de tornar o cadastro de loja completo/próprio = visão
  de independência do Omie)
- "Tem cadastro de fornecedor, de família, de tudo isso que você não bota" — criar todos os cadastros
  que faltam, não só produto/local.

================================================================================
## O. HISTÓRICO / RETENÇÃO (confirmado de novo)
================================================================================
- **Guardar sempre 1 ano de histórico no banco** (janela rolante); o que passa de 1 ano vai pro
  arquivo morto. É o que faz a **PREVISÃO funcionar certinho** (precisa de 1 ano). Já é a regra (rolling
  12 meses + offload pro Storage); manter e garantir que a previsão usa esse 1 ano.

================================================================================
## K. AGENDA
================================================================================
- 18/06 (amanhã) 10h: Joaquim sobe as alterações pendentes e testa tudo.
- 18/06 20h: reunião com o André — testar como USUÁRIO comum (conta sem admin).
- Depois que tudo funcionar: começar a AUTOMATIZAÇÃO DE RELATÓRIOS.
- Transcrição vai pro Drive.
