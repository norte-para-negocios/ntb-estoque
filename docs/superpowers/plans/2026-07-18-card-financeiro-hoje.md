# Card financeiro "hoje" + meta configurável Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Card financeiro "hoje" (saldo, a pagar/receber em aberto, fluxo de caixa projetado) no relatório de Indicadores, via 1 chamada ao vivo `ObterResumoFinancas` (sem sync/tabela nova), e tornar a meta compras/faturamento (hoje hardcoded) editável por loja.

**Architecture:** `lib/omie/financeiro-resumo.ts` novo faz a chamada Omie e nunca lança erro (retorna `null` em falha). `relatorio-indicadores/page.tsx` passa a buscar a linha da própria loja (hoje só usa o `id`), chama a função nova e renderiza o card; a meta vira `loja.meta_compras_pct ?? 40` em vez do `META_PCT` fixo. Edição da meta segue o padrão já existente de `editarLojaNegocio`/`InformacoesForm.tsx` em "Minha loja".

**Tech Stack:** Next.js Server Components, Supabase (migration simples), Omie API (`omieRequest` já existente).

## Global Constraints

- Chamada Omie: `endpoint: 'v1/financas/resumo'`, `call: 'ObterResumoFinancas'`, `data: { dDia: dataOmieBR(null) }` (helper já existente em `lib/data-bahia.ts`, retorna hoje em `DD/MM/AAAA` fuso America/Bahia).
- Resposta real testada (loja 3, 2026-07-17): `contaCorrente.vTotal` é **um número agregado** (não por conta bancária); `contaPagar`/`contaReceber` (`nTotal`, `vAtraso`, `vTotal`) são o total de **todos os títulos em aberto**, não só os que vencem hoje; `fluxoCaixa` é um array de 10 dias (`dDia`, `vPagar`, `vReceber`, `vSaldo`) começando em `dDia`, só projeção (sem "realizado").
- Sem suite automatizada neste repo — verificação manual (chamada real numa loja de teste, nunca a loja 4 pra testes ao vivo — usar loja 3 ou 7).
- A chamada ao Omie nunca pode quebrar a página: qualquer erro (rede, rate limit, credencial) faz a função devolver `null`, e o card some da tela — mesmo princípio de `buscarFrio`/`gravarFatoNoFrio` já usado no projeto.
- `meta_compras_pct` é nula por padrão (comportamento idêntico ao `META_PCT = 40` fixo atual para quem não configurar).

---

### Task 1: Coluna `meta_compras_pct` em `lojas`

**Files:**
- Create: `supabase/migrations/080_lojas_meta_compras_pct.sql`

**Interfaces:**
- Produces: coluna `lojas.meta_compras_pct numeric` (nula, check 0-100). Tasks 3 e 4 consomem.

- [ ] **Step 1: Escrever a migration**

```sql
alter table lojas
  add column if not exists meta_compras_pct numeric check (meta_compras_pct between 0 and 100);
```

- [ ] **Step 2: Aplicar**

```bash
node scripts/aplicar-migration.mjs 080_lojas_meta_compras_pct.sql
```

- [ ] **Step 3: Verificar**

```bash
node scripts/db.mjs "select column_name, data_type from information_schema.columns where table_name='lojas' and column_name='meta_compras_pct'"
```
Esperado: 1 linha, `numeric`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/080_lojas_meta_compras_pct.sql
git commit -m "feat(db): coluna meta_compras_pct em lojas"
```

---

### Task 2: `lib/omie/financeiro-resumo.ts` — chamada ao `ObterResumoFinancas`

**Files:**
- Create: `lib/omie/financeiro-resumo.ts`

**Interfaces:**
- Consumes: `omieRequest` (`lib/omie/client.ts`), `LojaOmie`, `dataOmieBR` (`lib/data-bahia.ts`).
- Produces: `type ResumoFinanceiroHoje = { contaCorrente: { vTotal: number }; contaPagar: { nTotal: number; vAtraso: number; vTotal: number }; contaReceber: { nTotal: number; vAtraso: number; vTotal: number }; fluxoCaixa: { dDia: string; vPagar: number; vReceber: number; vSaldo: number }[] }`; `buscarResumoFinanceiroHoje(loja: LojaOmie): Promise<ResumoFinanceiroHoje | null>`. Task 4 consome.

- [ ] **Step 1: Criar o arquivo**

```ts
// Card financeiro "hoje" (relatorio-indicadores): 1 chamada ao vivo ao Omie,
// sem sync nem tabela nova. Nunca lanca erro -- se o Omie falhar (rede, rate
// limit, credencial), devolve null e o card simplesmente nao aparece (mesmo
// principio de buscarFrio/gravarFatoNoFrio: nunca quebrar a pagina por causa
// de uma fonte auxiliar).
import { omieRequest, type LojaOmie } from './client'
import { dataOmieBR } from '@/lib/data-bahia'

