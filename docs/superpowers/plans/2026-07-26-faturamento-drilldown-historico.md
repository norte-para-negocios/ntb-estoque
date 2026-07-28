# Faturamento: drill-down cruzando 90 dias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O drill-down do relatório de Faturamento (tipo→família→produto) passa a completar com o fato do Contabo quando o período pedido cruza pro ano anterior, igual ao nível de cima já corrigido hoje.

**Architecture:** Estender a reagregação JS já existente (`agregarFaturamentoPorTipoFamilia`) pra calcular também os 2 rótulos compostos (`tipo>familia`, `familia>produto`), e remover a exclusão explícita de drill (`!prefixo`) da condição que decide buscar o histórico em `page.tsx`, usando `consultaDim` (já calculado) em vez de `dim` quando há drill ativo, com o mesmo corte de prefixo já aplicado no lado quente.

**Tech Stack:** Next.js Server Components, Supabase, API do Contabo (`lib/faturamento-frio.ts`).

## Global Constraints

- Sem suite automatizada — verificação manual (dado real, mesma técnica já usada nesta sessão: reconstrução independente via SQL/API, comparação de números).
- Sem mudança de comportamento fora do cenário "drill ativo E período cruzando o ano anterior" — o nível de cima (já corrigido hoje) e o caso comum continuam idênticos.
- Mesma filosofia de erro do resto do sistema: falha ao buscar o frio nunca quebra a tela (herdado, sem mudança).

---

### Task 1: Estender `agregarFaturamentoPorTipoFamilia`/`buscarFaturamentoFrioHistorico` pros rótulos compostos

**Files:**
- Modify: `lib/faturamento-frio.ts`

**Interfaces:**
- Consumes: nada de outras tasks.
- Produces: `buscarFaturamentoFrioHistorico` passa a aceitar `dim: 'tipo' | 'familia' | 'produto' | 'tipo>familia' | 'familia>produto'`. Task 2 chama com esse tipo estendido.

- [ ] **Step 1: Estender `agregarFaturamentoPorTipoFamilia`**

Em `lib/faturamento-frio.ts:70-98`, hoje:

```ts
function agregarFaturamentoPorTipoFamilia(
  itens: ItemFat[],
  mesPorCupom: Map<number, string>,
  metaPorCodigo: Map<number, { tipo: string | null; familia: string | null }>,
  dim: 'tipo' | 'familia'
): LinhaMatrizFrio[] {
  const acc = new Map<string, LinhaMatrizFrio>()
  for (const it of itens) {
    const mes = mesPorCupom.get(it.n_id_cupom)
    if (!mes) continue
    // Mesmo fallback de lib/omie/faturamento.ts (syncFaturamento): v_item cru
    // pode vir zerado do Omie em casos raros; recalcula a partir de
    // unit*qtde-desconto quando isso acontece.
    const v = it.v_item || (it.v_unit * it.quant - it.v_desc)
    if (!v) continue
    const info = it.id_produto != null ? metaPorCodigo.get(Number(it.id_produto)) : undefined
    const rotulo =
      dim === 'tipo'
        ? info?.tipo
          ? (TIPO_NOME[info.tipo] ?? `Tipo ${info.tipo}`)
          : 'Não classificado'
        : info?.familia || 'Sem família'
    const chave = `${rotulo}|${mes}`
    const ent = acc.get(chave) ?? { rotulo, mes, valor: 0 }
    ent.valor += v
    acc.set(chave, ent)
  }
  return [...acc.values()]
}
```

Trocar por (adiciona `tipoLabel`/`familiaLabel`/`produtoLabel` calculados sempre, escolhe o rótulo final por `dim`, incluindo os 2 casos compostos):

