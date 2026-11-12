# Plataforma Norte · Fase 1: assinaturas e bloqueio no ERP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada loja do ERP passa a ter um estado por módulo (dashboard, erp, cozinha, pacioli, vendas) que decide o que o menu mostra, quais rotas abrem e se dá para lançar, com uma tela da Norte para mudar isso, sem mudar nada para nenhuma loja até alguém mexer.

**Architecture:** Tabelas `plataforma_*` no banco do ERP guardam só as exceções; uma regra pura calcula o estado efetivo (padrão por módulo quando não há linha) e o acesso da pessoa (`abre`, `consulta`, `vitrine`). O layout do app é o ponto único de bloqueio das rotas (via cabeçalho com a rota posto pelo `proxy.ts`), o menu filtra pelo mesmo cálculo, e as server actions ganham uma segunda linha de guarda inserida por script. Erro de leitura das tabelas = falha aberta (padrão).

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (PostgREST + RLS), `node --test` para regras puras, migrations SQL aplicadas à mão no Contabo.

**Spec:** `docs/superpowers/specs/2026-11-12-plataforma-norte-modulos-design.md` · Roteiro: `docs/superpowers/plans/2026-11-12-plataforma-norte-roteiro.md`

## Global Constraints

- Regra de ouro: loja sem configuração = tudo como hoje (menu, rotas, ações).
- Estados: `ativo` (abre), `teste` (só desenvolvedores, `is_super_admin`), `bloqueado` (vitrine), `suspenso` (consulta sim, lançar não).
- Padrões sem linha gravada: `dashboard` ativo; `erp` ativo; `cozinha` teste; `pacioli` ativo nas lojas 5 e 2 (hoje em `lib/pacioli.ts`), bloqueado nas outras, mas aberto para `Admin` e super admin como hoje; `vendas` ativo (não é aplicado no ERP nesta fase).
- Tabelas no esquema `public` com prefixo `plataforma_` (o PostgREST só expõe `public`; decisão do construtor registrada no desenho).
- Gravação só por server action com `createServiceClient()`, depois de `exigirDevAcao()`.
- Migration só aditiva; aplicar à mão (`docker exec -i supabase-db psql -U supabase_admin -d postgres`), conferir com `\d`, depois `desktop/scripts/gerar-schema.sh`.
- Arquivos puros (`*-puro.ts`) sem alias `@/`, testados com `node --test`.
- Texto da interface em PT-BR, frase normal, sem caixa alta.
- Deploy só de madrugada; tudo novo primeiro só para desenvolvedores.

## Review Focus

- Loja sem nenhuma linha em `plataforma_assinaturas` (todas hoje): menu e rotas idênticos aos de hoje, inclusive Pacioli para Admin e Cozinha só para dev. → teste em Task 2 (`padrões reproduzem o comportamento atual`).
- Tabela inacessível (migration não aplicada, app desktop offline, erro de rede): nada bloqueia, vale o padrão. → teste em Task 3 (`erro de leitura cai no padrão`).
- Rotas parecidas: `/pacioli` não pode capturar `/pacioli-x`, `/cozinha` não captura `/cozinhas`. → teste em Task 2 (`moduloDaRota casa por segmento`).
- Módulo suspenso: telas e ações de leitura continuam funcionando; só gravação recusa, com mensagem clara. → teste em Task 5 (`leitura passa em suspenso`).
- Vitrine e administração nunca ficam bloqueadas por módulo (senão ninguém volta). → teste em Task 2 (`rotas livres`).

---

### Task 1: Migration 475 (tabelas da plataforma)

**Files:**
- Create: `supabase/migrations/475_plataforma_modulos.sql`

**Interfaces:**
- Produces: tabelas `plataforma_modulos(id text pk, nome text, ordem int)`, `plataforma_planos(id text pk, modulo_id text fk, nome text, preco_mensal numeric(12,2) null, ativo bool)`, `plataforma_clientes(id bigserial pk, nome text)`, `plataforma_lojas(erp_loja_id bigint pk fk lojas, vendas_store_id uuid null, cliente_id bigint null fk)`, `plataforma_assinaturas(id bigserial pk, erp_loja_id bigint fk lojas, modulo_id text fk, estado text check in ('ativo','teste','bloqueado','suspenso'), plano_id text null fk, preco_combinado numeric(12,2) null, obs text null, atualizado_por text, updated_at timestamptz default now(), unique(erp_loja_id, modulo_id))`.

