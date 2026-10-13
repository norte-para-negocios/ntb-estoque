# Nosso Omie — Fase 1 (base de dados do espelho completo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Espelhar no banco, de forma automática e leve, tudo do estoque Omie da loja 5 (kardex da loja inteira com histórico desde 01/07/2026, saldo/custo em qualquer data, OPs abertas com ficha gravada e origem, ajustes com autor e sem buraco, fichas técnicas com local de consumo e autor).

**Architecture:** Uma migration (160) com o flag `lojas.espelho_completo`, a tabela de estado `espelho_sync_estado` (cursor por loja+frente em jsonb), colunas novas e a função `saldo_em_data`. Um motor puro de "frentes" (recente + backfill, janelas de até 30 dias, cursor local/página, orçamento de páginas por ciclo) usado pelo kardex e pelos ajustes. Crons novos em `app/api/cron/*` (GET + `assertCronAuth`), um por recurso, sequenciais por loja, travados por `pegar_trava_sync`, parando ao primeiro erro do Omie sem repetir.

**Tech Stack:** Next.js 16 (route handlers), supabase-js (service role), Postgres (migration manual), `node --test` para funções puras (sem `@/`).

**Spec:** `docs/superpowers/specs/2026-10-13-nosso-omie-design.md` (Fase 1, itens 1–7) + AGENTS.md.

## Global Constraints

- Crons novos: só lojas com `espelho_completo = true`, `is_test = false`, `ativo = true`, `modo_estoque = 'omie'`, nunca loja 4.
- Janela proibida: nada que chame o Omie nas lojas com flag entre 00:00 e 07:00 de America/Bahia.
- Backfill até 2026-07-01; janelas de no máximo 30 dias; cursor persistido no banco.
- Toda leitura do Omie via `omieRequest`; trava por `pegar_trava_sync`; parar a loja no primeiro erro do Omie (MISUSE/REDUNDANT/bloqueio/rede) sem repetir no mesmo ciclo.
- `.range()` sempre com `.order(<coluna única>)`; `lojas` sempre com `is_test` no select; índice parcial nunca com `.upsert()` (movimentos usa a RPC `upsert_movimentos_ajuste`).
- Migration manual numerada 160, não aplicada por este plano; depois de aplicada: `desktop/scripts/gerar-schema.sh` + versão nova do desktop.
- Sem server action nova nesta fase (só rotas de cron) → `scripts/inserir-via-desktop.mjs`/`lib/offline/politica.ts` não mudam.
- Não regravar linha igual em tabela com gatilho da outbox (movimentos, ordens_producao, estrutura_produto_cache): só escrever o que mudou.

## Review Focus

1. Omie devolve `{}` ("não existem registros") para local/janela sem movimento → tratar como 0 páginas e seguir para o próximo local, nunca como erro (teste no motor: `totalPaginas = 0`).
2. Cron parado por dias (servidor fora, janela proibida) → a frente recente precisa recuperar o buraco desde `coberto_ate`, em janelas de até 30 dias (teste no motor).
3. Lista de OPs abertas vazia/truncada por falha → não marcar dezenas de OPs como fechadas (teste em `opsQueSairamDaLista`).
4. Insumo repetido na mesma ficha (mesmo `idProdMalha` 2×) bateria no `unique(loja_id, codigo_produto, codigo_produto_insumo)` → somar quantidade (teste em `itensDaEstrutura`).
5. Virada do dia em America/Bahia com servidor em Europe/Berlin → "hoje", "ontem" e a janela proibida sempre no fuso da Bahia (teste em `relogioBahia`).

---

### Task 1: Migration 160 + seleção de lojas + relógio da Bahia

**Files:**
- Create: `supabase/migrations/160_espelho_completo.sql`
- Create: `lib/estoque/espelho-lojas.ts` (puro), `lib/estoque/espelho-lojas.test.ts`
- Modify: `lib/omie/sync-all.ts` (add `getLojasEspelhoCompleto`)

