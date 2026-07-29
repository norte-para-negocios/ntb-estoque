# Dashboard de Produção (item #15) — volume por dia/semana/mês + por funcionário

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nova página `/relatorio-producao` com um gráfico de OPs concluídas por período (dia/semana/mês) empilhado por funcionário responsável pela conclusão, para a gestão identificar rápido dias sem produção ou queda de produtividade — sem vasculhar relatório nenhum.

**Architecture:** `ordens_producao` ganha uma coluna nova `concluida_por` (uuid → `profiles.id`), gravada automaticamente com o usuário logado no momento em que ele clica "Concluir OP" (mesmo padrão já usado em `inventarios`/`transferencias`). Sem dado retroativo — o gráfico só passa a ter quebra por funcionário a partir de agora; decisão já validada com o usuário (2026-07-28), junto com a ressalva de que "quem clicou em concluir" pode não ser exatamente "quem produziu" quando a conclusão é feita em lote por um gerente. Gráfico é um componente SVG construído à mão (sem lib nova — não existe nenhuma no projeto), seguindo a metodologia da skill `dataviz`: barras empilhadas, paleta categórica de 8 cores já validada (contraste + daltonismo) da própria skill, legenda sempre visível, tooltip por barra, e uma tabela de detalhe abaixo do gráfico (par acessível obrigatório).

**Tech Stack:** Next.js 16 App Router (Server Component pra página, Client Component só pro gráfico), Supabase (nova coluna + queries paginadas), SVG puro (sem lib de gráfico), CSS custom properties em `app/globals.css` (mesmo padrão de `--brand`/`--ok`/`--err`, com override em `.dark`).

## Global Constraints

- **Não é possível reconstruir histórico** — `concluida_por` só existe daqui pra frente; qualquer período anterior à publicação desta feature aparece como "Não identificado" pra 100% das OPs, isso é esperado e não é bug.
- Nunca chamar `.select()` sem paginação numa tabela que pode passar de 1000 linhas — sempre count-first + `.range()` (bug real já corrigido 3x nesta sessão).
- Paleta categórica: usar exatamente os 7 primeiros slots da paleta de referência da skill `dataviz` (`references/palette.md`) — já validada (CVD ΔE ≥ 8, contraste ok em claro e escuro), não inventar cor nova. O slot 8 (vermelho) fica de fora de propósito: essa cor já tem significado fixo neste app (`--err`, status de erro) — reusar como categórico violaria a regra da skill de nunca colocar uma cor de status ao lado de uma cor categórica sem rótulo.
- Sem suite de testes automatizada — verificação é `npx eslint <arquivo>` (0 erros novos) + `npm run build` (`EXIT=0`) + QA visual real via chrome-devtools MCP com a conta `claude.qa@ntb-estoque.dev` / `claudeqa123456` contra `npx next dev -p 3008`.
- Deploy manual: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`, depois `curl` confirmando HTTP 200 em produção.
- Migration numerada 092 (última existente: 091, criada no mesmo dia por este mesmo trabalho de sessão).

---

### Task 1: Migration — coluna `concluida_por`

**Files:**
- Create: `supabase/migrations/092_ordens_producao_concluida_por.sql`

**Interfaces:**
- Produces: coluna `ordens_producao.concluida_por uuid references profiles(id) on delete set null`, consumida pela Task 2 (grava) e pela Task 3 (lê).

- [ ] **Step 1: Escrever a migration**

```sql
-- Item #15 da reuniao 2026-07-27 (pedido do Andrey): dashboard de producao por
-- funcionario. Achado na pesquisa 2026-07-28: nem a Omie nem o app hoje sabem
-- "quem" concluiu uma OP. Decisao validada com o usuario: rastrear a partir de
-- agora quem estava logado no clique de "Concluir OP" (mesmo padrao ja usado em
-- inventarios/transferencias, migration 005). Sem backfill possivel -- OPs
-- concluidas antes desta coluna existir ficam com concluida_por = null pra
-- sempre, tratado como "Nao identificado" no dashboard (Task 5).
alter table ordens_producao
  add column if not exists concluida_por uuid references profiles(id) on delete set null;

create index if not exists idx_ordens_producao_concluida_por
  on ordens_producao (loja_id, concluida_por)
  where concluida_por is not null;
```

- [ ] **Step 2: Aplicar a migration**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
cat > apply-migration.mjs << 'EOF'
import { Client } from 'pg'
import { readFileSync } from 'fs'
import 'dotenv/config'
const sql = readFileSync(process.argv[2], 'utf8')
const client = new Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()
try { await client.query(sql); console.log('OK') } finally { await client.end() }
EOF
node --env-file=.env.local apply-migration.mjs supabase/migrations/092_ordens_producao_concluida_por.sql
rm apply-migration.mjs
```
Expected: `OK`, sem erro.