- [ ] **Step 1: Escrever a migration** com as tabelas acima; seed de `plataforma_modulos` (`dashboard` 0, `vendas` 1, `erp` 2, `cozinha` 3, `pacioli` 4) e `plataforma_planos` (`vendas-balcao`, `vendas-mesas`, `vendas-mais-10-mesas`, `erp`, `cozinha`, `pacioli`, todos com `preco_mensal` null); RLS no padrão da 473 (`select` para `(select usuario_e_admin()) or loja_id in (select usuario_lojas())` nas tabelas com loja; `modulos` e `planos` legíveis por `authenticated`); `revoke all from anon, authenticated`; `grant select to authenticated`; `grant all to service_role`; `notify pgrst, 'reload schema'`.
- [ ] **Step 2: Aplicar numa cópia local ou conferir sintaxe** com `psql -v ON_ERROR_STOP=1 -1` num Postgres local de teste (`docker run postgres:17`) com as funções `usuario_e_admin`/`usuario_lojas` criadas como `select true`/`select 1::bigint`. Expected: `COMMIT`.
- [ ] **Step 3: Commit** `feat(plataforma): migration 475 com módulos, planos e assinaturas`.

### Task 2: Regra pura dos módulos

**Files:**
- Create: `lib/plataforma/modulos-puro.ts`
- Test: `lib/plataforma/modulos-puro.test.ts`

**Interfaces:**
- Produces:
  - `type ModuloId = 'dashboard' | 'vendas' | 'erp' | 'cozinha' | 'pacioli'`
  - `type Estado = 'ativo' | 'teste' | 'bloqueado' | 'suspenso'`
  - `type Acesso = 'abre' | 'consulta' | 'vitrine'`
  - `const MODULOS: readonly { id: ModuloId; nome: string }[]` (nomes: "Início", "Norte Vendas", "Norte ERP", "Norte Cozinha", "Pacioli")
  - `estadoPadrao(modulo: ModuloId, lojaId: number | null): Estado`
  - `estadoEfetivo(gravado: Estado | undefined, modulo: ModuloId, lojaId: number | null): Estado`
  - `acesso(estado: Estado, modulo: ModuloId, quem: { superAdmin: boolean; admin: boolean }): Acesso`
  - `moduloDaRota(pathname: string): ModuloId | null` (`null` = rota livre)
  - `acessosDaLoja(gravados: Partial<Record<ModuloId, Estado>>, lojaId: number | null, quem: { superAdmin: boolean; admin: boolean }): Record<ModuloId, Acesso>`

- [ ] **Step 1: Escrever os testes**

```ts
test('padrões reproduzem o comportamento atual', () => {
  const dev = { superAdmin: true, admin: true }, admin = { superAdmin: false, admin: true }, comum = { superAdmin: false, admin: false }
  assert.equal(acessosDaLoja({}, 3, comum).erp, 'abre')
  assert.equal(acessosDaLoja({}, 3, comum).cozinha, 'vitrine')
  assert.equal(acessosDaLoja({}, 3, dev).cozinha, 'abre')
  assert.equal(acessosDaLoja({}, 3, comum).pacioli, 'vitrine')
  assert.equal(acessosDaLoja({}, 5, comum).pacioli, 'abre')
  assert.equal(acessosDaLoja({}, 3, admin).pacioli, 'abre')   // paridade com pacioliLiberado
  assert.equal(acessosDaLoja({}, 3, admin).cozinha, 'vitrine') // cozinha segue só dev
})
test('linha gravada vence o padrão', () => {
  assert.equal(acessosDaLoja({ cozinha: 'ativo' }, 3, { superAdmin: false, admin: false }).cozinha, 'abre')
  assert.equal(acessosDaLoja({ erp: 'suspenso' }, 3, { superAdmin: false, admin: false }).erp, 'consulta')
  assert.equal(acessosDaLoja({ erp: 'bloqueado' }, 3, { superAdmin: true, admin: true }).erp, 'vitrine')
})
test('moduloDaRota casa por segmento', () => {
  assert.equal(moduloDaRota('/cozinha'), 'cozinha')
  assert.equal(moduloDaRota('/cozinha/pratos/12'), 'cozinha')
  assert.equal(moduloDaRota('/cozinhas'), 'erp')
  assert.equal(moduloDaRota('/pacioli'), 'pacioli')
  assert.equal(moduloDaRota('/pacioli-x'), 'erp')
  assert.equal(moduloDaRota('/estoque/kardex'), 'erp')
  assert.equal(moduloDaRota('/home'), 'dashboard')
})
test('rotas livres', () => {
  for (const r of ['/modulos/cozinha', '/plataforma/modulos', '/usuario', '/loja', '/minha-loja', '/cargo', '/login', '/central']) assert.equal(moduloDaRota(r), null)
})
```

