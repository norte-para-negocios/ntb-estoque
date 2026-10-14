# Central de correções — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a Saúde do estoque por uma Central de correções (protótipo aprovado): problemas classificados com causa e R$, estado persistido no banco, painel universal com correção guiada que escreve no Omie pelas ações da Fase 4 + as novas (lançar OP de preparo/prato/cupom, zerar, não controla, pedir ao Ramon), busca rápida global e o log do robô.

**Architecture:** Toda regra (classificação, valor, causa em uma frase, prévia, estado efetivo, cupons sem OP, códigos de integração determinísticos, busca) em módulos puros `lib/correcoes/*-puro.ts` testados com `node --test`. Um loader servidor (`lib/correcoes/dados.ts`) lê tudo em paralelo (páginas em ondas + Contabo) e entrega ao classificador; a página é um Server Component que passa os problemas a um Client Component (`components/correcoes/Central.tsx`). O painel carrega sob demanda por server action (`carregarPainel`). Escritas novas num motor servidor (`lib/correcoes/op-central.ts`) com trava no banco (`central_op_lancada`, índice único) + `sync_trava`, uma escrita no Omie por vez.

**Tech Stack:** Next.js 16 (App Router, server actions), supabase-js/PostgREST, Postgres 17, API do Omie via `omieRequest`, Contabo frio (`buscarFrio`), Tailwind + `components/ui-kit`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-14-central-correcoes-design.md` (+ protótipo `scratchpad/prototipo-correcoes/index.html`).

## Global Constraints

- Worktree `/Users/joaquimsalles/Projects/ntb-estoque-central`, branch `central-correcoes` (base `origin/main` b785784).
- Proibido: aplicar migration, deploy, `git push`, chamar o Omie de verdade, escrever em produção. SELECT em produção para medir é ok.
- Migration nova numerada **171**, manual. Depois de aplicada: `desktop/scripts/gerar-schema.sh` + versão nova do desktop (registrar no relatório).
- `.range()` sempre com `.order(<coluna única>)`; `lojas` sempre com `is_test` no select; lista grande nunca em `.in()` na URL (lotes de 150); índice único parcial nunca com `.upsert()`.
- RLS nova no padrão initplan: `((select usuario_e_admin()) or loja_id in (select usuario_lojas()))`; escrita só service role (server action confere permissão antes).
- Toda escrita no Omie: loja `modo_estoque='omie'`, loja 4 bloqueada (`contextoEscritaOmie`), `is_test` = simulada, `registrarAuditoria`, 1 escrita por vez, parar no 1º `ehLimiteOmie`.
- Server action nova → `node scripts/inserir-via-desktop.mjs`; leitura em `lib/offline/politica.ts` (`leitura`); escritas da Central FORA da política (só com internet).
- Funções puras: sem `@/`, imports relativos com `.ts`, só `import type` de módulos com efeitos; `node --test`.
- Português simples, sem jargão; visual do protótipo (tokens do `globals.css`), mobile sem rolagem horizontal da página.
- Central < 1 s no servidor.

## Rulings (decisões sem perguntar)

- R1. Rota nova `/estoque/correcoes` ("Central de correções"); `/estoque/saude` faz `redirect('/estoque/correcoes')`; menu e `EstoqueAtalhos` trocam "Saúde" por "Correções". A tela antiga do robô continua em `/correcoes` (Administração) com o nome "Feito pelo robô".
- R2. Loja Omie: todos os grupos. Loja própria: negativos, custo e insumo sem custo pelo ledger (mesmas regras puras); OPs/cupons/contagem não se aplicam; ações de escrita só "Pedir ao Ramon"/"Ignorar"/"Marcar resolvido" (as escritas do modo próprio seguem nas telas de estoque, linkadas no painel).
- R3. Chave estável: `<grupo>:<tipo do alvo>:<id>[:<local>]` (`pa:produto:123`, `op:op:<nCodOP>`, `cupom:cupom:<n_id_cupom>`, `semcusto:produto:<insumo>:<local>`, `contagem:produto:<prod>:<local>`). OP usa `identificacao_n_cod_op` (estável entre syncs).
- R4. Grupos: tipo `04` → PA; `03` → PI; `99` → Taxas; demais (`00`,`01`,`02`,`07`,…) → "Insumos e revenda negativos (MP)". Taxas sempre por último; os outros por R$ em aberto.
- R5. Custo de referência = CMC se 0 < CMC < R$ 1.000 e não suspeito; senão custo pela ficha (Σ qtd × (1+perda%) × CMC do insumo, insumo com CMC fora de (0, 1.000) vale 0); senão 0. Valor: negativo = Σ|saldo negativo| × ref; custo = |saldo| × |CMC − ref| (ref = ficha, senão custo anterior), teto R$ 10 mi; OP = Σ insumo × ref do insumo (sem ficha: qtd × ref do produto); contagem = |para − de| × ref; cupom = Σ faltante × ref do prato; semcusto/taxa = 0.
- R6. Custo fora do normal = `custoAbsurdo` (≥ R$ 1.000 ou ≥ 20× o anterior) ou custo suspeito do espelho ou (PA/PI com ficha de custo > 0 e CMC ≥ 20× ou ≤ 1/20 do custo pela ficha).
- R7. OP aberta vira problema se: sobrando (origem cupom e saldo do local da OP ≥ 0), faltando (saldo do local < 0) ou velha (aberta há mais de 7 dias pela inclusão/previsão). Dependências: insumo com problema de custo aberto → "corrija antes o custo de X"; insumo sem custo no local → "o Omie recusa concluir (Client-193)".
- R8. Cupons sem OP: janela de 14 dias até agora − 2 h (a integração atrasa), cupons não cancelados (Contabo). Produto "com OP do PDV" = teve OP do PDV (cCodIntOP só dígitos, obs "Cupom N", origem `cupom`, ou `CP-`) nos últimos 60 dias **ou** ficha lida com itens, e tipo `04`/`03`. Por (dia, produto): cobertura = Σ qtd das OPs do PDV com previsão naquele dia; consumida pelos cupons em ordem de hora (FIFO); o que sobra é "sem OP". Um problema por cupom.
- R9. `cCodIntOP` determinístico: cupom `CP-<n_id_cupom base36>-<produto base36>` (≤ 20; se passar, `CP-` + hash); preparo/prato `CT-` + hash FNV de `loja|produto|data|quantidade` (13 caracteres base36). `origemDaOP` passa a classificar `CP-`/`CT-` como `app`, e `ehOPdoPDV` conta `CP-` como cobertura do cupom.
- R10. Motor de OP (`lancarOPCentral`): 1) já existe em `ordens_producao` com o código → só conclui se aberta; 2) insere `central_op_lancada` `incluindo` (23505: concluída → "já feito"; em andamento < 10 min → "outra aba"; senão retoma); 3) loja real: `ConsultarOrdemProducao {cCodIntOP}` antes de incluir quando retomando; 4) `IncluirOrdemProducao` ("já cadastrad"/"já existe" → consulta e segue); 5) `ConcluirOrdemProducao` com a data escolhida (≤ hoje); 6) `fetchOrdemProducao` (loja real); `concluida`, auditoria. Erro de limite → `parar: true`. Local: o da última OP do PDV do produto, senão o `local_estoque_cozinha_codigo` da loja, senão o padrão do Omie.
- R11. Permissões: escrita no Omie pela Central = nova `Correcoes - Executar` **e** a de sempre (`Ordens de Producao - Criar` + `- Concluir` para lançar OP; as ações da Fase 4 conferem as delas). Estados (Ramon/ignorar/resolver/reabrir) e "não controla" = `Movimentacoes` (quem vê a tela).
- R12. Estado efetivo: `ramon` fica até mudar; `ignorado` com `ate` volta a aberto depois de `ate`; `ignorado` sem `ate` volta a aberto se a assinatura mudou; `resolvido` vale até o fim do dia seguinte e, se o problema continua com a mesma assinatura depois disso, volta a aberto com aviso "voltou depois de resolvido em dd/mm". "Já resolvi no Omie" = `resolvido`; "Olhar outro dia" = `ignorado` até amanhã; "Não é problema" = `ignorado`.
- R13. "Marcar não controla estoque" grava em `estoque_nao_controla` (só local) e o produto some de todos os grupos.
- R14. Paginação por grupo no cliente (6 iniciais, "mostrar mais 10"): a lista de uma loja tem centenas de problemas (~150 KB), não milhares.
- R15. Busca de cupom: número (4–7 dígitos) procura nos cupons dos últimos 45 dias (só cabeçalhos, Contabo); `n_id_cupom` (≥ 9 dígitos) pelo atalho do frio. OP: `numerosCandidatos` (com/sem ano e zeros). Produto: nome/código. Nota: número/fornecedor.
- R16. Painel: produto = Movimentações dos últimos 60 dias pelo loader `carregarMovimentacoes` (`cod`, 200 linhas); OP = `movimentosDaOP`; nota = `movimentosDaNota`; cupom = `buscarFatCupomDetalhe` + OPs ligadas; ajuste/contagem = linha de `movimentos` + contagens do mesmo produto/local.
- R17. "Feito pelo robô" = `correcoes_automaticas` dos últimos 7 dias da loja, ligadas aos problemas por `produto_cod` (= `produtos.codigo` ou `codigo_produto`).
- R18. Medição: SQL das consultas da Central no servidor (`EXPLAIN ANALYZE` como `authenticated` com claims de um usuário da loja 5) + chamada ao frio no servidor; a página faz as leituras em 2 ondas paralelas.

## Review Focus

1. Duas abas (ou duplo clique) criando a OP do mesmo cupom → uma só (índice único em `central_op_lancada` + `cCodIntOP` determinístico + "já existe" do Omie) — teste de `decidirRetomadaOP` e `codIntOPCupom`.
2. Integração do PDV reprocessou depois da tela carregar → antes de incluir, o motor confere `ordens_producao` por produto+previsão do PDV naquele dia e recusa se a cobertura já fecha — teste de `coberturaAindaFalta`.
3. Cupom com o mesmo prato em duas linhas (Café ×2) → uma OP com a soma — teste em `cuponsSemOP`.
4. Problema resolvido que continua aparecendo porque o Omie ainda não foi relido → fica "Resolvido" até o fim do dia seguinte, depois reabre com aviso — teste de `estadoEfetivo`.
5. Contagem com unidade trocada (5 → 4.658) → sugere 4,658 e a prévia mostra a diferença certa — teste de `sugestaoContagem` e `previaAcao('corrigir_contagem')`.

---

## File Structure

- Create `lib/correcoes/formato.ts` (+test): `fmtQtd`, `fmtBRL`, `fmtBRLCurto`, `fmtData`, `b36`, `hashCurto`.
- Create `lib/correcoes/cupons-sem-op-puro.ts` (+test): `ehOPdoPDV`, `cuponsSemOP`, `codIntOPCupom`, `codIntOPCorrecao`, `coberturaAindaFalta`, `resumoCuponsPorDia`.
- Create `lib/correcoes/central-puro.ts` (+test): tipos, `custoRef`, `custoPelaFicha`, `classificarProblemas`, `assinatura`, `estadoEfetivo`, `resumoDoDia`, `comecePorAqui`, `ordenarGrupos`, `filtrarGrupo`, `sugestaoContagem`, `decidirRetomadaOP`.
- Create `lib/correcoes/causa-puro.ts` (+test): uma frase por grupo.
- Create `lib/correcoes/previa-puro.ts` (+test): `opcoesDoProblema`, `previaAcao`.
- Create `lib/correcoes/busca-puro.ts` (+test): `interpretarBuscaRapida`.
- Create `lib/correcoes/robo.ts` (+test): validação da ingestão (porta de `lib/correcoes.ts` antigo) + `ligarRoboAosProdutos`.
- Create `supabase/migrations/171_central_correcoes.sql`.
- Create `lib/correcoes/dados.ts` (servidor): `carregarCentral`.
- Create `lib/correcoes/painel-dados.ts` (servidor): `carregarPainelDados`.
- Create `lib/correcoes/op-central.ts` (servidor): `lancarOPCentral`.
- Create `lib/actions/central.ts` ('use server'): `carregarPainel`, `marcarEstadoProblema`, `marcarNaoControla`, `lancarOPCorrecao`.
- Create `app/(app)/estoque/correcoes/page.tsx`; modify `app/(app)/estoque/saude/page.tsx` (redirect).
- Create `components/correcoes/{Central,Hero,Comece,Grupo,Painel,CorrecaoGuiada,FeitoPeloRobo,icones}.tsx`, `components/correcoes/central.css`? (não: classes Tailwind + tokens).
- Port `app/(app)/correcoes/page.tsx`, `components/correcoes/CorrecaoItem.tsx`, `app/api/correcoes/ingest/route.ts`; modify `proxy.ts`, `components/shell/NavItems.ts`, `lib/resumo-dia.ts`, `lib/permissoes-catalogo.ts`, `lib/estoque/ops-abertas-puro.ts`, `components/estoque-proprio/EstoqueAtalhos.tsx`, `components/shell/{AppShell,BuscaGlobal}.tsx`, `lib/actions/busca-global.ts`, `lib/offline/politica.ts`, `AGENTS.md`.

---

### Task 1: Formatos e cupons sem OP (puros)

**Files:** Create `lib/correcoes/formato.ts`, `lib/correcoes/formato.test.ts`, `lib/correcoes/cupons-sem-op-puro.ts`, `lib/correcoes/cupons-sem-op-puro.test.ts`

**Interfaces — Produces:**
```ts
// formato.ts
export function fmtQtd(q: number | null, un: string | null): string        // '−11 un', '64,89 kg', '1,5 g'
export function fmtBRL(v: number): string                                    // 'R$ 1.589,01', '−R$ 3,00'
export function fmtBRLCurto(v: number): string                               // 'R$ 139,2 mil', 'R$ 1,2 mi', 'R$ 851'
export function fmtData(iso: string | null): string                          // 'dd/mm'
export function b36(n: number): string
export function hashCurto(s: string): string                                 // 13 chars base36, determinístico
// cupons-sem-op-puro.ts
export type ItemCupom = { nIdCupom: number; num: string | null; data: string; hora: string | null; produto: number; nome: string; quant: number }
export type OPPdv = { data: string; produto: number; qtd: number }
export type CupomSemOP = { nIdCupom: number; num: string | null; data: string; hora: string | null; itens: { produto: number; nome: string; quantidade: number }[] }
export function ehOPdoPDV(o: { cCodInt: string | null; obs?: string | null; origem?: string | null }): boolean
export function cuponsSemOP(itens: ItemCupom[], ops: OPPdv[], comOP: Set<number>, corte: string /* 'YYYY-MM-DDTHH:MM:SS' Bahia */): CupomSemOP[]
export function codIntOPCupom(nIdCupom: number, produto: number): string
export function codIntOPCorrecao(lojaId: number, produto: number, dataISO: string, quantidade: number): string
export function coberturaAindaFalta(vendido: number, coberto: number, pedido: number): boolean
export function resumoCuponsPorDia(c: CupomSemOP[]): { data: string; cupons: number; itens: number }[]
```

- [ ] Step 1: testes
```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtQtd, fmtBRL, fmtBRLCurto, fmtData, hashCurto } from './formato.ts'
test('formatos', () => {
  assert.equal(fmtQtd(-11, 'UN'), '−11 un'); assert.equal(fmtQtd(64.89, 'KG'), '64,89 kg'); assert.equal(fmtQtd(null, 'UN'), '—')
  assert.equal(fmtBRL(1589.01), 'R$ 1.589,01'); assert.equal(fmtBRL(-3), '−R$ 3,00')
  assert.equal(fmtBRLCurto(139200), 'R$ 139,2 mil'); assert.equal(fmtBRLCurto(1_250_000), 'R$ 1,3 mi'); assert.equal(fmtBRLCurto(851), 'R$ 851')
  assert.equal(fmtData('2026-10-08'), '08/10'); assert.equal(hashCurto('a').length, 13); assert.equal(hashCurto('x'), hashCurto('x')); assert.notEqual(hashCurto('x'), hashCurto('y'))
})
```
```ts
import { cuponsSemOP, codIntOPCupom, codIntOPCorrecao, ehOPdoPDV, coberturaAindaFalta, resumoCuponsPorDia, type ItemCupom } from './cupons-sem-op-puro.ts'
const it = (o: Partial<ItemCupom>): ItemCupom => ({ nIdCupom: 1, num: '100', data: '2026-10-13', hora: '12:00:00', produto: 10, nome: 'Moqueca', quant: 1, ...o })
test('PDV: numérico, Cupom N, origem cupom, CP-', () => {
  assert.ok(ehOPdoPDV({ cCodInt: '1559131' })); assert.ok(ehOPdoPDV({ cCodInt: 'X', obs: 'Cupom 206260' }))
  assert.ok(ehOPdoPDV({ cCodInt: 'X', origem: 'cupom' })); assert.ok(ehOPdoPDV({ cCodInt: 'CP-abc-def' }))
  assert.ok(!ehOPdoPDV({ cCodInt: 'NTB-1' })); assert.ok(!ehOPdoPDV({ cCodInt: null }))
})
test('FIFO por hora: manhã coberta, tarde sem OP; só produtos com OP do PDV', () => {
  const r = cuponsSemOP([
    it({ nIdCupom: 1, hora: '11:00:00' }), it({ nIdCupom: 2, hora: '15:00:00', num: '101' }),
    it({ nIdCupom: 2, hora: '15:00:00', num: '101', produto: 99, nome: 'Água' }),
  ], [{ data: '2026-10-13', produto: 10, qtd: 1 }], new Set([10]), '2026-10-13T23:00:00')
  assert.deepEqual(r, [{ nIdCupom: 2, num: '101', data: '2026-10-13', hora: '15:00:00', itens: [{ produto: 10, nome: 'Moqueca', quantidade: 1 }] }])
})
test('mesmo prato em duas linhas soma; cobertura parcial; corte de 2 h fora', () => {
  const r = cuponsSemOP([it({ quant: 1 }), it({ quant: 2 }), it({ nIdCupom: 3, hora: '22:30:00' })], [{ data: '2026-10-13', produto: 10, qtd: 1 }], new Set([10]), '2026-10-13T21:00:00')
  assert.equal(r.length, 1); assert.deepEqual(r[0].itens, [{ produto: 10, nome: 'Moqueca', quantidade: 2 }])
})
test('OP de outro dia não cobre', () => {
  assert.equal(cuponsSemOP([it({})], [{ data: '2026-10-12', produto: 10, qtd: 5 }], new Set([10]), '2026-10-14T00:00:00').length, 1)
})
test('códigos determinísticos e curtos', () => {
  assert.equal(codIntOPCupom(2302207100, 2796952545), codIntOPCupom(2302207100, 2796952545))
  assert.ok(codIntOPCupom(2302207100, 2796952545).startsWith('CP-')); assert.ok(codIntOPCupom(2302207100, 2796952545).length <= 20)
  assert.ok(codIntOPCupom(9e14, 9e14).length <= 20)
  const a = codIntOPCorrecao(5, 10, '2026-10-13', 2); assert.ok(a.startsWith('CT-') && a.length <= 20)
  assert.equal(a, codIntOPCorrecao(5, 10, '2026-10-13', 2)); assert.notEqual(a, codIntOPCorrecao(5, 10, '2026-10-13', 3))
})
test('cobertura ainda falta (PDV reprocessou?)', () => {
  assert.ok(coberturaAindaFalta(3, 1, 2)); assert.ok(!coberturaAindaFalta(3, 2, 2)); assert.ok(!coberturaAindaFalta(3, 3, 1))
})
test('resumo por dia', () => {
  assert.deepEqual(resumoCuponsPorDia([{ nIdCupom: 1, num: null, data: '2026-10-08', hora: null, itens: [{ produto: 1, nome: 'a', quantidade: 2 }] }]), [{ data: '2026-10-08', cupons: 1, itens: 2 }])
})
```
- [ ] Step 2: `node --test lib/correcoes/formato.test.ts lib/correcoes/cupons-sem-op-puro.test.ts` → FAIL.
- [ ] Step 3: implementar (FIFO: itens elegíveis ordenados por data, hora, nIdCupom; cobertura por `data|produto`; sobra agrupada por cupom e produto; cupons ordenados por data desc, hora desc). `coberturaAindaFalta(vendido, coberto, pedido)` = `coberto + pedido <= vendido + 1e-9`.
- [ ] Step 4: PASS. Step 5: commit `feat(correcoes): formatos e cupons sem OP (puros)`.

### Task 2: Classificador, estado e causa (puros)

**Files:** Create `lib/correcoes/central-puro.ts` (+test), `lib/correcoes/causa-puro.ts` (+test)

**Interfaces — Produces:**
```ts
export type Grupo = 'pa' | 'pi' | 'mp' | 'custo' | 'op' | 'contagem' | 'semcusto' | 'cupom' | 'taxa'
export type EstadoProblema = 'aberto' | 'resolvido' | 'ramon' | 'ignorado'
export type AcaoId = 'zerar' | 'contagem' | 'op_preparo' | 'op_prato' | 'ramon' | 'corrigir_custo' | 'concluir' | 'mudar_data' | 'excluir' | 'corrigir_contagem' | 'nao_controla' | 'criar_ops_cupom'
export type Alvo = { tipo: 'produto' | 'op' | 'cupom'; id: number }
export type Dependencia = { texto: string; chave?: string; alvo?: Alvo }
export type Problema = { chave: string; grupo: Grupo; alvo: Alvo; titulo: string; tag: string; causa: string; valor: number; valorRotulo: string; acoes: AcaoId[]; assinatura: string; depende: Dependencia[]; d: DadosProblema }
export type DadosProblema = { produto?: number; unidade?: string; tipo?: string | null; saldo?: number; cmc?: number; ref?: number; locaisNeg?: { local: number; nome: string; saldo: number }[]; local?: number; sugerida?: number; op?: OPAbertaC; sentido?: 'sobrando' | 'faltando' | 'velha'; contagem?: { de: number; para: number; data: string; sugerida: number | null }; pratos?: number[]; cupom?: CupomSemOP; desde?: string | null; notaPendente?: { id: number; numero: string } }
export type ProdutoC = { codigo: number; cod: string; nome: string; unidade: string; tipo: string | null; saldo: number; cmc: number; custoSuspeito?: boolean; locais: { local: number; saldo: number }[] }
export type OPAbertaC = { id: number; nCodOP: number | null; numero: string; produto: number | null; qtd: number; local: number | null; origem: string | null; previsao: string | null; inclusao: string | null; cupom: string | null; insumos: { produto: number; qtd: number }[] }
export type ItemFichaC = { insumo: number; qtd: number; perda: number; local: number | null }
export type EntradaCentral = {
  hoje: string; produtos: ProdutoC[]; nomesLocais: Map<number, string>; desde: Map<string, string>  // `${prod}:${local}`
  custoHist: Map<number, { atual: number; anterior: number | null }>; fichas: Map<number, ItemFichaC[]>; cmcLocal: Map<string, number>
  insumosInativos: Set<number>; opsAbertas: OPAbertaC[]; contagens: { produto: number; local: number; data: string; de: number; para: number }[]
  cuponsSemOP: CupomSemOP[]; notasPendentes: Map<number, { id: number; numero: string }>; naoControla: Set<number>; modo: 'omie' | 'proprio'
}
export const GRUPOS: Record<Grupo, { nome: string; sub: string }>
export function custoPelaFicha(itens: ItemFichaC[] | undefined, cmc: (p: number) => number): number
export function custoRef(p: ProdutoC, fichaCusto: number): number
export function sugestaoContagem(de: number, para: number): number | null      // para ≥ 1000 e para/de ≥ 500 → para/1000
export function classificarProblemas(e: EntradaCentral): Problema[]
export type RegistroEstado = { chave: string; estado: EstadoProblema; motivo: string | null; mensagem: string | null; acao: string | null; ate: string | null; assinatura: string | null; user_nome: string | null; atualizado_em: string }
export type EstadoEfetivo = { estado: EstadoProblema; reaberto: string | null; reg: RegistroEstado | null }
export function estadoEfetivo(reg: RegistroEstado | undefined, p: Problema, hoje: string, diaReg: (iso: string) => string): EstadoEfetivo
export function resumoDoDia(ps: { p: Problema; e: EstadoEfetivo }[], resolvidosHojeSumidos: number): { total: number; resolvidos: number; ramon: number; ignorados: number; abertos: number; emAberto: number; porGrupo: Record<Grupo, number> }
export function comecePorAqui(ps: { p: Problema; e: EstadoEfetivo }[], n?: number): Problema[]
export function ordenarGrupos(ps: { p: Problema; e: EstadoEfetivo }[]): Grupo[]
export type UIGrupo = { q: string; ordem: 'valor' | 'saldo' | 'nome'; filtro: 'aberto' | 'ramon' | 'feito' | 'todos' }
export function filtrarGrupo(ps: { p: Problema; e: EstadoEfetivo }[], g: Grupo, u: UIGrupo): { lista: { p: Problema; e: EstadoEfetivo }[]; contagem: Record<UIGrupo['filtro'], number> }
export function decidirRetomadaOP(r: { status: string; atualizadoEm: string } | null, agoraMs: number): 'novo' | 'feito' | 'em_andamento' | 'retomar'
// causa-puro.ts
export function causaNegativo(i: { grupo: 'pa' | 'pi' | 'mp'; saldo: string; locais: string; desde: string | null; cuponsSemOP: number; opAberta: string | null; notaPendente: string | null }): string
export function causaCusto(i: { cmc: string; ficha: string | null; vezes: number | null; anterior: string | null }): string
export function causaOP(i: { sentido: 'sobrando' | 'faltando' | 'velha'; desde: string | null; cupom: string | null; saldoLocal: string; qtd: string; insumos: string | null }): string
export function causaContagem(i: { de: string; para: string; data: string; sugerida: string | null }): string
export function causaSemCusto(i: { insumo: string; local: string; pratos: string[]; inativo: boolean }): string
export function causaTaxa(i: { saldo: string }): string
export function causaCupom(i: { num: string | null; data: string; hora: string | null; itens: string[] }): string
```

- [ ] Step 1: testes (`central-puro.test.ts`) — casos:
  - prato `04` saldo −11 no local 1 (CMC 5,28) → grupo `pa`, chave `pa:produto:10`, valor 58,08, ações `['zerar','op_prato','contagem','ramon']`; com 2 cupons sem OP do mesmo prato → `depende[0].texto` cita "2 cupons sem OP".
  - `03` → `pi` com `sugerida` = |saldo|; `01` → `mp`; `99` → `taxa` (ações `['nao_controla','ramon']`, valor 0); produto em `naoControla` some.
  - CMC 1589,01 (`03`, ficha custa 9,20) → problema `custo:produto:x` com valor = |saldo| × |1589,01 − 9,20|; CMC 0,0459 de insumo com anterior 0,04 → sem problema.
  - OP do cupom com saldo do local ≥ 0 → `op:op:<nCodOP>` sentido `sobrando`, ações começam com `excluir`; OP com insumo que tem problema de custo → `depende` com chave `custo:produto:<insumo>`; OP com 3 dias e saldo ≥ 0 de origem manual → nenhum problema; OP com 9 dias → `velha`.
  - contagem 5 → 4658 → `contagem:produto:p:1`, `sugerida` 4.658, valor = 4653 × ref.
  - insumo sem custo no local 1 usado em 2 pratos → `semcusto:produto:i:1`, `pratos` com 2; insumo inativo → chave `semcusto:produto:i:inativo`.
  - cupom sem OP → `cupom:cupom:<id>`, ações `['criar_ops_cupom','ramon']`, valor = Σ faltante × ref.
  - `sugestaoContagem(5, 4658)` = 4.658; `(5, 12)` = null.
  - `estadoEfetivo`: sem registro → aberto; ramon → ramon; ignorado `ate` ontem → aberto; ignorado sem `ate` e assinatura diferente → aberto com `reaberto`; resolvido ontem e mesma assinatura hoje → resolvido; resolvido anteontem e ainda aparece → aberto com `reaberto` = data.
  - `resumoDoDia` conta resolvidos/ramon/ignorados/abertos e soma `emAberto` só dos abertos; `comecePorAqui` devolve os 3 maiores abertos; `ordenarGrupos` põe `taxa` por último e os demais por R$ aberto; `filtrarGrupo` busca sem acento ("acai" acha "Açaí"), ordem por nome e contagem por filtro.
  - `decidirRetomadaOP(null)` → novo; `concluida` → feito; `incluindo` há 2 min → em_andamento; `incluindo` há 15 min ou `erro` → retomar.
- [ ] Step 2: testes de `causa-puro.test.ts` com a frase exata:
  - `causaNegativo({ grupo:'pa', saldo:'−11 un', locais:'Depósito', desde:'07/10', cuponsSemOP:2, opAberta:null, notaPendente:null })` = `'Saldo −11 un no Depósito, negativo desde 07/10. 2 cupons deste prato ficaram sem OP: a venda baixou o prato e não os insumos.'`
  - `causaNegativo({ grupo:'pi', saldo:'−64,89 kg', locais:'Depósito', desde:null, cuponsSemOP:0, opAberta:null, notaPendente:null })` = `'Saldo −64,89 kg no Depósito. Foi usado nos pratos sem OP de preparo lançada.'`
  - mp com nota: `'Saldo −1,84 kg no Depósito, negativo desde 10/10. Tem a nota 955667 esperando entrada no estoque.'`
  - `causaCusto({ cmc:'R$ 1.589,01/kg', ficha:'R$ 9,20', vezes:173, anterior:null })` = `'Custo médio de R$ 1.589,01/kg, 173 vezes o custo pela ficha (R$ 9,20). Costuma ser entrada com custo ou unidade errada.'`; sem ficha com anterior: `'Custo médio de R$ 600,00/un; antes era R$ 3,00. Costuma ser entrada com custo ou unidade errada.'`
  - `causaOP` sobrando: `'OP do caixa (cupom 206260) aberta desde 03/10, e o prato já tem saldo 3 un no local. Concluir agora deixaria sobra; excluir evita entrada em dobro.'`; faltando: `'Aberta desde 03/10. Concluir põe +232 un no saldo (hoje −10 un) e baixa os insumos (R$ 139,2 mil).'`; velha: `'Aberta desde 25/09 e ainda sem conclusão. Conclua com a data certa ou exclua se a produção não aconteceu.'`
  - `causaContagem({ de:'5 kg', para:'4.658 kg', data:'31/08', sugerida:'4,658 kg' })` = `'Contagem saltou de 5 kg para 4.658 kg em 31/08. Parece 4,658 kg digitado como 4.658 kg.'`
  - `causaSemCusto` = `'CARURU (PI) está sem custo no Depósito. Moqueca e Abará não concluem OP no Omie (erro Client-193) e saem mais baratos do que são.'`; inativo: `'X está inativo, mas continua na ficha de Moqueca e Abará. Troque o insumo na ficha.'`
  - `causaTaxa({ saldo:'−851 un' })` = `'Não é mercadoria: cada venda baixa o "estoque" e o saldo só desce (−851 un). Marcar como "não controla estoque" tira o item daqui.'`
  - `causaCupom` = `'Cupom 206453 de 12/10 às 15:20: Moqueca ×1, Abará ×2 sem OP. A venda baixou os pratos, mas os insumos não saíram.'`
- [ ] Step 3: FAIL → implementar → PASS. Step 4: commit `feat(correcoes): classificador, estado efetivo e causa em uma frase (puros)`.

### Task 3: Prévias, opções e busca (puros) + robô

**Files:** Create `lib/correcoes/previa-puro.ts` (+test), `lib/correcoes/busca-puro.ts` (+test), `lib/correcoes/robo.ts` (+test, porta de `ntb-estoque/lib/correcoes.ts` e `.test.ts`, mais `ligarRoboAosProdutos`)

**Interfaces — Produces:**
```ts
export type OpcaoDef = { acao: AcaoId; titulo: string; descricao: string; botao: string; campos: { id: string; rotulo: string; tipo: 'numero' | 'data' | 'texto'; sufixo?: string; inicial: string }[] }
export function opcoesDoProblema(p: Problema, hoje: string): OpcaoDef[]
export type Previa = { vazio: string } | { linhas: { rot: string; de: string; para: string }[]; omie: string; aviso?: string }
export function previaAcao(acao: AcaoId, p: Problema, v: Record<string, string>, ctx: { nome: (cod: number) => string; cmc: (cod: number) => number }): Previa
export function lerNumeroBR(s: string): number | null      // '4,658' → 4.658; '1.234,5' → 1234.5; '' → null
export function interpretarBuscaRapida(q: string): { texto: string; numerosOP: string[]; cupomNum: string | null; nIdCupom: number | null }
export function ligarRoboAosProdutos(linhas: { produto_cod: string }[], codPorCodigo: Map<string, number>): Map<number, number[]> // codigo_produto → índices
```
- [ ] Step 1: testes: `opcoesDoProblema` de PA começa por "Zerar o saldo" e PI por "Lançar OP de preparo" com quantidade sugerida e data de hoje; `previaAcao('zerar')` = linhas Saldo `−11 un → 0 un` e Valor e `omie` com "ajuste de entrada de 11 un"; `previaAcao('contagem', {contado:''})` → `vazio`; contagem 4 com saldo −11 → Diferença `+15 un`; `previaAcao('op_preparo', {qtd:'10', data:'2026-10-13'})` mostra saldo `−64,89 kg → −54,89 kg` e `omie` "Cria e conclui no Omie a OP de 10 kg … com data 13/10/2026"; `corrigir_contagem` com de 4658 para 4,658 → Diferença `−4.653,342 kg`; `concluir` de OP com risco de custo → `aviso`; `lerNumeroBR` casos; `interpretarBuscaRapida('2026/00396850')` traz `396850` em `numerosOP`; `('206453')` → `cupomNum '206453'` e `numerosOP` com `206453`; `('2302207100')` → `nIdCupom`; `('batata')` → só texto; validação da ingestão do robô (testes antigos portados).
- [ ] Step 2: FAIL → implementar → PASS. Step 3: commit `feat(correcoes): previas das correcoes, busca rapida e validacao do robo (puros)`.

### Task 4: Migration 171 + permissão + origem das OPs

**Files:** Create `supabase/migrations/171_central_correcoes.sql`; Modify `lib/permissoes-catalogo.ts`, `lib/estoque/ops-abertas-puro.ts` (+test)

Migration (resumo do que o arquivo contém, por inteiro):
```sql
insert into permissoes (nome) values ('Correcoes - Executar') on conflict (nome) do nothing;
-- 1. Log do robô (era a 156 local, número já usado no remoto)
create table if not exists public.correcoes_automaticas ( ...mesmas colunas e constraint de idempotência... );
-- índices (loja, origem_ts desc), (lote), parcial de decisão
-- RLS initplan + revoke escrita
-- 2. Estado de cada problema da Central
create table if not exists public.central_problema_estado (
  id bigserial primary key, loja_id bigint not null references public.lojas(id) on delete cascade, chave text not null,
  estado text not null check (estado in ('aberto','resolvido','ramon','ignorado')), motivo text, mensagem text, acao text,
  ate date, assinatura text, user_id uuid, user_nome text, criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(), unique (loja_id, chave));
