# "Nosso Omie" — controle de estoque nível Omie no Norte Estoque — Design mestre

Data: 2026-10-13 · Primeira loja: Donana Praia do Forte (loja 5, `modo_estoque='omie'`) · Repo: Norte Estoque.
Base já no ar (13/10): `/estoque*` para loja Omie (espelho, só leitura), kardex do Omie por produto sob demanda
(`kardex_omie`, `kardex_omie_carga`), trava `sync_trava` (migration 159). Ver AGENTS.md "Estoque da loja Omie (espelho)".

## 1. Entendimento

Pedido do dono (13/10): "criar o nosso próprio Omie". Na loja Omie o Norte Estoque espelha TUDO do estoque pela API
(mesmo saldo, nada divergente), mostra com telas melhores que as do Omie e escreve no Omie pelas próprias telas. Na loja
sem Omie, o modo `proprio` já cobre o mesmo. A faxina (robô de correções, `~/Projects/norte-faxina`) vai usar essa base
depois. "Crie tudo que você acha importante agora."

Fora (decidido): financeiro, NF-e de saída, lote no modo Omie.

## 2. Decomposição (uma entrega por fase, cada uma com plano próprio, nesta ordem)

### Fase 1 — Base de dados do espelho completo
1. **Flag por loja** `lojas.espelho_completo boolean default false` (ligada só na loja 5 nesta rodada). Todos os crons
   novos só rodam para lojas com a flag, nunca loja de teste (`is_test`) e nunca loja 4 (Sertão, produção protegida).
2. **Kardex da loja inteira, automático**: cron `sync-kardex` (a cada ciclo do `sync-cron.sh`, leve): para cada local
   ativo, `ListarMovimentoEstoque` SEM `idProd` (100 por página) numa janela; grava em `kardex_omie` (upsert por
   `(loja_id, id_mov, codigo_local_estoque)`). Duas frentes com cursor persistido (tabela de estado por loja):
   (a) **dia a dia**: ontem + hoje, sempre; (b) **backfill** para trás em janelas de até 30 dias até 2026-07-01,
   no máximo N páginas por ciclo (parar e continuar no ciclo seguinte). Usa `pegar_trava_sync(loja,'kardex-loja',…)`.
   **Janela de horário**: não rodar entre 00:00 e 07:00 de Brasília (a faxina do Mac usa a mesma chave do Omie de
   madrugada). Atualiza `kardex_omie_carga` dos produtos vistos.
3. **Saldo e custo em qualquer data**: função SQL `saldo_em_data(p_loja_id, p_data)` → por produto e local, o
   `saldo_apos`/`cmc_apos` do último movimento até a data (ordem `data_mov, id_mov`). Só vale onde o backfill já cobre
   (a tela informa "histórico disponível desde dd/mm").
4. **OPs abertas completas**: cron `sync-ops-abertas` (lojas com flag): `ListarOrdemProducao` só abertas (todas, sem
   janela de data) e, para as que ainda não têm, `ConsultarOrdemProducao` (itensDetalhes = ficha gravada na OP) — no
   máximo 30 consultas por ciclo. Grava a origem: `cupom` (obs `^Cupom \d+`, `uInc` WEBSERVICE), `manual`, `script`
   (`cCodIntOP` com prefixo conhecido), e `uInc`/`dInclusao`. Marca como fechada a OP que sumiu da lista de abertas.
   Reaproveitar `ordens_producao` (colunas novas ou `full_object`) seguindo o padrão do repo.
5. **Ajustes com autor e sem buraco**: `sync-ajustes` passa a buscar por **janela de data** (últimos 3 dias + backfill
   até 2026-07-01 com cursor de data), não mais pelo maior `id_ajuste` (que pula ajustes antigos, ver AGENTS.md).
   Colunas `autor` e `origem_ajuste` derivadas de `obs` ("NTB Estoque · Nome", "Usuário:Nome"), `cod_int_ajuste`
   (`ITEMnnnn` = app, `FPI-`/`SEED-`/`CORTE-` = script) — vazio = tela do Omie.
6. **Fichas automáticas**: cron `sync-fichas` (flag) preenche `estrutura_produto_cache` aos poucos (até 20 produtos por
   ciclo, pausa entre chamadas), guardando local de consumo de cada insumo e autor/data de alteração
   (`uIncProdMalha/uAltProdMalha`), refazendo cada ficha a cada 7 dias; apaga itens que saíram da ficha.
