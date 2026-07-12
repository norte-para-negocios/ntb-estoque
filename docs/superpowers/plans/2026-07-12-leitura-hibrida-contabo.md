# Leitura híbrida Supabase + Contabo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fazer as 18 telas/rotas que hoje leem `movimentos`, `movimentos_historico`, `notas_fiscais`, `nota_fiscal_items` ou `ordens_producao` direto do Supabase também consultarem a API do Contabo quando o período pedido sair da janela de 90 dias — para então podar o Supabase com segurança.

**Architecture:** Um módulo central (`lib/historico-contabo.ts`) decide "Supabase só" vs "Supabase + Contabo" e faz o merge; a `ntb-frio-api` (já rodando no Contabo) ganha 5 endpoints `GET`; cada arquivo afetado troca sua leitura simples por uma chamada ao módulo central, sem mudar o resto da lógica. A poda só roda na última task, depois de tudo testado.

**Tech Stack:** Next.js/TypeScript (app), Node/Express (`ntb-frio-api` no Contabo), Postgres 17 (`ntb_frio`).

## Global Constraints

- Nenhuma leitura muda de comportamento dentro dos 90 dias — sempre Supabase puro, idêntico a hoje.
- Falha ou timeout (5s) na API do Contabo nunca quebra uma página — a função central sempre devolve pelo menos o que o Supabase tem.
- `produtos` nunca sai do Supabase nem é duplicado no Contabo.
- Dedup entre as duas fontes é por `id` (preservado idêntico entre Supabase e Contabo desde a cópia) — exceto `movimentos_historico`, que não tem `id`, usa `cod_prod + data`.
- A poda (Task 19) só roda depois de todas as Tasks 3-18 em produção.
- Chave da API (`NTB_FRIO_API_KEY`) e URL (`NTB_FRIO_API_URL`) já existem em `.env.local` e na Vercel — não recriar.

---

### Task 1: Endpoints `GET` na `ntb-frio-api`

**Files:**
- Modify (no servidor Contabo, `/opt/ntb-frio-api/server.js` — fora do repo git, igual ao dual-write): adicionar 5 rotas `GET`

**Interfaces:**
- Produces: `GET /notas_fiscais`, `GET /nota_fiscal_items`, `GET /ordens_producao`, `GET /movimentos`, `GET /movimentos_historico`, todas atrás de `checkAuth` (já existe), retornando `{ rows: [...] }`

- [ ] **Step 1: Ler o `server.js` atual do servidor**

```bash
cd "C:\Users\media\AppData\Local\Temp\claude\C--Users-media\985e2291-388c-419d-92fd-c7b9329664c1\scratchpad" && node ssh-run.mjs "cat /opt/ntb-frio-api/server.js"
```

- [ ] **Step 2: Adicionar as 5 rotas antes de `app.get('/health', ...)`**

```javascript
app.get('/notas_fiscais', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, busca, id } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  const clauses = ['loja_id = $1', 'deleted_at is null'];
  const params = [loja_id];
  if (id) { params.push(id); clauses.push(`id = $${params.length}`); }
  if (data_inicio) { params.push(data_inicio); clauses.push(`d_emissao_nfe >= $${params.length}`); }
  if (data_final) { params.push(data_final); clauses.push(`d_emissao_nfe <= $${params.length}`); }
  if (busca) {
    params.push(`%${busca}%`);
    clauses.push(`(c_numero_nfe ilike $${params.length} or c_razao_social ilike $${params.length} or c_nome ilike $${params.length})`);
  }
  try {
    const sql = `select * from notas_fiscais where ${clauses.join(' and ')} order by d_emissao_nfe desc limit 2000`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /notas_fiscais:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/nota_fiscal_items', checkAuth, async (req, res) => {
  const { loja_id, nota_fiscal_id, data_inicio, data_final } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  try {
    if (nota_fiscal_id) {
      const ids = String(nota_fiscal_id).split(',').map(Number).filter(Boolean);
      const r = await pool.query(
        `select * from nota_fiscal_items where loja_id = $1 and nota_fiscal_id = any($2)`,
        [loja_id, ids]
      );
      return res.json({ rows: r.rows });
    }
    const clauses = ['i.loja_id = $1'];
    const params = [loja_id];
    if (data_inicio) { params.push(data_inicio); clauses.push(`nf.d_emissao_nfe >= $${params.length}`); }
    if (data_final) { params.push(data_final); clauses.push(`nf.d_emissao_nfe <= $${params.length}`); }
    const sql = `
      select i.* from nota_fiscal_items i
      join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
      where ${clauses.join(' and ')} and nf.deleted_at is null
      limit 5000`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /nota_fiscal_items:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/ordens_producao', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, validade_inicio, validade_final, busca, id } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  const clauses = ['loja_id = $1'];
  const params = [loja_id];
  if (id) { params.push(id); clauses.push(`id = $${params.length}`); }
  if (data_inicio) { params.push(data_inicio); clauses.push(`dt_conclusao_real >= $${params.length}`); }
  if (data_final) { params.push(data_final); clauses.push(`dt_conclusao_real <= $${params.length}`); }
  if (validade_inicio) { params.push(validade_inicio); clauses.push(`validade >= $${params.length}`); }
  if (validade_final) { params.push(validade_final); clauses.push(`validade <= $${params.length}`); }
  if (busca) {
    params.push(`%${busca}%`);
    clauses.push(`(num_ordem ilike $${params.length} or identificacao_c_num_op ilike $${params.length})`);
  }
  try {
    const sql = `select * from ordens_producao where ${clauses.join(' and ')} order by id desc limit 2000`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /ordens_producao:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/movimentos', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, id_prod, transferencia_id } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  const clauses = ['loja_id = $1'];
  const params = [loja_id];
  if (data_inicio) { params.push(data_inicio); clauses.push(`data >= $${params.length}`); }
  if (data_final) { params.push(data_final); clauses.push(`data <= $${params.length}`); }
  if (id_prod) { params.push(id_prod); clauses.push(`id_prod = $${params.length}`); }
  if (transferencia_id) { params.push(transferencia_id); clauses.push(`transferencia_id = $${params.length}`); }
  try {
    const sql = `select * from movimentos where ${clauses.join(' and ')} order by data desc limit 5000`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /movimentos:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/movimentos_historico', checkAuth, async (req, res) => {
  const { loja_id, cod_prod, data_inicio, data_final } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  const clauses = ['loja_id = $1'];
  const params = [loja_id];
  if (cod_prod) { params.push(cod_prod); clauses.push(`cod_prod = $${params.length}`); }
  if (data_inicio) { params.push(data_inicio); clauses.push(`data >= $${params.length}`); }
  if (data_final) { params.push(data_final); clauses.push(`data <= $${params.length}`); }
  try {
    const sql = `select * from movimentos_historico where ${clauses.join(' and ')} order by data desc limit 5000`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /movimentos_historico:', e);
    res.status(500).json({ error: 'internal error' });
  }
});
```

- [ ] **Step 3: Transferir o `server.js` atualizado e reiniciar o serviço**

Editar localmente uma cópia, depois transferir via base64 (mesma técnica já usada) e:

```bash
cd "C:\Users\media\AppData\Local\Temp\claude\C--Users-media\985e2291-388c-419d-92fd-c7b9329664c1\scratchpad" && node ssh-run.mjs "systemctl restart ntb-frio-api && systemctl status ntb-frio-api --no-pager | head -5"
```

- [ ] **Step 4: Testar cada endpoint via HTTPS público**

```bash
curl -s "https://frio-api.norteparanegocios.com.br/notas_fiscais?loja_id=3&data_final=2025-08-01" -H "X-Api-Key: 440a6cb43f04272a6d604baeddfd8ccf2efae3665ac4073cde87f5bd6eaf2903" | head -c 300
curl -s "https://frio-api.norteparanegocios.com.br/ordens_producao?loja_id=3&data_final=2025-08-01" -H "X-Api-Key: 440a6cb43f04272a6d604baeddfd8ccf2efae3665ac4073cde87f5bd6eaf2903" | head -c 300
curl -s "https://frio-api.norteparanegocios.com.br/movimentos?loja_id=3&data_final=2025-08-01" -H "X-Api-Key: 440a6cb43f04272a6d604baeddfd8ccf2efae3665ac4073cde87f5bd6eaf2903" | head -c 300
curl -s "https://frio-api.norteparanegocios.com.br/movimentos_historico?loja_id=3&data_final=2025-08-01" -H "X-Api-Key: 440a6cb43f04272a6d604baeddfd8ccf2efae3665ac4073cde87f5bd6eaf2903" | head -c 300
curl -s "https://frio-api.norteparanegocios.com.br/nota_fiscal_items?loja_id=3&data_final=2025-08-01" -H "X-Api-Key: 440a6cb43f04272a6d604baeddfd8ccf2efae3665ac4073cde87f5bd6eaf2903" | head -c 300
```