**Interfaces — Produces:**
- `relogioBahia(agora: Date): { hoje: string /*YYYY-MM-DD*/; hora: number }`
- `janelaProibida(agora: Date): boolean` (true se 0 ≤ hora < 7 na Bahia)
- `addDias(iso: string, n: number): string`, `isoParaBr(iso: string): string /*dd/mm/aaaa*/`
- `lojaPodeEspelhar(l: { id: number; ativo?: boolean; is_test: boolean; espelho_completo?: boolean | null; modo_estoque?: string | null; omie_app_key?: string | null }): boolean`
- `getLojasEspelhoCompleto(): Promise<LojaOmie[]>` (erro de consulta → log + `[]`)

Migration 160 (ordem dentro do arquivo):
1. `lojas.espelho_completo boolean not null default false` + `grant select (espelho_completo)` + `update lojas set espelho_completo = true where id = 5 and is_test = false`.
2. `espelho_sync_estado (loja_id, frente text, estado jsonb, atualizado_em, ultimo_erro, pk (loja_id, frente))`, RLS select no padrão initplan (migration 156), sem escrita para anon/authenticated.
3. `saldo_em_data(p_loja_id bigint, p_data date)` → `(n_cod_prod, codigo_local_estoque, saldo, cmc, data_mov, id_mov)`: `distinct on (n_cod_prod, codigo_local_estoque)` em `kardex_omie` com `data_mov <= p_data and not cancelado`, ordem `data_mov desc, id_mov desc`; `stable`, security invoker, execute para authenticated.
4. `ordens_producao`: `origem_op text`, `incluido_por_omie text`, `obs_omie text`, `aberta_omie boolean`, `itens_consultados_em timestamptz`; índice `(loja_id, identificacao_n_cod_produto, id desc)`.
5. `movimentos`: `autor text`, `origem_ajuste text`, `cod_int_ajuste text`; `create or replace upsert_movimentos_ajuste(p_rows jsonb)` com as 3 colunas novas e `where (...) is distinct from (...)` no `do update`.
6. `estrutura_produto_cache`: `id_malha bigint`, `codigo_local_estoque bigint`, `local_fonte text`, `incluido_por text`, `incluido_em date`, `alterado_por text`, `alterado_em date`; tabela `estrutura_produto_sync (loja_id, codigo_produto, sincronizado_em, itens int, pk)` com RLS select.

- [ ] Step 1: testes de `relogioBahia` (23:30 UTC → dia anterior? não: 02:30 UTC de 14/10 = 23:30 de 13/10 na Bahia), `janelaProibida` (03:00 UTC = 00:00 Bahia → true; 10:00 UTC = 07:00 → false; 09:59 UTC → true), `addDias` na virada de mês, `isoParaBr`, `lojaPodeEspelhar` (loja 4 false, is_test false, sem flag false, modo proprio false, sem chave false, loja 5 ok true).
- [ ] Step 2: `node --test lib/estoque/espelho-lojas.test.ts` → FAIL (módulo não existe).
- [ ] Step 3: implementar `espelho-lojas.ts` (Intl.DateTimeFormat com `timeZone: 'America/Bahia'`), `getLojasEspelhoCompleto` (select `id, omie_app_key, omie_app_secret, is_test, ativo, espelho_completo, modo_estoque` + filtros no banco e de novo em `lojaPodeEspelhar`), migration 160.
- [ ] Step 4: testes PASS; `npx tsc --noEmit`.
- [ ] Step 5: commit `feat(espelho): migration 160 (flag espelho_completo, estado, saldo_em_data, colunas) e selecao de lojas`.

### Task 2: Motor de frentes (recente + backfill)

**Files:**
- Create: `lib/estoque/espelho-frentes.ts` (puro), `lib/estoque/espelho-frentes.test.ts`