- [ ] **Step 3: Smoke-test — confirmar a coluna existe e é nullable**

```bash
cat > check.mjs << 'EOF'
import { Client } from 'pg'
import 'dotenv/config'
const client = new Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()
const { rows } = await client.query(`select column_name, data_type, is_nullable from information_schema.columns where table_name = 'ordens_producao' and column_name = 'concluida_por'`)
console.log(rows)
await client.end()
EOF
node --env-file=.env.local check.mjs
rm check.mjs
```
Expected: 1 linha, `data_type: uuid`, `is_nullable: YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/092_ordens_producao_concluida_por.sql
git commit -m "feat: coluna ordens_producao.concluida_por (rastreio de quem conclui a OP)"
```

---

### Task 2: Gravar `concluida_por` no clique de "Concluir OP"

**Files:**
- Modify: `lib/actions/ordem-producao.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/server` (sessão), já importado no arquivo indiretamente via `lib/auth.ts` — este arquivo precisa importar `createClient` também (hoje só usa `createServiceClient`).
- Produces: nenhuma interface nova pra outra task — mudança interna de `executarConclusaoOP`.

- [ ] **Step 1: Adicionar parâmetro `usuarioId` em `executarConclusaoOP`**

Localizar a assinatura da função (por volta da linha 490):
```ts
async function executarConclusaoOP(
  op: OPParaConcluir,
  dataEscolhidaISO?: string | null,
  qtdeProduzida?: number | null,
): Promise<{ ok: true; insumosPulados?: string[]; avisoRestaurar?: string; semEtiqueta?: boolean } | { error: string }> {
```
Trocar por:
```ts
async function executarConclusaoOP(
  op: OPParaConcluir,
  dataEscolhidaISO?: string | null,
  qtdeProduzida?: number | null,
  usuarioId?: string | null,
): Promise<{ ok: true; insumosPulados?: string[]; avisoRestaurar?: string; semEtiqueta?: boolean } | { error: string }> {
```

- [ ] **Step 2: Gravar `concluida_por` dentro de `marcarConcluidaLocal`**

Dentro da mesma função, achar `marcarConcluidaLocal` (por volta da linha 528) e adicionar o campo no `.update`:
```ts
  async function marcarConcluidaLocal() {
    const mc = dataConclusao.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    await supabase
      .from('ordens_producao')
      .update({
        concluida: true,
        dt_conclusao_real: mc ? `${mc[3]}-${mc[2]}-${mc[1]}` : null,
        concluida_por: usuarioId ?? null,
        conclusao_status: null,
        conclusao_erro_msg: null,
        conclusao_tentativas: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', op.id)
      .eq('loja_id', op.loja_id)
    revalidatePath('/ordem-producao')
  }
```

- [ ] **Step 3: Passar o usuário logado em `finishOP`**

No topo do arquivo, adicionar o import (arquivo já importa de `@/lib/auth`, adicionar `createClient` de `@/lib/supabase/server` junto do `createServiceClient` já importado):
```ts
import { createClient, createServiceClient } from '@/lib/supabase/server'
```
(confirmar o import atual de `createServiceClient` antes de editar — só ajustar a linha existente, não duplicar.)

Em `finishOP` (por volta da linha 620), antes do `return executarConclusaoOP(...)`, buscar o usuário da sessão:
```ts
export async function finishOP(
  opId: number,
  dataEscolhidaISO?: string | null,
  qtdeProduzida?: number | null,
): Promise<{ ok: true; insumosPulados?: string[]; avisoRestaurar?: string; semEtiqueta?: boolean } | { error: string }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Concluir'))) return { error: 'Sem permissão' }
  const supabaseSessao = await createClient()
  const { data: { user } } = await supabaseSessao.auth.getUser()
  const supabase = createServiceClient()
  // ... (resto igual)
```
E no `return`:
```ts
  return executarConclusaoOP(
    { ...op, identificacao_n_cod_op: op.identificacao_n_cod_op, loja_id: lojaId },
    dataEscolhidaISO,
    qtdeProduzida,
    user?.id ?? null
  )
```

- [ ] **Step 4: Passar o usuário logado em `finishOPsEmLote`**

