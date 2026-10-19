# Fase F (sem emissão fiscal) — fechamento de período, pacote do contador e devolução ao fornecedor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) o gerente fecha um mês e, a partir daí, nenhuma escrita do Norte Estoque com data dentro dele é aceita (trava no banco e no servidor, reabertura só com permissão nova e registrada); (2) tela "Contador" que baixa num ZIP os XMLs das notas de entrada do mês, o livro de entradas (Excel e PDF) e o inventário tipo Bloco H numa data; (3) devolução ao fornecedor [H1] registrada no estoque próprio (itens/quantidades de uma nota de entrada, saída pelo ledger com estorno parcial do custo, situação "devolução a emitir"), sem emitir NF-e.

**Architecture:** O fechamento mora em duas tabelas novas (`estoque_periodo_fechado` = estado, `estoque_periodo_eventos` = histórico append-only) e numa função `_exigir_periodo_aberto` que os gatilhos das tabelas do estoque próprio (ledger, itens da compra, OP própria, inventários, pedido de compra) e da correção de custo chamam; o servidor confere o mesmo estado antes de mandar qualquer escrita datada ao Omie (`lib/estoque/fechamento.ts`, regras puras em `fechamento-puro.ts`). O pacote do contador lê só o que já está no banco (notas + itens no formato do Omie nos dois modos, `sefaz_documentos` para os XMLs, posição de estoque da Fase D) e monta o ZIP com um escritor próprio (`node:zlib`, sem dependência nova). A devolução é um documento novo com saída no ledger por uma função própria que tira as unidades ao custo da entrada original e recalcula o custo médio sem elas.

**Tech Stack:** Next.js 16.2.9 (rotas `route.ts`, server actions), TypeScript, Supabase self-hosted (Postgres 17 + PostgREST), `node --test` (Node 26), `exceljs` (já usado em `lib/excel`), `@react-pdf/renderer` (já usado no PDF do pedido), `node:zlib` (`deflateRawSync`, `crc32`).

**Spec:** pedido do dono de 19/10/2026 (Fase F sem emissão fiscal) + `docs/superpowers/plans/2026-10-18-plano-mestre-paridade-omie.md` seção "Fase F" (itens 1, 3, 4) + `~/Projects/omie-rea/telas/CTB/fechamento-periodos-contabeis.md` (grade Situação/Período/Bloqueados em/por), `telas/CTB/gerar-arquivos-de-integracao.md` (XML das NF-e recebidas + Posição de Estoque), `telas/COM/listar-todas-devolucoes-compra/record-0.md` (devolução: nota de origem, motivo, itens com quantidade, CFOP 5.202, local, "movimenta estoque"), `gaps/matriz-compras-estoque-producao.md` [H1], [N7], `gaps/matriz-financeiro-vendas-config-relatorios.md` CTB 12/15/17.

## Global Constraints