**Interfaces — Produces:**
```ts
type Cursor = { ini: string; fim: string; local: number | null; pagina: number }
type EstadoFrentes = {
  recente: { cursor: Cursor | null; coberto_ate: string | null; concluido_em: string | null; desde: string | null }
  backfill: { cursor: Cursor | null; proximo_fim: string | null; coberto_desde: string | null; concluido: boolean }
}
type ConfigFrentes = { diasRecentes: number; janelaMaxDias: number; limite: string; intervaloRecenteMin: number }
estadoInicial(): EstadoFrentes
lerEstado(bruto: unknown): EstadoFrentes            // tolera jsonb vazio/velho
proximaLeitura(e, cfg, hoje, agoraMs, locais: (number|null)[]): { frente: 'recente'|'backfill'; cursor: Cursor; estado: EstadoFrentes } | null
aposLeitura(e, frente, totalPaginas: number, locais, agoraISO): EstadoFrentes
historicoDesde(e): string | null                    // backfill.coberto_desde ?? recente.desde
```
Regras: recente abre janela `[min(hoje-(diasRecentes-1), coberto_ate), min(hoje, ini+janelaMaxDias-1)]` quando não há cursor e (nunca rodou, ou `coberto_ate < hoje`, ou passaram `intervaloRecenteMin` desde `concluido_em`). Ao fechar a janela: `coberto_ate = fim`, `concluido_em = agora`, `desde ??= ini`, e na 1ª vez `backfill.proximo_fim = ini - 1`. Backfill só começa com `proximo_fim`; janela `[max(proximo_fim-(janelaMaxDias-1), limite), proximo_fim]`; ao fechar: `coberto_desde = ini`, `proximo_fim = ini-1`, `concluido = ini <= limite`. Se `proximo_fim < limite` → `concluido = true` sem leitura. Avanço: `pagina < totalPaginas` → página+1; senão próximo local (menor código > atual, na lista ordenada); sem próximo local → janela fechada. `totalPaginas = 0` = local vazio. Lista de locais vazia → `null`.

- [ ] Step 1: testes — 1ª leitura abre recente [ontem, hoje] no 1º local; avanço de página; troca de local; `totalPaginas=0`; fecha recente e arma backfill; intervalo de 30 min respeitado; recuperação de buraco de 40 dias (2 janelas, sem esperar intervalo); backfill para no limite e marca concluído; `lerEstado({})`; `historicoDesde`; local atual removido da lista.
- [ ] Step 2: FAIL. Step 3: implementar. Step 4: PASS + tsc. Step 5: commit `feat(espelho): motor puro de frentes (recente + backfill com cursor)`.

### Task 3: Cron `sync-kardex` (loja inteira)

**Files:**
- Create: `lib/omie/espelho-estado.ts` (ler/gravar `espelho_sync_estado`), `lib/omie/kardex-loja.ts` (`sincronizarKardexLoja`), `app/api/cron/sync-kardex/route.ts`
- Modify: `lib/omie/kardex.ts` (`buscarPaginaKardexLocal(loja, codigoLocal, dIni, dFim, pagina)`), `lib/estoque/espelho-lojas.ts` (`ehErroDeLimiteOmie(msg, faultCode)` + teste)

**Interfaces:**
- Consumes: Task 1 (`relogioBahia`, `janelaProibida`, `isoParaBr`, `getLojasEspelhoCompleto`), Task 2 (motor).
- Produces: `lerEstadoSync(lojaId, frente): Promise<unknown>`, `gravarEstadoSync(lojaId, frente, estado, ultimoErro?)`, `sincronizarKardexLoja(loja, agora): Promise<ResumoCiclo>`; `ResumoCiclo = { loja: number; paginas: number; linhas: number; parouPor: string | null; historicoDesde: string | null }`.

Config kardex: `diasRecentes 2, janelaMaxDias 30, limite '2026-07-01', intervaloRecenteMin 30`; orçamento 12 páginas/ciclo, pausa 700 ms entre chamadas, teto de 150 s. Trava `kardex-loja` (600 s, sempre solta no fim). Locais: `local_estoques` ativos (`inativo` ≠ 'S'), ordenados. Cada página: normaliza (`normalizarMovOmie`), upsert `kardex_omie` (constraint total), na frente recente upsert `kardex_omie_carga` só com `carregado_em` (sem mexer em `movimentos`); só depois avança e grava o estado. Erro → grava `ultimo_erro`, para a loja. Rota: janela proibida → 200 `{ pulado: 'janela 00-07' }`; 502 se todas as lojas falharam.