-- 3. Produtos que não controlam estoque (só local)
create table if not exists public.estoque_nao_controla (loja_id bigint not null references public.lojas(id) on delete cascade,
  codigo_produto bigint not null, motivo text, user_id uuid, user_nome text, criado_em timestamptz not null default now(),
  primary key (loja_id, codigo_produto));
-- 4. OPs lançadas pela Central (trava de idempotência por cCodIntOP)
create table if not exists public.central_op_lancada (id bigserial primary key, loja_id bigint not null references public.lojas(id) on delete cascade,
  cod_int_op text not null, origem text not null check (origem in ('cupom','correcao')), codigo_produto bigint not null,
  quantidade numeric not null, data_op date not null, n_id_cupom bigint, n_cod_op bigint,
  status text not null check (status in ('incluindo','incluida','concluida','erro')), erro text, simulado boolean not null default false,
  user_id uuid, user_nome text, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  unique (loja_id, cod_int_op));
-- RLS initplan (select), escrita só service role, para as 3 tabelas.
```
`origemDaOP`: `/^(NTB|CP|CT)-/` → `app`.

- [ ] Step 1: teste em `ops-abertas-puro.test.ts`: `origemDaOP({ cCodIntOP: 'CP-abc-def' })` e `'CT-x'` → `'app'`. FAIL → implementar → PASS.
- [ ] Step 2: migration + catálogo (`{ nome: 'Correcoes - Executar', label: 'Corrigir pela Central de correções' }` no módulo "Escrever no Omie pela tela"). `npx tsc --noEmit`.
- [ ] Step 3: commit `feat(db): migration 171 (estado da Central, nao controla, OPs da Central, log do robo) e permissao Correcoes - Executar`.

### Task 5: Loader da Central

**Files:** Create `lib/correcoes/dados.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `carregarEstoqueOmieComPosicoes`, `carregarEstoque`, `carregarOPsAbertas`, `historicoKardexDesde`, saude-puro (`negativoDesde`, `ultimoCmcAnterior`, `oscilacoesContagem`, `cmcPorLocalAtual`, `insumosSemCustoNoLocal`), `buscarFatCupons`/`buscarFatCupomItens`, `itensDaOPGravada`.
- Produces:
```ts
export type ProblemaComEstado = { p: Problema; e: EstadoEfetivo }
export type DadosCentral = { lojaNome: string; modo: 'omie' | 'proprio'; hoje: string; itens: ProblemaComEstado[]; resumo: ReturnType<typeof resumoDoDia>; ordem: Grupo[];
  produtos: Record<number, { nome: string; cod: string; un: string; tipo: string | null; saldo: number; cmc: number }>; cuponsPorDia: { data: string; cupons: number; itens: number }[];
  robo: LinhaRobo[]; roboPorProduto: Record<number, number[]>; avisos: string[]; podeExecutar: boolean; tempos: Record<string, number> }
export async function carregarCentral(lojaId: number, modo: 'omie' | 'proprio'): Promise<DadosCentral>
```
Onda 1 (paralelo): visão+posições, OPs abertas, `historicoKardexDesde`, fichas (`estrutura_produto_cache`), `estrutura_produto_sync`, SLD 120 dias, estados, não controla, robô 7 dias, notas `c_etapa='40'` 30 dias com itens, cupons+itens 14 dias (Contabo), OPs do PDV 60 dias (`id, identificacao_c_cod_int_op, origem_op, obs_omie, identificacao_n_cod_produto, identificacao_n_qtde, identificacao_d_dt_previsao` com previsão ≥ hoje−60, páginas em ondas), loja (`nome`, `is_test`), permissão `Correcoes - Executar`. Onda 2: kardex dos produtos negativos (desde), entradas 60 dias (custo anterior), produtos inativos que estão em fichas. `tempos` mede cada onda (`performance.now()`), logado no servidor.

