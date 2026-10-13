# Nosso Omie — Fases 2 e 3 (telas de informação e de auditoria) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar, só leitura, tudo o que o espelho da Fase 1 guarda: Saúde do estoque, Kardex da loja (filtros, paginação no servidor, CSV), custo do produto (gráfico, entradas, custo do prato), saldo em qualquer data, OPs abertas com origem/autor/idade/ficha/sobrando-faltando, fichas com "onde é usado", ajustes com autor e custo absurdo, e "quem mexeu".

**Architecture:** Toda regra de classificação mora em módulos puros `lib/estoque/*-puro.ts` (sem imports de valor, testados com `node --test`). Cada tela é um Server Component em `app/(app)/estoque/<tela>/page.tsx` que carrega do banco com o cliente do usuário (RLS) e entrega às funções puras; leitores de dados compartilhados ficam em `app/(app)/estoque/dados-*.ts`. Navegação por um componente de atalhos (`EstoqueAtalhos`) em todas as telas de estoque + itens novos no menu (`comEstoque`). Uma migration (161) só com índices e RLS em initplan para as leituras da loja inteira.

**Tech Stack:** Next.js 16.2 (App Router, Server Components, route handler GET para CSV), supabase-js, Postgres, Tailwind + `components/ui-kit/*`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-13-nosso-omie-design.md` (Fase 2 itens 1–4, Fase 3 itens 1–4) + AGENTS.md ("Estoque da loja Omie (espelho)", "Nosso Omie Fase 1").

## Global Constraints

- Telas só de leitura (escrita é a Fase 4). Nenhuma chamada ao Omie nesta etapa.
- Valem para loja `omie`; para loja `proprio` usam o ledger próprio onde fizer sentido; o que não couber mostra aviso claro (nunca 404 por modo). Loja `nenhum` → `notFound()` como `/estoque`.
- Permissão: telas de estoque exigem `Movimentacoes` (igual a `/estoque`); OPs abertas exige `Ordens de Producao`.
- `.range()` sempre com `.order(<coluna única>)` (normalmente `id`); `lojas` sempre com `is_test` no select.
- Política RLS nova/reescrita no padrão initplan: `((select usuario_e_admin()) or loja_id in (select usuario_lojas()))`.
- Migration nova numerada **161**, manual, não aplicada aqui; depois de aplicada: `desktop/scripts/gerar-schema.sh` + versão nova do desktop.
- Sem server action nova (só páginas e um GET de CSV) → `scripts/inserir-via-desktop.mjs` e `lib/offline/politica.ts` não mudam.
- Funções puras: sem `@/`, sem import de valor (só `import type`), `node --test lib/estoque/<x>.test.ts`.
- Português simples, sem jargão; mesmo kit (`components/ui-kit/*`, `components/estoque-proprio/Apresentacao`); mobile ok (sem rolagem horizontal da página; tabelas largas dentro de `overflow-x-auto`).
- Datas de negócio em America/Bahia (`hojeBahiaISO`); datas puras (YYYY-MM-DD) nunca passam por `new Date()` local.
- Limiares (Ruling): custo absurdo = CMC ≥ R$ 1.000/un **ou** ≥ 20× o anterior; salto recente = CMC ≥ 10× o anterior no mesmo local nos últimos 7 dias (mesma regra do marcador "salto" do kardex); contagem que oscila = duas contagens seguidas do mesmo produto/local com razão ≥ 3 (ambas > 0) ou contagem 0 entre duas > 0; OP velha = aberta há mais de 7 dias.

## Review Focus

1. Kardex da loja com milhares de linhas no período: a paginação no servidor precisa de ordem total (`data_mov desc, id_mov desc, id desc`) para não repetir/pular linhas entre páginas — teste na função que monta a ordem/offset (`paginaKardex`).
2. Data do "saldo em data" antes do início do histórico, no futuro, ou com o backfill ainda não começado → aviso, nunca uma lista "zerada" enganosa (teste `avaliarDataSaldo`).
3. Produto ainda não lido pelo `sync-fichas` não pode aparecer como "vende sem ficha" (só quem foi lido e tem 0 itens) — teste em `produtosSemFichaQueVendem`.
4. CSV com descrição contendo `;`, aspas ou quebra de linha e números com vírgula decimal → arquivo abre certo no Excel BR (BOM, `;`, aspas dobradas) — teste em `paraCsv`.
5. Saldo que fica negativo, volta a positivo e fica negativo de novo → "negativo desde" é o início do trecho negativo ATUAL, não o primeiro da história — teste em `negativoDesde`.

---

### Task 1: Migration 161, atalhos e menu

**Files:**
- Create: `supabase/migrations/161_estoque_telas_auditoria.sql`
- Create: `components/estoque-proprio/EstoqueAtalhos.tsx`
- Modify: `components/shell/NavItems.ts`, `lib/permissoes-catalogo.ts`, `components/shell/Sidebar.tsx`, `components/shell/MobileNav.tsx` (item ativo = rota mais específica)
- Create: `lib/nav-ativo.ts` (puro) + `lib/nav-ativo.test.ts`

**Interfaces — Produces:**
- `hrefAtivo(pathname: string, hrefs: string[]): string | null` — o href mais longo que é igual ao pathname ou prefixo seguido de `/`.
- `<EstoqueAtalhos atual="estoque"|"saude"|"kardex"|"ajustes"|"fichas"|"ops"|"quem-mexeu" />` (Server Component; links em pílulas roláveis no mobile).

Migration 161:
```sql
-- kardex da loja inteira por período
create index if not exists kardex_omie_loja_data_idx on public.kardex_omie (loja_id, data_mov desc, id_mov desc);
-- ajustes por período
create index if not exists movimentos_loja_data_idx on public.movimentos (loja_id, data desc);
-- RLS em initplan (migration 156) nas tabelas do kardex (159 criou no padrão por linha)
drop policy if exists kardex_omie_select_por_loja on public.kardex_omie;
create policy kardex_omie_select_por_loja on public.kardex_omie for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
drop policy if exists kardex_omie_carga_select_por_loja on public.kardex_omie_carga;
create policy kardex_omie_carga_select_por_loja on public.kardex_omie_carga for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
```

Menu: `{ href: '/estoque/saude', label: 'Saúde do estoque', icon: HeartPulse, group: 'Operação', comEstoque: true }` logo após `/estoque`; `MENU_PERMISSAO['/estoque/saude'] = 'Movimentacoes'`. As demais telas entram pelos atalhos (evita menu inchado).

- [ ] Step 1: teste `hrefAtivo('/estoque/saude', ['/estoque','/estoque/saude'])` → `/estoque/saude`; `'/estoque/produto/1'` → `/estoque`; `'/estoquex'` → null; `'/'` com `['/home']` → null.
- [ ] Step 2: FAIL. Step 3: implementar `lib/nav-ativo.ts`; usar em Sidebar/MobileNav no lugar de `pathname === i.href || startsWith`. Migration, atalhos, menu.
- [ ] Step 4: PASS + `npx tsc --noEmit`. Step 5: commit `feat(estoque): migration 161 (indices e RLS initplan do kardex), atalhos e menu Saude`.

### Task 2: Regras puras da Saúde do estoque

**Files:** Create `lib/estoque/saude-puro.ts`, `lib/estoque/saude-puro.test.ts`

**Interfaces — Produces:**
```ts
export const CUSTO_ABSURDO_MIN = 1000, CUSTO_ABSURDO_VEZES = 20, SALTO_VEZES = 10, OSCILACAO_VEZES = 3
export type MovSaldo = { data: string; ordem: number; local: number; saldo: number | null; cmc: number | null }
export function custoAbsurdo(cmc: number | null, anterior: number | null): 'alto' | 'salto20' | null
export function negativoDesde(movs: MovSaldo[]): Map<number /*local*/, string /*data*/>   // só locais negativos no último mov
export function saltosRecentes(movs: MovSaldo[], desde: string): { local: number; data: string; de: number; para: number }[]
export function ultimoCmcAnterior(movs: MovSaldo[]): Map<number, { atual: number; anterior: number | null }>
export type Contagem = { produto: number; local: number; data: string; ordem: number; qtd: number }
export function oscilacoesContagem(c: Contagem[]): { produto: number; local: number; data: string; de: number; para: number }[]
export type OPAbertaMin = { id: number; produto: number | null; origem: string | null }
export function opsSobrandoFaltando(saldos: Map<number, number>, tipos: Map<number, string | null>, abertas: OPAbertaMin[]): { sobrando: OPAbertaMin[]; faltando: number[] }
export type ItemFichaLocal = { produto: number; insumo: number; local: number | null }
export function insumosSemCustoNoLocal(itens: ItemFichaLocal[], cmcLocal: Map<string /*`${insumo}:${local}`*/, number>): { insumo: number; local: number; pratos: number[] }[]
export function produtosSemFichaQueVendem(vendidos: Set<number>, fichaLida: Map<number, number /*itens*/>, tipos: Map<number, string | null>): number[]
export function cmcPorLocalAtual(posicoes: { data_posicao: string; codigo_local_estoque: number; n_cod_prod: number; n_cmc: number | null }[]): Map<string, number>
```
Regras: `custoAbsurdo` = `alto` se `cmc ≥ 1000`, `salto20` se `anterior > 0 && cmc ≥ 20×anterior`, senão null (cmc ≤ 0/null → null). `negativoDesde`: por local, ordena por (data, ordem), anda até o fim; guarda a data do 1º mov do trecho negativo corrente (zera quando saldo ≥ 0). `oscilacoesContagem`: por produto+local ordenado; par seguido (a, b) com `max/min ≥ 3` (ambos > 0) ou um 0 e outro > 0 entre contagens positivas antes e depois (simplificação: `a > 0 && b === 0` marca; `a === 0 && b > 0` também marca). `opsSobrandoFaltando`: sobrando = OP aberta com `origem === 'cupom'` cujo produto tem saldo ≥ 0; faltando = produto tipo `03`/`04` com saldo < 0 sem nenhuma OP aberta. `insumosSemCustoNoLocal`: item com local, sem `cmcLocal` > 0 para `insumo:local` → agrupado por insumo+local com lista de pratos. `produtosSemFichaQueVendem`: vendido, tipo 03/04, `fichaLida.get(p) === 0` (ausente = não lido = fora). `cmcPorLocalAtual`: data mais recente com local ≠ 0; chave `insumo:local` → n_cmc.

- [ ] Step 1: testes (um por função, + os casos do Review Focus 3 e 5: negativo→positivo→negativo devolve a data do 2º trecho; produto não lido não entra).
- [ ] Step 2: FAIL. Step 3: implementar. Step 4: PASS. Step 5: commit `feat(estoque): regras puras da saude do estoque`.

### Task 3: Tela `/estoque/saude`

**Files:** Create `app/(app)/estoque/saude/page.tsx`, `app/(app)/estoque/dados-saude.ts`; Modify `app/(app)/estoque/dados-omie.ts` (exportar `carregarEstoqueOmieComPosicoes` que devolve `{ visao, posicoes }` sem ler duas vezes; `carregarEstoqueOmie` passa a chamar ela).

**Interfaces:**
- Consumes: Task 2.
- Produces: `carregarSaude(lojaId: number, modo: 'omie'|'proprio'): Promise<SaudeDados>` com
```ts
type ItemSaude = { codigoProduto: number; descricao: string; codigo: string; detalhe: string; href: string; tom?: 'erro'|'aviso' }
type SecaoSaude = { chave: string; titulo: string; explicacao: string; itens: ItemSaude[]; naoSeAplica?: string }
type SaudeDados = { secoes: SecaoSaude[]; avisos: string[] }
```
Loja Omie: visão + posições (foto), kardex dos últimos 90 dias (`kardex_omie` por `data_mov >= hoje-90`, paginado `.order('id')`), contagens = `movimentos` tipo `SLD` dos últimos 120 dias, OPs abertas (`aberta_omie = true`, ou `concluida is not true` se a coluna/flag não existir), fichas (`estrutura_produto_cache` com `codigo_local_estoque`), `estrutura_produto_sync`, vendidos = kardex com `id_cupom` não nulo nos últimos 30 dias. Seções: Negativos (PA/PI/MP separados por tipo no detalhe, "negativo desde dd/mm" ou "antes de dd/mm" quando o trecho começa antes do histórico lido), Custo absurdo, Salto de custo (7 dias), OPs sobrando, Faltando OP, Insumo sem custo no local de consumo, Contagem que oscila, Vende sem ficha. Cada item → `/estoque/produto/<cod>` (ou `/ordem-producao/abertas?q=` para OP).
Loja própria: negativos (`estoque_saldos` + desde via `estoque_movimentos.saldo_apos` 90 dias), custo absurdo (`estoque_custos` + `cmc_apos` anterior do ledger), salto (ledger 7 dias), insumo sem custo (fichas ativas, insumo com cmc 0 — local não se aplica), vende sem ficha (`origem = 'VENDA'` 30 dias, tipo 03/04 sem ficha ativa); OPs sobrando/faltando e contagem que oscila → `naoSeAplica` com texto.
Topo: cartões (`Indicador`) com a contagem de cada seção (link para a âncora). Seções vazias aparecem como "Tudo certo" em uma linha.

- [ ] Step 1: implementar loader + página + `EstoqueAtalhos atual="saude"`. `npx tsc --noEmit`.
- [ ] Step 2: commit `feat(estoque): tela Saude do estoque (loja Omie e propria)`.

### Task 4: Kardex da loja `/estoque/kardex` + CSV

**Files:** Create `lib/estoque/kardex-loja-puro.ts` + `.test.ts`, `app/(app)/estoque/kardex/page.tsx`, `app/(app)/estoque/kardex/csv/route.ts`, `app/(app)/estoque/dados-kardex.ts`

**Interfaces — Produces:**
```ts
export type FiltrosKardexLoja = { ini: string; fim: string; produto: number | null; q: string; local: number | null; origem: string; autor: string; page: number; erro: string | null }
export function lerFiltrosKardex(sp: Record<string, string | undefined>, hoje: string): FiltrosKardexLoja // padrão últimos 7 dias; fim<ini troca; > 366 dias corta em 366 com erro
export function paginaKardex(page: number, porPagina: number): { from: number; to: number }
export const ORDEM_KARDEX: readonly ['data_mov', 'id_mov', 'id'] // todas desc
export function paraCsv(cabecalho: string[], linhas: (string | number | null)[][]): string // BOM + ';' + CRLF, números com vírgula decimal
export function rotuloOrigemKardex(cod: string, des: string | null): string
```
`dados-kardex.ts`: `buscarKardexLoja(lojaId, f, { from, to })` → `{ linhas, total, truncadoAutor }` via `kardex_omie` com `count: 'exact'`, filtros `data_mov` entre, `n_cod_prod`, `codigo_local_estoque`, `cod_origem`; busca `q` → resolve até 200 produtos por `produtos.descricao/codigo ilike` (`escapeIlike`) e filtra `.in('n_cod_prod', …)`; `autor` → `movimentos.id_ajuste` com `autor ilike` no período (até 300 ids, `truncadoAutor` se passou) e `.in('id_ajuste', …)`. Ordem `.order('data_mov',{ascending:false}).order('id_mov',{ascending:false}).order('id',{ascending:false})`. Junta nome do produto, local e autor (do ajuste) por lotes.
Página: `Filtros` (data início/fim, produto (texto), local (select), origem (select das origens vistas: `cod_origem` distintos dos últimos 90 dias, limitado), autor (texto)), cartões (movimentos, entradas, saídas no período — da página atual não; usar só `total`), tabela (`overflow-x-auto`) com Data, Produto, Local, Origem, Quantidade, Custo unit., Custo médio após, Saldo após, Documento, Autor; `Paginacao` 100/página; botão "Baixar CSV" (`/estoque/kardex/csv?<mesmos params>`). Aviso de cobertura: "Histórico completo desde dd/mm" (`espelho_sync_estado` frente `kardex` → `historicoDesde(lerEstado(...))` — import de `lib/estoque/espelho-frentes`).
CSV: mesmos filtros, até 20.000 linhas (páginas de 1000 com a mesma ordem), `Content-Disposition: attachment; filename="kardex-<loja>-<ini>-<fim>.csv"`; acima disso última linha "… cortado em 20.000 linhas".
Loja própria: `redirect('/movimentacoes')` (o kardex do ledger próprio já existe lá, com filtros e exportação) — Ruling.

- [ ] Step 1: testes `lerFiltrosKardex` (padrão 7 dias; datas invertidas; 400 dias → corta e erro; page inválida → 1), `paginaKardex(3,100)` → `{from:200,to:299}`, `paraCsv` (BOM, `;`, aspas dobradas, quebra de linha entre aspas, `1234.5` → `1234,5`, null → vazio).
- [ ] Step 2: FAIL. Step 3: implementar puro + loader + página + rota. Step 4: PASS + tsc. Step 5: commit `feat(estoque): kardex da loja com filtros, paginacao no servidor e CSV`.

### Task 5: Custo do produto (página do produto)

**Files:** Create `lib/estoque/custo-produto-puro.ts` + `.test.ts`, `components/estoque-proprio/GraficoCusto.tsx`, `components/estoque-proprio/CustoProduto.tsx`; Modify `app/(app)/estoque/produto/[codigo]/page.tsx`

**Interfaces — Produces:**
```ts
export type MovCusto = { data: string; ordem: number; local: number; quantidade: number; valorUnit: number | null; cmc: number | null; saldo: number | null; cancelado?: boolean; doc?: string | null; origem?: string | null }
export type PontoCusto = { data: string; cmc: number }
export function serieCustoMedio(movs: MovCusto[]): Map<number /*local*/, PontoCusto[]> // último cmc > 0 do dia, por local, ordem crescente
export function entradasQueFormaramCusto(movs: MovCusto[], limite?: number): (MovCusto & { local: number })[] // por local: entradas (qtd > 0, valorUnit > 0, não cancelado) desde a última vez que o saldo ficou ≤ 0; mais recentes primeiro
export type ItemCusto = { insumo: number; qtdPorUnidade: number; cmc: number | null }
export function custoDoPrato(itens: ItemCusto[]): { total: number; semCusto: number[]; linhas: (ItemCusto & { custo: number })[] }
```
`GraficoCusto` (client, SVG puro, sem lib): linhas por local (até 3 locais com mais pontos), eixo Y em R$ com 3 marcas, eixo X datas início/fim, cor `var(--brand)`/tons; ponto com custo absurdo em `var(--err)`; altura 180px, largura 100%; `prefers-reduced-motion` sem animação.
`CustoProduto` (server-friendly): gráfico + tabela "Entradas que formaram o custo" + "Custo do prato pela ficha" (para tipo 03/04 com ficha): linhas insumo × qtd × custo médio atual; insumos sem custo destacados.
Loja Omie: kardex do produto (até 1000 linhas mais recentes, já carregado na página — subir o limite de 300 para 1000), ficha de `estrutura_produto_cache` (qtd × (1 + perda%/100)), custo atual dos insumos = `visao.linhas[].cmc`. Loja própria: `estoque_movimentos` do produto (até 1000, `cmc_apos`, `custo_unitario`, `saldo_apos`), ficha ativa (`carregarFichasAtivas`, qtd = bruta/rendimento), cmc atual = visão.

- [ ] Step 1: testes: série (2 movs no mesmo dia → fica o último; cmc 0/null ignorado; locais separados), entradas (saldo zera no meio → só as posteriores; cancelado fora; saída fora), custo do prato (soma; insumo sem custo vai para `semCusto` e entra com 0).
- [ ] Step 2: FAIL. Step 3: implementar. Step 4: PASS + tsc. Step 5: commit `feat(estoque): custo do produto (grafico do custo medio, entradas e custo do prato)`.

### Task 6: Saldo em data na `/estoque`

**Files:** Create `lib/estoque/saldo-data-puro.ts` + `.test.ts`, `components/estoque-proprio/SeletorData.tsx`; Modify `app/(app)/estoque/page.tsx`, `app/(app)/estoque/dados-omie.ts` (`carregarSaldoEmData`)

**Interfaces — Produces:**
```ts
export function avaliarDataSaldo(data: string, desde: string | null, hoje: string): { ok: true } | { ok: false; motivo: 'invalida' | 'futuro' | 'sem_historico' | 'antes_cobertura' }
export type LinhaSaldoData = { n_cod_prod: number; codigo_local_estoque: number; saldo: number | null; cmc: number | null; data_mov: string }
export function aplicarSaldoEmData<L extends { codigoProduto: number; locais: { codigoLocal: number; saldo: number; minimo: number | null; local: string }[]; minimo: number | null }>(linhas: L[], rows: LinhaSaldoData[]): (L & { saldo: number; cmc: number; valor: number; situacao: 'negativo'|'zerado'|'baixo'|'ok'; ultimoMov: string })[]
```
`aplicarSaldoEmData`: só produtos com linha no kardex até a data; saldo = soma dos locais; cmc = último cmc > 0 entre os locais (data_mov mais recente); valor = Σ saldo_local × cmc_local (cmc fora de (0, 1e7) vale 0); situação pela regra de `situacaoDe` (copiada, sem import).
Página: `?data=YYYY-MM-DD` (só loja Omie). `SeletorData` (client: `<input type="date">` + "Hoje" limpa o parâmetro). Com data válida: as linhas vêm de `aplicarSaldoEmData`, a faixa mostra "Saldo em dd/mm/aaaa pelo kardex do Omie · histórico completo desde dd/mm. Produtos sem movimento desde então não aparecem." e esconde `ModalEntrada`/negativos-top continuam. Data inválida → aviso âmbar com o motivo e a tela segue no saldo de hoje. RPC: `buscarTodasLinhas((from,to) => supabase.rpc('saldo_em_data', { p_loja_id, p_data }).order('n_cod_prod').order('codigo_local_estoque').range(from,to))` (chave única da função). Erro da RPC (migration 160 não aplicada) → aviso "Saldo em data ainda não ativado". Loja própria: seletor não aparece (Ruling: o ledger próprio já tem saldo por movimento; fora do escopo).

- [ ] Step 1: testes `avaliarDataSaldo` (futuro; antes do desde; sem desde; formato inválido; = desde ok; = hoje ok), `aplicarSaldoEmData` (2 locais somam; cmc do mov mais recente; cmc 2e7 vale 0 no valor; produto sem linha some).
- [ ] Step 2: FAIL. Step 3: implementar. Step 4: PASS + tsc. Step 5: commit `feat(estoque): saldo em qualquer data na tela de Estoque (kardex do Omie)`.

### Task 7: OPs abertas `/ordem-producao/abertas`

**Files:** Create `lib/estoque/ops-tela-puro.ts` + `.test.ts`, `app/(app)/ordem-producao/abertas/page.tsx`; Modify `app/(app)/ordem-producao/page.tsx` (link "OPs abertas" no cabeçalho)

**Interfaces — Produces:**
```ts
export function idadeDias(dtInclusao: string | null, hoje: string): number | null
export function itensDaOPGravada(fullObject: unknown): { insumo: number; quantidade: number; local: number | null }[] // itensDetalhes[].nIdProdutoMalha/nQtde/codigo_local_estoque
export type SituacaoOP = 'sobrando' | 'faltando' | 'ok' | null
export function situacaoDaOP(origem: string | null, saldoProduto: number | null): SituacaoOP // cupom & saldo ≥ 0 → sobrando; saldo < 0 → faltando (produto ainda negativo mesmo com OP aberta: falta concluir); senão ok; saldo desconhecido → null
export const ROTULO_ORIGEM_OP: Record<string, string> // vendas: 'Norte Vendas', app: 'Este app', script: 'Script', cupom: 'Cupom (PDV)', manual: 'Tela do Omie'
```
Página: lê loja (`is_test, modo_estoque, espelho_completo`), OPs (`buscarTodasLinhas`, `.order('id')`): Omie com flag → `aberta_omie = true`; Omie sem flag → `concluida` não true + aviso "espelho completo desligado nesta loja: lista pode estar incompleta"; própria → `concluida` não true (autor = `criada_por`, origem = `venda_ref` ? 'vendas' : 'app'). Saldo dos produtos: visão do estoque (Omie: `carregarEstoqueOmie`; própria: `carregarEstoque`). Filtros na URL: `q` (produto/número), `origem`, `autor`, `sit` (sobrando|faltando|velha), paginação em memória 50. Cartões: abertas, sobrando, faltando, mais de 7 dias. Linha: número, produto (link `/estoque/produto`), qtd, previsão, origem, autor, idade ("há N dias"), local, situação; `<details>` "Ficha gravada na OP" com insumos (nome, qtd, local) quando `itens_consultados_em`/itensDetalhes existir, senão "ainda não lida do Omie". Link para `/ordem-producao/<id>`.

- [ ] Step 1: testes das 3 funções (idade com virada de mês; itensDetalhes ausente/malformado → []; situações).
- [ ] Step 2: FAIL. Step 3: implementar. Step 4: PASS + tsc. Step 5: commit `feat(op): tela OPs abertas (origem, autor, idade, ficha da OP, sobrando/faltando)`.

### Task 8: Fichas `/estoque/fichas`

**Files:** Create `lib/estoque/fichas-tela-puro.ts` + `.test.ts`, `app/(app)/estoque/fichas/page.tsx`

**Interfaces — Produces:**
```ts
export type LinhaFichaTela = { produto: number; insumo: number; quantidade: number; perda: number; unidade: string | null; local: number | null; localFonte: string | null; alteradoPor: string | null; alteradoEm: string | null; incluidoPor: string | null; incluidoEm: string | null }
export type FichaAgrupada = { produto: number; itens: LinhaFichaTela[]; ultimaAlteracao: string | null; autor: string | null }
export function agruparFichas(linhas: LinhaFichaTela[]): FichaAgrupada[] // autor = quem alterou por último (alterado ?? incluido), data mais recente
export function ondeEUsado(linhas: LinhaFichaTela[], insumo: number): { produto: number; quantidade: number; local: number | null }[]
```
Página: modo `?insumo=<cod>` ("Onde é usado": lista de pratos com qtd e local) e modo lista (busca `q` por prato ou insumo, paginação 30 fichas, cada ficha em cartão com tabela de insumos: insumo (link "onde é usado"), quantidade+unidade, perda, local de consumo (+ "(da última OP)" se `local_fonte = 'op'`), alterado por/em). Topo: "N fichas lidas de M produtos de produção (PA/PI)" via `estrutura_produto_sync`. Omie: `estrutura_produto_cache` (todas as colunas da 160; se der erro de coluna → refaz select sem as colunas novas e avisa "migration 160 pendente"). Própria: `fichas_tecnicas` ativas + `ficha_tecnica_itens` (qtd = bruta/rendimento, perda = perda_pct, autor = `criada_por`, data = `created_at`, local = null com nota "no estoque próprio o local de consumo é escolhido na produção").

- [ ] Step 1: testes `agruparFichas` (autor/data mais recente; ordem por nome feita na página — aqui por produto), `ondeEUsado` (soma nada, lista cada prato uma vez).
- [ ] Step 2: FAIL. Step 3: implementar. Step 4: PASS + tsc. Step 5: commit `feat(estoque): tela de fichas com local de consumo, autor e onde e usado`.

### Task 9: Ajustes `/estoque/ajustes`

**Files:** Create `lib/estoque/ajustes-tela-puro.ts` + `.test.ts`, `app/(app)/estoque/ajustes/page.tsx`

**Interfaces — Produces:**
```ts
export type AjusteTela = { id: number; data: string; produto: number; local: number | null; tipo: string; quantidade: number; custoUnit: number | null; autor: string | null; origem: string | null; motivo: string | null; obs: string | null }
export function valorDoAjuste(a: Pick<AjusteTela, 'quantidade' | 'custoUnit' | 'tipo'>): number // |qtd| × custo; SLD → 0 (contagem, não movimento — AGENTS "trap do SLD")
export function custoForaDoNormal(custoUnit: number | null, cmcAtual: number | null): 'alto' | 'vezes' | null // ≥ 1000; ou cmcAtual > 0 e custo ≥ 20× cmcAtual ou ≤ cmcAtual/20
export const ROTULO_ORIGEM_AJUSTE: Record<string, string> // app 'Este app', script 'Script', pdv 'Venda (PDV)', api 'Integração', omie 'Tela do Omie'
export const ROTULO_TIPO_AJUSTE: Record<string, string> // ENT Entrada, SAI Saída, SLD Contagem (inventário), TRF Transferência
```
Página: período (padrão 30 dias, máx. 92), filtros `q` produto, `autor`, `origem`, `tipo`, `fora=1` (só custo fora do normal); exclui vendas do PDV (`motivo = 'PDV'` ou `origem = 'PDV'`) — Ruling: venda não é ajuste; lê o período inteiro (`buscarTodasLinhas`, `.order('id')`, filtros no banco por data e `.or('motivo.is.null,motivo.neq.PDV')`), filtra/ordena (data desc) em memória e pagina 50. Cartões: ajustes, valor das entradas, valor das saídas, custo fora do normal. Linha: data/hora Bahia, produto (link), local, tipo, quantidade, custo unit. (destaque `text-err` + pílula "custo fora do normal" com dica "custo médio atual R$ x"), valor, autor (ou "não identificado"), origem, motivo/obs. Própria: `estoque_movimentos` tipo `AJU` + origem `AJUSTE_MANUAL`/`INVENTARIO` (autor = nome do `profiles` para uuid; senão o próprio texto), custo = `custo_unitario ?? cmc_apos`.

- [ ] Step 1: testes `valorDoAjuste` (SLD 0; SAI negativa → positivo), `custoForaDoNormal` (1000 → alto; 20× → vezes; 1/20 → vezes; cmc 0 → só regra do 1000; null → null).
- [ ] Step 2: FAIL. Step 3: implementar. Step 4: PASS + tsc. Step 5: commit `feat(estoque): tela de ajustes com autor, valor e custo fora do normal`.

### Task 10: Quem mexeu `/estoque/quem-mexeu`

**Files:** Create `lib/estoque/quem-mexeu-puro.ts` + `.test.ts`, `app/(app)/estoque/quem-mexeu/page.tsx`

**Interfaces — Produces:**
```ts
export type EventoTipo = 'ajuste' | 'op' | 'ficha'
export type Evento = { pessoa: string | null; quando: string /*ISO date ou datetime*/; tipo: EventoTipo; titulo: string; detalhe: string; href: string | null }
export function chavePessoa(nome: string | null): string // trim, sem acento, minúsculas, espaços únicos; vazio → '(sem nome)'
export function resumoPorPessoa(ev: Evento[]): { chave: string; nome: string; total: number; porTipo: Record<EventoTipo, number>; ultimo: string }[] // nome = grafia mais frequente; ordem total desc
export function linhaDoTempo(ev: Evento[], chave: string | null): { dia: string; eventos: Evento[] }[] // dias desc, eventos desc no dia
```
Página: período (padrão 7 dias, máx. 92). Omie: ajustes (`movimentos` com `autor`/`origem_ajuste`, sem PDV), OPs (`ordens_producao.incluido_por_omie`, `dt_inclusao` no período), fichas (`estrutura_produto_cache.alterado_por/alterado_em` e `incluido_por/incluido_em` no período, uma por produto+pessoa+dia). Própria: `estoque_movimentos` (user → nome), `op_historico` (`user_nome`, `evento`), `fichas_tecnicas.criada_por`. Lado esquerdo (ou topo no mobile): pessoas com total e chips por tipo (link `?pessoa=`); lado direito: linha do tempo agrupada por dia. Sem pessoa escolhida: linha do tempo de todos (até 300 eventos, aviso se cortou).

- [ ] Step 1: testes (`chavePessoa` junta "Carlos Marinho" e " carlos  marinho"; resumo usa grafia mais frequente; linha do tempo agrupa e ordena; `null` → "(sem nome)").
- [ ] Step 2: FAIL. Step 3: implementar. Step 4: PASS + tsc. Step 5: commit `feat(estoque): tela Quem mexeu (linha do tempo por pessoa)`.

### Task 11: AGENTS.md e verificação final

**Files:** Modify `AGENTS.md` (seção "Nosso Omie Fases 2 e 3": telas, fontes, limiares, migration 161, deploy).

- [ ] Rodar todos os `node --test lib/estoque/*.test.ts lib/*.test.ts`; `npx tsc --noEmit`; `npm run build`; `npm run lint -- <arquivos novos>`.
- [ ] Commit `docs: AGENTS.md - telas das Fases 2 e 3 do nosso Omie`.