- [ ] **Step 2: Rodar e ver falhar** `node --test lib/plataforma/modulos-puro.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar** `lib/plataforma/modulos-puro.ts`. `acesso`: `ativo`→`abre`; `suspenso`→`consulta`; `teste`→`abre` só se `superAdmin`, senão `vitrine`; `bloqueado`→`vitrine` sempre. Paridade com `pacioliLiberado`: em `acessosDaLoja`, `pacioli` sem linha gravada e `quem.admin || quem.superAdmin` → `abre`. Rotas: `dashboard` = `/home`, `/resumo`; `cozinha` = `/cozinha`; `pacioli` = `/pacioli`; livres = `/modulos`, `/plataforma`, `/usuario`, `/loja`, `/minha-loja`, `/cargo`, `/login`, `/central`, `/api`; o resto `erp`.
- [ ] **Step 4: Rodar e ver passar.** Expected: todos PASS.
- [ ] **Step 5: Commit** `feat(plataforma): regra pura de módulos, estados e acesso`.

### Task 3: Leitura das assinaturas no servidor

**Files:**
- Create: `lib/plataforma/assinaturas.ts`

**Interfaces:**
- Consumes: `acessosDaLoja`, `ModuloId`, `Estado` (Task 2).
- Produces:
  - `carregarAcessos(): Promise<{ lojaId: number | null; acessos: Record<ModuloId, Acesso>; gravados: Partial<Record<ModuloId, Estado>> }>` (React `cache`, por requisição; usa `getProfile()`)
  - `exigirModulo(modulo: ModuloId): Promise<Acesso>` (para páginas: `vitrine` → `redirect('/modulos/' + modulo)`)
  - `exigirEscritaModulo(modulo: ModuloId): Promise<void>` (para ações: lança `Error('Este módulo não está liberado nesta loja.')` em `vitrine` e `Error('Módulo suspenso: dá para consultar, mas não lançar.')` em `consulta`)

- [ ] **Step 1: Implementar** lendo `plataforma_assinaturas` (`erp_loja_id = lojaId`, colunas `modulo_id, estado`) com `createClient()`. Qualquer `error` (tabela ausente, rede, desktop offline) → `gravados = {}` e `console.error` uma vez; nunca lança.
- [ ] **Step 2: Teste do caminho de erro** em `lib/plataforma/assinaturas-puro.test.ts` extraindo `gravadosDe(rows: {modulo_id: string; estado: string}[] | null, error: unknown): Partial<Record<ModuloId, Estado>>` para `lib/plataforma/assinaturas-puro.ts`:

```ts
test('erro de leitura cai no padrão', () => {
  assert.deepEqual(gravadosDe(null, { message: 'relation does not exist' }), {})
})
test('ignora módulo ou estado desconhecido', () => {
  assert.deepEqual(gravadosDe([{ modulo_id: 'erp', estado: 'suspenso' }, { modulo_id: 'x', estado: 'ativo' }, { modulo_id: 'cozinha', estado: 'talvez' }], null), { erp: 'suspenso' })
})
```

- [ ] **Step 3: Rodar** `node --test lib/plataforma/assinaturas-puro.test.ts` → PASS; `node_modules/.bin/tsc --noEmit -p .` → sem erros.
- [ ] **Step 4: Commit** `feat(plataforma): leitura das assinaturas com falha aberta`.

### Task 4: Bloqueio das rotas e menu

**Files:**
- Modify: `proxy.ts` (pôr `x-ntb-rota: <pathname>` no request repassado)
- Modify: `app/(app)/layout.tsx` (ler `headers().get('x-ntb-rota')`, `moduloDaRota`, `carregarAcessos`; `vitrine` → `redirect('/modulos/<id>')`; passar `acessos` ao `AppShell`; `consulta` → faixa "Módulo suspenso" no topo)
- Modify: `lib/nav-visivel.ts` (`CtxVisibilidade.modulos?: Record<ModuloId, Acesso>`; em `navItemVisivel`, item cujo `moduloDaRota(n.href)` dá `vitrine` some), `lib/nav-visivel.test.ts` se existir, senão criar
- Modify: `components/shell/NavItems.ts` (item `/cozinha` perde `superAdmin`), `lib/recursos-dev.ts` e `lib/central/visibilidade.ts` (tirar `/cozinha` de `ROTAS_SO_DEV` e do espelho), `app/(app)/layout.tsx` (`pacioli={acessos.pacioli === 'abre'}` no lugar de `pacioliLiberado`)
- Modify: `app/(app)/cozinha/layout.tsx` (`exigirDev()` → `exigirModulo('cozinha')`), `app/(app)/pacioli/page.tsx` (idem `'pacioli'`)

**Interfaces:**
- Consumes: `carregarAcessos`, `exigirModulo` (Task 3), `moduloDaRota` (Task 2).

- [ ] **Step 1: Teste do menu** em `lib/nav-visivel.test.ts`: item `{ href: '/cozinha' }` com `ctx.modulos.cozinha = 'vitrine'` → `false`; com `'abre'` → `true`; sem `ctx.modulos` → comportamento atual (true).
- [ ] **Step 2: Rodar e ver falhar**, implementar, rodar e ver passar: `node --test lib/nav-visivel.test.ts lib/central/modulos.test.ts`.
- [ ] **Step 3: Conferir no navegador** (dev local contra a produção por túnel, conta QA, loja 19): sem linhas gravadas, menu igual ao de hoje; gravando `cozinha=bloqueado` para a loja 19 (direto no banco), `/cozinha` redireciona para `/modulos/cozinha` e o item some do menu.
- [ ] **Step 4: Commit** `feat(plataforma): rotas e menu do ERP respeitam o módulo`.

### Task 5: Guarda nas server actions

**Files:**
- Create: `lib/plataforma/acoes-modulo.ts` (`moduloDaAcao(arquivo: string): ModuloId | null` — `custo-cardapio`, `cozinha-*` → `cozinha`; `usuario`, `loja`, `cargo`, `cadastro`, `plataforma-*`, `loja-selector`, `minha-loja` → `null`; resto → `erp`)
- Create: `lib/plataforma/guarda.ts` (`guardaModulo(nomeAcao: string): Promise<void>`: `nomeAcao` = `'<arquivo>#<acao>'` igual ao do `viaDesktop`; resolve o módulo; se `politicaDe(nomeAcao) === 'leitura'` só barra `vitrine`; senão chama `exigirEscritaModulo`)
- Create: `scripts/inserir-guarda-modulo.mjs` (idempotente: em cada `lib/actions/*.ts` com `'use server'`, logo depois da linha do `viaDesktop`, insere `await guardaModulo('<nome>')` e o import; não duplica)
- Test: `lib/plataforma/acoes-modulo.test.ts`

- [ ] **Step 1: Testes**

```ts
test('módulo de cada arquivo de ação', () => {
  assert.equal(moduloDaAcao('cozinha-eventos'), 'cozinha')
  assert.equal(moduloDaAcao('custo-cardapio'), 'cozinha')
  assert.equal(moduloDaAcao('usuario'), null)
  assert.equal(moduloDaAcao('estoque-omie'), 'erp')
})
test('leitura passa em suspenso', () => {
  assert.equal(barraAcao('consulta', 'leitura'), false)
  assert.equal(barraAcao('consulta', 'fila'), true)
  assert.equal(barraAcao('vitrine', 'leitura'), true)
  assert.equal(barraAcao('abre', 'fila'), false)
})
```

(`barraAcao(acesso: Acesso, politica: string): boolean` vai em `lib/plataforma/acoes-modulo.ts`.)
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar** `node --test lib/plataforma/acoes-modulo.test.ts`.
- [ ] **Step 3: Rodar o script** `node scripts/inserir-guarda-modulo.mjs` e depois `node scripts/inserir-via-desktop.mjs` (registro continua igual). Expected: N linhas inseridas, segunda execução insere 0; `tsc` limpo.
- [ ] **Step 4: Commit** `feat(plataforma): ações recusam módulo bloqueado ou suspenso`.

### Task 6: Vitrine do módulo

**Files:**
- Create: `app/(app)/modulos/[id]/page.tsx`, `components/plataforma/Vitrine.tsx`

**Interfaces:**
- Consumes: `MODULOS`, `ModuloId` (Task 2), `carregarAcessos` (Task 3).

- [ ] **Step 1: Implementar** no visual aprovado (protótipo, tela "vitrine"): símbolo e cor do módulo, o que ele faz (3 itens, textos do protótipo), faixa azul-noite "Ainda não está na <loja>. Os seus dados já estão aqui: quando liberar, ele abre pronto." e botão "Falar com a Norte" (`https://wa.me/5571986660666`, texto "Quero liberar o <módulo> na <loja>"). Se o acesso for `abre`, redireciona para a rota do módulo. `id` desconhecido → `notFound()`.
- [ ] **Step 2: Conferir** `/modulos/cozinha`, `/modulos/pacioli`, `/modulos/xyz` (404) com a conta QA. Prints desktop e celular.
- [ ] **Step 3: Commit** `feat(plataforma): vitrine do módulo não contratado`.

### Task 7: Tela da Norte para módulos e preços

**Files:**
- Create: `app/(app)/plataforma/modulos/page.tsx`, `components/plataforma/MatrizModulos.tsx`, `components/plataforma/Precos.tsx`, `lib/actions/plataforma-modulos.ts`
- Modify: `components/shell/NavItems.ts` (item "Módulos das lojas", grupo Administração, `superAdmin: true`), `lib/recursos-dev.ts` + espelho (`/plataforma`)

**Interfaces:**
- Consumes: `MODULOS`, `estadoEfetivo`, `estadoPadrao` (Task 2).
- Produces: `salvarAssinatura(lojaId: number, modulo: ModuloId, dados: { estado: Estado | null; planoId: string | null; precoCombinado: number | null }): Promise<{ ok: true } | { error: string }>` (`estado: null` apaga a linha = volta ao padrão); `salvarPrecoPlano(planoId: string, preco: number | null): Promise<{ ok: true } | { error: string }>`.

- [ ] **Step 1: Implementar** a matriz (lojas reais primeiro, depois as de teste; colunas = módulos; cada célula = estado efetivo com o seletor e um selo "padrão" quando não há linha; coluna Vendas mostra o plano), legenda dos 4 estados e a grade de preços, no visual do protótipo (tela "Administração"). Ações: `exigirDevAcao()`, valida `lojaId` em `lojas`, `modulo` em `MODULOS`, `estado` em `Estado`, `preco` ≥ 0; grava com `createServiceClient()`, `atualizado_por` = id do usuário; `revalidatePath('/', 'layout')`.
- [ ] **Step 2: Rodar** `node scripts/inserir-via-desktop.mjs` e `node scripts/inserir-guarda-modulo.mjs` (arquivo `plataforma-modulos` é livre).
- [ ] **Step 3: Conferir** com a conta QA na loja 19: trocar Cozinha para bloqueado → vitrine; voltar ao padrão → abre; suspender ERP → banner e "Salvar" de uma ação de estoque recusa com a mensagem; leitura continua. Voltar tudo ao padrão no fim.
- [ ] **Step 4: Commit** `feat(plataforma): tela da Norte para módulos e preços`.

### Task 8: Fechamento e produção

**Files:**
- Modify: `AGENTS.md` (seção "Plataforma Norte: módulos por loja"), memória do projeto

- [ ] **Step 1: Verificar** `npm test`, `node_modules/.bin/tsc --noEmit -p .`, `node_modules/.bin/eslint` nos arquivos novos, `next build`. Expected: tudo limpo.
- [ ] **Step 2: Aplicar a 475 em produção** (madrugada), conferir `\d plataforma_assinaturas`; `desktop/scripts/gerar-schema.sh`.
- [ ] **Step 3: Deploy** (`/opt/ntb-estoque/deploy.sh`) de madrugada; conferir como QA: lojas 5, 15 e 3 com menu igual ao de antes; `/plataforma/modulos` abre.
- [ ] **Step 4: Commit da documentação** `docs(plataforma): fase 1 no ar`.
