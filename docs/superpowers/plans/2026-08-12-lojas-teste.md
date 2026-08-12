# Lojas de Teste (NTB Estoque) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada loja ativa ganha uma "loja teste" gêmea que faz tudo que
a loja real faz, pode ler dado real da Omie, mas nunca escreve nada de
volta — sandbox completo por loja.

**Architecture:** Uma coluna nova (`is_test`) em `lojas` + um gate
central em `omieRequest` (`lib/omie/client.ts`) que intercepta qualquer
chamada de ESCRITA quando a loja é de teste, devolvendo uma resposta
sintética em vez de ligar pra Omie de verdade. `is_test` vira campo
OBRIGATÓRIO no tipo `LojaOmie`/`OmieRequestParams` — isso faz `tsc`
apontar, um por um, todos os ~47 pontos do código que precisam propagar
esse dado, sem depender de auditoria manual. Ver spec completa:
`docs/superpowers/specs/2026-08-12-lojas-teste-design.md`.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres
self-hosted no Contabo).

## Global Constraints

- Produção real, sem staging.
- `npx tsc --noEmit` limpo antes de cada commit de código.
- Migration aplicada manualmente via SSH: `ssh -i
  ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i
  supabase-db psql -U supabase_admin -d postgres" < arquivo.sql`.
- Deploy: `git push origin main` + SSH síncrono (`ssh -i
  ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque &&
  bash deploy.sh"`) + confirmar `curl -s -o /dev/null -w "HTTP
  %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login`
  (esperar 200) + confirmar commit no servidor via `git log --oneline
  -1`.
- **Sequenciamento crítico**: Tasks 1-3 (schema + gate + wiring)
  precisam estar 100% completas, com `tsc` limpo, ANTES do deploy (Task
  4). Nunca fazer deploy parcial que deixe uma loja de teste existindo
  em produção sem o gate funcionando — risco real de escrita acidental
  na Omie de verdade, com credenciais reais.
- `is_test` é OBRIGATÓRIO (não opcional) em `LojaOmie`/
  `OmieRequestParams` — é essa decisão que torna a Task 3
  auto-verificável via `tsc`. Não mude pra opcional achando que
  simplifica — isso reabriria exatamente o risco que essa decisão evita
  (um call site esquecido, silenciosamente sem bloqueio).
- Não mexe no "Sertão Teste" estreito já existente
  (`ordens_producao_teste`, migration 108, rota
  `/api/integracao/ordem-producao-teste`) — projeto paralelo, sem
  relação com este.
- Não expande pra NTB Vendas nesta rodada.

---

## Task 1: Migration — `is_test`/`loja_origem_id` + criar as 6 lojas teste + excluir da automação/seletor

**Files:**
- Create: `supabase/migrations/117_lojas_teste.sql`
- Modify: `lib/omie/sync-all.ts` (função `getLojasAtivas`)
- Modify: `app/(app)/layout.tsx`
- Modify: `lib/auth.ts` (função `getAtorGestao`)

**Interfaces:**
- Produces: coluna `lojas.is_test boolean not null default false` e
  `lojas.loja_origem_id bigint references lojas(id)` — usadas por
  praticamente todas as tasks seguintes.

**A migration** (confirme antes que 117 é o próximo número livre: `ls
supabase/migrations/ | sort -V | tail -3`):

```sql
-- Lojas de Teste (2026-08-12) -- ver docs/superpowers/specs/
-- 2026-08-12-lojas-teste-design.md. Cada loja ativa ganha uma gêmea de
-- teste: mesmas credenciais Omie (pra leitura trazer dado real), mas
-- todo INSERT/ALTERAR/EXCLUIR/CONCLUIR/REVERTER na Omie é bloqueado
-- pelo gate central em lib/omie/client.ts (ver migration/task
-- seguinte) -- aqui só criamos as linhas, o bloqueio de escrita ainda
-- não existe até a Task 2 estar deployada junto.

alter table lojas add column if not exists is_test boolean not null default false;
alter table lojas add column if not exists loja_origem_id bigint references lojas(id);

insert into lojas (nome, nome_fantasia, cnpj, omie_app_key, omie_app_secret, ativo, is_test, loja_origem_id)
select
  nome,
  '[TESTE] ' || coalesce(nome_fantasia, nome),
  cnpj,
  omie_app_key,
  omie_app_secret,
  true,
  true,
  id
from lojas
where ativo = true and is_test = false;
```