Mesma lógica, uma vez só antes do loop de conclusão (por volta da linha 897):
```ts
export async function finishOPsEmLote(
  opIds: number[]
): Promise<{ sucesso: number; falhas: { id: number; error: string }[] }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Concluir'))) {
    return { sucesso: 0, falhas: opIds.map((id) => ({ id, error: 'Sem permissão' })) }
  }
  if (!opIds.length) return { sucesso: 0, falhas: [] }
  const supabaseSessao = await createClient()
  const { data: { user } } = await supabaseSessao.auth.getUser()
  const supabase = createServiceClient()
  // ... resto da função igual, so passar `user?.id ?? null` como 4o argumento
  // em toda chamada de executarConclusaoOP dentro dela
```

- [ ] **Step 5: Confirmar que `retryOPsPendentes` (cron/reenvio, sem sessão) continua passando `undefined`**

Não precisa mudar nada ali — `executarConclusaoOP` já trata `usuarioId` como opcional (`usuarioId ?? null`), então as chamadas existentes dentro de `retryOPsPendentes` e `tentarConcluirSemInsumosSemCmc` continuam válidas sem alteração, resultando em `concluida_por = null` (correto: reenvio automático não tem usuário logado).

- [ ] **Step 6: Lint**

Run: `npx eslint lib/actions/ordem-producao.ts`
Expected: 0 erros novos.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: `EXIT=0`.

- [ ] **Step 8: QA funcional — concluir uma OP de teste e confirmar `concluida_por` gravado**

Com `npx next dev -p 3008` rodando e login QA: concluir qualquer OP pendente na loja de teste (ou usar o script de checagem direta no banco pra achar a última OP concluída pela conta QA e confirmar que `concluida_por` bate com o `id` do profile `claude.qa@ntb-estoque.dev`).

- [ ] **Step 9: Commit**

```bash
git add lib/actions/ordem-producao.ts
git commit -m "feat: gravar concluida_por (usuario logado) ao concluir uma OP"
```

---

### Task 3: Camada de dados — bucketing por dia/semana/mês + funcionário

**Files:**
- Create: `lib/dashboard-producao.ts`

**Interfaces:**
- Consumes: `createServiceClient` (`@/lib/supabase/server`), `hojeBahiaISO` (`@/lib/data-bahia`).
- Produces:
  ```ts
  export type Granularidade = 'dia' | 'semana' | 'mes'
  export type BucketProducao = {
    chave: string        // '2026-07-15' | '2026-S3' | '2026-07'
    rotulo: string        // '15' | 'Sem 3' | 'Jul/26'
    total: number
    porFuncionario: { nome: string; qtd: number }[]  // ordenado por qtd desc, "Não identificado" sempre por último
  }
  export type DashboardProducao = { buckets: BucketProducao[]; funcionariosOrdenados: string[] /* ordem fixa de cor, até 7 + 'Outros' */ }
  export async function carregarDashboardProducao(lojaId: number, granularidade: Granularidade, mesRef: string /* YYYY-MM */): Promise<DashboardProducao>
  ```
  Consumida pela Task 5 (`page.tsx`).

- [ ] **Step 1: Escrever `lib/dashboard-producao.ts`**