Expected: todas retornam `{"rows":[...]}` com HTTP 200 (não `{"error":...}`).

---

### Task 2: Módulo central `lib/historico-contabo.ts`

**Files:**
- Create: `lib/historico-contabo.ts`
- Test: `lib/historico-contabo.test.ts` (se o projeto já usa um test runner — confirmar com `cat package.json | grep -A2 '"scripts"'`; se não houver, pular os steps de teste automatizado e validar via chamada manual no Step 5)

**Interfaces:**
- Consumes: `GET /notas_fiscais`, `GET /nota_fiscal_items`, `GET /ordens_producao`, `GET /movimentos`, `GET /movimentos_historico` (Task 1)
- Produces: `complementarNotasFiscais`, `complementarNotaFiscalItems`, `complementarOrdensProducao`, `complementarMovimentos`, `complementarMovimentosHistorico`, `buscarMovimentosHistoricoBrutos` — usados por todas as Tasks 3-18

- [ ] **Step 1: Verificar se há test runner configurado**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && grep -A5 '"scripts"' package.json
```

- [ ] **Step 2: Criar o módulo**

```typescript
// lib/historico-contabo.ts
const JANELA_QUENTE_DIAS = 90

// Data mais antiga que ainda fica no Supabase apos a poda (Task 19). Qualquer
// consulta que peça algo mais velho que isso precisa completar com o Contabo.
function limiteJanelaQuente(): string {
  return new Date(Date.now() - JANELA_QUENTE_DIAS * 86400000).toISOString().slice(0, 10)
}

function foraDaJanelaQuente(dataInicio?: string | null): boolean {
  if (!dataInicio) return true // sem filtro de data = a leitura espera "tudo"
  return dataInicio < limiteJanelaQuente()
}

async function buscarFrio<T>(
  caminho: string,
  params: Record<string, string | number | undefined>
): Promise<T[]> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return []
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    const resp = await fetch(`${url}${caminho}?${qs.toString()}`, {
      headers: { 'X-Api-Key': key ?? '' },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    const json = (await resp.json()) as { rows?: T[] }
    return json.rows ?? []
  } catch (e) {
    console.error(`historico-contabo: falha ao consultar ${caminho}`, e)
    return []
  }
}

function mesclarPorId<T extends { id: number }>(quentes: T[], frias: T[]): T[] {
  const vistos = new Set(quentes.map((r) => r.id))
  return [...quentes, ...frias.filter((r) => !vistos.has(r.id))]
}

export async function complementarNotasFiscais<T extends { id: number }>(
  quentes: T[],
  opts: { lojaId: number; dataInicio?: string; dataFinal?: string; busca?: string; id?: number }
): Promise<T[]> {
  if (!foraDaJanelaQuente(opts.dataInicio) && !opts.id) return quentes
  const frias = await buscarFrio<T>('/notas_fiscais', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
    busca: opts.busca,
    id: opts.id,
  })
  return mesclarPorId(quentes, frias)
}

export async function complementarNotaFiscalItems<T extends { id: number }>(
  quentes: T[],
  opts: { lojaId: number; notaFiscalId?: number | number[]; dataInicio?: string; dataFinal?: string }
): Promise<T[]> {
  if (!opts.notaFiscalId && !foraDaJanelaQuente(opts.dataInicio)) return quentes
  const frias = await buscarFrio<T>('/nota_fiscal_items', {
    loja_id: opts.lojaId,
    nota_fiscal_id: Array.isArray(opts.notaFiscalId) ? opts.notaFiscalId.join(',') : opts.notaFiscalId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
  })
  return mesclarPorId(quentes, frias)
}

export async function complementarOrdensProducao<T extends { id: number }>(
  quentes: T[],
  opts: {
    lojaId: number
    dataInicio?: string
    dataFinal?: string
    validadeInicio?: string
    validadeFinal?: string
    busca?: string
    id?: number
  }
): Promise<T[]> {
  const precisa =
    opts.id || foraDaJanelaQuente(opts.dataInicio) || foraDaJanelaQuente(opts.validadeInicio)
  if (!precisa) return quentes
  const frias = await buscarFrio<T>('/ordens_producao', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
    validade_inicio: opts.validadeInicio,
    validade_final: opts.validadeFinal,
    busca: opts.busca,
    id: opts.id,
  })
  return mesclarPorId(quentes, frias)
}

export async function complementarMovimentos<T extends { id: number }>(
  quentes: T[],
  opts: { lojaId: number; dataInicio?: string; dataFinal?: string; idProd?: number; transferenciaId?: number }
): Promise<T[]> {
  if (!foraDaJanelaQuente(opts.dataInicio)) return quentes
  const frias = await buscarFrio<T>('/movimentos', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
    id_prod: opts.idProd,
    transferencia_id: opts.transferenciaId,
  })
  return mesclarPorId(quentes, frias)
}

export async function complementarMovimentosHistorico<T extends { cod_prod: number; data: string }>(
  quentes: T[],
  opts: { lojaId: number; codProd?: number; dataInicio?: string; dataFinal?: string }
): Promise<T[]> {
  if (!foraDaJanelaQuente(opts.dataInicio)) return quentes
  const frias = await buscarFrio<T>('/movimentos_historico', {
    loja_id: opts.lojaId,
    cod_prod: opts.codProd,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
  })
  const vistos = new Set(quentes.map((r) => `${r.cod_prod}|${r.data}`))
  return [...quentes, ...frias.filter((r) => !vistos.has(`${r.cod_prod}|${r.data}`))]
}

// Usado só pelo caso especial do relatorio-movimentacao (Task 9): busca linhas
// cruas sem mesclar com nada, pra agregacao acontecer em JS.
export async function buscarMovimentosHistoricoBrutos<T>(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
}): Promise<T[]> {
  return buscarFrio<T>('/movimentos_historico', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
  })
}

export { limiteJanelaQuente, foraDaJanelaQuente }
```

- [ ] **Step 3: Checagem de tipos**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit
```

Expected: sem erros novos relacionados a `lib/historico-contabo.ts`.

- [ ] **Step 4: Teste manual rápido (REPL via tsx, já que não há suite de testes automatizados confirmada)**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && node --experimental-strip-types -e "
process.env.NTB_FRIO_API_URL = 'https://frio-api.norteparanegocios.com.br';
process.env.NTB_FRIO_API_KEY = '440a6cb43f04272a6d604baeddfd8ccf2efae3665ac4073cde87f5bd6eaf2903';
import('./lib/historico-contabo.ts').then(async (m) => {
  const r = await m.complementarOrdensProducao([], { lojaId: 3, dataInicio: '2025-08-01', dataFinal: '2025-08-31' });
  console.log('linhas recebidas do Contabo:', r.length);
});
"
```

Expected: `linhas recebidas do Contabo: N` com `N >= 0` sem erro lançado.

- [ ] **Step 5: Commit**

```bash
git add lib/historico-contabo.ts
git commit -m "feat(contabo): modulo central de leitura hibrida Supabase + Contabo"
```

---

### Task 3: `lib/actions/busca-global.ts` (Tier 1)

**Files:**
- Modify: `lib/actions/busca-global.ts:56-95`

**Interfaces:**
- Consumes: `complementarNotasFiscais`, `complementarOrdensProducao` (Task 2)

- [ ] **Step 1: Adaptar `buscaNotas` e `buscaOrdens` para sempre completar com o Contabo (busca sem filtro de data)**

Substituir linhas 56-75 por:

```ts
  const buscaNotas = async (): Promise<BuscaItem[]> => {
    try {
      const { data, error } = await supabase
        .from('notas_fiscais')
        .select('id, c_numero_nfe, c_razao_social, c_nome')
        .eq('loja_id', lojaId)
        .is('deleted_at', null)
        .or(`c_numero_nfe.ilike.${p},c_razao_social.ilike.${p},c_nome.ilike.${p}`)
        .limit(5)
      if (error) return []
      const completas = await complementarNotasFiscais(data ?? [], { lojaId, busca: t })
      return completas.slice(0, 5).map((row) => ({
        tipo: 'Nota' as const,
        label: row.c_razao_social || row.c_nome || 'Fornecedor',
        sub: `NFe ${row.c_numero_nfe ?? '-'}`,
        href: `/nota-fiscal/${row.id}`,
      }))
    } catch {
      return []
    }
  }