- [ ] Step 1: implementar; `npx tsc --noEmit`.
- [ ] Step 2: commit `feat(correcoes): loader da Central (leituras em paralelo)`.

### Task 6: Ações novas (servidor) + motor de OP

**Files:** Create `lib/correcoes/op-central.ts`, `lib/correcoes/painel-dados.ts`, `lib/actions/central.ts`; Modify `lib/omie/ordem-producao.ts` (`consultarOPPorCodInt`), `lib/offline/politica.ts`, `lib/offline/registro-acoes.ts` (gerado).

**Interfaces — Produces:**
```ts
// lib/actions/central.ts
export type RespostaCentral = { ok: true; aviso: string; simulado?: boolean } | { error: string; parar?: boolean }
export async function marcarEstadoProblema(i: { chave: string; estado: EstadoProblema; motivo?: string | null; mensagem?: string | null; acao?: string | null; ate?: string | null; assinatura?: string | null }): Promise<RespostaCentral>
export async function marcarNaoControla(i: { codigoProduto: number; motivo?: string | null; desfazer?: boolean }): Promise<RespostaCentral>
export async function lancarOPCorrecao(i: { origem: 'cupom' | 'correcao'; codigoProduto: number; quantidade: number; dataISO: string; nIdCupom?: number | null; chave?: string | null; assinatura?: string | null }): Promise<RespostaCentral>
export async function carregarPainel(alvo: { tipo: 'produto' | 'op' | 'nota' | 'cupom' | 'ajuste'; id: number }): Promise<PainelDados | { error: string }>
// lib/correcoes/painel-dados.ts
export type PainelDados = { tipo; id; titulo; subtitulo; kpis: { rot: string; valor: string; tom?: 'erro' }[]; resumo: BlocoPainel[]; movimentos: MovPainel[]; ligado: GrupoLigado[]; hrefPagina: string | null; avisos: string[] }
```
`lancarOPCorrecao`: `contextoEscritaOmie('Correcoes - Executar', 'Ordens de Producao - Criar', 'Ordens de Producao - Concluir')` → `lancarOPCentral`. Para cupom: relê no Contabo o item do cupom (`buscarFatCupomDetalhe`) e as OPs do PDV daquele dia/produto em `ordens_producao` e recusa se `coberturaAindaFalta` for falso ("a integração do PDV já criou"). Sucesso: marca o estado `resolvido` (`acao`), revalida `/estoque/correcoes`.