```ts
import { createServiceClient } from '@/lib/supabase/server'

export type Granularidade = 'dia' | 'semana' | 'mes'

export type BucketProducao = {
  chave: string
  rotulo: string
  total: number
  porFuncionario: { nome: string; qtd: number }[]
}

export type DashboardProducao = {
  buckets: BucketProducao[]
  funcionariosOrdenados: string[]
}

type OpRow = { dt_conclusao_real: string | null; concluida_por: string | null }

const NAO_IDENTIFICADO = 'Não identificado'
const MAX_SERIES = 7

function mesParaIntervalo(mesRef: string): { ini: string; fim: string; numDias: number } {
  const [ano, mes] = mesRef.split('-').map(Number)
  const numDias = new Date(ano, mes, 0).getDate()
  return { ini: `${mesRef}-01`, fim: `${mesRef}-${String(numDias).padStart(2, '0')}`, numDias }
}

// Últimos 6 meses terminando em mesRef, pra granularidade 'mes'.
function ultimosMeses(mesRef: string, n: number): string[] {
  const [ano, mes] = mesRef.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ano, mes - 1 - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

const MES_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

async function buscarOpsPaginado(lojaId: number, dataIni: string, dataFim: string): Promise<OpRow[]> {
  const supabase = createServiceClient()
  const PAGE = 1000
  const todas: OpRow[] = []
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from('ordens_producao')
      .select('dt_conclusao_real, concluida_por')
      .eq('loja_id', lojaId)
      .eq('concluida', true)
      .gte('dt_conclusao_real', dataIni)
      .lte('dt_conclusao_real', dataFim)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (error || !data?.length) break
    todas.push(...(data as OpRow[]))
    if (data.length < PAGE) break
  }
  return todas
}

export async function carregarDashboardProducao(
  lojaId: number,
  granularidade: Granularidade,
  mesRef: string
): Promise<DashboardProducao> {
  const supabase = createServiceClient()

  const dataIni = granularidade === 'mes' ? `${ultimosMeses(mesRef, 6)[0]}-01` : mesParaIntervalo(mesRef).ini
  const dataFim = granularidade === 'mes' ? mesParaIntervalo(mesRef).fim : mesParaIntervalo(mesRef).fim

  const ops = await buscarOpsPaginado(lojaId, dataIni, dataFim)

  // Nomes: so busca os profiles realmente referenciados nas OPs do periodo.
  const idsUnicos = Array.from(new Set(ops.map((o) => o.concluida_por).filter((id): id is string => !!id)))
  const nomePorId = new Map<string, string>()
  if (idsUnicos.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', idsUnicos)
    for (const p of profiles ?? []) nomePorId.set(p.id, p.name || NAO_IDENTIFICADO)
  }

  // Bucket key por granularidade.
  function chaveDoRegistro(dataISO: string): { chave: string; rotulo: string } {
    if (granularidade === 'dia') {
      const dia = Number(dataISO.slice(8, 10))
      return { chave: dataISO, rotulo: String(dia) }
    }
    if (granularidade === 'mes') {
      const [ano, mes] = dataISO.slice(0, 7).split('-')
      return { chave: `${ano}-${mes}`, rotulo: `${MES_LABEL[Number(mes) - 1]}/${ano.slice(2)}` }
    }
    // semana: numero da semana ISO dentro do proprio mes de referencia (1a semana = dias 1-7, etc.)
    const dia = Number(dataISO.slice(8, 10))
    const semana = Math.floor((dia - 1) / 7) + 1
    return { chave: `${dataISO.slice(0, 7)}-S${semana}`, rotulo: `Sem ${semana}` }
  }

  const buckets = new Map<string, { rotulo: string; porFuncionario: Map<string, number> }>()

  // Garante buckets vazios pra todo o eixo (dias/semanas do mes, ou os 6 meses),
  // pra o grafico nao "pular" periodos sem producao -- e exatamente o que a
  // gestao quer enxergar (dia sem producao vira um buraco visivel, nao um gap invisivel).
  if (granularidade === 'dia') {
    const { numDias } = mesParaIntervalo(mesRef)
    for (let d = 1; d <= numDias; d++) {
      const chave = `${mesRef}-${String(d).padStart(2, '0')}`
      buckets.set(chave, { rotulo: String(d), porFuncionario: new Map() })
    }
  } else if (granularidade === 'semana') {
    const { numDias } = mesParaIntervalo(mesRef)
    const totalSemanas = Math.floor((numDias - 1) / 7) + 1
    for (let s = 1; s <= totalSemanas; s++) {
      buckets.set(`${mesRef}-S${s}`, { rotulo: `Sem ${s}`, porFuncionario: new Map() })
    }
  } else {
    for (const m of ultimosMeses(mesRef, 6)) {
      const [ano, mes] = m.split('-')
      buckets.set(m, { rotulo: `${MES_LABEL[Number(mes) - 1]}/${ano.slice(2)}`, porFuncionario: new Map() })
    }
  }

  for (const op of ops) {
    if (!op.dt_conclusao_real) continue
    const { chave } = chaveDoRegistro(op.dt_conclusao_real)
    const bucket = buckets.get(chave)
    if (!bucket) continue
    const nome = op.concluida_por ? (nomePorId.get(op.concluida_por) ?? NAO_IDENTIFICADO) : NAO_IDENTIFICADO
    bucket.porFuncionario.set(nome, (bucket.porFuncionario.get(nome) ?? 0) + 1)
  }

  // Ordem fixa de cor: funcionarios ordenados por volume TOTAL no periodo inteiro
  // (nao por bucket -- senao a cor de uma pessoa mudaria de dia pra dia).
  const totalPorFuncionario = new Map<string, number>()
  for (const b of buckets.values()) {
    for (const [nome, qtd] of b.porFuncionario) {
      totalPorFuncionario.set(nome, (totalPorFuncionario.get(nome) ?? 0) + qtd)
    }
  }
  const ordenadosPorVolume = Array.from(totalPorFuncionario.entries())
    .filter(([nome]) => nome !== NAO_IDENTIFICADO)
    .sort((a, b) => b[1] - a[1])
    .map(([nome]) => nome)
  const funcionariosOrdenados = ordenadosPorVolume.slice(0, MAX_SERIES)
  const temNaoIdentificado = totalPorFuncionario.has(NAO_IDENTIFICADO)
  const temOutros = ordenadosPorVolume.length > MAX_SERIES

  const resultado: BucketProducao[] = Array.from(buckets.entries()).map(([chave, b]) => {
    const porFuncionario: { nome: string; qtd: number }[] = []
    for (const nome of funcionariosOrdenados) {
      const qtd = b.porFuncionario.get(nome) ?? 0
      if (qtd > 0) porFuncionario.push({ nome, qtd })
    }
    if (temOutros) {
      const qtdOutros = Array.from(b.porFuncionario.entries())
        .filter(([nome]) => !funcionariosOrdenados.includes(nome) && nome !== NAO_IDENTIFICADO)
        .reduce((s, [, qtd]) => s + qtd, 0)
      if (qtdOutros > 0) porFuncionario.push({ nome: 'Outros', qtd: qtdOutros })
    }
    const qtdNaoIdent = b.porFuncionario.get(NAO_IDENTIFICADO) ?? 0
    if (qtdNaoIdent > 0) porFuncionario.push({ nome: NAO_IDENTIFICADO, qtd: qtdNaoIdent })
    const total = porFuncionario.reduce((s, f) => s + f.qtd, 0)
    return { chave, rotulo: b.rotulo, total, porFuncionario }
  })

  return {
    buckets: resultado,
    funcionariosOrdenados: [...funcionariosOrdenados, ...(temOutros ? ['Outros'] : []), ...(temNaoIdentificado ? [NAO_IDENTIFICADO] : [])],
  }
}
```