```

Substituir linhas 77-95 por:

```ts
  const buscaOrdens = async (): Promise<BuscaItem[]> => {
    try {
      const { data, error } = await supabase
        .from('ordens_producao')
        .select('id, num_ordem, identificacao_c_num_op')
        .eq('loja_id', lojaId)
        .or(`num_ordem.ilike.${p},identificacao_c_num_op.ilike.${p}`)
        .limit(5)
      if (error) return []
      const completas = await complementarOrdensProducao(data ?? [], { lojaId, busca: t })
      return completas.slice(0, 5).map((row) => ({
        tipo: 'OP' as const,
        label: row.num_ordem || row.identificacao_c_num_op || 'Ordem',
        sub: 'OP',
        href: '/ordem-producao',
      }))
    } catch {
      return []
    }
  }
```

- [ ] **Step 2: Adicionar o import**

No topo do arquivo, junto aos outros imports:

```ts
import { complementarNotasFiscais, complementarOrdensProducao } from '@/lib/historico-contabo'
```

- [ ] **Step 3: Checagem de tipos e build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

Expected: build passa sem erro.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/busca-global.ts
git commit -m "feat(contabo): busca global completa com historico do Contabo"
```

---

### Task 4: `app/(app)/ordem-producao/relatorio/route.ts` (Tier 1)

**Files:**
- Modify: `app/(app)/ordem-producao/relatorio/route.ts:59-85`

**Interfaces:**
- Consumes: `complementarOrdensProducao` (Task 2)

Esta rota não tem filtro de data — hoje traz TODAS as OPs da loja, paginado. Depois da poda, o Supabase só teria os últimos 90 dias; a chamada abaixo sempre busca o resto no Contabo.

- [ ] **Step 1: Adicionar `id` ao `select` (necessário pro dedup do módulo central) e completar após o loop de paginação**

Trocar a linha 66 (dentro de `buildQuery`) de:

```ts
      .select(
        'num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, produto_descricao, produto_unidade, validade, concluida',
      )
```

para:

```ts
      .select(
        'id, num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, produto_descricao, produto_unidade, validade, concluida',
      )
```

Logo depois do loop de paginação (após a linha 84, `if (bloco.length < PAGE_SIZE) break`), antes de onde `ordensList` é usado a seguir no arquivo, adicionar:

```ts
  const ordensCompletas = await complementarOrdensProducao(ordensList, { lojaId })
```

E trocar toda referência a `ordensList` mais adiante no arquivo (o `.map(...)` que monta `RelatorioOPItem`) para usar `ordensCompletas` em vez de `ordensList`.

- [ ] **Step 2: Adicionar o import**

```ts
import { complementarOrdensProducao } from '@/lib/historico-contabo'
```