```ts
function agregarFaturamentoPorTipoFamilia(
  itens: ItemFat[],
  mesPorCupom: Map<number, string>,
  metaPorCodigo: Map<number, { tipo: string | null; familia: string | null; nome?: string }>,
  dim: 'tipo' | 'familia' | 'tipo>familia' | 'familia>produto'
): LinhaMatrizFrio[] {
  const acc = new Map<string, LinhaMatrizFrio>()
  for (const it of itens) {
    const mes = mesPorCupom.get(it.n_id_cupom)
    if (!mes) continue
    // Mesmo fallback de lib/omie/faturamento.ts (syncFaturamento): v_item cru
    // pode vir zerado do Omie em casos raros; recalcula a partir de
    // unit*qtde-desconto quando isso acontece.
    const v = it.v_item || (it.v_unit * it.quant - it.v_desc)
    if (!v) continue
    const info = it.id_produto != null ? metaPorCodigo.get(Number(it.id_produto)) : undefined
    const tipoLabel = info?.tipo ? (TIPO_NOME[info.tipo] ?? `Tipo ${info.tipo}`) : 'Não classificado'
    const familiaLabel = info?.familia || 'Sem família'
    const produtoLabel = info?.nome || 'Produto não identificado'
    // Separador literal '>>' -- mesmo usado pela ingestao (lib/omie/faturamento.ts,
    // add('tipo>familia', ...)/add('familia>produto', ...)) pro drill do
    // pre-agregado casar com o mesmo formato aqui.
    const rotulo =
      dim === 'tipo' ? tipoLabel :
      dim === 'familia' ? familiaLabel :
      dim === 'tipo>familia' ? `${tipoLabel}>>${familiaLabel}` :
      `${familiaLabel}>>${produtoLabel}`
    const chave = `${rotulo}|${mes}`
    const ent = acc.get(chave) ?? { rotulo, mes, valor: 0 }
    ent.valor += v
    acc.set(chave, ent)
  }
  return [...acc.values()]
}
```

- [ ] **Step 2: Estender o tipo de `dim` em `buscarFaturamentoFrioHistorico`**

Em `lib/faturamento-frio.ts:109-114`, hoje:

```ts
export async function buscarFaturamentoFrioHistorico(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  dim: 'tipo' | 'familia' | 'produto'
  metaPorCodigo: Map<number, { tipo: string | null; familia: string | null; nome?: string }>
}): Promise<LinhaMatrizFrio[]> {
```

Trocar por (só o tipo de `dim` muda, resto da assinatura idêntico):

```ts
export async function buscarFaturamentoFrioHistorico(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  dim: 'tipo' | 'familia' | 'produto' | 'tipo>familia' | 'familia>produto'
  metaPorCodigo: Map<number, { tipo: string | null; familia: string | null; nome?: string }>
}): Promise<LinhaMatrizFrio[]> {
```

O resto da função (`if (opts.dim === 'produto') {...}` e o `return agregarFaturamentoPorTipoFamilia(itens, mesPorCupom, opts.metaPorCodigo, opts.dim)` no final) não precisa mudar — `opts.dim` já bate estruturalmente com o novo tipo estendido da função chamada.

- [ ] **Step 3: Rodar `npx tsc --noEmit -p .` e confirmar zero erros**

```bash
npx tsc --noEmit -p .
```
Esperado: nenhuma saída (a Task 2, que ainda não foi feita, é quem vai chamar com os novos valores de `dim` — até lá, nada quebra porque ninguém usa os novos valores ainda).

- [ ] **Step 4: Testar contra dado real (loja 5, tipo>familia, período histórico)**

```bash
cat > /tmp/verifica-drill-tmp.mjs << 'SCRIPT'
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { buscarFaturamentoFrioHistorico } = await import('./lib/faturamento-frio.ts')
import pg from 'pg'
const dbUrl = new URL(process.env.SUPABASE_DB_URL)
const senha = decodeURIComponent(dbUrl.password)
const ref = dbUrl.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
let host = 'aws-1-sa-east-1.pooler.supabase.com', port = 5432
try { const s = fs.readFileSync('scripts/.pooler-host','utf8').trim(); const [h,p]=s.split(':'); if(h) host=h; if(p) port=Number(p) } catch {}
const client = new pg.Client({ host, port, user: 'postgres.'+ref, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } })
await client.connect()
const { rows: prods } = await client.query('select codigo_produto, tipo_item, descricao_familia, codigo, descricao from produtos where loja_id = $1', [5])
await client.end()
const metaPorCodigo = new Map(prods.map((p) => [Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia, nome: p.descricao || p.codigo || String(p.codigo_produto) }]))
const rows = await buscarFaturamentoFrioHistorico({ lojaId: 5, dataInicio: '', dataFinal: '2025-12-31', dim: 'tipo>familia', metaPorCodigo })
console.log('linhas tipo>familia (historico):', rows.length)
console.log('amostra:', rows.slice(0, 3).map(r => r.rotulo))
console.log('total (deve bater na ordem de grandeza com o total por tipo, ~R$4.786.327,46):', rows.reduce((s,r)=>s+r.valor,0).toFixed(2))
SCRIPT
npx tsx /tmp/verifica-drill-tmp.mjs
rm -f /tmp/verifica-drill-tmp.mjs
```
Esperado: rótulos no formato `"<Tipo>>><Família>"`, e o total somado bate com o total já confirmado por tipo (R$4.786.327,46, jul-dez/2025, medido no fix de hoje mais cedo).