export type ResumoFinanceiroHoje = {
  contaCorrente: { vTotal: number }
  contaPagar: { nTotal: number; vAtraso: number; vTotal: number }
  contaReceber: { nTotal: number; vAtraso: number; vTotal: number }
  fluxoCaixa: { dDia: string; vPagar: number; vReceber: number; vSaldo: number }[]
}

export async function buscarResumoFinanceiroHoje(loja: LojaOmie): Promise<ResumoFinanceiroHoje | null> {
  try {
    const r = await omieRequest<ResumoFinanceiroHoje>({
      loja_id: loja.id,
      omie_app_key: loja.omie_app_key,
      omie_app_secret: loja.omie_app_secret,
      endpoint: 'v1/financas/resumo',
      call: 'ObterResumoFinancas',
      data: { dDia: dataOmieBR(null) },
    })
    if (!r?.contaCorrente) return null
    return r
  } catch (e) {
    console.error('financeiro-resumo: falha ao consultar ObterResumoFinancas', e)
    return null
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Verificação manual (chamada real, loja 3 ou 7 — nunca a 4)**

Criar um script ad-hoc temporário (fora do repo git, no scratchpad da sessão) que reimplementa só a chamada, pra confirmar a resposta real sem depender do Next.js:

```js
// scratchpad: verificar-resumo-financeiro.mjs
import fs from 'node:fs'
const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const lojaId = Number(process.argv[2] || 3)
const { execSync } = await import('node:child_process')
const rows = JSON.parse(execSync(`node scripts/db.mjs "select omie_app_key, omie_app_secret from lojas where id=${lojaId}"`).toString())
const loja = rows[0]
const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
const r = await fetch('https://app.omie.com.br/api/v1/financas/resumo/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ call: 'ObterResumoFinancas', app_key: loja.omie_app_key, app_secret: loja.omie_app_secret, param: [{ dDia: hoje }] }),
})
console.log(JSON.stringify(await r.json(), null, 2))
```

Rodar (a partir da raiz do repo, onde `.env.local` existe): `node /caminho/do/scratchpad/verificar-resumo-financeiro.mjs 3`. Esperado: JSON com `contaCorrente`, `contaPagar`, `contaReceber`, `fluxoCaixa` (mesmo formato já documentado na spec). Confirma que a função `buscarResumoFinanceiroHoje` (que usa o mesmo `omieRequest`/`endpoint`/`call`/`data`) vai receber o dado certo quando chamada pela Task 4.

- [ ] **Step 4: Commit**

```bash
git add lib/omie/financeiro-resumo.ts
git commit -m "feat: busca o resumo financeiro do dia via Omie (sem sync)"
```

---

### Task 3: Meta editável em "Minha loja"

**Files:**
- Modify: `lib/actions/minha-loja.ts`
- Modify: `components/minha-loja/InformacoesForm.tsx`
- Modify: `app/(app)/minha-loja/page.tsx`

**Interfaces:**
- Consumes: coluna `lojas.meta_compras_pct` (Task 1).
- Produces: `LojaNegocioInput` ganha o campo `meta_compras_pct: string`; nenhuma interface nova além disso (mesma `editarLojaNegocio`).

- [ ] **Step 1: `lib/actions/minha-loja.ts` — adicionar o campo ao input e ao update**

Localizar:

```ts
export type LojaNegocioInput = {
  nome_fantasia: string
  cep: string
  uf: string
  cidade: string
  bairro: string
  logradouro: string
  numero: string
}
```

Substituir por:

```ts
export type LojaNegocioInput = {
  nome_fantasia: string
  cep: string
  uf: string
  cidade: string
  bairro: string
  logradouro: string
  numero: string
  meta_compras_pct: string
}
```

Localizar, dentro de `editarLojaNegocio`:

```ts
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('lojas')
    .update({
      nome_fantasia: dados.nome_fantasia.trim() || null,
      cep: dados.cep.trim() || null,
      uf: dados.uf.trim() || null,
      cidade: dados.cidade.trim() || null,
      bairro: dados.bairro.trim() || null,
      logradouro: dados.logradouro.trim() || null,
      numero: dados.numero.trim() || null,
    })
    .eq('id', lojaId)
```

Substituir por (usa o `clamp` que já existe mais abaixo no arquivo — mover a definição de `clamp` pra ANTES de `editarLojaNegocio`, já que hoje ela está declarada depois e só é usada por `salvarEtiquetaConfig`):

```ts
  const metaPct = dados.meta_compras_pct.trim()
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('lojas')
    .update({
      nome_fantasia: dados.nome_fantasia.trim() || null,
      cep: dados.cep.trim() || null,
      uf: dados.uf.trim() || null,
      cidade: dados.cidade.trim() || null,
      bairro: dados.bairro.trim() || null,
      logradouro: dados.logradouro.trim() || null,
      numero: dados.numero.trim() || null,
      meta_compras_pct: metaPct ? clamp(Number(metaPct), 0, 100, 40) : null,
    })
    .eq('id', lojaId)
```

Mover a linha `const clamp = (n: number, min: number, max: number, fallback: number) => ...` (hoje logo antes de `salvarEtiquetaConfig`) pra logo depois da função `lojaGerivel`, antes de `editarLojaNegocio` — só reposicionamento, sem mudar o conteúdo da função.

- [ ] **Step 2: `components/minha-loja/InformacoesForm.tsx` — adicionar o campo na `LojaInfo` e no form**

Localizar:

```ts
export type LojaInfo = {
  nome: string | null
  nome_fantasia: string | null
  cnpj: string | null
  cep: string | null
  uf: string | null
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
}
```

Substituir por:

```ts
export type LojaInfo = {
  nome: string | null
  nome_fantasia: string | null
  cnpj: string | null
  cep: string | null
  uf: string | null
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  meta_compras_pct: number | null
}
```

Localizar:

```ts
  const [form, setForm] = useState<LojaNegocioInput>({
    nome_fantasia: loja.nome_fantasia ?? '',
    cep: loja.cep ?? '',
    uf: loja.uf ?? '',
    cidade: loja.cidade ?? '',
    bairro: loja.bairro ?? '',
    logradouro: loja.logradouro ?? '',
    numero: loja.numero ?? '',
  })
```

Substituir por:

```ts
  const [form, setForm] = useState<LojaNegocioInput>({
    nome_fantasia: loja.nome_fantasia ?? '',
    cep: loja.cep ?? '',
    uf: loja.uf ?? '',
    cidade: loja.cidade ?? '',
    bairro: loja.bairro ?? '',
    logradouro: loja.logradouro ?? '',
    numero: loja.numero ?? '',
    meta_compras_pct: loja.meta_compras_pct != null ? String(loja.meta_compras_pct) : '',
  })
```

Localizar o fim do grid de campos (logo antes do `</div>` que fecha `grid grid-cols-2 gap-3 sm:grid-cols-4`):

```tsx
        <div>
          <label className={labelClass}>Número</label>
          <input className={inputClass} value={form.numero} onChange={(e) => set('numero', e.target.value)} />
        </div>
      </div>
```

Substituir por:

```tsx
        <div>
          <label className={labelClass}>Número</label>
          <input className={inputClass} value={form.numero} onChange={(e) => set('numero', e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Meta compras ÷ faturamento (%)</label>
          <input
            className={`${inputClass} num`}
            value={form.meta_compras_pct}
            placeholder="40"
            inputMode="decimal"
            onChange={(e) => set('meta_compras_pct', e.target.value.replace(/[^0-9.,]/g, ''))}
          />
        </div>
      </div>
```

- [ ] **Step 3: `app/(app)/minha-loja/page.tsx` — incluir a coluna na query**

Localizar:

```ts
  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia, cnpj, cep, uf, cidade, bairro, logradouro, numero')
    .eq('id', lojaId)
    .single<LojaInfo>()
```

Substituir por:

```ts
  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia, cnpj, cep, uf, cidade, bairro, logradouro, numero, meta_compras_pct')
    .eq('id', lojaId)
    .single<LojaInfo>()
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Verificação manual**

`npm run dev`, abrir `/minha-loja` como admin global, editar "Meta compras ÷ faturamento (%)" pra um valor (ex.: 35), salvar, confirmar toast de sucesso e que o campo mantém o valor após `router.refresh()`. Conferir no banco:
```bash
node scripts/db.mjs "select id, meta_compras_pct from lojas where id=<lojaId testada>"
```

- [ ] **Step 6: Commit**

```bash
git add lib/actions/minha-loja.ts "components/minha-loja/InformacoesForm.tsx" "app/(app)/minha-loja/page.tsx"
git commit -m "feat(minha-loja): meta de compras/faturamento editavel por loja"
```

---

### Task 4: Card "hoje" em `relatorio-indicadores/page.tsx` + meta configurável

**Files:**
- Modify: `app/(app)/relatorio-indicadores/page.tsx`

**Interfaces:**
- Consumes: `buscarResumoFinanceiroHoje` (Task 2), coluna `lojas.meta_compras_pct` (Task 1).

- [ ] **Step 1: Ler o arquivo atual antes de editar**

O arquivo real (confirmado nesta sessão) NÃO busca a linha de `lojas` hoje — só usa `lojaId` (number) vindo de `getCurrentLojaId()`. É preciso adicionar essa busca.

- [ ] **Step 2: Adicionar os imports novos**

Localizar:

```ts
import { descreverCFOP } from '@/lib/cfop'
import { Scale, Download } from 'lucide-react'
```

Substituir por:

```ts
import { descreverCFOP } from '@/lib/cfop'
import { buscarResumoFinanceiroHoje } from '@/lib/omie/financeiro-resumo'
import type { LojaOmie } from '@/lib/omie/client'
import { Scale, Download } from 'lucide-react'
```

- [ ] **Step 3: Buscar a loja (credenciais Omie + meta) e o resumo financeiro**

Localizar:

```ts
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const sp = await searchParams
```

Substituir por:

```ts
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const supabaseLoja = createServiceClient()
  const { data: lojaRow } = await supabaseLoja
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, meta_compras_pct')
    .eq('id', lojaId)
    .single<LojaOmie & { meta_compras_pct: number | null }>()
  const metaPct = lojaRow?.meta_compras_pct ?? 40
  const resumoHoje = lojaRow?.omie_app_key ? await buscarResumoFinanceiroHoje(lojaRow) : null

  const sp = await searchParams
```

(Nota: `createServiceClient` já é importado no topo do arquivo, reutilizado aqui com um nome de variável diferente — `supabase` já é usado mais abaixo pra outras queries, evita conflito de nomes.)

- [ ] **Step 4: Trocar `META_PCT` fixo por `metaPct`**

Localizar:

```ts
const META_PCT = 40
const corMeta = (pct: number) => (!Number.isFinite(pct) ? 'text-text-muted' : pct <= META_PCT ? 'text-ok' : pct <= 50 ? 'text-warn' : 'text-err')
```

Substituir por (a função `corMeta` precisa receber a meta agora, já que não é mais uma constante do módulo):

```ts
const corMeta = (pct: number, meta: number) => (!Number.isFinite(pct) ? 'text-text-muted' : pct <= meta ? 'text-ok' : pct <= 50 ? 'text-warn' : 'text-err')
```

Atualizar todos os 3 usos de `corMeta(x)` no arquivo pra `corMeta(x, metaPct)`:
1. Na linha `const cls = ind.tipo === 'res' ? corRes(v) : ind.tipo === 'pct' ? corMeta(v) : ...` → `corMeta(v, metaPct)`.
2. Na linha `{ind.tipo === 'pct' ? fmtPct(ind.total) : ...}` do `<td>` de total, no `className` → `corMeta(ind.total, metaPct)`.
3. Nos 2 usos no bloco de pills (`corMeta(pctTotal)`) → `corMeta(pctTotal, metaPct)`.

E trocar as 2 ocorrências de `≤ {META_PCT}%` (no pill "Meta" e no rodapé de texto) por `≤ {metaPct}%`, e `pctTotal <= META_PCT` por `pctTotal <= metaPct`, e `pctTotal - META_PCT` por `pctTotal - metaPct`.

- [ ] **Step 5: Renderizar o card "hoje"**

Adicionar, logo depois do bloco de pills (`</div>` que fecha a `div` com `Faturado/Comprado/Compras ÷ Fat/Meta`) e antes da tabela de indicadores:

```tsx
      {resumoHoje && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Saldo em conta (hoje)</div>
            <div className={`num mt-1 text-lg font-semibold ${resumoHoje.contaCorrente.vTotal < 0 ? 'text-err' : 'text-text'}`}>
              {fmtMoeda(resumoHoje.contaCorrente.vTotal)}
            </div>
            {resumoHoje.contaCorrente.vTotal < 0 && (
              <div className="mt-1 text-[11px] text-warn" title="Saldo negativo pode indicar conta não conciliada no Omie">
                ⚠ pode estar desconciliado no Omie
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Em aberto (todos os títulos)</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-[13px] text-text-muted">A pagar</span>
              <span className="num text-sm font-semibold text-err">{fmtMoeda(resumoHoje.contaPagar.vTotal)}</span>
            </div>
            {resumoHoje.contaPagar.vAtraso > 0 && (
              <div className="text-right text-[11px] text-err">{fmtMoeda(resumoHoje.contaPagar.vAtraso)} em atraso</div>
            )}
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-[13px] text-text-muted">A receber</span>
              <span className="num text-sm font-semibold text-ok">{fmtMoeda(resumoHoje.contaReceber.vTotal)}</span>
            </div>
            {resumoHoje.contaReceber.vAtraso > 0 && (
              <div className="text-right text-[11px] text-err">{fmtMoeda(resumoHoje.contaReceber.vAtraso)} em atraso</div>
            )}
          </div>
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Fluxo de caixa projetado</div>
            <table className="mt-1 w-full text-[12px]">
              <tbody>
                {resumoHoje.fluxoCaixa.slice(0, 5).map((d) => (
                  <tr key={d.dDia}>
                    <td className="py-0.5 text-text-muted">{d.dDia.slice(0, 5)}</td>
                    <td className={`num py-0.5 text-right font-medium ${d.vSaldo >= 0 ? 'text-ok' : 'text-err'}`}>{fmtMoeda(d.vSaldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Verificação manual**

`npm run dev`, logar como QA numa loja com integração Omie ativa (loja 3, `claude.qa@ntb-estoque.dev`, `claudeqa123456` — trocar `current_loja_id` via SQL se necessário e restaurar depois), abrir `/relatorio-indicadores`, confirmar que o card aparece com dado real (saldo, a pagar/receber, fluxo de 5 dias) e que a coloração da célula "Compras ÷ Faturamento" respeita a meta configurada em "Minha loja" (Task 3). Testar também o caso de falha: trocar temporariamente `omie_app_key` da loja de teste por um valor inválido, confirmar que a página carrega normalmente SEM o card (sem erro 500), depois restaurar a key original.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/relatorio-indicadores/page.tsx"
git commit -m "feat(relatorio-indicadores): card financeiro hoje + meta configuravel por loja"
```

---

## Ordem de execução

Task 1 → Task 2 (pode rodar em paralelo com Task 1) → Task 3 (depende da Task 1) → Task 4 (depende das Tasks 1, 2 e 3 — a meta configurada na Task 3 só é visível de verdade depois que a Task 4 lê `meta_compras_pct`).
