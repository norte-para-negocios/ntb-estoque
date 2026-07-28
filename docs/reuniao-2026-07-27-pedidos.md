# Reunião NTB — 27/07/2026 (Ramon Carneiro × Joaquim × Andrey)

Fonte: `Reunião Desenvolvimento-20260727_200534-Gravação de Reunião` (docx, transcrição
automática, sem diarização confiável em vários trechos — bastante ruído/inglês mal
transcrito misturado). Duração: 1h20m26s. Participantes: **Ramon Carneiro** (gestor/dono),
**Andrey** (sócio/gestor, entrou aos ~4min), **Joaquim** (dev).

Lida a transcrição inteira, linha a linha (523 linhas). Abaixo, todo item acionável
identificado, na ordem em que apareceu. Onde a fala ficou ambígua por causa da qualidade da
transcrição, isso está marcado explicitamente — não preenchi lacunas por suposição.

**Revisão de 2026-07-28 (2ª passada):** por pedido do usuário, a reunião foi re-transcrita do
zero a partir do `.mp4` original (Mistral Voxtral, `/etl-audio`) e cruzada com os 4 arquivos
de referência que ele mandou (`FAT_SVVM_2026.xlsx`, `MOV_AMJ_2026 - 1º SEM.xlsx`,
`NFS_ENT_SVVM_26_R0.xlsx`, `OP_SVVM_JUN25 - R1.xlsx`, `NTB Estoque - Relatório SVVM 2026 -
R06.pptx`). Achados dessa revisão:
- A retranscrição teve diarização falha (`speakers_count: 1`, mesma limitação do docx
  original) e um artefato sério: um loop de ~26 minutos (00:42 a 01:09) onde o modelo travou
  repetindo a mesma frase em vez de transcrever o áudio real. Esse trecho foi recuperado
  comparando com o docx original, que cobria esse período sem o mesmo problema.
- **1 correção real**: o item #6 (abaixo) era uma má-atribuição — o pedido "notas fiscais só
  concluídas" era sobre **Compras**, não Faturamento (Ramon diz explicitamente, minuto ~1:04:03,
  "o relatório de faturamento, ele já está mais, já está funcionando direitinho" logo antes de
  reclamar do filtro em Compras). Mesclado com o item #7.