- [ ] Step 1: `consultarOPPorCodInt(loja, cCodIntOP)` (`ConsultarOrdemProducao {cCodIntOP}`; "não cadastrad"/"não encontrad" → null).
- [ ] Step 2: motor + actions + painel; `node scripts/inserir-via-desktop.mjs`; `politica.ts`: `central#carregarPainel` em `leitura`; `npx tsc --noEmit`.
- [ ] Step 3: commit `feat(correcoes): acoes da Central (estado, nao controla, lancar OP idempotente) e painel sob demanda`.

### Task 7: Tela da Central (UI)

**Files:** Create `app/(app)/estoque/correcoes/page.tsx`, `components/correcoes/{Central,Hero,Comece,Grupo,Painel,CorrecaoGuiada,FeitoPeloRobo,ui}.tsx`; Modify `app/(app)/estoque/saude/page.tsx` (redirect), `components/estoque-proprio/EstoqueAtalhos.tsx`, `components/shell/NavItems.ts`, `lib/permissoes-catalogo.ts` (MENU_PERMISSAO da rota nova), `lib/nav-ativo` (sem mudança).

Comportamento (igual ao protótipo): hero (anel resolvidos/ignorados/Ramon, legenda, R$ em aberto, chips que abrem o grupo), "Comece por aqui" (3 cartões), grupos colapsáveis (estado de aberto em `localStorage`, só conveniência), busca/ordem/filtro por grupo, "mostrar mais", item → painel. Painel: pilha (voltar, migalhas), abas Resumo/Movimentos/Ligado a, busca nos movimentos, bloco do problema (troca entre problemas do mesmo alvo), dependências com link, opções (radio), campos, prévia ao vivo, confirmação escura ("Confirme: …"), feito/desfazer (reabrir), ignorar com motivos, toast com Desfazer (para estados). Ações: `zerar` → `ajusteOmie({ novoSaldo: 0 })` local a local; `contagem` → `ajusteOmie({ novoSaldo })`; `corrigir_contagem` → `ajusteOmie({ diferenca })`; `op_preparo`/`op_prato` → `lancarOPCorrecao`; `concluir`/`excluir`/`mudar_data` → `acaoOPLote`; `corrigir_custo` → lista os ajustes de entrada candidatos (do painel) com `corrigirCustoAjuste`; `criar_ops_cupom` → `lancarOPCorrecao` item a item; `nao_controla` → `marcarNaoControla`; `ramon` → `marcarEstadoProblema('ramon', mensagem)`. Depois de escrever no Omie: `marcarEstadoProblema('resolvido', acao)` e `router.refresh()`. Grupo de cupons: faixa âmbar fixa "A integração do PDV pode reprocessar sozinha; confira antes", resumo por dia e botão "Criar OPs que faltam (N)" (confirmação, 1 por vez, para no `parar`, lista do resultado). Celular: painel vira folha de baixo com alça de arrastar.