- [ ] **Step 1: Confirmar o schema real de `lojas` antes de escrever a migration**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c '\\d lojas'"
```

Confirme que `nome`, `cnpj` são `not null` (o `INSERT` acima já cobre os
dois) e que não existe nenhuma outra coluna `not null` sem default que
precisaria ser preenchida. Se houver, ajuste o `INSERT` antes de
aplicar.

- [ ] **Step 2: Escrever o arquivo da migration** com o SQL acima
exatamente.

- [ ] **Step 3: Aplicar via SSH**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d postgres" < supabase/migrations/117_lojas_teste.sql
```

Esperado: `ALTER TABLE` (2x), `INSERT 0 6` (uma linha por loja ativa
hoje — confirme via `select count(*) from lojas where ativo=true and
is_test=false` que bate com 6 antes de assumir).

- [ ] **Step 4: Confirmar as 6 lojas teste criadas**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select id, nome_fantasia, is_test, loja_origem_id from lojas where is_test = true order by loja_origem_id\""
```

Esperado: 6 linhas, `nome_fantasia` começando com `[TESTE] `,
`loja_origem_id` apontando pra uma das 6 lojas reais (ids 2, 3, 4, 5, 6,
7).

- [ ] **Step 5: Editar `getLojasAtivas()`** (`lib/omie/sync-all.ts`)

O arquivo hoje (linhas 4-12):
```typescript
export async function getLojasAtivas(): Promise<LojaOmie[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('ativo', true)
    .not('omie_app_key', 'is', null)
  return (data ?? []) as LojaOmie[]
}
```

Trocar por:
```typescript
export async function getLojasAtivas(): Promise<LojaOmie[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('ativo', true)
    .eq('is_test', false)
    .not('omie_app_key', 'is', null)
  return (data ?? []) as LojaOmie[]
}
```

- [ ] **Step 6: Editar o seletor de loja** (`app/(app)/layout.tsx`,
linhas 21-37 hoje)

O trecho hoje:
```typescript
  let lojasQuery = supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .eq('ativo', true)
    .order('nome_fantasia')

  // Nao-admin so enxerga as lojas que tem em loja_user.
  if (!isAdmin) {
    const { data: vinculos } = await supabase
      .from('loja_user')
      .select('loja_id')
      .eq('user_id', profile.id)
    const lojaIds = [
      ...new Set((vinculos ?? []).map((v) => v.loja_id).filter((v): v is number => v != null)),
    ]
    lojasQuery = lojasQuery.in('id', lojaIds.length ? lojaIds : [-1])
  }
```

Trocar SÓ o corpo do `if (!isAdmin)`, acrescentando o filtro de
`is_test` (Admin global continua vendo lojas reais + teste, sem
mudança):
```typescript
  let lojasQuery = supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .eq('ativo', true)
    .order('nome_fantasia')

  // Nao-admin so enxerga as lojas que tem em loja_user, e nunca ve lojas de teste.
  if (!isAdmin) {
    const { data: vinculos } = await supabase
      .from('loja_user')
      .select('loja_id')
      .eq('user_id', profile.id)
    const lojaIds = [
      ...new Set((vinculos ?? []).map((v) => v.loja_id).filter((v): v is number => v != null)),
    ]
    lojasQuery = lojasQuery.eq('is_test', false).in('id', lojaIds.length ? lojaIds : [-1])
  }