- **2 achados novos nos arquivos de referência**, incorporados abaixo: a spec exata do
  formato de "Programação de Produção" (item #10, achada em `OP_SVVM_JUN25`) e os limites de
  referência reais de Compras/Faturamento e Perdas usados pela consultoria (item #16, achados
  no pptx).

## Tabela resumo (todos os itens)

| # | Item | Detalhe | Status |
|---|------|---------|--------|
| 1 | Desligar sistema antigo (teste) | Testar desligamento do app antigo "Norte Para Negócios" no Contabo pra medir ganho de performance | Prazo: 28/07 |
| 2 | Preço de entrada usando campo errado do Omie | Trocar fonte de "último preço de compra" de valor unitário do fornecedor para CMC (custo médio contábil) da compra | **Corrigido e em produção** (commit `c97c4d5`) — CMC não vem da NF, já existia via posição de estoque |
| 3 | NF pendente contando notas já manifestadas | Excluir notas manifestadas (etapa 40) da contagem "precisa de ação"; restringir NF em aberto e OP atrasada ao mês atual | Bug confirmado |
| 4 | Filtros do relatório "por operação" quebrados | Nenhum filtro (tipo, local, família, origem) tinha efeito na tabela | **Corrigido e em produção** (commit `0646e8b`, 2026-07-28) |
| 5 | Quantidade errada no detalhe de Movimentações | Card mostra valor "acumulado" onde parece que deveria descontar do estoque | Bug confirmado |
| 6 | ~~Faturamento sem filtro concluída/cancelada~~ | **Correção 2ª passada**: má-atribuição — Ramon diz explicitamente que o Faturamento "já está funcionando direitinho"; o pedido de filtro era sobre Compras, mesmo item que o #7 | Mesclado no #7, não é item separado |
| 7 | Compras sem filtro de status | Verificado ao vivo nas 4 RPCs (`relatorio_compras_total/_dim/_matriz/_detalhe`) + espelho JS: já filtram por padrão só concluída+não cancelada (migration 083) | **Já corrigido antes desta sessão** — falta só o extra (opção de ver canceladas), que é feature nova, não bug |
| 8 | Sync de transferência/inventário feito no Omie não volta | Nunca puxou; ao trazer, gerar número de sequência local + trazer campo responsável; trazer quem alterou a OP no Omie | Bug confirmado |
| 9 | Erro 500 na emissão de NF-e (homologação) | Investigado: emissão fiscal não existe no código (só leitura/consulta) — decisão de escopo já registrada como alto risco, não é bug | Não é código — precisa decisão explícita antes de construir (certificado + SEFAZ reais) |
| 10 | Impressão de "Programação de Produção" | Matriz produto x dia do mês (landscape A4), linha em branco por dia pra anotar o produzido, variante "atrasadas", filtro de local de produção | **Corrigido e em produção** (commits `108aa75`/`ffd8525`/`6d11ef0`/`1c4ab18`) |
| 11 | Relatório de Inventários | PDF por período (espelha Transferências) + botão "Copiar link" (compartilhar) | **Corrigido e em produção** (commits `0e74ce4`/`9dd4218`/`9c6c5a7`) |
| 12 | Detalhe clicável de Movimentações + edição inline | Modal ao clicar numa linha, ver tudo do movimento, editar/reverter sem trocar de tela; sempre mostrar unidade de medida junto da quantidade | Feature nova — já em andamento |
| 13 | Mobile: card de produto escondia campos (mínimo, previsão, custo, margem) | Componente compartilhado `Lista` já suportava múltiplos valores com rótulo no card mobile — só as colunas estavam marcadas `ocultarMobile: true` | **Corrigido e em produção** (commit `129eaab`) |
| 14 | Relatório "Posição de Estoque" com cobertura de inventário | Saldo atual + data do último inventário, por produto e por local de estoque | Feature nova |
| 15 | Dashboard de produção diário/semanal/mensal por funcionário | Gráfico de OPs feitas por dia, com quem produziu | Feature nova |
| 16 | Dashboard/Home por perfil (Operação × Gerência) | Operação: enxuto e acionável (ordens atrasadas, NF pendente, transferência aberta, produto abaixo do mínimo). Gerência: completo e gráfico (rejeitos, top faturados/comprados, parados em estoque, relação compras/faturamento) | Feature nova — maior escopo |
| 17 | Categorias contábeis / centro de custo | Ramon vai pesquisar e definir a estrutura; direção já confirmada: CFOP fica no cadastro do produto | Aguardando pesquisa do Ramon |
| 18 | Auditoria Fiscal e Pendências | Revisão adiada para quando entrarem na parte de notas fiscais | Adiado |
| 19 | App local com sincronização periódica | Ideia inicial (rodar local, sync a cada N minutos, uso offline transparente) — sem escopo ou prazo definido | Watch item, sem decisão |
| 20 | Catálogo A4 de QR code | Testado ao vivo, selecionar todos / seleção específica / filtro de inativo funcionando | Confirmado OK — falta só teste de impressão física |
| 21 | Tipos de ajuste de estoque (entrada/saída/ajuste positivo) | Confirmado que não precisa mudar: ajuste de saldo já é coberto por Inventário; entrada sem nota já existe | Confirmado OK, sem ação |
| 22 | Próxima reunião | Quinta-feira 30/07, agora às 19h (antecipada de 21h) | Agenda |

## ⚠️ Ação com prazo explícito
- **Testar amanhã (28/07) o desligamento do sistema antigo "Norte Para Negócios" no
  Contabo** — ele está consumindo CPU no mesmo servidor (só 6 núcleos) e é apontado como uma
  das causas da lentidão geral. Andrey tem acesso para desligar. A loja Praia do Forte (única
  usando o sistema antigo) deve parar de usá-lo a partir do dia 3 do mês que vem de qualquer
  forma. Pedido explícito do Ramon: "faz um teste amanhã... para a gente ver quanto fica mais
  rápido".

## Bugs confirmados ao vivo (ação clara)

1. **Preço de entrada usando o campo errado do Omie.** O campo "último preço de
   compra"/preço de entrada está pegando o *valor unitário do fornecedor* da NF — errado
   quando o fornecedor usa unidade de medida diferente da loja (ex.: fornecedor vende em
   caixa, loja controla em ml — caso citado: leite de coco). Trocar para o **CMC (Custo
   Médio Contábil) da compra**, campo que já existe no Omie ("custo de estoque: CMC") e já
   vem na unidade de medida correta da loja.

2. **Notas fiscais "pendentes" contando notas já manifestadas.** Resumo mostrava 47 notas,
   mas ao abrir a lista só vinham 9 — a diferença são notas já **manifestadas** no Omie
   (etapa 40) que não deveriam contar como "precisa de ação". Regra pedida: se já
   manifestada, não entra na contagem/lista de pendentes, **e** restringir "notas fiscais em
   aberto"/"precisa de ação" para **somente as do mês atual** (nota muito antiga em aberto
   quase sempre já foi manifestada há tempo). Mesma restrição de "só o mês atual" pedida
   para **ordens de produção atrasadas** no resumo operacional.
   - Depende de: trazer o campo de manifestação da NF-e para o sistema (pedido já registrado
     na reunião de 22/07, ainda não implementado — ver `[[project_ntb_estoque_reuniao_2026-07-22]]`).