- [ ] Step 1: implementar; `npx tsc --noEmit`; `npm run build`.
- [ ] Step 2: commit `feat(correcoes): tela Central de correcoes com painel universal e correcao guiada`.

### Task 8: Busca rápida global

**Files:** Modify `lib/actions/busca-global.ts`, `components/shell/BuscaGlobal.tsx`, `components/shell/AppShell.tsx`

`BuscaItem` ganha `tipo: 'Produto' | 'OP' | 'Nota' | 'Cupom'`, `alvo?: { tipo: 'produto'|'op'|'nota'|'cupom'; id: number }`. Produto → `/estoque/produto/<codigo_produto>` (loja com estoque) senão `/produto?q=`; OP por `numerosCandidatos` (`identificacao_c_num_op.ilike`/`num_ordem`/`identificacao_n_cod_op.eq`) → `/ordem-producao/<id>`; nota → `/nota-fiscal/<id>`; cupom (R15) → `/faturamento/cupom/<n_id_cupom>`. `AppShell`: ⌘K/Ctrl+K também abre. `BuscaGlobal`: setas ↑↓, Enter, grupos (incl. Cupons); ao escolher, dispara `CustomEvent('ntb:abrir-painel', { cancelable: true, detail: alvo })`; se a Central tratou (`defaultPrevented`), não navega.