- [ ] **Step 3: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/ordem-producao/relatorio/route.ts"
git commit -m "feat(contabo): relatorio de OP completa com historico do Contabo"
```

---

### Task 5: `app/(app)/transferencia/relatorio/route.ts` (Tier 1)

**Files:**
- Modify: `app/(app)/transferencia/relatorio/route.ts:70-76`

**Interfaces:**
- Consumes: `complementarMovimentos` (Task 2)

- [ ] **Step 1: Adicionar `id` ao select e completar com o Contabo**

Trocar linhas 70-76:

```ts
    if (codigos.length) {
      const { data: movs } = await supabase
        .from('movimentos')
        .select('transferencia_id')
        .eq('loja_id', lojaId)
        .in('id_prod', codigos)
        .not('transferencia_id', 'is', null)
```

por:

```ts
    if (codigos.length) {
      const { data: movsData } = await supabase
        .from('movimentos')
        .select('id, transferencia_id')
        .eq('loja_id', lojaId)
        .in('id_prod', codigos)
        .not('transferencia_id', 'is', null)
      const movs = await complementarMovimentos(movsData ?? [], { lojaId })
```

(A variável `movs` já é consumida logo abaixo no arquivo do mesmo jeito que antes — só a origem dos dados mudou.)

- [ ] **Step 2: Adicionar o import**

```ts
import { complementarMovimentos } from '@/lib/historico-contabo'
```

- [ ] **Step 3: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/transferencia/relatorio/route.ts"
git commit -m "feat(contabo): relatorio de transferencia completa movimentos com Contabo"
```

---

### Task 6: `app/(app)/transferencia/page.tsx` (Tier 1)

**Files:**
- Modify: `app/(app)/transferencia/page.tsx:72-78`

**Interfaces:**
- Consumes: `complementarMovimentos` (Task 2)

- [ ] **Step 1: Mesmo padrão da Task 5**

Trocar linhas 72-78:

```ts
    if (codigos.length) {
      const { data: movs } = await supabase
        .from('movimentos')
        .select('transferencia_id')
        .eq('loja_id', lojaId)
        .in('id_prod', codigos)
        .not('transferencia_id', 'is', null)
```

por:

```ts
    if (codigos.length) {
      const { data: movsData } = await supabase
        .from('movimentos')
        .select('id, transferencia_id')
        .eq('loja_id', lojaId)
        .in('id_prod', codigos)
        .not('transferencia_id', 'is', null)
      const movs = await complementarMovimentos(movsData ?? [], { lojaId })
```

- [ ] **Step 2: Adicionar o import**

```ts
import { complementarMovimentos } from '@/lib/historico-contabo'
```

- [ ] **Step 3: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/transferencia/page.tsx"
git commit -m "feat(contabo): pagina de transferencia completa movimentos com Contabo"
```

---

### Task 7: `app/(app)/home/page.tsx` (Tier 1)

**Files:**
- Modify: `app/(app)/home/page.tsx:80-93`

**Interfaces:**
- Consumes: `limiteJanelaQuente` (Task 2), endpoint `GET /ordens_producao` via `fetch` direto (contagem, não precisa do merge de linhas)

O card "Ordens de produção" (linha 84) conta TODAS as OPs da loja, sem filtro de data — depois da poda, a contagem do Supabase sozinha ficaria menor sem avisar. Como é um `head:true` (só contagem, sem linhas pra fazer merge por `id`), soma-se a contagem do Contabo referente só à parte antiga (evita contar duas vezes o que ainda está nos dois lados).

- [ ] **Step 1: Adicionar a soma da parte antiga depois do `Promise.all`**

Logo após o bloco `Promise.all` (linhas 80-93), adicionar:

```ts
  const cutoff = limiteJanelaQuente()
  let opsAntigasCount = 0
  if (process.env.NTB_FRIO_API_URL) {
    try {
      const resp = await fetch(
        `${process.env.NTB_FRIO_API_URL}/ordens_producao?loja_id=${lojaId}&data_final=${cutoff}`,
        { headers: { 'X-Api-Key': process.env.NTB_FRIO_API_KEY! }, signal: AbortSignal.timeout(5000) }
      )
      if (resp.ok) {
        const json = (await resp.json()) as { rows?: unknown[] }
        opsAntigasCount = json.rows?.length ?? 0
      }
    } catch (e) {
      console.error('home/page: falha ao completar contagem de OPs com o Contabo', e)
    }
  }
  const opsTotalCount = (ops.count ?? 0) + opsAntigasCount
```

- [ ] **Step 2: Trocar o uso de `ops.count` no JSX pelo novo `opsTotalCount`**

Localizar onde `ops.count` é renderizado (card "Ordens de produção") e trocar para `opsTotalCount`.

- [ ] **Step 3: Adicionar o import**

```ts
import { limiteJanelaQuente } from '@/lib/historico-contabo'
```

- [ ] **Step 4: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/home/page.tsx"
git commit -m "feat(contabo): card de OPs na home conta historico do Contabo"
```

---

### Task 8: `lib/resumo-dia.ts` (Tier 2)

**Files:**
- Modify: `lib/resumo-dia.ts:162-175, 214-219, 251-253, 335-337, 389-391`

**Interfaces:**
- Consumes: `complementarNotasFiscais`, `complementarOrdensProducao`, `complementarMovimentos`, `complementarMovimentosHistorico` (Task 2)

Este arquivo aceita qualquer `dataISO` passada (não é só "hoje") — é o de maior risco silencioso.

- [ ] **Step 1: Completar a contagem/soma de `movimentos_historico` (linha 171)**

Trocar:

```ts
    supabase.from('movimentos_historico').select('entradas, saidas').in('loja_id', lojaIds).gte('data', dataIni).lte('data', dataFim),
```

Como essa query usa `.in('loja_id', lojaIds)` (múltiplas lojas), o módulo central (que espera `lojaId: number`) precisa ser chamado por loja e depois concatenado. Trocar o bloco `Promise.all` (linhas 162-175) para primeiro rodar as outras 8 queries normalmente, e tratar `movimentos_historico` à parte, logo depois:

```ts
  const [
    notasRows, transfCount, inventCount, opsPrevCount, opsConclCount, , etiqRows, errosCount, auditCount,
  ] = await Promise.all([
    supabase.from('notas_fiscais').select('n_valor_nfe').in('loja_id', lojaIds)
      .gte('d_emissao_nfe', dataIni).lt('d_emissao_nfe', proxDia).is('deleted_at', null).eq('c_etapa', '60'),
    supabase.from('transferencias').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    supabase.from('inventarios').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    supabase.from('ordens_producao').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('identificacao_d_dt_previsao', dataIni).lte('identificacao_d_dt_previsao', dataFim),
    supabase.from('ordens_producao').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('dt_conclusao_real', dataIni).lte('dt_conclusao_real', dataFim),
    Promise.resolve(null),
    supabase.from('impressao_etiquetas').select('qtd_etiquetas').in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    supabase.from('integration_attempts').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).eq('error', true).gte('created_at', ini).lt('created_at', fim),
    supabase.from('audit_log').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
  ])

  const movHistQuente = (
    await supabase.from('movimentos_historico').select('cod_prod, data, entradas, saidas').in('loja_id', lojaIds).gte('data', dataIni).lte('data', dataFim)
  ).data ?? []
  let movRows = movHistQuente
  if (dataIni < limiteJanelaQuente()) {
    for (const lojaId of lojaIds) {
      movRows = await complementarMovimentosHistorico(movRows, { lojaId, dataInicio: dataIni, dataFinal: dataFim })
    }
  }
```

(`movRows` continua sendo usado do mesmo jeito no resto da função — o shape das linhas é o mesmo, `{ cod_prod, data, entradas, saidas }` em vez de só `{ entradas, saidas }`, o que não quebra os usos existentes que só leem `entradas`/`saidas`.)

- [ ] **Step 2: Completar a categoria `notas` (linhas 214-219)**

Trocar:

```ts
  if (cat === 'notas') {
    const { data } = await supabase.from('notas_fiscais')
      .select('id, d_emissao_nfe, c_numero_nfe, c_nome, c_razao_social, n_valor_nfe, c_etapa, loja_id')
      .in('loja_id', lojaIds).gte('d_emissao_nfe', dataIni).lt('d_emissao_nfe', proxDia).is('deleted_at', null)
      .eq('c_etapa', '60')
      .order('d_emissao_nfe', { ascending: false }).limit(LIMITE_LISTA)
```

por:

```ts
  if (cat === 'notas') {
    const { data: notasQuentes } = await supabase.from('notas_fiscais')
      .select('id, d_emissao_nfe, c_numero_nfe, c_nome, c_razao_social, n_valor_nfe, c_etapa, loja_id')
      .in('loja_id', lojaIds).gte('d_emissao_nfe', dataIni).lt('d_emissao_nfe', proxDia).is('deleted_at', null)
      .eq('c_etapa', '60')
      .order('d_emissao_nfe', { ascending: false }).limit(LIMITE_LISTA)
    let data = notasQuentes ?? []
    for (const lojaId of lojaIds) {
      data = await complementarNotasFiscais(data, { lojaId, dataInicio: dataIni, dataFinal: dataFim })
    }
```

- [ ] **Step 3: Completar a categoria `transferencias` (uso de `movimentos`, linhas 251-253)**

Trocar:

```ts
      transfIds.length
        ? supabase.from('movimentos').select('transferencia_id, id_prod').in('transferencia_id', transfIds).limit(5000)
        : Promise.resolve({ data: [] as { transferencia_id: number; id_prod: number }[] }),
```

por:

```ts
      transfIds.length
        ? supabase.from('movimentos').select('id, transferencia_id, id_prod').in('transferencia_id', transfIds).limit(5000)
        : Promise.resolve({ data: [] as { id: number; transferencia_id: number; id_prod: number }[] }),
```

E depois desse `Promise.all`, completar (o `dataIni` da categoria já está em escopo na função):

```ts
  if (transfIds.length && dataIni < limiteJanelaQuente()) {
    for (const lojaId of lojaIds) {
      movsData = await complementarMovimentos(movsData, { lojaId })
    }
  }
```

(ajustar o nome da variável que recebe o resultado do `Promise.all` conforme o destructuring já existente no arquivo em torno da linha 251 — o padrão é o mesmo das Tasks 5/6.)

- [ ] **Step 4: Completar a categoria `producao` (linhas 335-337)**

Trocar:

```ts
    const { data } = await supabase.from('ordens_producao')
      .select('identificacao_n_cod_produto, identificacao_n_qtde, produto_descricao')
      .in('loja_id', lojaIds).gte('dt_conclusao_real', dataIni).lte('dt_conclusao_real', dataFim).limit(5000)
```

por:

```ts
    const { data: opsQuentes } = await supabase.from('ordens_producao')
      .select('id, identificacao_n_cod_produto, identificacao_n_qtde, produto_descricao')
      .in('loja_id', lojaIds).gte('dt_conclusao_real', dataIni).lte('dt_conclusao_real', dataFim).limit(5000)
    let data = opsQuentes ?? []
    for (const lojaId of lojaIds) {
      data = await complementarOrdensProducao(data, { lojaId, dataInicio: dataIni, dataFinal: dataFim })
    }
```

- [ ] **Step 5: Completar a categoria `movimentacoes` (linhas 389-391)**

Trocar:

```ts
    const { data } = await supabase.from('movimentos_historico')
      .select('loja_id, codigo, descricao, entradas, saidas').in('loja_id', lojaIds).gte('data', dataIni).lte('data', dataFim)
      .order('saidas', { ascending: false }).limit(LIMITE_LISTA)
```

por:

```ts
    const { data: histQuentes } = await supabase.from('movimentos_historico')
      .select('loja_id, cod_prod, codigo, descricao, data, entradas, saidas').in('loja_id', lojaIds).gte('data', dataIni).lte('data', dataFim)
      .order('saidas', { ascending: false }).limit(LIMITE_LISTA)
    let data = histQuentes ?? []
    for (const lojaId of lojaIds) {
      data = await complementarMovimentosHistorico(data, { lojaId, dataInicio: dataIni, dataFinal: dataFim })
    }
```

- [ ] **Step 6: Adicionar os imports**

```ts
import {
  complementarNotasFiscais,
  complementarOrdensProducao,
  complementarMovimentos,
  complementarMovimentosHistorico,
  limiteJanelaQuente,
} from '@/lib/historico-contabo'
```

- [ ] **Step 7: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 8: Teste manual contra uma data antiga**

Rodar o dev server e abrir `/resumo?data=2025-08-15&periodo=mes` (ou a rota equivalente que chama `carregarResumoDia`); confirmar que os números não ficam zerados/vazios comparado ao que existia antes da poda (a poda ainda não rodou nesta altura do plano, então o comportamento deve ser idêntico ao de antes — o objetivo deste teste é só confirmar que a chamada ao Contabo não quebra nada).

- [ ] **Step 9: Commit**

```bash
git add lib/resumo-dia.ts
git commit -m "feat(contabo): resumo do dia completa com historico do Contabo para datas antigas"
```

---

### Task 9: Relatório de movimentação — caso especial (`relatorio-movimentacao/page.tsx` + `export/route.ts`) (Tier 2)

**Files:**
- Modify: `app/(app)/relatorio-movimentacao/page.tsx:408-427`
- Modify: `app/(app)/relatorio-movimentacao/export/route.ts:103-153`

**Interfaces:**
- Consumes: `buscarMovimentosHistoricoBrutos`, `limiteJanelaQuente` (Task 2)
- Produces: `agregarMovimentacaoJS` (helper novo, usado pelos dois arquivos)

A RPC `relatorio_movimentacao_matriz` faz `join` com `produtos` — não dá pra rodar ela no Contabo (ver spec, seção "Caso especial"). Quando o período pedido cruza os 90 dias, busca-se a parte antiga como linhas cruas e agrega-se em JS, usando metadados de produto/preço do Supabase.

- [ ] **Step 1: Criar o helper de agregação, em `lib/historico-contabo.ts` (acrescentar ao arquivo da Task 2)**

```ts
export type LinhaMovHistoricoBruta = {
  loja_id: number
  cod_prod: number
  codigo: string | null
  descricao: string | null
  data: string
  entradas: number
  saidas: number
}

type MetaProduto = { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }
type PrecoProduto = { n_id_produto: number; n_preco_unit: number }

// Reimplementa em JS o mesmo agrupamento da funcao SQL relatorio_movimentacao_matriz
// (supabase/migrations/066_relatorio_movimentacao_filtros.sql) — usada so para a fracao
// da consulta que caiu fora da janela quente, ja que produtos (join da funcao SQL)
// nao pode ser duplicado no Contabo. Se a funcao SQL mudar de novo, replicar aqui tambem.
export function agregarMovimentacaoJS(
  linhas: LinhaMovHistoricoBruta[],
  metaPorCodigo: Map<number, MetaProduto>,
  precoPorProduto: Map<number, number>,
  dim: 'tipo' | 'familia' | 'produto',
  sentido: 'entradas' | 'saidas'
): { rotulo: string; mes: string; qtde: number; valor: number }[] {
  const grupos = new Map<string, { rotulo: string; mes: string; qtde: number; valor: number }>()
  for (const l of linhas) {
    const meta = metaPorCodigo.get(l.cod_prod)
    const rotulo =
      (dim === 'tipo' ? meta?.tipo_item : dim === 'familia' ? meta?.descricao_familia : l.descricao) ||
      'Sem classificação'
    const mes = l.data.slice(0, 7)
    const qtde = sentido === 'entradas' ? l.entradas ?? 0 : l.saidas ?? 0
    if (!qtde) continue
    const preco = precoPorProduto.get(l.cod_prod) ?? 0
    const chave = `${rotulo}|${mes}`
    const acc = grupos.get(chave) ?? { rotulo, mes, qtde: 0, valor: 0 }
    acc.qtde += qtde
    acc.valor += qtde * preco
    grupos.set(chave, acc)
  }
  return [...grupos.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo) || a.mes.localeCompare(b.mes))
}
```

- [ ] **Step 2: Adaptar `relatorio-movimentacao/page.tsx`**

Trocar linhas 424-427:

```ts
  const matriz = await rpcTodos<LinhaMatriz>('relatorio_movimentacao_matriz', {
    p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_dim: 'produto', p_sentido: sentido,
    p_cod_prods: codigosIn, p_produto: produtoBusca ? escapeIlike(produtoBusca) : null,
  })
```

por:

```ts
  const cutoff = limiteJanelaQuente()
  const iniRpc = ini < cutoff ? cutoff : ini
  const matrizRecente = await rpcTodos<LinhaMatriz>('relatorio_movimentacao_matriz', {
    p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: 'produto', p_sentido: sentido,
    p_cod_prods: codigosIn, p_produto: produtoBusca ? escapeIlike(produtoBusca) : null,
  })

  let matriz = matrizRecente
  if (ini < cutoff) {
    const brutas = await buscarMovimentosHistoricoBrutos<LinhaMovHistoricoBruta>({
      lojaId, dataInicio: ini, dataFinal: cutoff,
    })
    const { data: metaRows } = await supabase
      .from('produtos')
      .select('codigo_produto, tipo_item, descricao_familia')
      .eq('loja_id', lojaId)
    const metaPorCodigo = new Map((metaRows ?? []).map((m) => [m.codigo_produto, m]))
    const { data: precoRows } = await supabase
      .from('nota_fiscal_items')
      .select('n_id_produto, n_preco_unit, notas_fiscais!inner(d_emissao_nfe, deleted_at)')
      .eq('loja_id', lojaId)
      .gt('n_preco_unit', 0)
    const precoPorProduto = new Map<number, number>()
    for (const r of (precoRows ?? []) as { n_id_produto: number; n_preco_unit: number }[]) {
      if (r.n_id_produto && !precoPorProduto.has(r.n_id_produto)) precoPorProduto.set(r.n_id_produto, r.n_preco_unit)
    }
    const antiga = agregarMovimentacaoJS(brutas, metaPorCodigo, precoPorProduto, 'produto', sentido)
    const combinados = new Map<string, LinhaMatriz>()
    for (const linha of [...antiga, ...matrizRecente]) {
      const chave = `${linha.rotulo}|${linha.mes}`
      const acc = combinados.get(chave) ?? { rotulo: linha.rotulo, mes: linha.mes, qtde: 0 }
      acc.qtde += linha.qtde
      combinados.set(chave, acc)
    }
    matriz = [...combinados.values()]
  }
```

- [ ] **Step 3: Adicionar os imports em `relatorio-movimentacao/page.tsx`**

```ts
import {
  buscarMovimentosHistoricoBrutos,
  agregarMovimentacaoJS,
  limiteJanelaQuente,
  type LinhaMovHistoricoBruta,
} from '@/lib/historico-contabo'
```

- [ ] **Step 4: Repetir o mesmo padrão em `export/route.ts` (linhas 103-153)**

Aplicar a mesma troca do Step 2 dentro do loop `for (const [sentido, nome, label] of [...])`, usando `ini`/`fim` já calculados nas linhas 104-105 do arquivo, e os mesmos imports do Step 3.

- [ ] **Step 5: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 6: Teste manual**

Rodar o dev server, abrir `/relatorio-movimentacao?data_inicio=2025-07-01&data_final=2026-07-01` (cruza os 90 dias) e comparar o total com o que a tela mostrava antes desta mudança para o mesmo período (deve bater, já que os dados ainda existem no Supabase nesta altura do plano — a poda só roda na Task 19).

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/relatorio-movimentacao/page.tsx" "app/(app)/relatorio-movimentacao/export/route.ts" lib/historico-contabo.ts
git commit -m "feat(contabo): relatorio de movimentacao agrega historico do Contabo em JS"
```

---

### Task 10: `app/(app)/nota-fiscal/relatorio/route.ts` (Tier 2)

**Files:**
- Modify: `app/(app)/nota-fiscal/relatorio/route.ts:104-131`

**Interfaces:**
- Consumes: `complementarNotasFiscais` (Task 2)

- [ ] **Step 1: Adicionar `id` ao tipo `Nota` (já presente no select, linha 118) e completar após o loop de paginação**

O `select` na linha 118 já inclui `id`. Depois do loop `for (let pagina = 0; ; pagina++) { ... }` que popula `notas` (em torno da linha 135, onde o array termina de ser preenchido), adicionar:

```ts
  const notasCompletas = dataInicio < limiteJanelaQuente()
    ? await complementarNotasFiscais(notas, { lojaId, dataInicio, dataFinal, busca: numNfe || fornecedor })
    : notas
```

E trocar o uso de `notas` no `.map(...)` que monta `RelatorioNFItem` (linhas 141-147) para `notasCompletas`.

- [ ] **Step 2: Adicionar o import**

```ts
import { complementarNotasFiscais, limiteJanelaQuente } from '@/lib/historico-contabo'
```

- [ ] **Step 3: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/nota-fiscal/relatorio/route.ts"
git commit -m "feat(contabo): relatorio de NF completa com historico do Contabo"
```

---

### Task 11: `app/(app)/nota-fiscal/export/route.ts` (Tier 2)

**Files:**
- Modify: `app/(app)/nota-fiscal/export/route.ts:97-127`

**Interfaces:**
- Consumes: `complementarNotasFiscais` (Task 2)

- [ ] **Step 1: Adicionar `id` ao tipo `Nota` e ao select (linha 110), completar após a paginação**

Trocar linha 110 de:

```ts
      .select('d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa')
```

para:

```ts
      .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa')
```

Adicionar `id: number` ao tipo `Nota` (linhas 97-104). Depois do loop de paginação que popula `notas`, adicionar:

```ts
  const notasCompletas = dataInicio < limiteJanelaQuente()
    ? await complementarNotasFiscais(notas, { lojaId, dataInicio, dataFinal, busca: params.num_nfe || params.fornecedor })
    : notas
```

E trocar o uso de `notas` no mapeamento de `rows` (linhas 137-143) para `notasCompletas`.

- [ ] **Step 2: Adicionar o import**

```ts
import { complementarNotasFiscais, limiteJanelaQuente } from '@/lib/historico-contabo'
```

- [ ] **Step 3: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/nota-fiscal/export/route.ts"
git commit -m "feat(contabo): export de NF completa com historico do Contabo"
```

---

### Task 12: `app/(app)/nota-fiscal/page.tsx` (Tier 2)

**Files:**
- Modify: `app/(app)/nota-fiscal/page.tsx:154-192`

**Interfaces:**
- Consumes: `complementarNotasFiscais` (Task 2)

Esta tela é paginada (`.range`) e tem uma query de totais separada. Como o merge com o Contabo traz linhas fora de ordem/paginação nativa do Postgres, o tratamento aqui é: só ativar a busca no Contabo quando a página pedida cair fora do que o Supabase sozinho cobre — na prática, mais simples e seguro é completar a lista SEM paginação vinda do Contabo (a paginação do resultado final passa a ser feita em memória sobre o array já mesclado, igual ao padrão já usado em `HistoricoTab.tsx` com `TETO_LINHAS`).

- [ ] **Step 1: Completar a query principal (linhas 154-172)**

Depois da linha 192 (`const [{ data: notasRaw }, { data: totaisRaw, count: totalNotas }] = await Promise.all([query, totaisQuery])`), adicionar:

```ts
  let notas = notasRaw ?? []
  let totalNotasFinal = totalNotas ?? 0
  if (dataInicio < limiteJanelaQuente()) {
    const antes = notas.length
    notas = await complementarNotasFiscais(notas, {
      lojaId, dataInicio, dataFinal,
      busca: params.num_nfe || params.fornecedor,
    })
    totalNotasFinal = (totalNotas ?? 0) + (notas.length - antes)
  }
```

Trocar as referências a `notasRaw` e `totalNotas` no restante da função (montagem do JSX e paginação) para `notas` e `totalNotasFinal` respectivamente.

- [ ] **Step 2: Adicionar o import**

```ts
import { complementarNotasFiscais, limiteJanelaQuente } from '@/lib/historico-contabo'
```

- [ ] **Step 3: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/nota-fiscal/page.tsx"
git commit -m "feat(contabo): listagem de NF completa com historico do Contabo"
```

---

### Task 13: `app/(app)/ordem-producao/export/route.ts` (Tier 2)

**Files:**
- Modify: `app/(app)/ordem-producao/export/route.ts:57-90`

**Interfaces:**
- Consumes: `complementarOrdensProducao` (Task 2)

`sp.data_inicio`/`sp.data_final` são opcionais aqui (sem default) — se ausentes, a rota já lê tudo, então sempre completa com o Contabo nesse caso.

- [ ] **Step 1: Adicionar `id` ao tipo `Ordem` e ao select (linha 73), completar após a paginação**

Trocar linha 72-74 de:

```ts
      .select(
        'num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, validade, concluida',
      )
```

para:

```ts
      .select(
        'id, num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, validade, concluida',
      )
```

Adicionar `id: number` ao tipo `Ordem` (linhas 59-66). Depois do loop de paginação que popula `ordensRaw`, adicionar:

```ts
  const ordensCompletas = (!sp.data_inicio || sp.data_inicio < limiteJanelaQuente())
    ? await complementarOrdensProducao(ordensRaw, { lojaId, dataInicio: sp.data_inicio, dataFinal: sp.data_final })
    : ordensRaw
```

E trocar `ordensRaw` por `ordensCompletas` no mapeamento de `rows` (linhas 114-123).

- [ ] **Step 2: Adicionar o import**

```ts
import { complementarOrdensProducao, limiteJanelaQuente } from '@/lib/historico-contabo'
```

- [ ] **Step 3: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/ordem-producao/export/route.ts"
git commit -m "feat(contabo): export de OP completa com historico do Contabo"
```

---

### Task 14: `components/movimentacoes/MovimentosTab.tsx` (Tier 2)

**Files:**
- Modify: `components/movimentacoes/MovimentosTab.tsx:118-156, 266-274`

**Interfaces:**
- Consumes: `complementarMovimentosHistorico`, `complementarMovimentos`, `complementarOrdensProducao`, `complementarNotaFiscalItems` (Task 2)

- [ ] **Step 1: Completar `movimentos_historico` (linhas 118-123)**

Trocar:

```ts
      const { data: histRows } = await supabase
        .from('movimentos_historico')
        .select('entradas, saidas')
        .eq('loja_id', lojaId)
        .in('cod_prod', idsProdDetalhes)
        .gte('data', ini)
        .lte('data', fim)
```

por:

```ts
      const { data: histRowsRaw } = await supabase
        .from('movimentos_historico')
        .select('cod_prod, data, entradas, saidas')
        .eq('loja_id', lojaId)
        .in('cod_prod', idsProdDetalhes)
        .gte('data', ini)
        .lte('data', fim)
      const histRows = await complementarMovimentosHistorico(histRowsRaw ?? [], { lojaId, dataInicio: ini, dataFinal: fim })
```

- [ ] **Step 2: Completar `movimentos`, `ordens_producao` e `nota_fiscal_items` (linhas 132-156)**

Trocar o `Promise.all` de 132-156 (adicionando `id` ao select de `nota_fiscal_items`, que hoje não tem, e completando cada um depois):

```ts
      const [{ data: movsRaw }, { data: opsRaw }, { data: nfItemsRaw }, { data: invItems }] = await Promise.all([
        supabase
          .from('movimentos')
          .select('id, data, tipo, quan, codigo_local_estoque, codigo_local_estoque_destino, obs, status')
          .eq('loja_id', lojaId)
          .in('id_prod', idsProdDetalhes)
          .gte('data', ini)
          .lt('data', fimExcl)
          .order('data', { ascending: false })
          .limit(500),
        supabase
          .from('ordens_producao')
          .select('id, identificacao_d_dt_previsao, dt_conclusao_real, concluida, identificacao_n_qtde, quantidade, identificacao_c_num_op, num_ordem')
          .eq('loja_id', lojaId)
          .in('identificacao_n_cod_produto', idsProdDetalhes)
          .gte('identificacao_d_dt_previsao', ini)
          .lte('identificacao_d_dt_previsao', fim)
          .order('identificacao_d_dt_previsao', { ascending: false })
          .limit(300),
        supabase
          .from('nota_fiscal_items')
          .select('id, n_id_produto, n_qtde_nfe, c_codigo_produto, notas_fiscais!inner(d_emissao_nfe, c_numero_nfe, c_natureza_operacao)')
          .eq('loja_id', lojaId)
          .in('n_id_produto', idsProdDetalhes)
          .limit(500),
        // ... (query de inventario inalterada, mantida como no arquivo original)
      ])

      const movs = await complementarMovimentos(movsRaw ?? [], { lojaId, dataInicio: ini, dataFinal: fimExcl })
      const ops = await complementarOrdensProducao(opsRaw ?? [], { lojaId, dataInicio: ini, dataFinal: fim })
      const nfItems = ini < limiteJanelaQuente()
        ? await complementarNotaFiscalItems(nfItemsRaw ?? [], { lojaId, dataInicio: ini, dataFinal: fim })
        : (nfItemsRaw ?? [])
```

(Manter a 4ª posição do array, `invItems`/inventário, exatamente como já está no arquivo — não faz parte do escopo desta migração.)

- [ ] **Step 3: Completar a query de saldo posterior (linhas 266-274)**

Trocar:

```ts
              if (fim < hojeISO) {
                const { data: posteriores } = await supabase
                  .from('movimentos')
                  .select('tipo, quan, codigo_local_estoque, codigo_local_estoque_destino')
                  .eq('loja_id', lojaId)
                  .eq('id_prod', produtoUnico.id_prod)
                  .eq('status', 'Concluido')
                  .gte('data', fimExcl)
                  .limit(1000)
```

por:

```ts
              if (fim < hojeISO) {
                const { data: posterioresRaw } = await supabase
                  .from('movimentos')
                  .select('id, tipo, quan, codigo_local_estoque, codigo_local_estoque_destino')
                  .eq('loja_id', lojaId)
                  .eq('id_prod', produtoUnico.id_prod)
                  .eq('status', 'Concluido')
                  .gte('data', fimExcl)
                  .limit(1000)
                const posteriores = await complementarMovimentos(posterioresRaw ?? [], { lojaId, dataInicio: fimExcl })
```

- [ ] **Step 4: Adicionar os imports**

```ts
import {
  complementarMovimentosHistorico,
  complementarMovimentos,
  complementarOrdensProducao,
  complementarNotaFiscalItems,
  limiteJanelaQuente,
} from '@/lib/historico-contabo'
```

- [ ] **Step 5: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add components/movimentacoes/MovimentosTab.tsx
git commit -m "feat(contabo): aba de movimentos completa com historico do Contabo"
```

---

### Task 15: `components/movimentacoes/HistoricoTab.tsx` (Tier 2)

**Files:**
- Modify: `components/movimentacoes/HistoricoTab.tsx:90-112, 163-206`

**Interfaces:**
- Consumes: `complementarMovimentosHistorico` (Task 2)

- [ ] **Step 1: Completar `lerTudo()` (linhas 90-112)**

Depois do loop `for (let off = 0; ...)` que popula `todas`, antes do `return todas`:

```ts
  async function lerTudo(): Promise<LinhaRaw[]> {
    const todas: LinhaRaw[] = []
    const LOTE = 1000
    for (let off = 0; off < TETO_LINHAS; off += LOTE) {
      let q = supabase
        .from('movimentos_historico')
        .select('cod_prod, codigo, descricao, data, entradas, saidas')
        .eq('loja_id', lojaId)
        .gte('data', ini)
        .lte('data', fim)
        .order('data', { ascending: false })
        .order('saidas', { ascending: false })
        .order('cod_prod', { ascending: true })
        .range(off, off + LOTE - 1)
      if (termo) q = q.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
      if (codigosIn) q = q.in('cod_prod', codigosIn)
      const { data } = await q
      const lote = (data ?? []) as LinhaRaw[]
      todas.push(...lote)
      if (lote.length < LOTE) break
    }
    if (ini < limiteJanelaQuente()) {
      return complementarMovimentosHistorico(todas, { lojaId, dataInicio: ini, dataFinal: fim })
    }
    return todas
  }
```

- [ ] **Step 2: Completar o modo "por data" (linhas 163-206)**

Depois de montar `query`/`totaisQuery` e rodar `const { data } = await query` (em torno da linha 176 do arquivo original) e `const { data: totaisData } = await totaisQuery` (em torno da linha 206), envolver ambos:

```ts
    const { data: dataRaw } = await query
    let data = (dataRaw ?? []) as LinhaRaw[]
    const { data: totaisRaw } = await totaisQuery
    let totaisData = (totaisRaw ?? []) as { cod_prod: number; entradas: number; saidas: number }[]
    if (ini < limiteJanelaQuente()) {
      data = await complementarMovimentosHistorico(data, { lojaId, dataInicio: ini, dataFinal: fim })
      totaisData = await complementarMovimentosHistorico(totaisData as LinhaRaw[], { lojaId, dataInicio: ini, dataFinal: fim })
    }
```

(Ajustar os nomes de variável para bater com o que o resto da função já usa daqui pra frente — o objetivo é só envolver as duas leituras existentes com o complemento do Contabo, mantendo os nomes finais `data`/`totaisData` que o restante do arquivo espera.)

- [ ] **Step 3: Adicionar o import**

```ts
import { complementarMovimentosHistorico, limiteJanelaQuente } from '@/lib/historico-contabo'
```

- [ ] **Step 4: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add components/movimentacoes/HistoricoTab.tsx
git commit -m "feat(contabo): aba de historico completa com dados do Contabo"
```

---

### Task 16: `app/(app)/validade/page.tsx` (Tier 2)

**Files:**
- Modify: `app/(app)/validade/page.tsx:78-143`

**Interfaces:**
- Consumes: `complementarOrdensProducao` (Task 2)

Aqui o filtro é sobre `validade`, não sobre atividade — usa-se `validadeInicio`/`validadeFinal` do módulo central em vez de `dataInicio`/`dataFinal`, já que a coluna relevante é outra.

- [ ] **Step 1: Completar a query principal (linhas 78-89)**

Depois de `const { data: ordensRaw } = await ordensQuery` (a variável que recebe o resultado da query montada nas linhas 78-89), adicionar:

```ts
  const ordens = vencidos
    ? await complementarOrdensProducao(ordensRaw ?? [], { lojaId, validadeInicio: '0001-01-01', validadeFinal: hojeMais(-1) })
    : await complementarOrdensProducao(ordensRaw ?? [], { lojaId, validadeInicio: hojeMais(0), validadeFinal: hojeMais(dias) })
```

(O `validadeInicio: '0001-01-01'` no modo `vencidos` força `foraDaJanelaQuente` a sempre completar com o Contabo, já que não há limite inferior real nesse modo — qualquer OP vencida há muito tempo deve aparecer.)

- [ ] **Step 2: Completar as 6 contagens (`queryContagem()`, linhas 121-143)**

Como são `head:true` (só contagem), seguir o mesmo padrão da Task 7 (home/page.tsx) — somar a contagem do Contabo pra faixa `< limiteJanelaQuente()` quando aplicável. Trocar:

```ts
  const hoje0 = hojeMais(0)
  const [cVencidos, c0, c7, c15, c30, c60] = await Promise.all(
    [
      queryContagem().lt('validade', hoje0),
      queryContagem().gte('validade', hoje0).lte('validade', hoje0),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(7)),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(15)),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(30)),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(60)),
    ].map((p) => p.then((r) => r.count ?? 0)),
  )