- [ ] **Step 5: Commit**

```bash
git add lib/faturamento-frio.ts
git commit -m "feat: agregarFaturamentoPorTipoFamilia calcula rotulos compostos (tipo>familia, familia>produto)"
```

---

### Task 2: `app/(app)/relatorio-faturamento/page.tsx` — parar de excluir drill do histórico

**Files:**
- Modify: `app/(app)/relatorio-faturamento/page.tsx`

**Interfaces:**
- Consumes: `buscarFaturamentoFrioHistorico` com o tipo de `dim` estendido (Task 1).
- Produces: nenhuma interface nova exportada.

- [ ] **Step 1: Remover `!prefixo` da condição `cruzaAnoAnterior`**

Em `app/(app)/relatorio-faturamento/page.tsx`, hoje:

```ts
  // Achado real (auditoria 2026-07-26): `faturamento_importado` (a fonte por
  // trás da RPC acima) só guarda o ano corrente pras dimensões tipo/família/
  // produto (ver comentário em lib/omie/faturamento.ts) -- sem completar com
  // o fato do Contabo (histórico completo desde jul/2025), qualquer período
  // cruzando pra ano anterior perdia esse dado em silêncio (medido: loja 5,
  // aba Tipo, período "Todos" -- R$4,99M mostrado vs R$9,78M real). Só se
  // aplica ao nível "de cima" (sem drill, sem usarFato) -- o drill usa
  // dimensões compostas (tipo>familia/familia>produto) que o fato não tem
  // como reagregar sem uma reescrita maior; fica como limitação conhecida,
  // igual já existe pro filtro de tipo/família/produto em Notas Fiscais.
  const anoAtualStr = mesAtual.slice(0, 4)
  const cruzaAnoAnterior = !prefixo && !usarFato && !verCupons && (!mesIni || mesIni < `${anoAtualStr}-01`)
```

Trocar por (remove o `!prefixo` e o parágrafo do comentário que descrevia essa exclusão como limitação -- o drill agora é coberto):

```ts
  // Achado real (auditoria 2026-07-26): `faturamento_importado` (a fonte por
  // trás da RPC acima) só guarda o ano corrente pras dimensões tipo/família/
  // produto (ver comentário em lib/omie/faturamento.ts) -- sem completar com
  // o fato do Contabo (histórico completo desde jul/2025), qualquer período
  // cruzando pra ano anterior perdia esse dado em silêncio (medido: loja 5,
  // aba Tipo, período "Todos" -- R$4,99M mostrado vs R$9,78M real). Cobre
  // tanto o nível de cima quanto o drill (dimensões compostas tipo>familia/
  // familia>produto, ver lib/faturamento-frio.ts).
  const anoAtualStr = mesAtual.slice(0, 4)
  const cruzaAnoAnterior = !usarFato && !verCupons && (!mesIni || mesIni < `${anoAtualStr}-01`)
```

- [ ] **Step 2: Usar `consultaDim` (não `dim`) quando há drill, e aplicar o corte de prefixo no resultado do histórico**

Em `app/(app)/relatorio-faturamento/page.tsx`, hoje:

```ts
    const anoAnteriorFim = `${Number(anoAtualStr) - 1}-12-31`
    const dataFinalHistorico = mesFim && mesFim < `${anoAtualStr}-01` ? fimDoMes(mesFim) : anoAnteriorFim
    // cruzaAnoAnterior já exige !usarFato, e usarFato é sempre true quando
    // dim === 'forma_pgto' -- nunca chega aqui com essa dimensão.
    const rows = await buscarFaturamentoFrioHistorico({
      lojaId, dataInicio: dataIni || '', dataFinal: dataFinalHistorico, dim: dim as 'tipo' | 'familia' | 'produto', metaPorCodigo,
    })
    // Guarda defensiva: o concat com `matriz` (linha ~254) assume que o
    // pré-agregado (RPC) só tem o ano corrente e o histórico só tem antes
    // dele -- verdade hoje porque syncFaturamento sempre reinsere só o ano
    // corrente (ver comentário lá), mas se um backfill futuro popular
    // `faturamento_importado` com anos anteriores, essas duas fontes
    // passariam a se sobrepor. Filtra aqui pra nunca somar mês >= ano
    // corrente vindo do histórico, mesmo que isso mude.
    const semSobreposicao = rows.filter((r) => r.mes < `${anoAtualStr}-01`)
    historico = rotulosFiltro.length ? semSobreposicao.filter((r) => rotulosFiltro.includes(r.rotulo)) : semSobreposicao
```