- [ ] **Step 2: Lint**

Run: `npx eslint lib/dashboard-producao.ts`
Expected: 0 erros novos.

- [ ] **Step 3: Smoke-test manual via script**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
cat > test-dashboard.mjs << 'EOF'
import { carregarDashboardProducao } from './lib/dashboard-producao.ts'
const r = await carregarDashboardProducao(2, 'dia', '2026-07')
console.log(JSON.stringify(r, null, 2).slice(0, 2000))
EOF
npx tsx test-dashboard.mjs
rm test-dashboard.mjs
```
Expected: JSON com `buckets` (até 31 itens) e `funcionariosOrdenados`, sem erro. Provavelmente todos os `porFuncionario` vêm vazios/"Não identificado" (dado só passa a existir depois da Task 2 rodar em produção) — isso é esperado nesta etapa, não é bug.

- [ ] **Step 4: Commit**

```bash
git add lib/dashboard-producao.ts
git commit -m "feat: bucketing de OPs concluidas por dia/semana/mes e funcionario"
```

---

### Task 4: Paleta categórica + componente de gráfico

**Files:**
- Modify: `app/globals.css`
- Create: `components/producao/ProducaoChart.tsx`

**Interfaces:**
- Consumes: `BucketProducao[]`, `funcionariosOrdenados: string[]` (Task 3).
- Produces: `<ProducaoChart buckets={...} funcionariosOrdenados={...} />`, consumido pela Task 5.

- [ ] **Step 1: Adicionar as 7 cores categóricas em `app/globals.css`**

Paleta de referência da skill `dataviz` (`references/palette.md`), já validada (CVD ΔE ≥ 8 tanto claro quanto escuro, contraste ok) — usar os 7 primeiros slots tal como estão, sem inventar cor. Dentro do bloco `:root` (depois de `--info: #3b82f6;`):
```css
  --info: #3b82f6;
  /* Paleta categorica p/ graficos (dashboard de producao, por funcionario).
     7 primeiros slots da paleta de referencia validada da skill dataviz
     (references/palette.md) -- CVD deltaE >= 8, contraste ok claro/escuro.
     Slot 8 (vermelho) fica de fora de proposito: ja e --err neste app. */
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --series-3: #1baf7a;
  --series-4: #eda100;
  --series-5: #e87ba4;
  --series-6: #008300;
  --series-7: #4a3aa7;
```
Dentro do bloco `.dark` (depois de `--info: #60a5fa;`):
```css
  --info: #60a5fa;
  --series-1: #3987e5;
  --series-2: #d95926;
  --series-3: #199e70;
  --series-4: #c98500;
  --series-5: #d55181;
  --series-6: #008300;
  --series-7: #9085e9;
```

- [ ] **Step 2: Criar `components/producao/ProducaoChart.tsx`**