```

por:

```ts
  const hoje0 = hojeMais(0)
  const [cVencidosBase, c0, c7, c15, c30, c60] = await Promise.all(
    [
      queryContagem().lt('validade', hoje0),
      queryContagem().gte('validade', hoje0).lte('validade', hoje0),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(7)),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(15)),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(30)),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(60)),
    ].map((p) => p.then((r) => r.count ?? 0)),
  )
  // "Vencidos" nao tem limite inferior — a poda pode ter tirado do Supabase OPs
  // com validade vencida ha muito tempo, entao sempre completa com o Contabo.
  const vencidasAntigas = await complementarOrdensProducao([], {
    lojaId, validadeInicio: '0001-01-01', validadeFinal: hojeMais(-1),
  })
  const cVencidos = cVencidosBase + vencidasAntigas.length
```

- [ ] **Step 3: Adicionar o import**

```ts
import { complementarOrdensProducao } from '@/lib/historico-contabo'
```

- [ ] **Step 4: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/validade/page.tsx"
git commit -m "feat(contabo): pagina de validade completa OPs antigas com Contabo"
```

---

### Task 17: `app/(app)/ordem-producao/page.tsx` (Tier 3)

**Files:**
- Modify: `app/(app)/ordem-producao/page.tsx:138-174, 281-304`