Trocar por (troca `dim` por `prefixo ? consultaDim : dim` na chamada, e aplica o mesmo corte de prefixo que `matriz` já recebe de `matrizCrua`, ANTES do filtro de sobreposição e de `rotulosFiltro`):

```ts
    const anoAnteriorFim = `${Number(anoAtualStr) - 1}-12-31`
    const dataFinalHistorico = mesFim && mesFim < `${anoAtualStr}-01` ? fimDoMes(mesFim) : anoAnteriorFim
    // cruzaAnoAnterior já exige !usarFato, e usarFato é sempre true quando
    // dim === 'forma_pgto' -- nunca chega aqui com essa dimensão. Com drill
    // ativo, usa consultaDim (tipo>familia/familia>produto, já calculado no
    // topo da função) em vez de dim -- mesmo raciocínio de matrizCrua/matriz.
    const dimHistorico = (prefixo ? consultaDim : dim) as 'tipo' | 'familia' | 'produto' | 'tipo>familia' | 'familia>produto'
    const rowsBrutas = await buscarFaturamentoFrioHistorico({
      lojaId, dataInicio: dataIni || '', dataFinal: dataFinalHistorico, dim: dimHistorico, metaPorCodigo,
    })
    // Mesmo corte de prefixo que matrizCrua recebe pra virar matriz (linha
    // ~208) -- sem isso, o histórico com drill ativo devolveria o rótulo
    // composto inteiro ("Tipo>>Familia") em vez de só a parte do filho
    // ("Familia"), e nunca bateria com as linhas do lado quente (já cortadas).
    const rows = prefixo
      ? rowsBrutas.filter((r) => r.rotulo.startsWith(prefixo)).map((r) => ({ ...r, rotulo: r.rotulo.slice(prefixo.length) }))
      : rowsBrutas
    // Guarda defensiva: o concat com `matriz` (linha ~254) assume que o
    // pré-agregado (RPC) só tem o ano corrente e o histórico só tem antes
    // dele -- verdade hoje porque syncFaturamento sempre reinsere só o ano
    // corrente (ver comentário lá), mas se um backfill futuro popular
    // `faturamento_importado` com anos anteriores, essas duas fontes
    // passariam a se sobrepor. Filtra aqui pra nunca somar mês >= ano
    // corrente vindo do histórico, mesmo que isso mude.
    const semSobreposicao = rows.filter((r) => r.mes < `${anoAtualStr}-01`)
    historico = rotulosFiltro.length ? semSobreposicao.filter((r) => rotulosFiltro.includes(r.rotulo)) : semSobreposicao
```

- [ ] **Step 3: Rodar `npx tsc --noEmit -p .` e `npm run build`, confirmar zero erros**

```bash
npx tsc --noEmit -p .
npm run build
```

- [ ] **Step 4: Testar com dado real — drill ativo + período cruzando o ano anterior**

Escolher a loja 5, entrar na aba Tipo com período "Todos", clicar num tipo real (drill pra família) e confirmar que os valores de meses de 2025 aparecem (antes do fix, sumiam). Comparar o total do tipo escolhido contra a soma das famílias mostradas no drill — devem bater exatamente (mesmo total, só reagrupado).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/relatorio-faturamento/page.tsx"
git commit -m "fix: drill-down do Faturamento completa com o Contabo cruzando o ano anterior"
```

---

### Task 3: Validação end-to-end + merge + deploy

**Files:** nenhum (só verificação manual + git).

**Interfaces:**
- Consumes: Tasks 1-2 já commitadas.

- [ ] **Step 1: Reconstrução independente — escolher um tipo real da loja 5 e comparar drill vs. soma manual**

```bash
node scripts/db.mjs "select tipo_item, count(*) from produtos where loja_id=5 group by tipo_item order by count(*) desc limit 5"
```

- [ ] **Step 2: Rodar a mesma verificação de reconciliação já usada no fix de hoje mais cedo, agora pro nível `tipo>familia`**

Reusar o script de verificação da Task 1 (Step 4), trocando `dim: 'familia>produto'` pra conferir o segundo nível do drill também, pro mesmo tipo escolhido no Step 1.

- [ ] **Step 3: Merge e deploy**

```bash
git fetch origin main
git push origin HEAD:main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

- [ ] **Step 4: Reportar o resultado final**

Resumo do que foi confirmado (rótulos compostos calculados corretamente, corte de prefixo aplicado, totais batendo entre os dois níveis do drill e com o nível de cima já corrigido hoje, build/tsc limpos, deploy feito).