```tsx
'use client'

import { useState } from 'react'

type BucketProducao = {
  chave: string
  rotulo: string
  total: number
  porFuncionario: { nome: string; qtd: number }[]
}

const CORES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)']
const COR_OUTROS = 'var(--text-muted)'

function corDoFuncionario(nome: string, funcionariosOrdenados: string[]): string {
  const idx = funcionariosOrdenados.indexOf(nome)
  if (idx === -1 || idx >= CORES.length) return COR_OUTROS
  return CORES[idx]
}

export function ProducaoChart({
  buckets,
  funcionariosOrdenados,
}: {
  buckets: BucketProducao[]
  funcionariosOrdenados: string[]
}) {
  const [hover, setHover] = useState<number | null>(null)
  const maxTotal = Math.max(...buckets.map((b) => b.total), 1)

  const larguraBarra = 28
  const gap = 10
  const alturaPlot = 220
  const alturaEixoX = 28
  const larguraEixoY = 40
  const largura = larguraEixoY + buckets.length * (larguraBarra + gap)
  const altura = alturaPlot + alturaEixoX

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxTotal * f))

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      {/* Legenda -- sempre visivel com 2+ series */}
      {funcionariosOrdenados.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {funcionariosOrdenados.map((nome) => (
            <div key={nome} className="flex items-center gap-1.5 text-[12px] text-text-muted">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ background: corDoFuncionario(nome, funcionariosOrdenados) }}
              />
              {nome}
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <svg width={largura} height={altura} role="img" aria-label="OPs concluídas por período">
          {/* Gridlines horizontais */}
          {yTicks.map((v, i) => {
            const y = alturaPlot - (v / maxTotal) * alturaPlot
            return (
              <g key={i}>
                <line x1={larguraEixoY} y1={y} x2={largura} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text x={larguraEixoY - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                  {v}
                </text>
              </g>
            )
          })}

          {/* Barras empilhadas */}
          {buckets.map((b, i) => {
            const x = larguraEixoY + i * (larguraBarra + gap)
            let yAtual = alturaPlot
            const segmentos = b.porFuncionario.map((f) => {
              const h = maxTotal > 0 ? (f.qtd / maxTotal) * alturaPlot : 0
              const y = yAtual - h
              yAtual = y - 2 // gap de 2px entre segmentos
              return { ...f, y, h }
            })
            return (
              <g
                key={b.chave}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                style={{ cursor: b.total > 0 ? 'pointer' : 'default', outline: 'none' }}
              >
                {segmentos.map((s, si) => (
                  <rect
                    key={si}
                    x={x}
                    y={s.y}
                    width={larguraBarra}
                    height={Math.max(s.h, 0)}
                    fill={corDoFuncionario(s.nome, funcionariosOrdenados)}
                    opacity={hover === null || hover === i ? 1 : 0.35}
                    rx={si === segmentos.length - 1 ? 4 : 0}
                  />
                ))}
                {/* Hit area maior que a barra, cobre a coluna inteira */}
                <rect x={x} y={0} width={larguraBarra} height={alturaPlot} fill="transparent" />
                {/* Total no topo (label direto -- so o total, nao cada segmento) */}
                {b.total > 0 && (
                  <text
                    x={x + larguraBarra / 2}
                    y={(segmentos[segmentos.length - 1]?.y ?? alturaPlot) - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill="var(--text)"
                  >
                    {b.total}
                  </text>
                )}
                <text
                  x={x + larguraBarra / 2}
                  y={alturaPlot + 18}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--text-muted)"
                >
                  {b.rotulo}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Tooltip do bucket em hover/focus */}
      {hover !== null && buckets[hover] && buckets[hover].total > 0 && (
        <div className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px]">
          <div className="font-semibold text-text">{buckets[hover].rotulo} — {buckets[hover].total} OP(s)</div>
          <div className="mt-1 space-y-0.5">
            {buckets[hover].porFuncionario.map((f) => (
              <div key={f.nome} className="flex items-center gap-1.5 text-text-muted">
                <span
                  className="inline-block h-0.5 w-3 rounded-full"
                  style={{ background: corDoFuncionario(f.nome, funcionariosOrdenados) }}
                />
                <span>{f.nome}:</span>
                <span className="num font-medium text-text">{f.qtd}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Lint**

Run: `npx eslint components/producao/ProducaoChart.tsx`
Expected: 0 erros novos.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css components/producao/ProducaoChart.tsx
git commit -m "feat: paleta categorica + componente de grafico (barras empilhadas) para dashboard de producao"
```

---

### Task 5: Página `/relatorio-producao`