3. **Relatório de Movimentações → "por operação": filtros não funcionam.** Ramon aplicou
   vários filtros ao vivo (tipo "movimento manual de estoque", local de estoque, família,
   origem) e **nenhum teve efeito** — a lista não mudava. Também notou valores
   inconsistentes (ex.: "compra de produto" aparecendo onde não devia; disparidade entre
   valores tipo venda ~2 milhões vs. ~3 milhões mencionados). Ramon vai mandar a planilha
   Excel de referência para comparar. **Prioridade alta** — é o relatório que vai virar a
   base de dados do dashboard de rejeitos/saídas (ver seção de dashboard abaixo).

4. **Quantidade exibida errada na tela de Movimentações (detalhe do card).** No card de
   detalhe (ex.: leite de coco), a quantidade mostrada parecia estar errada — discussão ao
   vivo sugere que deveria estar **descontando do estoque** (saldo), não mostrando um valor
   "acumulado". Precisa investigar a lógica exata de cálculo desse campo.

5. ~~Faturamento: ainda falta filtro concluída/cancelada por padrão~~ — **correção da 2ª
   passada (2026-07-28)**: reexaminando o contexto completo (não só a frase isolada), Ramon
   fala "no faturamento, as notas fiscais trazer somente as concluídas" só como transição de
   assunto — na sequência imediata ele confirma "o relatório de faturamento, ele já está
   mais, já está funcionando direitinho" e só DEPOIS reclama do filtro que falta, já falando
   de **Compras** ("se a mercadoria foi concluída ou não aqui, não tem... está puxando
   tudo"). Item mesclado no #6 abaixo — não existe pedido separado de filtro pro Faturamento.

6. **Compras: falta filtro de status (concluída/cancelada/tudo), hoje traz tudo sem
   filtro.** Confirmado ao vivo que o relatório de Compras "está puxando tudo", sem
   distinguir concluída de cancelada/aberta. Pedido explícito: **adicionar filtro de status
   em Compras** (e, por analogia, em Vendas/Faturamento se algum dia ganhar filtro
   equivalente), com opção de ver concluídas, canceladas ou tudo — mas vindo **fixo/marcado
   por padrão** para mostrar só as relevantes (Ramon insiste: "coloque aqui a informação...
   pode trazer já fixo como trouxe o outro"). **Investigado 2026-07-28: já corrigido antes
   desta sessão** (RPCs de Compras já filtram concluída+não-cancelada por padrão desde a
   migration 083) — falta só a opção extra de ver canceladas/tudo, que é feature nova.

7. **Transferências e inventários feitos direto no Omie não sincronizam de volta.**
   Confirmado que **nunca puxou**, desde antes: uma transferência ou um inventário feito
   diretamente no Omie não aparece no NTB Estoque. Ramon se ofereceu a fazer uma
   transferência de teste no Omie para validar. Ao trazer:
   - Inventário: não usar o número de sequência do Omie — gerar o próximo número
     localmente, como já é feito hoje; trazer também o campo **responsável** do Omie
     (campo obrigatório lá, já existe campo equivalente no NTB Estoque).
   - Ordem de produção alterada dentro do Omie: hoje só traz a ordem, não traz **quem fez a
     alteração** — precisa também puxar o nome/usuário responsável.

## Erro ao vivo — emissão de NF-e (homologação) — investigado 2026-07-28

**Não é bug de código: a feature não existe no repo.** Emissão de NF-e/NFS-e
nunca foi implementada — só existe leitura/consulta (`ListarRecebimentos`,
`ConsultarRecebimento`). Isso é decisão de escopo deliberada, já registrada
em `docs/superpowers/specs/2026-06-26-omie-varredura-spec.md` (linha ~180):
"IGNORAR. Emitir NFC-e/SAT requer certificado digital por CNPJ e
homologação SEFAZ por estado. Não é plug-and-play. Alto risco
operacional." O upload de certificado digital (`lib/actions/certificado.ts`)
só guarda o arquivo — a função de descriptografar a senha
(`lib/cripto.ts` `descriptografar`) não tem NENHUM call site, ou seja,
nada no repo hoje sequer lê o certificado de volta pra usar. O teste ao
vivo da reunião rodou fora do repo (nenhum arquivo commitado ou modificado
na janela da reunião). Antes de qualquer código, precisa de: (1) decisão
consciente de construir emissão fiscal de verdade (risco alto, tema
sensível — não fazer sem alinhar explicitamente), e (2) resolver a
pendência de permissão de emissor com a Omie/contabilidade, que é
administrativa, não tem nada a ver com código.



Ao final da reunião, teste ao vivo via Claude Code: emitir NF-e em modo **homologação**
(não produção) e consultar notas reais, usando o certificado digital já configurado do
fornecedor **Vieiras e Vinhos**. Resultado: **HTTP 500** (esperado seria 200, ou possivelmente
407). Ação pendente: investigar a causa exata do erro antes da próxima reunião (quinta,
30/07). Contexto de schema mencionado: NF-e de entrada/saída (chave de 44 caracteres),
NFS-e de serviços (46 caracteres), além de cupom fiscal. Já confirmado antes desta call que
dá pra **puxar** notas reais, mas ainda falta **permissão de emissor** (pendência
administrativa/certificado, não é bug de código).

## Features novas pedidas

### Impressão de "Programação de Produção" (nova, distinta da lista de OPs atrasadas)
Ramon quer imprimir a programação de produção (OPs pendentes/programadas do período) num
formato específico — ele vai mandar um modelo de exemplo para usar de base. Campos: **local
de produção** (núcleo, cozinha, bar — únicos locais de produção confirmados; "revenda" não
conta, é compra), data, número da ordem, código, descrição do produto, quantidade prevista,
e **campos em branco para preenchimento manual** (a pessoa imprime em papel e escreve à mão
a quantidade produzida). Confirmado: é para sair **impresso em papel**, não uma planilha
digital.

**Spec concreta encontrada em `OP_SVVM_JUN25 - R1.xlsx` (2ª passada, 2026-07-28)** — essa
planilha É o "modelo de exemplo" que o Ramon citou ("eu tô te mandando esse daqui para você
usar como base"), tem 2 abas relevantes:
- **"PROG DE PRODUÇÃO"**: matriz **produto × dia do mês** — colunas fixas `Cód Produto`,
  `Descrição do Produto`, `Und` (unidade), depois **uma coluna por dia** (1 a 30/31) com a
  quantidade prevista naquele dia; filtros de cabeçalho: Local de Produção, Número da OP,
  Etapa, Tipo do Produto. Ou seja, não é uma lista simples (data/produto/qtd em linhas) — é
  uma grade mensal, um produto por linha, um dia por coluna.
- **"PROG DE PRODUÇÃO EM ATRASO"**: mesma estrutura de matriz, mas filtrada por
  `Etapa = 'A Produzir'` — confirma que é uma visão **separada** da "lista de ordens
  atrasadas" simples que já existe (ele foi explícito sobre isso na call).
- Confirma também os locais de produção reais usados: `COZINHA`, e (por outras abas do mesmo
  arquivo) `NUCLEO`/`PIZZARIA` — bate com o que já estava confirmado na call.

### Relatório de Inventários (equivalente ao de Transferências, que já existe)
Transferências já tem relatório PDF filtrável por mês. Inventário não tem — só Excel de
export e um PDF individual por inventário. Pedido: criar relatório de inventários feitos no
período (como o de transferências) e considerar adicionar uma opção de **compartilhamento**
(enviar o PDF diretamente, tipo "share").

### Tela de Movimentações — detalhe por clique com edição inline (em andamento)
Joaquim já estava implementando isso ao vivo durante a call. Objetivo: clicar em qualquer
linha de movimento (transferência, OP, nota fiscal, ajuste manual) e ver o detalhe completo.
Pedido do Ramon: abrir isso como **modal/janela sobreposta**, não uma tela nova — e permitir
**editar direto ali** (ex.: reverter uma OP) sem trocar de tela. Também pedido: sempre que
aparecer uma quantidade na interface, mostrar a **unidade de medida** ao lado (ex.: "ml"),
para não ficar ambíguo do que se trata.

### Mobile — tabela de produtos: coluna fixa + rolagem horizontal
Detalha e substitui o pedido genérico já registrado ("informação some no mobile"): a coluna
do **nome do produto** deve ficar **fixa**, e as demais colunas (margem, estoque mínimo,
previsão de venda) devem ficar em uma área de **rolagem horizontal** — comparação explícita
usada: "como uma tabela de Brasileirão" (time fixo, estatísticas rolando ao lado).

### Novo relatório: "Posição de Estoque" com cobertura de inventário
Falta um relatório que mostre, por **local de estoque**, a lista de produtos com **saldo
atual** e a **data do último inventário** (contagem) daquele produto naquele local — para
identificar cobertura de inventário (o que não é contado há mais de 30 dias, por exemplo).
Sugestão do Ramon: estender o relatório **Estoque Valorizado** já existente, adicionando
saldo + data do último inventário. Sugestão do Joaquim: usar abas/filtro por local (mesmo
padrão já usado no relatório de Faturamento). Confirmado: produtos inativos já são
excluídos de todos os relatórios por regra geral — vale conferir se esse relatório
específico segue essa regra quando for criado.

### Dashboard de acompanhamento de produção (diário/semanal/mensal, por funcionário)
Pedido do Andrey: gráfico mostrando, dia a dia (1 a 30), quantas OPs foram feitas e por
quem, com opção de visão diária/semanal/mensal — para a gestão identificar rapidamente
períodos sem produção ou queda de produtividade por funcionário, sem precisar vasculhar
relatório nenhum.

### Reestruturação do Dashboard/Home por perfil de usuário (pedido maior, several sub-itens)
Diretriz geral dada pelo Ramon: revisar todos os relatórios/telas perguntando "a pessoa
realmente precisa ver isso" — a tela de "auditoria" hoje mostra contagem de ações do
usuário no sistema, que não é uma métrica útil. Confirmado tecnicamente possível (Joaquim):
dar dashboards diferentes por permissão de login. Definição de escopo:
- **Perfil Operação** (tela de início/operacional): só o que exige ação imediata — ordens
  atrasadas, notas fiscais pendentes, transferências em aberto, produtos abaixo do mínimo.
  **Não** deve mostrar: erro de sincronização, valores de rejeito, valores de faturamento,
  valores de compra.
- **Perfil Gerência**: dashboard completo, com foco em **gráficos** (linha, barra) em vez de
  tabelas — deve reunir, sem precisar abrir relatório nenhum:
  - Resumo de rejeitos/perdas separado por tipo (baixa de matéria-prima, de revenda, de
    produto em processo), com valor e drill-down para a lista de produtos rejeitados.
  - Top 10/20 produtos mais faturados (com gráfico).
  - Top 10/20 produtos mais comprados (com gráfico), maior fornecedor.
  - Produtos parados em estoque (sem movimento).
  - Relação compras/faturamento (%), separada por categoria: revenda (faturamento vs.
    compra de revenda) e produto acabado (faturamento vs. compra de matéria-prima). Métrica
    já existe (ex.: 41%) mas os dados podem estar desatualizados — conferir. Ramon disse
    explicitamente (~1:08:04) que essa relação "não precisa mudar por enquanto" — baixa
    prioridade dentro do item.
  - Esse dashboard consolidado usaria como fonte o relatório de Movimentações reestruturado
    (ver bug #3 acima): resumo de saídas por origem (NFE / transferência / ajuste manual
    "ND"), resumo de entradas por produto, resumo de transferências por local de destino.

**Limites de referência reais, achados em `NTB Estoque - Relatório SVVM 2026 - R06.pptx`
(2ª passada, 2026-07-28)** — esse pptx é um relatório de performance que a própria
NTB Consultoria já monta manualmente pro cliente (Faturamento/Compras/Perdas, Jan-Jul/2026),
e serve de mockup quase pronto pro dashboard de Gerência. Números concretos que devem
substituir os hardcoded/genéricos hoje no sistema:
  - **Índice Compras/Faturamento: limite de referência real é 30%** (não 40% — o valor
    hardcoded/default documentado em `lojas.meta_compras_pct` — conferir e possivelmente
    corrigir o default).
  - **Perda de Matéria-Prima: limite 8%** do faturamento da categoria.
  - **Perda de Revenda: tolerância ZERO** — qualquer perda em revenda já é considerada
    anomalia (validade vencida, avaria ou erro de contagem), não uma faixa aceitável.
  - Conteúdo do pptx que mapeia direto pros itens do dashboard já listados acima: top 20
    mais/menos vendidos (separado por Revenda e Produto Acabado), ranking de fornecedores,
    ranking por família, resumo de saídas manuais, 20 maiores perdas (separado por Revenda e
    Matéria-Prima) — tudo já com números reais calculados manualmente pela consultoria hoje.
  - Recomendações do próprio relatório que viram pedidos implícitos de feature: régua de
    compra dinâmica considerando média móvel de vendas recentes (não só saldo mínimo fixo),
    alertas automáticos quando Compras ou Perdas ultrapassarem o limite (antes do fechamento
    do mês, não só no relatório mensal), e exigir foto + lançamento de transferência pra toda
    ocorrência de perda (rastreabilidade).

## Pesquisa/definição pendente (não é código ainda)
- **Categorias contábeis / centro de custo**: Ramon vai pesquisar como estruturar isso (não
  é padrão fixo entre empresas, cada uma monta o próprio DRE) e passar a definição depois.
  Direção já confirmada: CFOP de entrada/saída e categoria fiscal devem ficar associados ao
  **cadastro do produto** (não repetidos a cada nota fiscal) — reforça o pedido já registrado
  em 22/07 sobre redesenho da entrada manual de NF. Aguardar a pesquisa do Ramon antes de
  implementar essa parte.

## Adiado explicitamente para depois
- **Auditoria Fiscal e Pendências**: Ramon disse para deixar para quando entrarem na parte
  de notas fiscais (não é escopo desta rodada).
- **App/aplicativo local com sincronização periódica**: no início da call, discussão sobre
  se um "aplicativo" (parece ser uma versão local/desktop, não só o app web) ficaria mais
  rápido por rodar localmente, com sincronização periódica com o banco (a cada X minutos) de
  forma que o usuário nunca perceba estar sem internet. Ficou em nível de conversa/ideia, sem
  decisão de escopo ou prazo — **watch item**, não uma tarefa a iniciar agora.

## Confirmado funcionando / aprovado nesta reunião
- **Catálogo de produtos A4 (QR code)**: testado ao vivo — filtro, "selecionar todos" (87
  produtos) e seleção específica (ex.: 5 produtos) funcionando corretamente; filtro de
  produto inativo com padrão correto (oculta por padrão). Ainda falta o teste de impressão
  física para validar o uso real ("bipar" direto da folha).
- **Tipos de ajuste de estoque**: confirmado que não é necessário criar "ajuste de saldo"
  separado (isso já é coberto pelo fluxo de Inventário) nem uma "entrada sem nota" separada
  (já é possível registrar como entrada manual hoje). Nenhuma mudança necessária aqui.

## Agenda
- Próxima reunião semanal: **quinta-feira, 30/07, às 19h** (antecipada de 21h a pedido do
  Joaquim, que tem outro compromisso às 21h nesse dia).