```

- [ ] **Step 7: Editar `getAtorGestao()`** (`lib/auth.ts`, linha 210
hoje)

O trecho hoje:
```typescript
  let lojaIds: number[] = []
  if (isAdminGlobal) {
    const { data } = await supabase.from('lojas').select('id').eq('ativo', true)
    lojaIds = (data ?? []).map((l) => l.id as number)
```

Trocar por:
```typescript
  let lojaIds: number[] = []
  if (isAdminGlobal) {
    const { data } = await supabase.from('lojas').select('id').eq('ativo', true).eq('is_test', false)
    lojaIds = (data ?? []).map((l) => l.id as number)
```

- [ ] **Step 8: `npx tsc --noEmit`** no repo inteiro — esperado limpo
(estas edições não tocam nenhum tipo, só filtros de query).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/117_lojas_teste.sql lib/omie/sync-all.ts "app/(app)/layout.tsx" lib/auth.ts
git commit -m "feat: schema de lojas de teste + exclusão de crons/seletor/gestão"
```

**NÃO aplicar deploy nem migration em produção separadamente desta
task** — a migration já foi aplicada no Step 3 (precisa estar no banco
antes da Task 2 poder ser testada localmente), mas o **deploy do
código** (Steps 5-7) só acontece na Task 4, junto com o gate central da
Task 2 e o wiring da Task 3.

---

## Task 2: Gate central em `lib/omie/client.ts`

**Files:**
- Modify: `lib/omie/client.ts` (arquivo inteiro, 126 linhas hoje)

**Interfaces:**
- Consumes: nenhuma desta plano (é o arquivo mais central de todos).
- Produces: `LojaOmie.is_test: boolean` (obrigatório),
  `OmieRequestParams.is_test: boolean` (obrigatório) — toda a Task 3
  depende desses dois campos existirem e serem obrigatórios pra `tsc`
  apontar os call sites que faltam.

**O arquivo completo, substituindo o atual por inteiro:**

```typescript
import { createServiceClient } from '@/lib/supabase/server'

const OMIE_BASE_URL = 'https://app.omie.com.br/api/'

export type LojaOmie = {
  id: number
  omie_app_key: string
  omie_app_secret: string
  is_test: boolean
}

export interface OmieRequestParams {
  loja_id: number
  omie_app_key: string
  omie_app_secret: string
  is_test: boolean
  endpoint: string // ex: 'v1/geral/produtos'
  call: string // ex: 'ListarProdutos'
  data: Record<string, unknown>
}

export class OmieError extends Error {
  constructor(
    message: string,
    public readonly faultCode?: string,
    public readonly httpStatus?: number
  ) {
    super(message)
    this.name = 'OmieError'
  }
}

// Convenção Omie 100% consistente (confirmada em toda a base hoje, sem
// exceção): calls de escrita sempre começam com um destes verbos.
function ehChamadaDeEscrita(call: string): boolean {
  return /^(Incluir|Alterar|Excluir|Concluir|Reverter)/.test(call)
}

// omieRequest<T> já faz um cast (json as T), não valida shape em
// runtime -- um objeto "shotgun" só com os nomes de campo de ID usados
// de verdade no código evita ter que mapear call -> campo
// individualmente (cada função de escrita só lê o campo que espera, o
// resto é ignorado).
function respostaSimulada(): Record<string, unknown> {
  const idFicticio = -Math.floor(Date.now() / 1000)
  return {
    nCodOP: idFicticio,
    cCodIntOP: `TESTE-${idFicticio}`,
    cNumOP: String(idFicticio),
    nCodProduto: idFicticio,
    nCodFamilia: idFicticio,
    nCodLocalEstoque: idFicticio,
    nCodCli: idFicticio,
    nCodEstrutura: idFicticio,
    codigo_status: '0',
    descricao_status: 'Simulado (loja de teste, nenhuma chamada real feita)',
    id_ajuste: idFicticio,
    id_movest: idFicticio,
  }
}

/**
 * Chamada generica ao Omie com retry/backoff e tratamento de rate limit (425/429).
 * Mantem a politica do sistema Laravel: aguarda ~60s ao tomar rate limit, ate 3 tentativas.
 *
 * Lojas de teste (is_test=true): calls de ESCRITA nunca saem de
 * verdade -- retorna uma resposta simulada e loga em
 * integration_attempts com o model prefixado "[SIMULADO]". Calls de
 * LEITURA sempre passam normal, usando a credencial real (mesma da
 * loja de origem, pra trazer dado real).
 */
export async function omieRequest<T = unknown>({
  loja_id,
  omie_app_key,
  omie_app_secret,
  is_test,
  endpoint,
  call,
  data,
}: OmieRequestParams): Promise<T> {
  if (is_test && ehChamadaDeEscrita(call)) {
    const simulada = respostaSimulada()
    await logIntegrationAttempt({
      loja_id,
      model: `[SIMULADO] ${call}`,
      request: JSON.stringify(data),
      response: JSON.stringify(simulada),
      code: '0',
    })
    return simulada as T
  }

  const body = JSON.stringify({
    app_key: omie_app_key,
    app_secret: omie_app_secret,
    call,
    param: [data],
  })

  let lastError: Error | null = null

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${OMIE_BASE_URL}${endpoint}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      // Rate limit do Omie
      if (res.status === 429 || res.status === 425) {
        await sleep(60_000)
        continue
      }

      const json = (await res.json().catch(() => null)) as
        | (T & { faultstring?: string; faultcode?: string })
        | null

      if (!res.ok || (json && 'faultstring' in json && json.faultstring)) {
        const faultCode = json?.faultcode
        const msg = json?.faultstring || `Omie HTTP ${res.status}`
        // "Nao existem registros para a pagina [N]" nao e erro: e fim/lista vazia.
        // O Laravel tratava como objeto vazio. Retornamos {} para o sync encerrar limpo.
        if (/n.o existem registros/i.test(msg)) {
          return {} as T
        }
        // Limite de concorrencia / consumo redundante do Omie: vem como faultstring,
        // nao HTTP 429. Aguarda (honrando "Aguarde N segundos" quando informado) e retenta.
        if (/j. existe uma requisi|consumo redundante|too many requests|aguarde/i.test(msg)) {
          if (attempt < 2) {
            const pedido = msg.match(/aguarde\s+(\d+)\s*segundos/i)
            const espera = pedido ? Math.min(Number(pedido[1]) + 2, 60) * 1000 : 5000 * (attempt + 1)
            await sleep(espera)
            continue
          }
        }
        throw new OmieError(msg, faultCode, res.status)
      }

      return json as T
    } catch (e) {
      lastError = e as Error
      // erro de rede: backoff progressivo; faltas de negocio Omie nao retentam
      if (e instanceof OmieError) throw e
      if (attempt < 2) await sleep(2000 * (attempt + 1))
    }
  }

  throw lastError ?? new Error('Falha desconhecida na chamada Omie')
}

export async function logIntegrationAttempt(params: {
  loja_id: number
  model: string
  request: string
  response?: string
  code?: string
  error?: boolean
  error_message?: string
}) {
  const supabase = createServiceClient()
  await supabase.from('integration_attempts').insert({
    loja_id: params.loja_id,
    model: params.model,
    request: params.request,
    response: params.response ?? null,
    code: params.code ?? null,
    error: params.error ?? false,
    error_message: params.error_message ?? null,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

Mudanças em relação ao original: `LojaOmie`/`OmieRequestParams` ganham
`is_test: boolean`; duas funções novas (`ehChamadaDeEscrita`,
`respostaSimulada`); `omieRequest` passa a desestruturar `loja_id` e
`is_test` também (antes só desestruturava `omie_app_key,
omie_app_secret, endpoint, call, data`); o corpo ganha o `if` de
interceptação no topo, antes do `body`/loop de retry. **Todo o resto do
arquivo (retry, rate limit, tratamento de erro, `logIntegrationAttempt`,
`sleep`) é idêntico ao original, byte a byte** — não mude nada além do
que está listado aqui.

- [ ] **Step 1: Substituir o arquivo inteiro** pelo conteúdo acima.

- [ ] **Step 2: `npx tsc --noEmit`** — vai FALHAR agora, com dezenas de
erros "Property 'is_test' is missing in type...". **Isso é esperado
nesta task** — a Task 3 corrige todos esses erros. Não tente corrigir
nenhum call site nesta task; só confirme que o arquivo `client.ts` em
si (a definição dos tipos e da função) está sintaticamente correto —
rode `npx tsc --noEmit lib/omie/client.ts` isoladamente (ou aceite os
erros de outros arquivos como esperados, mas confirme que nenhum erro
aponta pra dentro de `client.ts` — se apontar, o arquivo tem um bug de
sintaxe/tipo real, corrija antes de seguir).

- [ ] **Step 3: Commit**

```bash
git add lib/omie/client.ts
git commit -m "feat: gate central de escrita Omie pra lojas de teste"
```

(Este commit deixa o repo com `tsc` quebrado de propósito — é
intermediário. A Task 3 corrige e é o ponto em que `tsc` volta a ficar
limpo.)

---

## Task 3: Wiring — propagar `is_test` em todos os call sites

**Files:**
- Modify: todos os arquivos que `npx tsc --noEmit` apontar (achado
  hoje: 47 ocorrências de `omieRequest(`/`omieRequest<` em ~19
  arquivos — `lib/omie/ajuste.ts`, `cliente-fornecedor.ts`,
  `empresa.ts`, `dfe-docs.ts`, `faturamento.ts`, `malha.ts`,
  `nota-fiscal.ts`, `familia.ts`, `local-estoque.ts`, `produto.ts`,
  `movimento.ts`, `posicao-estoque.ts`, `ordem-producao.ts`,
  `sync-movimentos.ts`, `sync-ajustes.ts`, mais `lib/actions/
  inventario.ts`, `movimentacoes.ts`, `transferencia.ts` — e qualquer
  outro que o `tsc` apontar que não esteja nesta lista, a lista é um
  ponto de partida, não a fonte de verdade final).

**Interfaces:**
- Consumes: `LojaOmie.is_test`/`OmieRequestParams.is_test`
  (obrigatórios, da Task 2).
- Produces: nenhuma interface nova — só propagação de dado.

**O padrão de correção é sempre o mesmo.** Exemplo real (`lib/omie/
ordem-producao.ts`, função `incluirOrdemProducao`, hoje):
```typescript
  return omieRequest<{ nCodOP?: number; cCodIntOP?: string; cNumOP?: string }>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/produtos/op',
    call: 'IncluirOrdemProducao',
    data,
  })
```
Corrigido (só a linha `is_test` é nova):
```typescript
  return omieRequest<{ nCodOP?: number; cCodIntOP?: string; cNumOP?: string }>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/op',
    call: 'IncluirOrdemProducao',
    data,
  })