**Files:**
- Create: `app/(app)/relatorio-producao/page.tsx`
- Modify: `app/(app)/relatorios/page.tsx`

**Interfaces:**
- Consumes: `carregarDashboardProducao` (Task 3), `ProducaoChart` (Task 4), `getAtorGestao`/`getCurrentLojaId` (`@/lib/auth`).

- [ ] **Step 1: Escrever a página**

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { carregarDashboardProducao, type Granularidade } from '@/lib/dashboard-producao'
import { ProducaoChart } from '@/components/producao/ProducaoChart'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { BarChart3 } from 'lucide-react'

export const dynamic = 'force-dynamic'

const GRANULARIDADES: { value: Granularidade; label: string }[] = [
  { value: 'dia', label: 'Diária' },
  { value: 'semana', label: 'Semanal' },
  { value: 'mes', label: 'Mensal' },
]

function mesAtualISO(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
}

function linkPara(g: Granularidade, mes: string) {
  return `/relatorio-producao?g=${g}&mes=${mes}`
}

export default async function RelatorioProducaoPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string; mes?: string }>
}) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()
  const lojaId = await getCurrentLojaId()

  const sp = await searchParams
  const granularidade: Granularidade = ['dia', 'semana', 'mes'].includes(sp.g ?? '') ? (sp.g as Granularidade) : 'dia'
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : mesAtualISO()

  const { buckets, funcionariosOrdenados } = await carregarDashboardProducao(lojaId, granularidade, mes)

  const total = buckets.reduce((s, b) => s + b.total, 0)
  const bucketsComProducao = buckets.filter((b) => b.total > 0)
  const media = bucketsComProducao.length ? Math.round((total / bucketsComProducao.length) * 10) / 10 : 0
  const melhor = buckets.reduce((m, b) => (b.total > m.total ? b : m), buckets[0] ?? { rotulo: '-', total: 0 })

  const [ano, mesNum] = mes.split('-').map(Number)
  const mesAnterior = new Date(ano, mesNum - 2, 1)
  const mesSeguinte = new Date(ano, mesNum, 1)
  const mesAnteriorISO = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`
  const mesSeguinteISO = `${mesSeguinte.getFullYear()}-${String(mesSeguinte.getMonth() + 1).padStart(2, '0')}`
  const ehMesAtual = mes === mesAtualISO()

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Dashboard de Produção"
          icon={BarChart3}
          description="OPs concluídas por período, com quebra por quem concluiu."
          voltarHref="/relatorios"
        />
      </ListaHeader>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {GRANULARIDADES.map((g) => (
            <Link
              key={g.value}
              href={linkPara(g.value, mes)}
              aria-current={granularidade === g.value ? 'true' : undefined}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium u-motion ${
                granularidade === g.value
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border bg-surface text-text-muted hover:border-brand/40 hover:text-text'
              }`}
            >
              {g.label}
            </Link>
          ))}
        </div>
        {granularidade !== 'mes' && (
          <div className="flex items-center gap-2 text-[13px]">
            <Link href={linkPara(granularidade, mesAnteriorISO)} className="rounded-md border border-border px-2 py-1 hover:bg-surface-2">
              ← Mês anterior
            </Link>
            <span className="font-medium text-text">{mes}</span>
            {!ehMesAtual && (
              <Link href={linkPara(granularidade, mesSeguinteISO)} className="rounded-md border border-border px-2 py-1 hover:bg-surface-2">
                Mês seguinte →
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Total no período</p>
          <p className="num mt-0.5 text-xl font-semibold text-text">{total}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Média nos dias com produção</p>
          <p className="num mt-0.5 text-xl font-semibold text-text">{media}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Melhor período</p>
          <p className="num mt-0.5 text-xl font-semibold text-text">{melhor.rotulo} ({melhor.total})</p>
        </div>
      </div>

      {total === 0 ? (
        <EmptyState icon={BarChart3} title="Sem OPs concluídas no período" hint="Ajuste o período ou aguarde novas conclusões." />
      ) : (
        <ProducaoChart buckets={buckets} funcionariosOrdenados={funcionariosOrdenados} />
      )}

      {/* Tabela de detalhe -- par acessivel do grafico (skill dataviz: sempre precisa existir) */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[500px] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2">
              <th className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Período</th>
              <th className="whitespace-nowrap px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">Total</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Por funcionário</th>
            </tr>
          </thead>
          <tbody>
            {bucketsComProducao.map((b) => (
              <tr key={b.chave} className="border-t border-border/60">
                <td className="whitespace-nowrap px-3 py-2 text-text">{b.rotulo}</td>
                <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">{b.total}</td>
                <td className="px-3 py-2 text-[12px] text-text-muted">
                  {b.porFuncionario.map((f) => `${f.nome}: ${f.qtd}`).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Adicionar entrada no hub `/relatorios`**

Em `app/(app)/relatorios/page.tsx`, adicionar `Factory` (ou reusar `BarChart3`, já importado) e um novo grupo. Import (linha 6, adicionar `Factory` à lista já existente):
```ts
import {
  BarChart3, ShoppingCart, ArrowDownUp, DollarSign, Scale, Percent, ShieldCheck, CalendarCheck, ArrowUpRight, Boxes, ClipboardX, Factory,
} from 'lucide-react'
```
No array `RELATORIOS`, adicionar um grupo novo (depois do grupo `'Dia a dia'`):
```ts
  {
    grupo: 'Produção',
    itens: [
      { href: '/relatorio-producao', titulo: 'Dashboard de Produção', icon: Factory, descricao: 'OPs concluídas por dia/semana/mês, com quebra por quem concluiu.', pergunta: 'Quem produziu e quando?' },
    ],
  },
```

- [ ] **Step 3: Lint**

Run: `npx eslint "app/(app)/relatorio-producao/page.tsx" "app/(app)/relatorios/page.tsx"`
Expected: 0 erros novos.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `EXIT=0`.

- [ ] **Step 5: QA visual real (aplicar a skill dataviz — checks 5-7: hover, legenda, tabela, olhar o resultado renderizado)**

Com `npx next dev -p 3008` rodando e login QA via chrome-devtools MCP:
1. Abrir `/relatorios` — confirmar o card novo "Dashboard de Produção" no grupo "Produção".
2. Abrir `/relatorio-producao` — confirmar KPIs, gráfico (mesmo que vazio/"Não identificado" se não houver OPs concluídas recentes na loja de teste) e tabela de detalhe abaixo.
3. Trocar as abas Diária/Semanal/Mensal e confirmar que a URL e o gráfico mudam.
4. Se houver dado real (loja com produção recente), passar o mouse/focar numa barra e confirmar o tooltip aparece com o total e a quebra por funcionário.
5. Tirar um screenshot da página renderizada — checar visualmente: sem overlap de rótulo, sem barra cortada, legenda legível, sem "número em cima de cada segmento" (só o total no topo).
6. `pkill -f "next dev -p 3008"` ao terminar.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/relatorio-producao/page.tsx" "app/(app)/relatorios/page.tsx"
git commit -m "feat: pagina /relatorio-producao (dashboard de producao por dia/semana/mes e funcionario)"
```

---

### Task 6: Deploy e atualização do catálogo

**Files:**
- Modify: `docs/reuniao-2026-07-27-pedidos.md`

- [ ] **Step 1: Deploy em produção**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```
Expected: HTTP 200.

- [ ] **Step 2: Verificação final em produção**

Repetir os checks visuais do Step 5 da Task 5 contra a URL de produção.

- [ ] **Step 3: Atualizar o catálogo da reunião**

Marcar o item #15 como concluído em `docs/reuniao-2026-07-27-pedidos.md`, com nota explicando a decisão de rastrear `concluida_por` só a partir de agora (sem histórico) e a ressalva sobre conclusão em lote por gerente.

- [ ] **Step 4: Commit**

```bash
git add docs/reuniao-2026-07-27-pedidos.md
git commit -m "docs: marcar item #15 (dashboard de producao) como concluido"
git push
```

## Self-Review Notes

- Cobertura do spec: "dia a dia (1 a 30)" → granularidade `dia`; "visão diária/semanal/mensal" → toggle `g`; "por quem" → `concluida_por` + legenda/tooltip por funcionário; "sem precisar vasculhar relatório" → tabela de detalhe já embutida na mesma página, não é PDF separado.
- Risco assumido e já validado com o usuário: sem histórico de `concluida_por`, e "quem clicou em concluir" pode não ser exatamente "quem produziu" numa conclusão em lote — registrado no texto da página não (não há espaço de sobra), mas registrado no catálogo (Task 6) pra não virar surpresa numa reunião futura.
- Paleta: usa os 7 primeiros slots da paleta de referência já validada da skill `dataviz`, sem rodar o validador de novo (a própria `palette.md` já documenta que passa em todos os checks) — só copiando valores, não differentes.
- Tipos consistentes entre Task 3 (`BucketProducao`, `funcionariosOrdenados: string[]`) e Task 4/5 (mesmos nomes de campo usados em `ProducaoChart` e na página).