- [ ] Step 1: teste puro já coberto (Task 3). Implementar; `node scripts/inserir-via-desktop.mjs` (sem ação nova); `npx tsc --noEmit`.
- [ ] Step 2: commit `feat(busca): busca rapida com OP sem ano, cupom, teclado e abre o painel na Central`.

### Task 9: Log do robô (porta do checkout antigo)

**Files:** Create `app/(app)/correcoes/page.tsx`, `components/correcoes/CorrecaoItem.tsx`, `app/api/correcoes/ingest/route.ts` (adaptados: imports de `@/lib/correcoes/robo`, mensagem "migration 171"); Modify `proxy.ts`, `components/shell/NavItems.ts` (`/correcoes` "Feito pelo robô"), `lib/resumo-dia.ts` (contador), `lib/permissoes-catalogo.ts` se necessário.

- [ ] Step 1: portar; ingest resolve a loja com `.eq('ativo', true).eq('is_test', false)` (lição do webhook); `npx tsc --noEmit`.
- [ ] Step 2: commit `feat(correcoes): log do robo (tela /correcoes, ingestao e contador do painel)`.

### Task 10: Fechamento, medição, documentação e revisão

- [ ] `node --test lib/correcoes/*.test.ts lib/estoque/*.test.ts lib/movimentacoes/*.test.ts`; `npx tsc --noEmit`; `npm run build`.
- [ ] Medir (R18) e registrar no AGENTS.md: seção "Central de correções (14/10/2026)" (telas, regras, tabelas, ações, permissões, 171, rulings, deploy: aplicar 171 → deploy → `gerar-schema.sh` + versão do desktop → dar `Correcoes - Executar` aos cargos; testar na loja de teste da Donana PF).
- [ ] Commit `docs: AGENTS.md - Central de correcoes`.
- [ ] Revisor único (subagente, opus): escrita perigosa no Omie (duplicar OP, loja errada, is_test, corrida entre abas) e desempenho. Corrigir Critical/Important com teste; commit.