- Branch `fase-f-contador` a partir de `54103fde`. Cada task termina num commit com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_0183b5mkJcQaRjgHoMxzahgr`.
- NUNCA: deploy, migration em produção, escrita em produção, chamada à SEFAZ ou ao Omie. Leitura em produção só `begin read only; … rollback;`. Nada de CPF/CNPJ nem conteúdo de XML de terceiros nos entregáveis.
- **Não mexer na Central de correções** (`lib/correcoes/**`, `lib/actions/central.ts`, `app/(app)/estoque/correcoes/**`, `components/correcoes/**`, SQL 171/172). O que a Central manda ao Omie com data antiga continua só com o aviso de sempre (ver "Fica para depois").
- Migrations a partir de **230**, cada uma numa transação, aditivas (código velho continua funcionando com elas aplicadas). Ordem: 230 → 231 → 232. Teste local: `bash scripts/testes-sql/230_preparar_banco.sh f1` (container `ntb-teste-sql`, `create database f1 template fb` + 187, 188, 190–195, 200, 201 + 230+).
- RLS de tabela nova: `((select usuario_e_admin()) or loja_id in (select usuario_lojas()))`; anon sem nada; escrita só service role / funções; `security definer` sempre com `set search_path = public`; funções que escrevem só para `service_role`. Permissões novas no catálogo (`lib/permissoes-catalogo.ts`).
- Modo Omie intacto: os gatilhos novos não tocam `movimentos`, `ordens_producao` de loja Omie nem nada que o sync do Omie grava. Para lojas Omie a trava vale só para o que o Norte Estoque manda ao Omie com data no mês fechado.
- Server action nova → `node scripts/inserir-via-desktop.mjs`; fechamento, reabertura e devolução ficam fora de `lib/offline/politica.ts` (só com internet: mexem em estado que outro caixa pode estar usando).
- Regra pura sem alias `@/`, `node --test`; import de valor de outro `.ts` só com `// @ts-ignore` + extensão `.ts`. `npx tsc --noEmit -p .` limpo ao fim de cada task.
- Erro de período fechado: SQLSTATE **`PF001`**, mensagem em português começando por "Período fechado:".

## Decisões (R1–R10)

- **R1 — Mês por mês, como o Omie.** Uma linha por loja × mês fechado. Só fecha mês **anterior** ao mês atual (Bahia). Reabrir apaga a linha e grava evento com motivo (≥ 10 caracteres) e quem reabriu; fechar grava evento com quem fechou. Permissões novas: `Fechamento - Fechar mes`, `Fechamento - Reabrir mes` (Admin/AdminLoja passam, como em todo o app).
- **R2 — Pendências impedem o fechamento.** `periodo_pendencias(loja, mes)` lista o que ainda vai escrever com data no mês: ajustes manuais e transferências do Omie à espera de reenvio (`movimentos` status Iniciado/Processando/Erro/Sem CMC, `tentativas < 30`, exceto TRF sem transferência = resíduo), inventários do mês não finalizados ou com item à espera de envio, correções de custo em andamento. Com pendência o mês não fecha (a tela mostra a lista). Corrida fechamento × escrita: trava consultiva por loja (`pg_advisory_xact_lock_shared` nos gatilhos, exclusiva no fechamento).
- **R3 — O que a trava pega (estoque próprio, no banco).** (a) `estoque_movimentos` novo com `data_ref` no mês fechado; (b) item de compra lançado num mês fechado não pode ser estornado, alterado nem apagado (desfazer entrada/excluir nota); (c) OP própria (`ordens_producao` de loja `proprio`): criar/alterar com previsão no mês fechado, concluir com data no mês fechado, e qualquer mudança em OP concluída num mês fechado; (d) `inventarios`/`inventario_items` (as duas lojas, só o Norte Estoque grava): criar, mudar data, apagar, contar/excluir item com a data do inventário no mês fechado (atualização de status do reenvio passa); (e) pedido de compra criado num mês fechado não muda de conteúdo, e previsão de entrega não pode cair num mês fechado; (f) `estoque_correcao_custo` (loja Omie) com `data_ajuste` no mês fechado. Estornos com data de hoje de documentos não listados (venda cancelada depois, por exemplo) continuam aceitos: o estorno é um fato do mês aberto.
- **R4 — Cancelamento na SEFAZ não trava a fila.** `sefaz_marcar_cancelada` (180) passa a capturar `PF001`: marca a nota cancelada, NÃO estorna, grava evento `cancelada` com `estorno_pendente` na compra e devolve `estornada=false, mes_fechado=true` (o gerente reabre o mês para estornar).
- **R5 — Servidor (as duas lojas).** `exigirPeriodoAberto(lojaId, datas, oQue)` antes de: correção de custo e relançamento (data do ajuste), ajuste manual com data (`criarAjusteManual`), inventário (criar, duplicar, enviar/editar/remover item, finalizar, excluir: data do inventário), OP (criar, mudar data, concluir com data, reverter/excluir OP concluída no mês fechado), notas do estoque próprio (desfazer entrada, excluir), pedido de compra (salvar), devolução (cancelar). Unificação do aviso antigo: `situacaoDaData` devolve `fechado` (trava, fechamento formal) › `antigo` (o aviso de sempre: antes do mês passado ou até `ESTOQUE_MES_FECHADO_ATE`, pede 2ª confirmação) › `aberto`. A tela de correção de custo usa a mesma função; a Central continua com `mesDoAjusteFechado` (não mexida).
- **R6 — Livro de entradas.** Uma linha por nota × CFOP de entrada (`itensAjustes.cCFOPEntrada`; sem ele, o CFOP do fornecedor com 5→1, 6→2, 7→3). Nota entra se `c_etapa='60'`, não excluída, não cancelada e com **data de entrada** (`infoCadastro.dRec`, dd/mm/aaaa; sem ela a emissão) no mês. Colunas: data de entrada, emissão, espécie (NF-e), série, número, fornecedor, CNPJ, UF (da chave), CFOP, valor contábil (Σ `vTotalItem`), base ICMS, ICMS, ICMS-ST, IPI, PIS, COFINS, chave. Totais por CFOP e geral. Vale para as duas lojas (o estoque próprio projeta os itens no formato do Omie, Fase B).
- **R7 — XMLs.** `sefaz_documentos` tipo `procNFe` (último por chave) das notas do livro. Loja Omie não tem XML guardado: o ZIP leva um `LEIA-ME.txt` dizendo isso e listando as chaves (o Omie entrega pelo Painel do Contador). Nota do livro sem XML guardado também vai listada no LEIA-ME.
- **R8 — Bloco H numa data.** Loja própria: `posicao_proprio_em_data(loja, data)` = Σ quantidade do ledger com `data_ref ≤ data` por produto × local, custo = `cmc_apos` do último movimento (por id) do produto até a data. Loja Omie: foto de `posicao_estoques` com local real mais recente **até** a data (a tela diz a data da foto usada). Montagem pela `montarPosicao(..., ver: 'sped')` da Fase D (mesmas colunas H010 no Excel). Padrão: último dia do mês escolhido.
- **R9 — Devolução ao fornecedor (só estoque próprio).** Documento `devolucoes_fornecedor` (+ itens, + eventos append-only), número sequencial por loja, nota de origem obrigatória (compra lançada ou parcial), motivo obrigatório, data = hoje, situação `a_emitir` ("Devolução a emitir") → `cancelada`; `emitida` reservada para a emissão futura (nada grava). Quantidade por item ≤ recebido − já devolvido (devoluções não canceladas). Saída no ledger (`SAI`, origem `DEVOLUCAO_FORNECEDOR`, ref `dev:<id>`, linha = linha da nota) ao **custo unitário da entrada original** e custo médio recalculado sem as unidades: `C₁ = (S₀·C₀ − q·c)/(S₀ − q)` se `S₀ − q > 0` e o resultado > 0; senão `C₁ = C₀` (HIPÓTESE: sem kardex de devolução do Omie capturado; as 3 devoluções da loja 5 são de 2022/2024). Cancelar = estorno de cada saída (`estornar_movimento`, volta ao custo da saída). Desfazer a entrada de uma nota com devolução ativa é recusado. CFOP sugerido (editável depois, na emissão): 1101→5201, 1102→5202, 1401→5410, 1403→5411, 1407→5413, 1556→5556 (e os 2xxx → 6xxx iguais); resto → 5949/6949 conforme o primeiro dígito.
- **R10 — Tela "Contador"** (`/contador`, menu Administração, `gestaoUsuarios`): Fechamento (12 últimos meses: situação, fechado em/por, botões Fechar/Reabrir com motivo, pendências, histórico) e Pacote (mês → Baixar pacote ZIP, Livro Excel, Livro PDF, Bloco H Excel com data). Permissão nova `Contador - Pacote` para baixar. Devolução: seção na página da nota do estoque próprio + lista `/devolucao-fornecedor`.

## Review Focus

- **Fechar o mês com reenvio ao Omie ainda pendente daquele mês** → o fechamento recusa e lista a pendência; nada pode ficar preso entre a trava e o cron de reenvio. Teste: Task 1 SQL `pendência de ajuste manual impede fechar`.
- **Desfazer entrada / excluir nota lançada num mês fechado** → recusa clara com o mês e quem fechou, nenhum movimento gravado (a transação toda volta). Teste: Task 1 SQL `estornar_compra de compra lançada em mês fechado falha com PF001 e não grava estorno`.
- **Cancelamento da nota na SEFAZ chegando depois do fechamento** → a sincronização não para; a nota fica cancelada e a compra marcada para estorno manual. Teste: Task 1 SQL `sefaz_marcar_cancelada em mês fechado não estorna e não falha`.
- **Devolver mais do que entrou (duas devoluções da mesma nota, duplo clique)** → a segunda recusa pelo saldo devolvível; a mesma chave de idempotência devolve o mesmo documento. Teste: Task 4 SQL `quantidade acima do devolvível recusa` e `mesma chave não duplica`.
- **Devolução seguida de "Desfazer entrada"** → recusado até cancelar a devolução (senão as unidades sairiam duas vezes). Teste: Task 4 SQL `estornar_compra com devolução ativa recusa`.

---

## Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `supabase/migrations/230_fechamento_periodo.sql`, `scripts/testes-sql/230_fechamento_periodo.sql`, `scripts/testes-sql/230_preparar_banco.sh` | Tabelas, funções, gatilhos e pendências do fechamento | 1 |
| `lib/estoque/fechamento-puro.ts` (+ teste), `lib/estoque/fechamento.ts`, `lib/actions/fechamento.ts` | Regras puras, leitura do estado, ações fechar/reabrir | 2 |
| `lib/actions/estoque-omie.ts`, `movimentacoes.ts`, `inventario.ts`, `ordem-producao.ts`, `nota-fiscal-proprio.ts`, `compras-proprio.ts`, `pedido-compra.ts`, `components/estoque-proprio/CorrigirCusto.tsx`, `app/(app)/estoque/ajustes/page.tsx` | Trava no servidor e aviso unificado | 3 |
| `supabase/migrations/231_devolucao_fornecedor.sql` + teste SQL; `lib/compras/devolucao-puro.ts` (+ teste); `lib/actions/devolucao-fornecedor.ts`; `components/nota-fiscal/DevolucaoFornecedorNF.tsx`; `app/(app)/devolucao-fornecedor/page.tsx` | Devolução ao fornecedor | 4 |
| `supabase/migrations/232_contador.sql` + teste SQL; `lib/contador/{zip,livro-entradas-puro}.ts` (+ testes); `lib/contador/{livro-entradas-loader,bloco-h-loader,pacote}.ts`; `lib/contador/LivroPdf.tsx`; `app/(app)/contador/{page.tsx,pacote/route.ts,livro/route.ts,bloco-h/route.ts}`; `components/contador/*`; `components/shell/NavItems.ts`; `lib/permissoes-catalogo.ts` | Pacote do contador + tela | 5 |
| `AGENTS.md`, `desktop/schema` (só nota) | Registro da fase | 6 |

### Task 1: Migration 230 — fechamento no banco

**Interfaces — Produces:** tabelas `estoque_periodo_fechado(loja_id, mes date, fechado_em, fechado_por, fechado_por_nome, obs)`, `estoque_periodo_eventos(id, loja_id, mes, acao 'fechar'|'reabrir', user_id, user_nome, motivo, pendencias jsonb, created_at)`; `periodo_fechado(p_loja bigint, p_data date) → boolean`; `_exigir_periodo_aberto(p_loja bigint, p_data date, p_oque text) → void` (PF001); `periodo_pendencias(p_loja bigint, p_mes date) → jsonb` (array `{tipo, quantidade, detalhe}`); `fechar_periodo(p_loja, p_mes, p_user, p_user_nome, p_obs) → jsonb {ok, duplicado?, pendencias?}`; `reabrir_periodo(p_loja, p_mes, p_user, p_user_nome, p_motivo) → jsonb {ok}`. Gatilhos R3 + R4.

- [ ] Escrever `scripts/testes-sql/230_fechamento_periodo.sql` (DO-blocks com `assert`, loja própria e loja Omie de teste criadas no próprio script, tudo em `begin … rollback`): fechar mês futuro/atual recusa; fechar setembro ok e 2ª vez `duplicado`; `registrar_movimento` com `p_data` em setembro → PF001, com hoje ok; `estornar_compra` de compra lançada em mês fechado falha com PF001 e não grava estorno; OP própria concluída em setembro não reverte; inventário com data em setembro não aceita item novo mas aceita update de status; pedido criado em setembro não muda itens; `estoque_correcao_custo` com `data_ajuste` em setembro recusa; pendência de ajuste manual impede fechar; `sefaz_marcar_cancelada` em mês fechado não estorna e não falha; reabrir sem motivo recusa, com motivo grava evento e libera.
- [ ] Rodar contra `f1` antes da migration: falha (funções inexistentes).
- [ ] Escrever a migration 230 (R1–R4).
- [ ] `bash scripts/testes-sql/230_preparar_banco.sh f1` e rodar o teste: todos os `assert` passam; `\df` de cada função = 1 overload.
- [ ] Commit `feat(230): fechamento de período no banco`.

### Task 2: Regras puras e ações de fechamento

**Interfaces — Produces:**
- `fechamento-puro.ts`: `type MesFechado = { mes: string /*YYYY-MM*/; fechadoEm: string | null; fechadoPorNome: string | null }`; `mesDaData(d: string | null | undefined): string | null` (aceita `YYYY-MM-DD[T…]` e `DD/MM/YYYY`); `bloqueioPorPeriodo(datas: (string|null|undefined)[], fechados: MesFechado[], oQue: string): string | null`; `situacaoDaData(dataISO, hojeISO, fechados: string[], fechadoAteEnv?: string|null): 'fechado'|'antigo'|'aberto'`; `validarFechamento(mes: string, hojeISO: string): string | null`; `validarReabertura(motivo: string): string | null`; `mesesDaTela(hojeISO: string, n = 12): string[]`; `rotuloMes('2026-09') = 'setembro de 2026'`; `ehErroPeriodoFechado(e: {code?, message?}): boolean`.
- `fechamento.ts` (servidor): `mesesFechados(lojaId): Promise<MesFechado[]>`, `exigirPeriodoAberto(lojaId, datas, oQue): Promise<string | null>`, `situacaoPeriodoLoja(lojaId, dataISO): Promise<'fechado'|'antigo'|'aberto'>`.
- `lib/actions/fechamento.ts`: `fecharMes(mes: string, obs?: string): Promise<{ ok: true; duplicado: boolean } | { error: string; pendencias?: Pendencia[] }>`, `reabrirMes(mes: string, motivo: string): Promise<{ ok: true } | { error: string }>`.

- [ ] Teste `lib/estoque/fechamento-puro.test.ts`: `bloqueioPorPeriodo(['2026-09-15'], [{mes:'2026-09',…}], 'Ajuste')` cita "setembro de 2026" e quem fechou; `situacaoDaData('2026-09-15','2026-10-19',['2026-09'])='fechado'`, `('2026-08-31','2026-10-19',[])='antigo'`, `('2026-09-01','2026-10-19',[])='aberto'`, env `'2026-09'` → `antigo`; `validarFechamento('2026-10','2026-10-19')` recusa, `('2026-09',…)` null, `('lixo')` recusa; `validarReabertura('curto')` recusa; `mesDaData('05/10/2026')='2026-10'`.
- [ ] Rodar: falha. Implementar. Rodar: passa.
- [ ] `fechamento.ts`, ações, permissões no catálogo (módulo "Fechamento e contador"), `node scripts/inserir-via-desktop.mjs`; `npx tsc --noEmit -p .`.
- [ ] Commit `feat(fechamento): regras e ações de fechar/reabrir mês`.

### Task 3: Trava no servidor nas escritas datadas

- [ ] Chamar `exigirPeriodoAberto` (R5) nas actions listadas; erro de banco `PF001` vira a mensagem do banco (já é português).
- [ ] `corrigirCustoAjuste`/`relancarCorrecaoCusto`: `fechado` recusa sem 2ª confirmação; `antigo` segue pedindo; `CorrigirCusto.tsx` e `estoque/ajustes/page.tsx` recebem `mesesFechados` e usam `situacaoDaData`.
- [ ] `npx tsc --noEmit -p .`; testes puros existentes (`escrita-omie-puro`, `fechamento-puro`) passam.
- [ ] Commit `feat(fechamento): trava no servidor antes das escritas com data`.

### Task 4: Devolução ao fornecedor (migration 231)

**Interfaces — Produces:** `devolucao_fornecedor_registrar(p_loja, p_compra, p_itens jsonb [{compra_item_id, quantidade, cfop}], p_motivo, p_user, p_user_nome, p_chave) → jsonb {ok, id, numero, duplicado}`; `devolucao_fornecedor_cancelar(p_loja, p_id, p_user, p_user_nome, p_motivo) → jsonb {ok}`; `_saida_ao_custo_da_entrada(...)`; `devolucao-puro.ts`: `cfopDevolucao(cfopEntrada: string|null): string`, `devolvivel(recebido, jaDevolvido): number`, `validarDevolucao(itens, disponiveis): string | null`, `cmcAposDevolucao(S0, C0, q, c): number`; actions `registrarDevolucao`, `cancelarDevolucao`, `carregarDevolucoesDaNota`.

- [ ] Teste SQL `scripts/testes-sql/231_devolucao_fornecedor.sql`: compra de 10 UN a R$ 10 + 10 UN a R$ 20 (CMC 15), devolver 5 da 2ª → saída a R$ 20, CMC (20·15 − 5·20)/15 = 13,333333; quantidade acima do devolvível recusa; mesma chave não duplica; cancelar volta saldo 20; estornar_compra com devolução ativa recusa; loja Omie recusa.
- [ ] Teste puro `lib/compras/devolucao-puro.test.ts` (mesmos números + CFOP).
- [ ] Rodar: falham. Implementar migration, puro, actions, componente e lista. Rodar: passam. `inserir-via-desktop`, `tsc`.
- [ ] Commit `feat(231): devolução ao fornecedor sem NF-e`.

### Task 5: Pacote do contador (migration 232 + tela)

**Interfaces — Produces:** `posicao_proprio_em_data(p_loja bigint, p_data date) → table(codigo_produto bigint, codigo_local_estoque bigint, saldo numeric, cmc numeric)` (security invoker); `zip.ts`: `criarZip(arquivos: {nome: string; dados: Uint8Array | string}[]): Buffer`; `livro-entradas-puro.ts`: `montarLivro(notas: NotaLivro[], itens: ItemLivro[], mes: string): { linhas: LinhaLivro[]; totaisCfop: TotalCfop[]; total: TotalCfop }`, `cfopEntradaDoItem(fo, cfopNota)`; loaders `carregarLivroEntradas(lojaId, mes)`, `carregarBlocoH(lojaId, dataISO)`; `montarPacote(lojaId, mes, dataBlocoH) → { zip: Buffer; nome: string }`.

- [ ] Teste `lib/contador/zip.test.ts` (o ZIP abre com `unzip -t`, nomes e conteúdo voltam iguais, CRC confere) e `livro-entradas-puro.test.ts` (nota com 2 CFOPs vira 2 linhas; nota cancelada/etapa 40/fora do mês fica fora; dRec manda sobre a emissão; 5.102 sem CFOP de entrada vira 1.102; totais).
- [ ] Teste SQL `scripts/testes-sql/232_contador.sql`: saldo em data soma só até a data, custo do último movimento até a data.
- [ ] Rodar: falham. Implementar. Rodar: passam.
- [ ] Rotas, PDF, tela, menu, catálogo; `tsc`.
- [ ] Commit `feat(232): pacote do contador e tela Contador`.

### Task 6: Registro

- [ ] Seção nova no `AGENTS.md` (o que foi feito, ordem 230 → 231 → 232, permissões, testes, o que ficou para depois). Commit.

## Fica para depois

- Emissão da NF-e de devolução (SEFAZ, com OK do dono); remessa/transferência com nota [H4]; SPED EFD completo; painel NFC-e.
- Central de correções (Refazer inventário, OP pela Central) continua só com o aviso de mês antigo: a trava formal não foi ligada lá (regra "não mexer na Central").
- Bloco H em data passada para lojas Omie depende do espelho do kardex (Fase D item 5).