- [ ] Step 1: teste de `ehErroDeLimiteOmie` (MISUSE, "consumo redundante", "Já existe uma requisição", bloqueada → true; "Produto não encontrado" → false). FAIL → implementar → PASS.
- [ ] Step 2: implementar estado, página do kardex, `sincronizarKardexLoja`, rota. `npx tsc --noEmit`.
- [ ] Step 3: commit `feat(espelho): cron sync-kardex da loja inteira (dia a dia + backfill ate 01/07)`.

### Task 4: `sync-ajustes` por janela de data, com autor e origem

**Files:**
- Create: `lib/estoque/ajuste-autor.ts` (puro) + `.test.ts`
- Modify: `lib/omie/sync-ajustes.ts` (`ajusteParaMovimento` grava `autor/origem_ajuste/cod_int_ajuste`; nova `syncAjustesJanela(loja, agora)`), `app/api/cron/sync-ajustes/route.ts`

**Interfaces — Produces:** `autorDoAjuste(obs): string | null`, `origemDoAjuste({ obs, cod_int_ajuste, origem, imp_api }): 'app'|'script'|'pdv'|'api'|'omie'`.
Regras: autor = texto depois de `NTB Estoque · ` até ` | ` ou fim; `Usuário:Nome`/`Usuario: Nome` → Nome. Origem: `cod_int` `^(ITEM\d|MOV-)` ou obs com "NTB Estoque" → app; `^(FPI|SEED|CORTE)-` → script; origem PDV → pdv; `imp_api='S'` → api; resto → omie (tela).
Janela: config `diasRecentes 3, janelaMaxDias 30, limite '2026-07-01', intervaloRecenteMin 30`, `locais = [null]`, `ListarAjusteEstoque` com `data_movimento_de/ate`, 50/página, orçamento 8 páginas, trava `ajustes` (600 s), frente `ajustes` no estado. Rota: lojas com flag → `syncAjustesJanela` (pula na janela 00–07); demais (sem loja 4) → `syncAjustes` de sempre (agora também com autor/origem).

- [ ] Step 1: testes de autor/origem (casos do AGENTS.md e da faxina: "NTB Estoque · Edson dos santos dias | custo corrigido...", "Garrafa quebrada · Avarias do bar · NTB Estoque · Carlos Marinho", "Usuário:Ramon", "Cupom 205152", ITEM8045, CORTE-80312-ALCAPARRAS, vazio). FAIL → implementar → PASS.
- [ ] Step 2: implementar `syncAjustesJanela` + rota; tsc. Step 3: commit `feat(espelho): sync-ajustes por janela de data com autor e origem (lojas com espelho)`.

### Task 5: Cron `sync-ops-abertas`

**Files:**
- Create: `lib/estoque/ops-abertas-puro.ts` + `.test.ts`, `lib/omie/ops-abertas.ts`, `app/api/cron/sync-ops-abertas/route.ts`

**Interfaces — Produces:**
- `origemDaOP({ cCodIntOP, cObs, uInc }): 'vendas'|'app'|'script'|'cupom'|'manual'` (NTBV → vendas; NTB- → app; `^(OP|FPI|SEED|CORTE|FAX)-` → script; obs `^Cupom \d+` ou uInc WEBSERVICE → cupom; resto manual).
- `linhaOPAberta(op, lojaId)` → colunas escalares + `origem_op`, `incluido_por_omie`, `obs_omie`, `aberta_omie: true`.
- `opMudou(existente, nova): boolean` (compara só as colunas que a rota grava).
- `opsQueSairamDaLista(locaisAbertas: number[], daLista: Set<number>, listaCompleta: boolean): number[]` (lista incompleta → []; lista vazia com > 10 locais → []).
- `precisaConsultarItens(row: { full_object, itens_consultados_em }): boolean`.
Fluxo: trava `ops-abertas` 1800 s (só solta se falhar — vira o intervalo de 30 min); `ListarOrdemProducao` `cConcluida: 'N'` todas as páginas (pausa 700 ms; erro → para sem marcar nada); lê existentes por lotes de 100 ids; insere novas (concluida=false) e atualiza só as que mudaram (sem tocar `concluida`); marca `aberta_omie = false` nas OPs locais `concluida is not true` que não vieram (lotes por `id`); `ConsultarOrdemProducao` em até 30 OPs abertas sem itens (grava `full_object.itensDetalhes` + `itens_consultados_em`; "não cadastrada" → `aberta_omie=false`), parando no 1º erro de limite. Estado `ops-abertas` (abertas, consultadas, lista_completa_em).

