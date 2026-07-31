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
| 3 | NF pendente contando notas já manifestadas | Campo de manifestação real não existe em lugar nenhum do full_object sincronizado (confirmado no banco) — Ramon propôs solução mais simples: restringir NF travada/OP atrasada ao mês atual | **Corrigido e em produção** (commit `0f703bd`) — parte do campo de manifestação de verdade fica pendente, precisa de pesquisa na API da Omie |
| 4 | Filtros do relatório "por operação" quebrados | Nenhum filtro (tipo, local, família, origem) tinha efeito na tabela | **Corrigido e em produção** (commit `0646e8b`, 2026-07-28) |
| 5 | Quantidade errada no detalhe de Movimentações | Card mostra valor "acumulado" onde parece que deveria descontar do estoque | **Investigado e esclarecido, em produção** (commit `83db1a7`) — causa raiz não é bug de cálculo, é a Omie não compensar transferência interna entre locais |
| 6 | ~~Faturamento sem filtro concluída/cancelada~~ | **Correção 2ª passada**: má-atribuição — Ramon diz explicitamente que o Faturamento "já está funcionando direitinho"; o pedido de filtro era sobre Compras, mesmo item que o #7 | Mesclado no #7, não é item separado |
| 7 | Compras sem filtro de status | Verificado ao vivo nas 4 RPCs (`relatorio_compras_total/_dim/_matriz/_detalhe`) + espelho JS: já filtram por padrão só concluída+não cancelada (migration 083) | ✅ Resolvido 2026-07-31 (migration 097, chips Concluída/Pendente/Cancelada/Todas) |
| 8 | Sync de transferência/inventário feito no Omie não volta | Nunca puxou; ao trazer, gerar número de sequência local + trazer campo responsável; trazer quem alterou a OP no Omie | **Corrigido e em produção, os 2 sub-itens** (commits `d1dcfda`/`d9a6cfe`/`ffd415b`) — 8a como visão só-de-leitura (decisão de escopo, sem responsável — API da Omie não tem esse campo) |
| 9 | Erro 500 na emissão de NF-e (homologação) | Investigado: emissão fiscal não existe no código (só leitura/consulta) — decisão de escopo já registrada como alto risco, não é bug | Não é código — precisa decisão explícita antes de construir (certificado + SEFAZ reais) |
| 10 | Impressão de "Programação de Produção" | Matriz produto x dia do mês (landscape A4), linha em branco por dia pra anotar o produzido, variante "atrasadas", filtro de local de produção | **Corrigido e em produção** (commits `108aa75`/`ffd8525`/`6d11ef0`/`1c4ab18`) |
| 11 | Relatório de Inventários | PDF por período (espelha Transferências) + botão "Copiar link" (compartilhar) | **Corrigido e em produção** (commits `0e74ce4`/`9dd4218`/`9c6c5a7`) |
| 12 | Detalhe clicável de Movimentações + edição inline | Modal ao clicar numa linha, ver tudo do movimento, editar/reverter sem trocar de tela; sempre mostrar unidade de medida junto da quantidade | Feature nova — já em andamento |
| 13 | Mobile: card de produto escondia campos (mínimo, previsão, custo, margem) | Componente compartilhado `Lista` já suportava múltiplos valores com rótulo no card mobile — só as colunas estavam marcadas `ocultarMobile: true` | **Corrigido e em produção** (commit `129eaab`) |
| 14 | Relatório "Posição de Estoque" com cobertura de inventário | Saldo atual + data do último inventário, por produto e por local de estoque | **Corrigido e em produção** (commits `19ee96f`/`bf98c99`) — aba "Por local" no Estoque Valorizado, não relatório separado |
| 15 | Dashboard de produção diário/semanal/mensal por funcionário | Gráfico de OPs feitas por dia, com quem produziu | **Corrigido e em produção** (commits `6994127`/`75b92c0`/`fbdce19`/`2b3444b`/`ea633b6`) — sem histórico de "quem", só a partir de agora |
| 16 | Dashboard/Home por perfil (Operação × Gerência) | Operação: enxuto e acionável (ordens atrasadas, NF pendente, transferência aberta, produto abaixo do mínimo). Gerência: completo e gráfico (rejeitos, top faturados/comprados, parados em estoque, relação compras/faturamento) | **Corrigido e em produção, 1ª fase** (commits `9afe6a7`/`1c1304c`/`9a7e805`/`f8c7884`) — régua de compra dinâmica, alertas automáticos e foto obrigatória em perda ficam para depois |
| 17 | Categorias contábeis / centro de custo | Ramon vai pesquisar e definir a estrutura; direção já confirmada: CFOP fica no cadastro do produto | Aguardando pesquisa do Ramon |
| 18 | Auditoria Fiscal e Pendências | Revisão adiada para quando entrarem na parte de notas fiscais | ✅ Auditoria Fiscal resolvida 2026-07-31 (mesmo filtro de status do #7, migration 097) — Pendências continua adiado |
| 19 | App local com sincronização periódica | Ideia inicial (rodar local, sync a cada N minutos, uso offline transparente) — sem escopo ou prazo definido | Watch item, sem decisão |
| 20 | Catálogo A4 de QR code | Testado ao vivo, selecionar todos / seleção específica / filtro de inativo funcionando | Confirmado OK — falta só teste de impressão física |
| 21 | Tipos de ajuste de estoque (entrada/saída/ajuste positivo) | Confirmado que não precisa mudar: ajuste de saldo já é coberto por Inventário; entrada sem nota já existe | Confirmado OK, sem ação |
| 22 | Próxima reunião | Quinta-feira 30/07, agora às 19h (antecipada de 21h) | Agenda |
| 23 | Necessidade de Matéria-Prima (achado 2026-07-29, não pedido na reunião) | Mapa dia-a-dia de MP necessária, explodindo ficha técnica × programação de produção — achado na planilha `OP_SVVM_JUN25 - R1.xlsx`, aba "NECESSIDADE DE MP", que a consultoria já monta na mão | ✅ Resolvido |
| 24 | Indicador de status/progresso em operações lentas (achado na auditoria 2026-07-29) | Pedido solto na call (~00:52, Andrey): mostrar o que o sistema está fazendo enquanto uma tela demora | Sem spec, sem decisão de prioridade |
| 25 | Relatório de desconto por forma de pagamento (achado na auditoria 2026-07-29) | 3 abas dedicadas em `FAT_SVVM_2026.xlsx` que a consultoria monta na mão, nunca pedido nem catalogado antes | Não implementado, aguardando prioridade |
| 26 | Priorização de auditoria por categoria — Material de Consumo (achado na auditoria 2026-07-29) | Recomendação do slide 11 do pptx, ligada ao item #14 já implementado | Não implementado, aguardando prioridade |
| 27 | Dashboard de rejeitos: só 3 de 6 categorias de baixa (achado na auditoria 2026-07-29) | `MOV_AMJ_2026` rastreia 3 categorias a mais (Gastos Gerais/Desp. Funcionário/MC) que o dashboard do item #16 não soma | Não implementado, escopo a decidir |
| 28 | Filtro de status em Faturamento — pedido real, separado do #6 (achado na 3ª auditoria 2026-07-30) | Ramon pede ao vivo (~01:07min) o mesmo filtro concluído/cancelado do #6, olhando uma nota cancelada dentro do próprio relatório de Faturamento | ✅ Resolvido 2026-07-31 — filtro Normal/Cancelado/Devolvido/Todos, só no modo "Ver cupons" (único lugar onde esse dado existe) |
| 29 | Relatório de Margem por Produto (achado na 3ª auditoria 2026-07-30) | Aba "MARGEM" em `FAT_SVVM_2026.xlsx`: matriz produto × mês com V.Unit/CMC/%Margem, 581 linhas, que a consultoria já monta na mão | Não implementado, aguardando prioridade |
| 30 | Top produtos por quantidade vendida (achado na 3ª auditoria 2026-07-30) | Aba "10 mais por quant" em `FAT_SVVM_2026.xlsx` — ranking por quantidade, eixo diferente do top faturados por R$ (item #16) | Não implementado, aguardando prioridade |
| 31 | Tabela de "Ver cupons" sem paginação (achado 2026-07-31, testando o item #28) | Período de 1 ano (13 mil+ cupons) faz o navegador travar ao montar a tabela sem limite de linhas — reproduz igual sem filtro nenhum, não foi causado pelo filtro de status | ✅ Resolvido 2026-07-31 — corte de exibição em 1000 linhas (mais recentes primeiro), busca continua completa |

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

   **Investigado e esclarecido em 2026-07-29** (a pedido do usuário, sem transcrição/print
   disponível — reproduzido direto com dado real de produção). Reproduzido com o produto
   real "LEITE DE COCO (MP)" (loja 3, código 80074): uma transferência interna de 60.000 ml
   (DEPOSITO → outro local, em 27/07/2026) aparece no card "Entradas/Saídas" (fonte: sync
   `ListarMovimentos` da Omie, tabela `movimentos_historico`) como **"Saídas: 60.000"** sem
   nenhuma "Entrada" compensatória — porque essa tabela não tem dimensão de local (é
   sempre a loja inteira), e a Omie conta a saída da origem sem contabilizar a entrada no
   destino no mesmo agregado. Confirmado contra `posicao_estoques`: o estoque **total** da
   loja pra esse produto não caiu nada perto de 60.000 no período — só mudou de local
   internamente. **Não é um bug de cálculo do NTB** (o dado vem direto da API da Omie, sem
   dimensão de local pra filtrar/corrigir) — é a Omie conflar "saiu deste local" com "saiu
   da empresa". Solução aplicada: nota explicativa nos dois lugares onde esse número
   aparece (abas Histórico e Movimentos), deixando claro o que o número representa e
   apontando pro **Saldo inicial/final** (que reconcilia certo quando filtrado por local
   específico — validado ao vivo: 77.700 → 17.700 bateu exato com os 60.000 de saída ao
   isolar o local de origem da transferência).

5. ~~Faturamento: ainda falta filtro concluída/cancelada por padrão~~ — **correção da 2ª
   passada (2026-07-28)**: reexaminando o contexto completo (não só a frase isolada), Ramon
   fala "no faturamento, as notas fiscais trazer somente as concluídas" só como transição de
   assunto — na sequência imediata ele confirma "o relatório de faturamento, ele já está
   mais, já está funcionando direitinho" e só DEPOIS reclama do filtro que falta, já falando
   de **Compras** ("se a mercadoria foi concluída ou não aqui, não tem... está puxando
   tudo"). Item mesclado no #6 abaixo — não existe pedido separado de filtro pro Faturamento
   **NESSE MOMENTO da call**. **Correção 2026-07-30 (3ª auditoria independente)**: essa
   conclusão estava certa pra esse trecho específico (~55min), mas incompleta — tem um
   pedido SEPARADO e explícito de filtro pro Faturamento mais tarde na mesma reunião
   (~01:07min), registrado como item #28 abaixo. Não misturar os dois: aquele ali foi
   falso alarme, este é pedido real.

6. **Compras: falta filtro de status (concluída/cancelada/tudo), hoje traz tudo sem
   filtro.** Confirmado ao vivo que o relatório de Compras "está puxando tudo", sem
   distinguir concluída de cancelada/aberta. Pedido explícito: **adicionar filtro de status
   em Compras** (e, por analogia, em Vendas/Faturamento se algum dia ganhar filtro
   equivalente), com opção de ver concluídas, canceladas ou tudo — mas vindo **fixo/marcado
   por padrão** para mostrar só as relevantes (Ramon insiste: "coloque aqui a informação...
   pode trazer já fixo como trouxe o outro"). **Investigado 2026-07-28: já corrigido antes
   desta sessão** (RPCs de Compras já filtram concluída+não-cancelada por padrão desde a
   migration 083) — falta só a opção extra de ver canceladas/tudo, que é feature nova.

   **✅ Resolvido 2026-07-31**: chips de status (Concluída/Pendente/Cancelada/Todas,
   Concluída como padrão) adicionados em Compras — mesmo componente (`ChipsStatus`) já
   usado em Nota Fiscal. Migration 097 trocou o hardcode das 4 RPCs
   (`relatorio_compras_total/_dim/_matriz/_detalhe`) por um parâmetro `p_status` com
   default `'CONCLUIDA'` (sem regressão: validado que o default bate exatamente com o
   comportamento anterior, e que Concluída+Pendente+Cancelada soma exato com Todas, com
   dado real da loja 3). Espelhado também no complemento frio (Contabo) e nas 2 rotas de
   export. Auditoria Fiscal (item #18) ganhou o mesmo filtro no mesmo commit, já que
   dependia exatamente desta parte de notas fiscais que faltava. Faturamento continua
   pendente (item #28) — usa outro dado (status do cupom, não `c_etapa` de NF).

7. **Transferências e inventários feitos direto no Omie não sincronizam de volta.**
   Confirmado que **nunca puxou**, desde antes: uma transferência ou um inventário feito
   diretamente no Omie não aparece no NTB Estoque. Ramon se ofereceu a fazer uma
   transferência de teste no Omie para validar. Ao trazer:
   - Inventário: não usar o número de sequência do Omie — gerar o próximo número
     localmente, como já é feito hoje; trazer também o campo **responsável** do Omie
     (campo obrigatório lá, já existe campo equivalente no NTB Estoque).
   - Ordem de produção alterada dentro do Omie: hoje só traz a ordem, não traz **quem fez a
     alteração** — precisa também puxar o nome/usuário responsável.

   **Investigado 2026-07-29 — pesquisa completa contra a documentação oficial da Omie
   (não só o código deste repo), 2 sub-itens com resultado bem diferente:**
   - **✅ "Quem alterou a OP" — resolvido, em produção (commit `d1dcfda`).** A Omie já manda
     esse dado em toda chamada (`outrasInf.uAlt`/`dAlteracao`), o app só descartava.
     Testado ao vivo com sync real: 2.800 OPs de uma loja vieram com
     `alterado_por_omie = 'WEBSERVICE'` (ou seja, alteradas pela própria API/NTB, não por um
     humano direto na tela da Omie) — confirma que o campo é lido corretamente; se algum dia
     um usuário editar uma OP manualmente na Omie, o nome dele vai aparecer aqui em vez de
     "WEBSERVICE". Sem backfill possível (dado não existia salvo antes desta mudança).
   - **✅ Puxar transferência/inventário — resolvido 2026-07-29, como visão só-de-leitura
     (decisão validada com o usuário, ciente da limitação de responsável).** "Transferência"
     e "Inventário" não são objetos próprios na Omie — os dois usam o mesmo endpoint (`Ajuste
     de Estoque`), diferenciado só pelo campo `motivo`. **O campo de responsável que o Ramon
     pediu não existe na API da Omie** — confirmado contra a documentação oficial
     (`https://app.omie.com.br/api/v1/estoque/ajuste/`), não é limitação deste app.

     **Achado real que mudou o desenho da solução**: sintetizar uma linha de cabeçalho de
     transferência/inventário "fake" a partir dos ajustes brutos (como o pedido original
     sugeria) criaria **duplicata** — `movimentos` (populado pelo sync já existente de
     ajustes) e `inventario_items` (populado só pelo NTB) compartilham o mesmo `id_ajuste`
     em 858 linhas hoje, ou seja, TODO inventário que o próprio NTB já cria reapareceria como
     um "achado na Omie" fake. Por isso a solução virou uma seção só-de-leitura ("Feito
     direto na Omie") dentro de `/transferencia` e `/inventario`, com 3 filtros de exclusão
     validados contra dado real de produção antes de ir pro ar (`motivo != 'TPQ'`,
     `obs not ilike '%NTB%'`, dedup contra `inventario_items.id_ajuste`) — sem gerar número
     de sequência nem virar um registro nativo, só mostra o que foi detectado. Responsável
     aparece como "Não identificado" nesses casos, sempre.

     Bug real achado e corrigido durante a validação: o filtro inicial usava
     `.neq()`/`.not(ilike)` do supabase-js, que descarta silenciosamente TODA linha com
     `motivo`/`obs` nulos (semântica de NULL do SQL) — quase toda transferência externa
     legítima não tem `obs` preenchido, então a primeira versão escondia quase tudo que
     devia mostrar. Corrigido e revalidado com SQL direto antes do deploy.

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
- Confirma também os locais de produção reais usados: `COZINHA`, `BAR` e `PIZZARIA` (aba
  "Local de Produção") — bate com o que já estava confirmado na call. **Correção
  2026-07-29 (auditoria independente)**: a versão anterior desta nota citava também
  `NUCLEO` como confirmado no arquivo — não é verdade, essa string não aparece em
  nenhuma célula de `OP_SVVM_JUN25 - R1.xlsx`. "Núcleo" como local de produção real é
  fato só da call (Ramon/Andrey falaram ao vivo), não do arquivo.

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

### Novo relatório: "Posição de Estoque" com cobertura de inventário — ✅ resolvido 2026-07-28
Falta um relatório que mostre, por **local de estoque**, a lista de produtos com **saldo
atual** e a **data do último inventário** (contagem) daquele produto naquele local — para
identificar cobertura de inventário (o que não é contado há mais de 30 dias, por exemplo).
Sugestão do Ramon: estender o relatório **Estoque Valorizado** já existente, adicionando
saldo + data do último inventário. Sugestão do Joaquim: usar abas/filtro por local (mesmo
padrão já usado no relatório de Faturamento). Confirmado: produtos inativos já são
excluídos de todos os relatórios por regra geral — vale conferir se esse relatório
específico segue essa regra quando for criado.

**Solução implementada**: seguindo as duas sugestões literalmente — nova aba "Por local"
(`?ver=local`, componente `SegmentLinks`, mesmo padrão do Faturamento) dentro do próprio
Estoque Valorizado, em vez de um relatório novo separado. RPC nova
(`relatorio_estoque_valorizado_local`, migration 091) retorna 1 linha por produto+local
com saldo, CMC, valor e a data do último inventário (via `inventarios`/`inventario_items`,
já que não existe hoje nenhum outro lugar no sistema que calcule isso). Linhas "Nunca
contado" ou com 30+ dias sem contagem aparecem em vermelho, mesmo limiar de 30 dias já
usado no card "Locais sem contagem de inventário" do resumo operacional. A visão default
(agregada, "Total") não mudou em nada. Validado com dado real de produção: da loja SVVM,
1421 combinações produto+local, das quais só 198 (14%) têm alguma contagem de inventário
registrada — confirma que a lacuna que motivou o pedido é real e grande.
Plano: `docs/superpowers/plans/2026-07-28-estoque-valorizado-por-local-cobertura.md`.

### Dashboard de acompanhamento de produção (diário/semanal/mensal, por funcionário) — ✅ resolvido 2026-07-28
Pedido do Andrey: gráfico mostrando, dia a dia (1 a 30), quantas OPs foram feitas e por
quem, com opção de visão diária/semanal/mensal — para a gestão identificar rapidamente
períodos sem produção ou queda de produtividade por funcionário, sem precisar vasculhar
relatório nenhum.

**Bloqueio real achado antes de construir**: nem a Omie nem o app sabiam "quem" concluía
uma OP — não existia esse dado em lugar nenhum. Investigação encontrou que a conclusão de
OP tem sim um fluxo humano real dentro do próprio app (botão "Concluir OP", com sessão).
Apresentei a decisão pro usuário em vez de assumir sozinho: **decisão dele (2026-07-28)**
foi rastrear quem está logado no momento do clique, a partir de agora — mesmo padrão já
usado em `inventarios`/`transferencias` (`user_id`). Duas ressalvas já registradas com ele:
(1) sem histórico — só conta daqui pra frente, meses passados aparecem 100%
"Não identificado"; (2) "quem clicou em concluir" pode não ser exatamente "quem produziu"
numa conclusão em lote feita por um gerente pela equipe toda.

**Solução implementada**: coluna nova `ordens_producao.concluida_por` (migration 092),
gravada automaticamente em `finishOP`/`finishOPsEmLote` com o usuário da sessão (reenvio
automático via cron continua gravando null, corretamente). Página nova
`/relatorio-producao` (hub em `/relatorios`, grupo "Produção") com gráfico de barras
empilhadas (SVG próprio, sem lib nova), paleta categórica de 7 cores validada
(contraste + daltonismo) via skill `dataviz`, legenda, tooltip por barra e tabela de
detalhe abaixo — três granularidades (Diária = dias do mês, Semanal = semanas do mês,
Mensal = últimos 6 meses). Validado com dado real de produção: 9.851 OPs concluídas só
em julho/2026 numa das lojas. Plano:
`docs/superpowers/plans/2026-07-29-dashboard-producao-por-funcionario.md`.

### Reestruturação do Dashboard/Home por perfil de usuário (pedido maior, several sub-itens) — ✅ 1ª fase resolvida 2026-07-29
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

**Solução implementada (1ª fase)**: `/home` (tela "Início") passa a ramificar por perfil —
quem não é gestão continua vendo o painel operacional de sempre (ordens/OPs pendentes,
produtos abaixo do mínimo, vencidos/vencendo, inventários e transferências em aberto), agora
com um alerta novo de **notas fiscais pendentes** que faltava (reaproveitando a mesma lógica
já usada no `/resumo` gerencial, restrita à loja atual e ao mês corrente). Quem tem
`podeGerir` (Admin/AdminLoja) ganha, abaixo disso, um painel gerencial com gráficos: rejeitos
por tipo (matéria-prima/revenda/produto em processo, com % sobre o faturamento da categoria e
o limiar de 8%/0% já sinalizando em vermelho quando estoura), relação compras/faturamento por
categoria com o limiar real de 30% (não mudei `lojas.meta_compras_pct`, que continua editável
e em 40% — os limiares novos são só visuais/de referência, decisão de política de negócio
fica pra depois), top 10 produtos mais faturados/comprados + maior fornecedor, e produtos
parados há 30+ dias sem movimento.

**Refinamento achado 2026-07-29 (releitura a fundo da planilha `FAT_SVVM_2026.xlsx`)**: a
consultoria separa o "top 10 mais faturados" por **tipo de produto** (a aba de referência
filtra explicitamente `Tipo = 04-Produto Acabado`, não mistura com revenda) — o painel
gerencial implementado mostra um ranking único, sem essa separação. Também confirmei, com
números reais dessa planilha (jan-jul/2026, loja SVVM), que o cálculo do índice
compras/faturamento bate exatamente com o limiar de referência: compras de matéria-prima
(R$367.737,76) ÷ faturamento de produto acabado (R$1.196.958,65) = **30,72%**, quase idêntico
ao limite de 30% já usado — validação independente do que já foi implementado.

**Achado real ao investigar, corrigido de brinde**: a home ATUAL já mostrava o valor de cada
nota fiscal recente (`n_valor_nfe`) pra QUALQUER usuário logado, inclusive quem é só
Operação — violava a própria regra que este item pede, e já era assim antes desta tarefa
existir. Essa seção ("Últimas notas fiscais") saiu da home; quem precisa da lista usa
`/nota-fiscal`. Validado programaticamente (não só visualmente): a página renderizada não tem
nenhum valor em R$ fora do painel gerencial.

**Fora do escopo desta 1ª fase, por decisão explícita** (não é uma parte esquecida): régua de
compra dinâmica por média móvel, alertas automáticos de Compras/Perdas antes do fechamento do
mês, e exigência de foto em toda perda — são "recomendações que viram pedidos implícitos de
feature" maiores que o escopo direto do item #16 (mostrar o dashboard certo pra cada perfil),
tratadas como itens novos a priorizar depois, não como pendência deste item.
Plano: `docs/superpowers/plans/2026-07-29-dashboard-home-por-perfil.md`.

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

## Achados novos da releitura completa (2026-07-29, a pedido do usuário)

Reunião re-transcrita do zero (nova transcrição limpa, sem o artefato de loop da 1ª
retranscrição) e lida linha a linha contra o catálogo — nada faltando, todos os 22 itens
batem com o que foi dito ao vivo. As 5 planilhas/pptx de referência foram relidas a fundo
(todas as abas, não só as já resumidas antes). Dois achados novos:

### Item #23: Necessidade de Matéria-Prima — ✅ resolvido 2026-07-29
Aba "NECESSIDADE DE MP" em `OP_SVVM_JUN25 - R1.xlsx`: um mapa dia-a-dia (mesmo formato de
matriz do item #10, dia 1 a 30/31 em coluna) de quanto de cada matéria-prima vai ser
necessário, calculado explodindo a ficha técnica (bill-of-materials) de cada produto contra
a programação de produção planejada. Ex.: "dia 15, vai precisar de 180ml de leite de coco"
porque X ordens de produção planejadas pra esse dia usam esse ingrediente. **Não foi pedido
explicitamente na reunião** — é uma extensão natural do item #10 (mesma fonte de dados:
`ordens_producao.full_object.itensDetalhes`, já usada pelo detalhe clicável do item #12).
A consultoria já monta isso manualmente hoje pro cliente.

Implementado como novo botão "Necessidade de MP" em Ordens de Produção
(`app/(app)/ordem-producao/necessidade-mp/route.ts` +
`components/relatorio/NecessidadeMpPDF.tsx`), espelhando exatamente o padrão de
`programacao/route.ts`: mesma paginação conta-primeiro (evita o corte de 1000
linhas do PostgREST num mês cheio de OPs), mesmos filtros (mês/local/tipo do
produto acabado/só atrasadas). A diferença é a agregação: em vez de somar
`identificacao_n_qtde` por produto da OP, explode `full_object.itensDetalhes`
(`{nIdProdutoMalha, nQtde}`) de cada OP e acumula `nQtde` por dia, por
ingrediente — o mesmo campo já usado por `buscarDetalheOP` no detalhe
clicável de uma OP (item #12), nunca antes agregado por dia.

**Achado real durante a validação**: a soma direta de `nQtde` (quantidades
fracionadas em kg) gerava lixo de ponto flutuante na exibição (ex.:
`0.44999999999999996` em vez de `0.45`). Corrigido arredondando pra 3 casas
decimais (precisão de grama) só na exibição, mesmo padrão já usado em
`lib/ajustes-omie.ts`. Validado cruzando a saída do PDF contra um recálculo
independente direto nas linhas cruas de `ordens_producao` (loja 3, julho/2026,
produto "ABACAXI (PI)" código 70107/`codigo_produto` 4265684733) — bateu exato
dia a dia.

### Refinamento no item #16 (dashboard gerencial)
Ver nota na seção do item #16 acima — top faturados deveria separar por tipo de produto
(Produto Acabado vs Revenda), e o cálculo do índice compras/faturamento foi validado
independentemente contra dado real da planilha (30,72% ≈ limiar de 30%).

## Auditoria independente pós-fechamento (2026-07-29, a pedido do usuário)

O usuário pediu confirmação explícita de que a releitura acima foi de verdade completa.
Em vez de eu mesmo reafirmar, um agente novo (sem contexto prévio, instruído a ser
adversarial) releu os 2 transcripts + as 5 planilhas/pptx do zero, cruzando contra o
catálogo. **Resultado: o catálogo NÃO estava 100% completo.** Achados reais (além da
correção do #10 acima):

- **#24 — Indicador de status/progresso em operações lentas** (~00:52 da call, Andrey):
  pedido pra mostrar o que o sistema está fazendo enquanto uma tela demora ("tá
  consultando a Omie ou não?"). Não é um bug, é uma sugestão de UX solta — nunca virou
  item nenhum, nem como "adiado". **Sem spec, sem decisão de prioridade ainda.**
- **#25 — Relatório de desconto por forma de pagamento**: `FAT_SVVM_2026.xlsx` tem 2
  abas dedicadas ("Desconto 10+", "Desconto pot tipo de pgto" — erro de digitação da
  própria planilha, não é "por") que a consultoria monta todo mês (ex.: R$58.585,57 de
  desconto só em Pix, jan–jul). **Correção 2026-07-30 (3ª auditoria independente)**: a
  versão anterior desta nota citava também "Fat vs forma de pgto" como uma 3ª aba de
  desconto — não é, o cabeçalho real dessa aba é "FATURAMENTO POR FORMA DE PAGAMENTO"
  (faturamento total por forma de pagamento, não desconto). Zero menção a desconto/forma
  de pagamento no catálogo até agora. **Não pedido na reunião, achado só na planilha —
  mesma categoria dos itens #16/#23.**
- **#26 — Priorização de auditoria por categoria (Material de Consumo)**: slide 11 do
  pptx recomenda direcionar as próximas contagens físicas pra Material de Consumo,
  categoria que opera acima do limite na maioria dos meses. Relacionado ao item #14
  (Posição de Estoque com cobertura de inventário, já implementado) mas o direcionamento
  por prioridade de categoria não foi implementado.
- **#27 — Dashboard de rejeitos/perdas cobre só 3 categorias de baixa, o arquivo de
  referência rastreia 6**: o dashboard gerencial (item #16, já em produção) soma
  Matéria-Prima/Revenda/Produto em Processo. `MOV_AMJ_2026 - 1º SEM.xlsx` também rastreia
  "BAIXA GASTOS GERAIS", "BAIXA DESP. FUNCION." e "BAIXA MC" (todas sob o tipo fiscal
  "07-Material de Uso e Consumo", com valores reais — lenha, material de limpeza,
  refeição de funcionário). Essas 3 categorias adicionais não aparecem no dashboard já
  entregue — não é erro de cálculo, é escopo que ficou de fora sem decisão consciente.

Nenhum dos 4 foi implementado ainda — são achados novos, registrados aqui pra decisão
de prioridade (provavelmente na reunião de 30/07, 19h), não construídos por conta
própria como #16/#23 foram (aqueles já tinham sido explicitamente autorizados pelo
usuário: "pode continuar").

## 3ª auditoria independente (2026-07-30, a pedido do usuário)

Usuário pediu de novo, pela terceira vez, confirmação de leitura completa ("eu quero que
você leia tudo de novo: tudo, cada página, cada aba, tudo"). Desta vez rodados 3 agentes
independentes em paralelo (não sequencial), cada um sem ver o trabalho dos outros: 1 para
os 2 transcripts completos, 2 releituras independentes e redundantes de todas as abas dos
5 arquivos de referência (prova de cobertura: todas as abas de todos os workbooks foram
abertas e listadas, incluindo abas vazias como "Diário de Bordo"/"BD"). Achados:

- **Item #28** (novo) e correção no item #5 — ver acima.
- **Itens #29 e #30** (novos) — ver tabela acima.
- **Correção no item #25** — "Fat vs forma de pgto" NÃO é aba de desconto (é faturamento
  total por forma de pagamento); só 2 das 3 abas citadas antes são de fato sobre desconto.
  Corrigido acima.
- **Achados menores, não viraram item novo** (baixa confiança / provavelmente já
  resolvidos, registrados só pra não sumir):
  - (~51:46min) Ramon sugere cachear o relatório "por operação" em vez de buscar o ano
    inteiro toda vez, usando o sinal de alteração que a própria Omie manda em vez de
    repuxar tudo sempre. Joaquim responde pouco depois que já adicionou cache — parece já
    resolvido, mas a abordagem específica ("usar sinal de alteração da Omie") não está
    documentada em nenhum item.
  - (~55:21min) Ramon sugere separar "operação" num ambiente à parte por performance;
    Joaquim rejeita na hora ("não tem necessidade"). Nunca foi registrado, ao contrário de
    outras rejeições na hora que o catálogo já lista (ex.: item #21).
  - `NFS_ENT_SVVM_26_R0.xlsx` tem categorização fiscal bem mais profunda (16 abas: ICMS
    00/20/60/90, CFOP por tipo, flag "ERRO CFOP 1407", "N GERA ESTOQUE"/"N GERA C A
    PAGAR") do que os itens #17/#18 ("pesquisa pendente do Ramon"/"adiado") deixam claro
    — não é item novo, é nota de escopo: quando o Ramon voltar com a estrutura de
    categorias contábeis (#17), o escopo real é maior do que "definir categoria e CFOP no
    cadastro do produto" sozinho.

Depois desta rodada: **30 itens no catálogo, 23 originais + a 1ª rodada de auditoria (#23-27)
resolvidos/documentados, mais #28-30 dessa 3ª rodada — nenhum dos #24-30 foi implementado
ainda**, todos aguardando decisão de prioridade do usuário.

## Agenda
- Próxima reunião semanal: **quinta-feira, 30/07, às 19h** (antecipada de 21h a pedido do
  Joaquim, que tem outro compromisso às 21h nesse dia).