**Interfaces:**
- Consumes: `complementarOrdensProducao` (Task 2)

Comportamento padrão (mês corrente) já é seguro; só precisa completar quando o usuário customizar `data_inicio`/`data_final` pra um período antigo.

- [ ] **Step 1: Completar `baseQuery()` no ponto de uso (onde o resultado é lido para popular a tela — localizar a chamada de `baseQuery()` seguida de `.range(...)` que traz `ordens`)**

Onde a lista de OPs da página é lida (após `const { data: ordensRaw } = await baseQuery()...`), adicionar:

```ts
  const ordens = dataInicio < limiteJanelaQuente()
    ? await complementarOrdensProducao(ordensRaw ?? [], { lojaId, dataInicio, dataFinal })
    : (ordensRaw ?? [])
```

- [ ] **Step 2: Completar `totaisBase()` (linhas 281-304, contagens)**

Trocar:

```ts
  const [
    { count: totConcluidas },
    { count: totPrevistas },
    { count: totPendentes },
    { count: totAtrasadas },
  ] = await Promise.all([
    totaisBase().eq('concluida', true),
    totaisBase().eq('concluida', false).gt('identificacao_d_dt_previsao', hojeISO),
    totaisBase().eq('concluida', false).eq('identificacao_d_dt_previsao', hojeISO),
    totaisBase().eq('concluida', false).lt('identificacao_d_dt_previsao', hojeISO),
  ])
```