```
Em toda função que já recebe um parâmetro `loja: LojaOmie` (a maioria),
a correção é sempre `is_test: loja.is_test,` (ou o nome local do
parâmetro, ex: `inventario.loja.is_test` em `lib/actions/
inventario.ts`).

**Onde o erro do `tsc` for sobre a QUERY que busca a loja** (não sobre a
chamada a `omieRequest` em si — ex: "Type '{ id: number; omie_app_key:
string; omie_app_secret: string; }' is missing the following properties
from type 'LojaOmie': is_test"), significa que o `.select(...)` do
Supabase que monta esse objeto `loja` não está trazendo a coluna
`is_test`. Corrija adicionando `is_test` na lista de colunas do
`.select(...)` correspondente (mesmo arquivo, procure pela query que
alimenta a variável/parâmetro apontada pelo erro).

- [ ] **Step 1: Rodar `npx tsc --noEmit`**, copiar a lista completa de
erros.

- [ ] **Step 2: Corrigir o primeiro arquivo da lista** — para cada
ocorrência de `omieRequest(`/`omieRequest<` nesse arquivo, adicionar
`is_test: <expressão certa>,` no objeto passado, e se necessário
adicionar `is_test` ao `.select(...)` que alimenta o objeto `loja`
usado.

- [ ] **Step 3: Repetir o Step 2 pra cada arquivo restante da lista de
erros**, até `npx tsc --noEmit` sair com **zero erros** no repo inteiro.

- [ ] **Step 4: Grep de confirmação final** — depois do `tsc` limpo,
rode:
```bash
grep -c "is_test" lib/omie/*.ts lib/actions/inventario.ts lib/actions/movimentacoes.ts lib/actions/transferencia.ts
```
Confirme que TODO arquivo que aparecia na lista original de 19 (mais
qualquer um novo que o `tsc` tenha revelado) tem pelo menos 1 ocorrência
de `is_test` — um arquivo com 0 seria sinal de que ele não usa
`omieRequest` de verdade (só foi citado por engano) ou que a correção
foi feita de um jeito que não usa a palavra `is_test` literal (ex: uma
variável renomeada) — nesse caso, confirme manualmente lendo o arquivo,
não assuma que está errado só pelo grep.

- [ ] **Step 5: `npx tsc --noEmit`** uma última vez, no repo inteiro —
critério de conclusão desta task: **zero erros**.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: propaga is_test em todos os call sites de omieRequest"
```

---

## Task 4: QA + Deploy

**Files:**
- Nenhum arquivo novo — task de deploy e validação.

**Interfaces:**
- Consumes: Tasks 1-3 completas, commitadas, `tsc` limpo.

- [ ] **Step 1: `npx tsc --noEmit`** no repo inteiro, confirmar limpo
mais uma vez antes do deploy.

- [ ] **Step 2: Deploy**

```bash
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

Aguardar terminar (síncrono). Depois confirmar:
```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && git log --oneline -1"
```
Esperado: `HTTP 200`, commit do Step 6 da Task 3 no servidor.

- [ ] **Step 3: Confirmar `getLojasAtivas()` não retorna nenhuma loja
teste**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select id, is_test from lojas where ativo=true and omie_app_key is not null\""
```
Confirme visualmente que a query real usada por `getLojasAtivas()`
(equivalente a `.eq('is_test', false)` a mais) excluiria as 6 linhas
`is_test=true` — rode a query completa com o filtro:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select id from lojas where ativo=true and is_test=false and omie_app_key is not null\""
```
Confirme que nenhum dos ids das 6 lojas teste aparece.

- [ ] **Step 4: Confirmar que uma chamada de ESCRITA contra uma loja
teste é bloqueada de verdade**

Pegue o id de uma loja teste (ex: a gêmea da loja 7, Vinhas & Vinhetos):
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select id, nome_fantasia from lojas where is_test=true and loja_origem_id=7\""
```

Direto no servidor, rode um script Node ad-hoc (dentro do container ou
via `node -e`, usando o mesmo `omieRequest` compilado do build) OU, mais
simples, dispare a rota HTTP real de integração de Ordem de Produção
(`app/api/integracao/ordem-producao/route.ts`) apontando `loja_id` pra
essa loja teste, SE ela tiver uma `integracao_api_key` configurada — se
não tiver (é o caso mais provável, a migration desta rodada não criou
uma), documente que esse teste específico via rota HTTP não é possível
sem configuração adicional, e valide por outro caminho: confirme
INDIRETAMENTE lendo o código deployado no servidor:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && grep -n 'ehChamadaDeEscrita\|respostaSimulada' lib/omie/client.ts"
```
Confirme que as duas funções estão presentes no arquivo real deployado
no servidor (prova de que o código certo foi pro ar, mesmo sem
conseguir disparar uma chamada de teste ponta-a-ponta sem navegador).

- [ ] **Step 5: Confirmar RLS — usuário comum não vê loja de teste**

Reusar o padrão de JWT simulado já usado nas Fases 2a/2b hoje, com um
usuário comum real (`626393b3-6e27-4d45-a382-8ec36c37043b`, Gerson
Mendes, perfil `Usuario`, loja 3):
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"626393b3-6e27-4d45-a382-8ec36c37043b\\\", \\\"role\\\": \\\"authenticated\\\"}';
select id, nome_fantasia, is_test from lojas;
reset role;
\""
```
Esperado: nenhuma linha com `is_test=true` na lista retornada (RLS já
bloqueia por não ter `loja_user` pra essa loja).

- [ ] **Step 6: Relatório final**

Resuma cada step (passou/falhou). Documente explicitamente que o teste
de UI real (login como Admin no navegador, criar uma Ordem de Produção
de verdade dentro de uma loja teste e ver a tela mostrar sucesso) **não
foi feito nesta sessão** — sem acesso a navegador — e que o próximo
passo real de validação é o usuário logar como Admin, entrar numa loja
`[TESTE]`, e testar o fluxo completo manualmente.

---

## Execução

Todas as 4 tasks neste único repo, mesma sessão — oferecer execução via
`superpowers:subagent-driven-development`. **Dado que este projeto
mexe no arquivo mais central de toda a integração Omie
(`lib/omie/client.ts`, usado por 47 call sites), o controller deve
fazer TODOS os steps de SSH/deploy diretamente** (mesmo padrão já usado
em todos os planos de hoje) — e considerar rodar a Task 3 (wiring)
pessoalmente ou com supervisão mais próxima, dado o volume de arquivos
tocados e o risco de um call site mal migrado silenciosamente não
propagar `is_test` (mitigado pelo `tsc`, mas vale atenção extra na
revisão).
