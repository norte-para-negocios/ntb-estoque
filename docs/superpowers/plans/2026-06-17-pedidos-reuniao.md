# Pedidos e bugs da reunião NTB 17/06/2026 (Joaquim + Ramon) — COMPLETO

Releitura integral da transcrição (1.142 segmentos, 62 min). Áudio ruim em partes;
(?) = precisa confirmar. Quem mostra a tela e fala os pedidos é o Ramon; Joaquim anota.

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
- **Agrupar/ver por MÊS** (não só por data). Hoje fica "por data" e "por produto" e polui (muita água,
  embalagem). Quer poder priorizar produtos com entrada; "cada produto colocar um do mês".
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
  - O necessário: **permitir cadastrar a estrutura.**

================================================================================
## E. CADASTRO VIA SINTEGRA / FORNECEDOR (pra integração fiscal futura)
================================================================================
- Tela onde se informa um endereço/CNPJ (ele chamou de "cindere" = SINTEGRA?) pra **puxar cadastros**:
  produtos, clientes, **fornecedor**, CEST.
- Quando entrar a integração fiscal (entrada de NF), vai precisar cadastrar/puxar o fornecedor.
- Pedido: criar o campo/fluxo de **cadastro de fornecedor** (e puxar fornecedor já cadastrado).

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
## K. AGENDA
================================================================================
- 18/06 (amanhã) 10h: Joaquim sobe as alterações pendentes e testa tudo.
- 18/06 20h: reunião com o André — testar como USUÁRIO comum (conta sem admin).
- Depois que tudo funcionar: começar a AUTOMATIZAÇÃO DE RELATÓRIOS.
- Transcrição vai pro Drive.