por:

```ts
  const [
    { count: totConcluidas },
    { count: totPrevistas },
    { count: totPendentes },
    { count: totAtrasadas },
  ] = await Promise.all([
    totaisBase().eq('concluida', true),
    totaisBase().eq('concluida', false).gt('identificacao_d_dt_previsao', hojeISO),
    totaisBase().eq('concluida', false).eq('identificacao_d_dt_previsao', hojeISO),
    totaisBase().eq('concluida', false).lt('identificacao_d_dt_previsao', hojeISO),
  ])
  let totConcluidasFinal = totConcluidas ?? 0
  if (dataInicio < limiteJanelaQuente()) {
    const antigasConcluidas = await complementarOrdensProducao([], { lojaId, dataInicio, dataFinal })
    totConcluidasFinal = (totConcluidas ?? 0) + antigasConcluidas.filter((o) => o.concluida).length
  }
```

(Contagens de `prevista`/`pendente`/`atrasada` dependem de `identificacao_d_dt_previsao >= hoje` ou `= hoje`, que por definição está sempre dentro da janela quente — só `concluida` precisa do complemento.)

- [ ] **Step 3: Trocar o uso de `totConcluidas` no JSX por `totConcluidasFinal`**

- [ ] **Step 4: Adicionar o import**

```ts
import { complementarOrdensProducao, limiteJanelaQuente } from '@/lib/historico-contabo'
```