7. `sync-familias` entra no `sync-cron.sh`.

### Fase 2 — Telas de informação
1. **Saúde do estoque** `/estoque/saude` (loja Omie e própria): cartões e listas de
   PA/PI/MP negativos (com desde quando, pelo kardex), custo médio absurdo (≥ R$1.000/un ou ≥ 20× o anterior),
   salto de custo recente, OPs abertas sobrando (prato com saldo ≥ 0 e OP aberta do PDV) e faltando (saldo < 0 sem OP),
   insumo sem custo no local de consumo (causa do Client-193), contagem que oscila (≥ 3× entre contagens), produto sem
   ficha que vende. Cada item leva ao produto/kardex.
2. **Kardex da loja** `/estoque/kardex`: todos os movimentos com filtros (período, produto, local, origem, usuário/autor),
   paginação no servidor, exportação CSV.
3. **Custo do produto** (na página do produto): gráfico do custo médio no tempo (pelo kardex), as entradas que formaram o
   custo, e para PA/PI o custo do prato pela ficha (soma dos insumos × custo atual).
4. **Saldo em data**: seletor de data na tela `/estoque` (usa `saldo_em_data`), com aviso de cobertura.

### Fase 3 — Telas de cadastro/auditoria
1. **OPs abertas** (ampliar `/ordem-producao` ou aba nova): todas as abertas com origem, autor, idade, ficha gravada na
   OP, e indicação sobrando/faltando.
2. **Fichas** (`/estoque/fichas`): todas as fichas com insumos, local de consumo, autor/data; "onde é usado" (insumo →
   pratos).
3. **Ajustes** (`/estoque/ajustes`): todos os ajustes com autor, motivo, quantidade, valor e custo unitário; destaque de
   custo absurdo.
4. **Quem mexeu** (`/estoque/quem-mexeu`): linha do tempo por pessoa (ajustes, OPs, fichas).

### Fase 4 — Escrever no Omie pela tela (loja Omie)
1. Na tela de estoque/produto da loja Omie: **Entrada/Saída/Ajuste** e **Transferência** usando as actions Omie já
   existentes (`criarAjusteManual`, transferência), com o CMC lido ao vivo como já fazem.
2. **OPs**: concluir/excluir/redatar em lote a partir da lista de abertas (actions existentes).
3. **Trocar insumo em massa** na tela de fichas (ex.: Coca → Pepsi): `IncluirEstrutura` (com `intMalha`) → reler →
   `ExcluirEstrutura` → reler, por produto, com prévia e confirmação. (`AlterarEstrutura` NÃO troca o produto do item.)
4. **Corrigir custo de um ajuste** (tela de ajustes): excluir o ajuste e relançar com o custo informado, com prévia,
   confirmação e checagem de mês fechado (não mexer em mês já enviado à contabilidade sem confirmação explícita).
5. Toda escrita: permissão própria, `is_test` respeitado (simula), loja 4 bloqueada nesta rodada, registro em
   `audit_log`.

## 3. Regras transversais
- Limite do Omie: toda leitura nova passa por `omieRequest` (pacing, MISUSE, REDUNDANT) e por `sync_trava`; crons novos
  são pequenos por ciclo e param ao primeiro MISUSE (não repetir — ver AGENTS.md).
- `.range()` sempre com `.order(<coluna única>)`; `lojas` sempre com `is_test` no select; índice único parcial não
  serve para `.upsert()`.
- Migrations manuais, numeradas a partir de **160** (156–159 já usadas no remoto). Deploy e migration só depois da
  revisão final; quem coordena aplica.
- Testes: funções puras com `node --test` (sem `@/`); `npx tsc --noEmit`; `npm run build`.
- Textos em português simples, sem jargão; mesmo kit visual das telas atuais (`components/ui-kit`, `Apresentacao`).
- App desktop offline (AGENTS.md "App desktop offline"): **toda server action nova** → rodar `node scripts/inserir-via-desktop.mjs`
  e classificar em `lib/offline/politica.ts` (escritas no Omie = `depende`, só com internet); **toda migration nova** →
  rodar `desktop/scripts/gerar-schema.sh` (e registrar no relatório que o desktop precisa de versão nova).
- Loja 5 compartilha a chave do Omie com a faxina do Mac (madrugada) — por isso a janela 00:00–07:00 nos crons novos.