- [ ] Step 1: testes das 5 funções puras. FAIL → implementar → PASS.
- [ ] Step 2: implementar `lib/omie/ops-abertas.ts` + rota; tsc. Step 3: commit `feat(espelho): cron sync-ops-abertas (todas as abertas, ficha gravada, origem e autor)`.

### Task 6: Cron `sync-fichas`

**Files:**
- Create: `lib/estoque/fichas-puro.ts` + `.test.ts`, `lib/omie/fichas.ts`, `app/api/cron/sync-fichas/route.ts`
- Modify: `lib/omie/malha.ts` (tipos `dIncProdMalha`, `uIncProdMalha`, `dAltProdMalha`, `uAltProdMalha`, `codigo_local_estoque?`)

**Interfaces — Produces:**
- `itensDaEstrutura(itens, ctx: { lojaId; codigoProduto; tipoPorCodigo: Map<number,string|null>; localPorInsumoOP: Map<number, number> }): LinhaFicha[]` (soma insumo repetido; local = do item da ficha se vier, senão da última OP do produto, `local_fonte` 'ficha'|'op'|null; datas dd/mm/aaaa → ISO).
- `escolherProdutosFicha(candidatos: number[], ultimaSync: Map<number,string>, agoraMs, limite, diasRefazer): number[]` (nunca sincronizados primeiro, depois os mais velhos que 7 dias).
- `fichaMudou(existente, nova): boolean`; `localPorInsumoDaOP(fullObject): Map<number, number>` (`itensDetalhes[].nIdProdutoMalha → codigo_local_estoque`).
Fluxo: trava `fichas` 600 s; candidatos = `produtos` tipo 03/04 não inativos (paginado com `.order('id')`); 20 por ciclo, pausa 1,5 s, teto 150 s; para cada um: `consultarEstrutura` → linhas → upsert só as que mudaram → apaga insumos que saíram (só deste produto) → upsert `estrutura_produto_sync`. Sem estrutura = apaga itens do produto e registra `itens = 0`. Erro de limite → para.

- [ ] Step 1: testes das funções puras. FAIL → implementar → PASS.
- [ ] Step 2: implementar `lib/omie/fichas.ts` + rota; tsc. Step 3: commit `feat(espelho): cron sync-fichas (ficha com local de consumo e autor, refaz a cada 7 dias)`.

### Task 7: `sync-cron.sh`, AGENTS.md e verificação final

**Files:** Modify `scripts/sync-cron.sh`, `AGENTS.md`.

- `hit /api/cron/sync-kardex` todo ciclo (logo depois de `sync-ajustes`); `sync-ops-abertas` todo ciclo (a trava de 30 min limita); `sync-fichas` todo ciclo; `sync-familias` 1×/hora no bloco 4.
- AGENTS.md: seção "Nosso Omie — Fase 1" (flag, crons, limites, estado, saldo_em_data, o que fazer no deploy).
- [ ] `bash -n scripts/sync-cron.sh`; todos os `node --test` novos e antigos de `lib/estoque` e `lib/omie`; `npx tsc --noEmit`; `npm run build`.
- [ ] Commit `chore(espelho): crons novos no sync-cron.sh e AGENTS.md`.