- [ ] **Step 5: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/ordem-producao/page.tsx"
git commit -m "feat(contabo): pagina de OP completa periodo customizado com Contabo"
```

---

### Task 18: `app/(app)/nota-fiscal/[id]/page.tsx` (fallback de link)

**Files:**
- Modify: `app/(app)/nota-fiscal/[id]/page.tsx:20-35`

**Interfaces:**
- Consumes: `complementarNotasFiscais`, `complementarNotaFiscalItems` (Task 2)

- [ ] **Step 1: Completar a busca da nota quando não encontrada no Supabase**

Trocar linhas 20-25:

```ts
  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('id, c_numero_nfe, c_razao_social, c_nome, c_chave_nfe, d_emissao_nfe, n_valor_nfe, c_etapa, n_id_receb')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()
```

por:

```ts
  const { data: nfSupabase } = await supabase
    .from('notas_fiscais')
    .select('id, c_numero_nfe, c_razao_social, c_nome, c_chave_nfe, d_emissao_nfe, n_valor_nfe, c_etapa, n_id_receb')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()

  const nf = nfSupabase ?? (await complementarNotasFiscais([], { lojaId, id: Number(id) }))[0] ?? null
```

- [ ] **Step 2: Completar os itens quando a nota veio do Contabo**

Trocar linhas 29-35:

```ts
  const [{ data: itens }, { data: categorias }] = await Promise.all([
    supabase
      .from('nota_fiscal_items')
      .select('id, c_codigo_produto, c_descricao_produto, c_cfop, n_qtde_nfe, c_unidade_nfe, n_preco_unit, v_total_item, quantidade, categoria_contabil_id')
      .eq('nota_fiscal_id', id)
      .eq('loja_id', lojaId)
      .order('n_sequencia'),
```

por:

```ts
  const [{ data: itensRaw }, { data: categorias }] = await Promise.all([
    supabase
      .from('nota_fiscal_items')
      .select('id, c_codigo_produto, c_descricao_produto, c_cfop, n_qtde_nfe, c_unidade_nfe, n_preco_unit, v_total_item, quantidade, categoria_contabil_id')
      .eq('nota_fiscal_id', id)
      .eq('loja_id', lojaId)
      .order('n_sequencia'),
```

(manter a segunda posição do `Promise.all`, `categorias`, exatamente como já está no arquivo). Logo após o `Promise.all`, adicionar:

```ts
  const itens = nfSupabase
    ? itensRaw
    : await complementarNotaFiscalItems(itensRaw ?? [], { lojaId, notaFiscalId: Number(id) })
```

- [ ] **Step 3: Adicionar o import**

```ts
import { complementarNotasFiscais, complementarNotaFiscalItems } from '@/lib/historico-contabo'
```

- [ ] **Step 4: Build**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/nota-fiscal/[id]/page.tsx"
git commit -m "feat(contabo): pagina de detalhe de NF cai pro Contabo se nao achar no Supabase"
```

---

### Task 19: Poda no Supabase (agora segura)

**Files:**
- Nenhum arquivo novo — reaproveita `podar-supabase.mjs`, já escrito e transferido pro servidor Contabo na Task 7 do plano `docs/superpowers/plans/2026-07-12-backfill-historico-1ano-contabo.md`

**Interfaces:**
- Consumes: todas as Tasks 3-18 em produção e validadas

- [ ] **Step 1: Confirmar que todas as Tasks 3-18 foram deployadas e testadas em produção há pelo menos alguns dias sem erro reportado**

Checar logs de erro (`console.error` das funções `buscarFrio`/`historico-contabo`) — se o projeto tiver alguma integração de log (Vercel logs, Sentry, etc.), revisar por `historico-contabo: falha ao consultar` nos últimos dias.

- [ ] **Step 2: Rodar o dry-run**

```bash
cd "C:\Users\media\AppData\Local\Temp\claude\C--Users-media\985e2291-388c-419d-92fd-c7b9329664c1\scratchpad" && node ssh-run.mjs "cd /opt/ntb-backfill && node podar-supabase.mjs"
```

Expected: todas as linhas `Seguro=true`.

- [ ] **Step 3: Medir o tamanho do banco antes**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && node scripts/db.mjs "select pg_size_pretty(pg_database_size(current_database()))"
```

- [ ] **Step 4: Rodar de verdade**

```bash
cd "C:\Users\media\AppData\Local\Temp\claude\C--Users-media\985e2291-388c-419d-92fd-c7b9329664c1\scratchpad" && node ssh-run.mjs "cd /opt/ntb-backfill && node podar-supabase.mjs --commit"
```

- [ ] **Step 5: Medir o tamanho do banco depois**

```bash
cd "C:\Users\media\OneDrive\Desktop\EMPRESA TRIFORCE AUTO\clientes\ntb-ramon-andrey\ntb-estoque-next" && node scripts/db.mjs "select pg_size_pretty(pg_database_size(current_database()))"
```

Expected: bem menor que antes.

- [ ] **Step 6: QA manual pós-poda — abrir cada tela adaptada com um período/termo antigo e confirmar que o dado continua aparecendo**

Roteiro mínimo: busca global por um número de NF de 2025; `/resumo?data=2025-08-15&periodo=mes`; `/relatorio-movimentacao?data_inicio=2025-07-01`; `/nota-fiscal?data_inicio=2025-07-01`; `/ordem-producao?data_inicio=2025-07-01`; `/validade?modo=vencidos`; abrir o link de uma nota fiscal antiga direto pela URL (`/nota-fiscal/<id-de-uma-nota-de-2025>`).

- [ ] **Step 7: Atualizar `AGENTS.md` e commit final**

```bash
git add AGENTS.md
git commit -m "docs: documenta arquitetura final de leitura hibrida Supabase + Contabo"
git push origin main
```
