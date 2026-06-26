# NTB Estoque -- Melhorias Fase 1 (Bugs + UI + Faturamento)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir bugs criticos, melhorar filtros/tabelas/UX em todas as telas, e implementar faturamento nativo via API Omie (NFC-e + NF-e saida) eliminando o import manual do FAT_DRV.

**Architecture:** Sistema Next.js 16 + Supabase + Vercel + Omie ERP. Bugs sao corrigidos via migrations SQL. UI segue o ui-kit existente (components/ui-kit/). Novos endpoints Omie seguem o padrao de lib/omie/*.ts. Faturamento sera uma nova pipeline: sync Omie -> tabelas Supabase -> RPC -> tela.

**Tech Stack:** Next.js 16, Supabase (pooler aws-1-sa-east-1), TypeScript, shadcn/ui, Vercel, Omie REST API, scripts/aplicar-migration.mjs

## Global Constraints

- Middleware e `proxy.ts`, NAO `middleware.ts` (breaking change Next.js 16)
- Nunca usar travessao (--) em textos visiveis ao usuario
- Free tier apenas -- sem servicos pagos
- Testes ao vivo NUNCA na loja 4 (O SERTAO VAI VIRAR MAR) -- usar loja 3 (Donana Rio Vermelho) ou 7 (VINHAS)
- Migration aplicada via `node scripts/aplicar-migration.mjs <arquivo>` ou `node scripts/db.mjs`
- Omie escrita: 800ms entre calls (anti-rajada)
- Omie leitura: 300ms entre paginas (rate limit 240 req/min)
- RBAC via `requirePermissao(lojaId, 'Nome Permissao')` nas server actions
- Git push apos cada task concluida

---

## Mapa de arquivos

| Arquivo | Acao | Descricao |
|---|---|---|
| `supabase/migrations/047_auditoria_fiscal_filtro_etapa.sql` | Criar | Fix bug auditoria -- adicionar filtro c_etapa |
| `supabase/migrations/050_cupons_fiscais.sql` | Criar | Tabelas para sync NFC-e |
| `supabase/migrations/051_notas_fiscais_saida.sql` | Criar | Tabela para NF-e de saida |
| `supabase/migrations/052_ajustes_estoque.sql` | Criar | Tabela historico ajustes |
| `lib/omie/cupom-fiscal.ts` | Criar | Wrapper CupomFiscalConsultar (NFC-e) |
| `lib/omie/nota-fiscal-saida.ts` | Criar | Wrapper nfconsultar tpNF=1 |
| `lib/omie/dfe-docs.ts` | Criar | Wrapper dfedocs ObterNfe/ObterCupom |
| `lib/omie/pedido-compra.ts` | Criar | Wrapper IncluirPedCompra |
| `lib/omie/produto-fornecedor.ts` | Criar | Wrapper ListarProdutoFornecedor |
| `app/api/sync/cupons-fiscais/route.ts` | Criar | Cron sync NFC-e |
| `app/api/sync/notas-fiscais-saida/route.ts` | Criar | Cron sync NF-e saida |
| `app/api/nota-fiscal/[id]/xml/route.ts` | Criar | Download XML via DFe |
| `app/api/nota-fiscal/[id]/danfe/route.ts` | Criar | Download DANFE via DFe |
| `components/ui-kit/Combobox.tsx` | Criar | Select com busca inline |
| `components/produtos/GerarPedidoCompra.tsx` | Criar | Modal gerar PO no Omie |
| `_qa_probe_cupons.mjs` | Criar | Script probe NFC-e (descartavel) |
| `app/(app)/produto/page.tsx` | Modificar | Export completo, filtro margem |
| `app/(app)/produto/export/route.ts` | Modificar | Incluir CMC, saldo, sugestao |
| `app/(app)/nota-fiscal/page.tsx` | Modificar | Fix filtro fornecedor, mais filtros |
| `app/(app)/nota-fiscal/[id]/page.tsx` | Modificar | Botoes XML/DANFE |
| `app/(app)/auditoria-fiscal/page.tsx` | Modificar | Verificar se usa as RPCs corrigidas |
| `app/(app)/home/page.tsx` | Modificar | Valor estoque, data sync completa |
| `app/(app)/relatorio-faturamento/page.tsx` | Modificar | Modo nativo vs import |
| `components/filtros/FiltrosGaveta.tsx` | Modificar | Adicionar tipo combobox |
| `components/ui-kit/Lista.tsx` | Modificar | Suporte sort por coluna |
| `components/ui-kit/Paginacao.tsx` | Modificar | Exibir total de registros |
| `lib/actions/transferencia.ts` | Modificar | Fix motivo TPQ |

---

## Task 1: Verificar migration 043 em producao (10 min)

**Files:**
- Read: `supabase/migrations/043_movimentos_constraints.sql`

**Interfaces:**
- Produces: confirmacao se constraints TPQ e 'Sem CMC' existem no banco de producao

- [ ] **Step 1: Verificar constraints no banco**

```bash
node scripts/db.mjs
```

Dentro do Node REPL (ou via script inline), rodar:

```javascript
// scripts/_check-migration-043.mjs
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data, error } = await sb.rpc('sql', {
  query: `
    SELECT constraint_name, check_clause
    FROM information_schema.check_constraints
    WHERE constraint_name IN ('movimentos_tipo_check', 'movimentos_status_check')
  `
})
console.log(data, error)
```

Ou via `psql` se disponivel. O resultado esperado e ver `'TPQ'` em `movimentos_tipo_check` e `'Sem CMC'` em `movimentos_status_check`.

- [ ] **Step 2: Se migration 043 NAO aplicada, aplicar agora**

```bash
node scripts/aplicar-migration.mjs supabase/migrations/043_movimentos_constraints.sql
```

Resultado esperado: sem erros. Se der erro `constraint already exists`, a migration ja foi aplicada.

- [ ] **Step 3: Verificar movimentos com erro**

No Supabase Dashboard > SQL Editor:

```sql
SELECT id, tipo, motivo, status, descricao_status, response, updated_at
FROM movimentos
WHERE status = 'Erro'
ORDER BY updated_at DESC
LIMIT 10;
```

Anotar o conteudo de `descricao_status` -- ele revela a causa exata do erro de transferencia.

- [ ] **Step 4: Commit do resultado**

```bash
git add supabase/migrations/043_movimentos_constraints.sql
git commit -m "fix: confirmar/aplicar migration 043 constraints de movimentos"
```

---

## Task 2: BUG-01 -- Migration 047 auditoria fiscal (30 min)

**Files:**
- Create: `supabase/migrations/047_auditoria_fiscal_filtro_etapa.sql`
- Read: `supabase/migrations/040_auditoria_fiscal.sql`

**Interfaces:**
- Produces: funcoes `relatorio_auditoria_fiscal_cfop` e `relatorio_auditoria_fiscal_itens` corretas (so NFs c_etapa = '60' e nao canceladas)

- [ ] **Step 1: Criar migration 047**

Criar `supabase/migrations/047_auditoria_fiscal_filtro_etapa.sql`:

```sql
-- Fix: relatorio_auditoria_fiscal_cfop e relatorio_auditoria_fiscal_itens
-- incluiam NFs canceladas e pendentes (sem filtro c_etapa = '60').
-- Agora filtra apenas NFs autorizadas e nao canceladas.

create or replace function relatorio_auditoria_fiscal_cfop(
  p_loja_id bigint,
  p_ini date,
  p_fim date
) returns table(
  cfop_doc text,
  cfop_entrada text,
  itens bigint,
  valor numeric,
  credita_icms bigint,
  move_estoque bigint
)
language sql stable as $$
  select
    coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') as cfop_doc,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop_entrada,
    count(*)::bigint as itens,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    count(*) filter (
      where coalesce(
        i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N'
      ) <> 'S'
    )::bigint as credita_icms,
    count(*) filter (
      where coalesce(
        i.full_object->'itensAjustes'->>'cNaoGerarMovEstoque', 'N'
      ) <> 'S'
    )::bigint as move_estoque
  from nota_fiscal_items i
  join notas_fiscais nf
    on nf.id = i.nota_fiscal_id
    and nf.loja_id = i.loja_id
    and nf.deleted_at is null
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini
    and nf.d_emissao_nfe <= p_fim
    and nf.c_etapa = '60'
    and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
  group by 1, 2
  order by valor desc, cfop_doc, cfop_entrada;
$$;

create or replace function relatorio_auditoria_fiscal_itens(
  p_loja_id bigint,
  p_ini date,
  p_fim date,
  p_cfop_doc text default null,
  p_cfop_entrada text default null,
  p_fornecedor text default null
) returns table(
  data date,
  nota text,
  fornecedor text,
  produto text,
  codigo text,
  cfop_doc text,
  cfop_entrada text,
  cst_icms text,
  origem text,
  credita_icms boolean,
  move_estoque boolean,
  valor numeric,
  item_id bigint
)
language sql stable as $$
  select
    nf.d_emissao_nfe as data,
    nf.c_numero_nfe as nota,
    coalesce(nf.c_razao_social, nf.c_nome) as fornecedor,
    i.c_descricao_produto as produto,
    i.c_codigo_produto as codigo,
    coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') as cfop_doc,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop_entrada,
    i.full_object->'itensICMS'->>'cSitTrib' as cst_icms,
    i.full_object->'itensICMS'->>'cOrigem' as origem,
    (coalesce(
      i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N'
    ) <> 'S') as credita_icms,
    (coalesce(
      i.full_object->'itensAjustes'->>'cNaoGerarMovEstoque', 'N'
    ) <> 'S') as move_estoque,
    (coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    i.id as item_id
  from nota_fiscal_items i
  join notas_fiscais nf
    on nf.id = i.nota_fiscal_id
    and nf.loja_id = i.loja_id
    and nf.deleted_at is null
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini
    and nf.d_emissao_nfe <= p_fim
    and nf.c_etapa = '60'
    and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
    and (p_cfop_doc is null
      or coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') = p_cfop_doc)
    and (p_cfop_entrada is null
      or i.full_object->'itensAjustes'->>'cCFOPEntrada' = p_cfop_entrada)
    and (p_fornecedor is null
      or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
  order by nf.d_emissao_nfe desc, i.id;
$$;
```

- [ ] **Step 2: Aplicar migration**

```bash
node scripts/aplicar-migration.mjs supabase/migrations/047_auditoria_fiscal_filtro_etapa.sql
```

Resultado esperado: `CREATE FUNCTION` duas vezes, sem erros.

- [ ] **Step 3: Validar no Supabase SQL Editor**

```sql
-- Confirmar que so NFs etapa 60 aparecem
SELECT DISTINCT c_etapa, count(*) 
FROM notas_fiscais 
WHERE loja_id = 3
GROUP BY c_etapa;

-- Testar a funcao corrigida
SELECT * FROM relatorio_auditoria_fiscal_cfop(3, '2026-01-01', '2026-06-30') LIMIT 5;
```

Resultado esperado: funcao retorna dados sem NFs pendentes/canceladas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/047_auditoria_fiscal_filtro_etapa.sql
git commit -m "fix: auditoria fiscal filtrar apenas NFs etapa 60 e nao canceladas (migration 047)"
```

---

## Task 3: BUG-02 -- Fix filtro fornecedor na Nota Fiscal (20 min)

**Files:**
- Modify: `app/(app)/nota-fiscal/page.tsx`

**Interfaces:**
- Produces: busca por fornecedor encontra tanto c_razao_social quanto c_nome

- [ ] **Step 1: Localizar as duas queries com o bug**

Abrir `app/(app)/nota-fiscal/page.tsx`. O filtro de fornecedor esta nas queries de `listagem` e `totais`. Buscar por `.ilike('c_nome'` -- provavelmente esta assim:

```typescript
// ERRADO (atual):
.ilike('c_nome', `%${params.fornecedor}%`)
```

- [ ] **Step 2: Corrigir as duas ocorrencias**

Trocar cada `.ilike('c_nome', ...)` por:

```typescript
// CORRETO:
.or(`c_razao_social.ilike.%${params.fornecedor}%,c_nome.ilike.%${params.fornecedor}%`)
```

Fazer a substituicao em AMBAS as queries (listagem principal e query de totais/count).

- [ ] **Step 3: Testar**

Navegar para /nota-fiscal, digitar parte de uma razao social conhecida no filtro de fornecedor. Confirmar que aparece resultado. Confirmar que buscar por nome fantasia/nome tambem funciona.

- [ ] **Step 4: Commit**

```bash
git add app/(app)/nota-fiscal/page.tsx
git commit -m "fix: busca por fornecedor em NF cobre c_razao_social e c_nome"
```

---

## Task 4: BUG-03 -- Fix motivo TPQ na transferencia (45 min)

**Files:**
- Modify: `lib/actions/transferencia.ts`

**Interfaces:**
- Produces: transferencias TPQ enviam `motivo: 'TRF'` ao Omie (motivo valido)

- [ ] **Step 1: Diagnosticar o erro exato**

Rodar no Supabase SQL Editor:

```sql
SELECT m.id, m.tipo, m.motivo, m.status, m.descricao_status,
       m.codigo_status, m.response, m.updated_at,
       t.numero as transferencia_numero
FROM movimentos m
JOIN transferencias t ON t.id = m.transferencia_id
WHERE m.status = 'Erro'
ORDER BY m.updated_at DESC
LIMIT 10;
```

Se `codigo_status != 0` e `descricao_status` contem texto do Omie sobre "motivo invalido" ou "campo invalido", confirma a Causa D. Se `status` esta como `'Processando'` permanente, e provavelmente a Causa A (migration 043).

- [ ] **Step 2: Localizar a linha do motivo em transferencia.ts**

Abrir `lib/actions/transferencia.ts`. Buscar por `motivo:`. Deve estar assim na funcao `processarMovimento`:

```typescript
// Linha ~333 (atual -- pode passar 'TPQ' ao Omie)
motivo: trans.motivo || 'TRF',
```

- [ ] **Step 3: Corrigir o mapeamento do motivo**

```typescript
// CORRETO -- TPQ nao e motivo valido no Omie, usar TRF
motivo: (trans.motivo === 'TPQ' ? 'TRF' : trans.motivo) || 'TRF',
```

- [ ] **Step 4: Testar na loja 3 (Donana) com um produto de baixo valor**

Criar uma transferencia de teste na loja 3, adicionar 1 unidade de um produto simples, enviar. Confirmar que o status vai para `'Enviado'` e nao `'Erro'`.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/transferencia.ts
git commit -m "fix: transferencia TPQ mapeia motivo para TRF ao enviar ao Omie"
```

---

## Task 5: UI-04 -- Export completo de produtos com CMC, saldo e sugestao (2h)

**Files:**
- Modify: `app/(app)/produto/export/route.ts`

**Interfaces:**
- Produces: XLSX com colunas: Codigo, Descricao, Familia, Tipo, Unidade, Preco Venda, CMC, Saldo Atual, Minimo, Sugestao Compra, Margem%

- [ ] **Step 1: Ler o arquivo atual**

Abrir `app/(app)/produto/export/route.ts`. Observar: a query atual seleciona `codigo, descricao, descricao_familia, tipo_item, unidade, valor_unitario`. Precisa adicionar CMC (de posicao_estoques) e estoque_minimo (de produtos).

- [ ] **Step 2: Adicionar join com posicao_estoques e campos extras**

A query com join deve ser algo como:

```typescript
// Buscar produtos com campos extras
const { data: produtos } = await supabase
  .from('produtos')
  .select(`
    codigo,
    descricao,
    descricao_familia,
    tipo_item,
    unidade,
    valor_unitario,
    estoque_minimo
  `)
  .eq('loja_id', lojaId)
  .eq('inativo', false)
  .order('descricao')

// Buscar ultima foto de posicao de estoque (para CMC e saldo)
const { data: posicoes } = await supabase
  .from('posicao_estoques')
  .select('codigo_produto, n_cmc, n_saldo_qtde_atual')
  .eq('loja_id', lojaId)
  .eq('foto_date', supabase.rpc('max', { column: 'foto_date', loja_id: lojaId }))
  // Alternativa: buscar max foto_date em subquery separada

// Montar map de CMC e saldo por codigo
const cmcMap = new Map(posicoes?.map(p => [p.codigo_produto, {
  cmc: p.n_cmc ?? 0,
  saldo: p.n_saldo_qtde_atual ?? 0
}]) ?? [])

// Montar linhas do Excel
const linhas = produtos?.map(p => {
  const pos = cmcMap.get(p.codigo) ?? { cmc: 0, saldo: 0 }
  const minimo = p.estoque_minimo ?? 0
  const sugestao = Math.max(0, minimo - pos.saldo)
  const margem = pos.cmc > 0 && p.valor_unitario > 0
    ? ((p.valor_unitario - pos.cmc) / p.valor_unitario * 100)
    : null
  return {
    'Codigo': p.codigo,
    'Descricao': p.descricao,
    'Familia': p.descricao_familia,
    'Tipo': p.tipo_item,
    'Unidade': p.unidade,
    'Preco Venda': p.valor_unitario,
    'CMC': pos.cmc,
    'Saldo Atual': pos.saldo,
    'Minimo': minimo,
    'Sugestao Compra': sugestao,
    'Margem %': margem != null ? parseFloat(margem.toFixed(1)) : '',
  }
})
```

Nota: a logica de buscar a foto mais recente deve seguir o mesmo padrao usado em `app/(app)/produto/page.tsx` linhas 193-247 (busca as 2 fotos mais recentes).

- [ ] **Step 3: Gerar o XLSX com as novas colunas**

Manter o mesmo mecanismo de geracao de XLSX que ja existe no arquivo (provavelmente `xlsx` ou `exceljs`). So alterar os campos do objeto de cada linha.

- [ ] **Step 4: Testar**

Abrir `/produto`, clicar em "Excel". Verificar que o arquivo baixado tem as colunas CMC, Saldo, Minimo, Sugestao e Margem preenchidas.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/produto/export/route.ts
git commit -m "feat: export de produtos inclui CMC, saldo atual, minimo e sugestao de compra"
```

---

## Task 6: UI-05 -- Dashboard com valor total do estoque e data completa de sync (3h)

**Files:**
- Modify: `app/(app)/home/page.tsx`

**Interfaces:**
- Produces: home mostra valor total monetario do estoque, lista de repor com saldo/minimo, data completa do sync (nao so hora)

- [ ] **Step 1: Adicionar query de valor total do estoque**

Em `app/(app)/home/page.tsx`, na secao de queries em paralelo (dentro de `Promise.all` ou similar), adicionar:

```typescript
// Query valor total do estoque (foto mais recente)
const { data: valorEstoque } = await supabase.rpc(
  'valor_total_estoque',
  { p_loja_id: lojaId }
)
```

Essa RPC precisa ser criada (ver Step 2).

- [ ] **Step 2: Criar migration com a RPC valor_total_estoque**

Criar `supabase/migrations/048_valor_total_estoque.sql`:

```sql
create or replace function valor_total_estoque(p_loja_id bigint)
returns numeric
language sql stable as $$
  select coalesce(sum(pe.n_cmc * pe.n_saldo_qtde_atual), 0)
  from posicao_estoques pe
  where pe.loja_id = p_loja_id
    and pe.foto_date = (
      select max(foto_date)
      from posicao_estoques
      where loja_id = p_loja_id
    )
    and pe.n_saldo_qtde_atual > 0
    and pe.n_cmc > 0;
$$;
```

Aplicar:
```bash
node scripts/aplicar-migration.mjs supabase/migrations/048_valor_total_estoque.sql
```

- [ ] **Step 3: Exibir o valor total no hero da home**

No JSX do hero (linhas ~203-227 do home/page.tsx), apos o total de produtos, adicionar:

```tsx
{valorEstoque != null && valorEstoque > 0 && (
  <div>
    <span className="text-xs text-muted-foreground">Valor em estoque</span>
    <p className="text-lg font-semibold">
      {new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(valorEstoque)}
    </p>
  </div>
)}
```

- [ ] **Step 4: Melhorar exibicao da data de sync**

Localizar onde `produto_ultima_atualizacao` e formatado. Trocar `formatarHora` por logica que mostre a data quando o sync for de dia anterior:

```typescript
function formatarUltimaAtualizacao(data: Date | string | null): string {
  if (!data) return 'nunca'
  const d = new Date(data)
  const agora = new Date()
  const mesmoDia =
    d.getDate() === agora.getDate() &&
    d.getMonth() === agora.getMonth() &&
    d.getFullYear() === agora.getFullYear()
  if (mesmoDia) {
    return `hoje as ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  }
  const ontem = new Date(agora)
  ontem.setDate(agora.getDate() - 1)
  const ehOntem =
    d.getDate() === ontem.getDate() &&
    d.getMonth() === ontem.getMonth() &&
    d.getFullYear() === ontem.getFullYear()
  if (ehOntem) {
    return `ontem as ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  }
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}
```

Adicionar classe `text-warning` quando sync tiver mais de 24h.

- [ ] **Step 5: Melhorar lista "Repor estoque" na home**

A lista atual (linhas ~309-330) mostra so codigo e nome. Adicionar saldo atual e minimo:

Mudar a query de `produtos_repor` para tambem retornar saldo e minimo. Verificar o retorno atual da RPC `produtos_repor` -- se ela ja retorna esses campos, basta renderizar.

```tsx
{/* Linha do produto na lista de repor */}
<div key={prod.codigo} className="flex items-center justify-between text-sm py-1">
  <span className="font-medium">{formatarNomeProduto(prod.descricao)}</span>
  <span className="text-muted-foreground text-xs">
    {prod.saldo_atual ?? 0} / {prod.estoque_minimo ?? 0} min
  </span>
</div>
```

- [ ] **Step 6: Commit**

```bash
git add app/(app)/home/page.tsx supabase/migrations/048_valor_total_estoque.sql
git commit -m "feat: home mostra valor total do estoque e data completa do ultimo sync"
```

---

## Task 7: UI-06 -- Filtros de data no relatorio de faturamento (2h)

**Files:**
- Modify: `app/(app)/relatorio-faturamento/page.tsx`
- Create: `supabase/migrations/049_faturamento_filtro_data.sql`

**Interfaces:**
- Produces: relatorio de faturamento com filtros de data inicio/fim funcionais

- [ ] **Step 1: Ler o estado atual do relatorio de faturamento**

Abrir `app/(app)/relatorio-faturamento/page.tsx`. Identificar qual RPC e chamada (provavelmente `relatorio_faturamento_matriz`). Ver se ela ja aceita parametros de data.

- [ ] **Step 2: Adicionar parametros de data a RPC se nao existirem**

Se a RPC nao aceita `p_ini date, p_fim date`, criar migration:

`supabase/migrations/049_faturamento_filtro_data.sql`:

```sql
-- Adiciona filtros de data ao relatorio de faturamento.
-- A funcao e substituida mantendo retrocompatibilidade (parametros com default).
create or replace function relatorio_faturamento_matriz(
  p_loja_id bigint,
  p_ini date default (date_trunc('month', current_date)::date),
  p_fim date default current_date,
  p_dim text default 'familia'
)
returns table(
  dim text,
  mes text,
  valor numeric
)
language sql stable as $$
  -- Adaptar ao schema real da funcao existente
  -- Ler o corpo atual da funcao em migrations anteriores e adicionar
  -- AND fi.data_referencia >= p_ini AND fi.data_referencia <= p_fim
  -- no WHERE
  select dim, mes, valor
  from relatorio_faturamento_dados  -- adaptar ao nome real da tabela/view
  where loja_id = p_loja_id
    and data_referencia >= p_ini
    and data_referencia <= p_fim
  order by mes, valor desc;
$$;
```

IMPORTANTE: ler a funcao atual antes de substituir. O corpo acima e um template -- adaptar ao SQL real.

- [ ] **Step 3: Adicionar filtros de data a tela**

Em `app/(app)/relatorio-faturamento/page.tsx`, adicionar `dataInicio` e `dataFim` aos searchParams e passar para a RPC:

```typescript
// Ler dos searchParams
const dataInicio = searchParams.ini ?? format(startOfMonth(new Date()), 'yyyy-MM-dd')
const dataFim = searchParams.fim ?? format(new Date(), 'yyyy-MM-dd')

// Passar para a RPC
const { data } = await supabase.rpc('relatorio_faturamento_matriz', {
  p_loja_id: lojaId,
  p_ini: dataInicio,
  p_fim: dataFim,
})
```

Adicionar os campos de data ao `FiltrosGaveta` da tela:

```typescript
const campos: CampoFiltro[] = [
  { key: 'ini', label: 'Data inicio', tipo: 'date' },
  { key: 'fim', label: 'Data fim', tipo: 'date' },
  // ... campos existentes
]
```

- [ ] **Step 4: Aplicar migration**

```bash
node scripts/aplicar-migration.mjs supabase/migrations/049_faturamento_filtro_data.sql
```

- [ ] **Step 5: Testar**

Abrir /relatorio-faturamento, definir um periodo (ex.: junho 2026) e confirmar que os dados mudam.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/relatorio-faturamento/page.tsx supabase/migrations/049_faturamento_filtro_data.sql
git commit -m "feat: relatorio de faturamento com filtros de data inicio e fim"
```

---

## Task 8: UI-01 -- Ordenacao por coluna nas tabelas (3h)

**Files:**
- Modify: `components/ui-kit/Lista.tsx`
- Modify: `app/(app)/nota-fiscal/page.tsx` (como exemplo)

**Interfaces:**
- Consumes: `Lista.tsx` recebe `sort?: { key: string; direcao?: 'asc' | 'desc'; onSort: (key: string) => void }` por coluna
- Produces: `<th>` clicavel que adiciona `ord=coluna&dir=asc|desc` na URL

- [ ] **Step 1: Adicionar suporte de sort ao componente Lista**

Abrir `components/ui-kit/Lista.tsx`. Localizar o tipo `Coluna<T>`. Adicionar:

```typescript
// No tipo Coluna<T>:
sort?: string  // chave para ordenacao server-side (nome da coluna no banco)
```

No componente, adicionar prop `sortAtual?: string` e `dirAtual?: 'asc' | 'desc'` e callback `onSort?: (key: string) => void`:

```typescript
// No header da coluna, quando col.sort existe:
<th key={col.key} className={cn('text-left px-3 py-2 text-xs font-medium text-muted-foreground', col.className)}>
  {col.sort ? (
    <button
      onClick={() => onSort?.(col.sort!)}
      className="flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {col.header}
      {sortAtual === col.sort ? (
        dirAtual === 'asc' ? (
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 2L10 8H2L6 2Z"/>
          </svg>
        ) : (
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 10L2 4H10L6 10Z"/>
          </svg>
        )
      ) : (
        <svg className="w-3 h-3 opacity-30" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 1L9 5H3L6 1ZM6 11L3 7H9L6 11Z"/>
        </svg>
      )}
    </button>
  ) : col.header}
</th>
```

- [ ] **Step 2: Implementar sort na tela nota-fiscal como exemplo**

Em `app/(app)/nota-fiscal/page.tsx`, adicionar `ord` e `dir` aos searchParams e aplicar ao `.order()` da query:

```typescript
// Resolver sort dos searchParams
const ord = searchParams.ord ?? 'd_emissao_nfe'
const dir = (searchParams.dir ?? 'desc') as 'asc' | 'desc'

// Colunas permitidas para sort (evitar injecao)
const COLUNAS_SORT = ['d_emissao_nfe', 'c_numero_nfe', 'c_nome', 'n_valor_total', 'c_etapa'] as const
const ordSeguro = COLUNAS_SORT.includes(ord as any) ? ord : 'd_emissao_nfe'

// Na query:
.order(ordSeguro, { ascending: dir === 'asc' })
```

Nas colunas da tabela, adicionar `sort: 'nome_coluna_banco'` nas colunas que suportam ordenacao.

- [ ] **Step 3: Conectar o callback ao router**

Em Client Component que renderiza a lista (ou via Link com searchParams):

```typescript
function handleSort(key: string) {
  const novaDir = sortAtual === key && dirAtual === 'asc' ? 'desc' : 'asc'
  const params = new URLSearchParams(searchParams.toString())
  params.set('ord', key)
  params.set('dir', novaDir)
  router.push(`?${params.toString()}`)
}
```

- [ ] **Step 4: Testar**

Clicar no header "Data" na tela de notas fiscais. Confirmar que as notas reordenam e a seta muda de direcao ao segundo clique.

- [ ] **Step 5: Commit**

```bash
git add components/ui-kit/Lista.tsx app/(app)/nota-fiscal/page.tsx
git commit -m "feat: ordenacao por coluna em tabelas -- implementar em nota-fiscal"
```

---

## Task 9: UI-02 -- Contagem total na paginacao (2h)

**Files:**
- Modify: `components/ui-kit/Paginacao.tsx`
- Modify: `app/(app)/nota-fiscal/page.tsx` (como exemplo de como adicionar count)

**Interfaces:**
- Consumes: `Paginacao` recebe `total?: number`
- Produces: exibe "1-50 de 847 registros" quando total informado

- [ ] **Step 1: Modificar o componente Paginacao**

Abrir `components/ui-kit/Paginacao.tsx`. Adicionar prop `total?: number` e `porPagina?: number`:

```typescript
interface PaginacaoProps {
  pagina: number
  temProxima: boolean
  total?: number
  porPagina?: number
}

// No JSX, exibir range quando total disponivel:
{total != null && (
  <span className="text-xs text-muted-foreground">
    {((pagina - 1) * (porPagina ?? 50)) + 1}-{Math.min(pagina * (porPagina ?? 50), total)} de {total.toLocaleString('pt-BR')}
  </span>
)}
```

- [ ] **Step 2: Adicionar count paralelo na tela nota-fiscal**

Em `app/(app)/nota-fiscal/page.tsx`, adicionar count paralelo sem alterar a query principal:

```typescript
// Adicionar ao Promise.all existente (ou criar um se nao tiver):
const [{ data: notas }, { count: totalNotas }] = await Promise.all([
  supabase
    .from('notas_fiscais')
    .select('*')  // selecao completa
    .eq('loja_id', lojaId)
    // ... filtros
    .range(offset, offset + POR_PAGINA - 1),
  supabase
    .from('notas_fiscais')
    .select('*', { count: 'exact', head: true })
    .eq('loja_id', lojaId)
    // ... mesmos filtros (sem range)
])

// Passar para Paginacao:
<Paginacao pagina={pagina} temProxima={temProxima} total={totalNotas ?? undefined} porPagina={POR_PAGINA} />
```

- [ ] **Step 3: Testar**

Abrir /nota-fiscal e confirmar que aparece "1-50 de 847 registros" (ou o numero real). Confirmar que o count muda ao filtrar.

- [ ] **Step 4: Commit**

```bash
git add components/ui-kit/Paginacao.tsx app/(app)/nota-fiscal/page.tsx
git commit -m "feat: paginacao exibe total de registros (ex: 1-50 de 847)"
```

---

## Task 10: UI-03 -- Combobox com busca para selects de produto/fornecedor (4h)

**Files:**
- Create: `components/ui-kit/Combobox.tsx`
- Modify: `components/filtros/FiltrosGaveta.tsx`

**Interfaces:**
- Produces: `Combobox` com input de busca + lista virtualizada; `FiltrosGaveta` renderiza Combobox quando `tipo === 'combobox'`

- [ ] **Step 1: Verificar se cmdk esta no projeto**

```bash
cat package.json | grep cmdk
```

Se nao tiver: `npm install cmdk` -- mas primeiro verificar se shadcn/ui ja inclui o Command. Verificar se existe `components/ui/command.tsx`.

- [ ] **Step 2: Criar Combobox.tsx**

Criar `components/ui-kit/Combobox.tsx`:

```tsx
'use client'
import { useState, useRef } from 'react'
import { cn } from '@/lib/utils'

interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function Combobox({ options, value, onChange, placeholder = 'Buscar...', className, disabled }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = query.length > 0
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const selected = options.find(o => o.value === value)

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 50) }}
        disabled={disabled}
        className="w-full flex items-center justify-between border border-border rounded-md px-3 py-2 text-sm bg-background hover:bg-muted/50 transition-colors"
      >
        <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
          {selected?.label ?? placeholder}
        </span>
        <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6l4 4 4-4"/>
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg overflow-hidden">
          <div className="p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar..."
              className="w-full border border-border rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {value && (
              <button
                type="button"
                onClick={() => { onChange(''); setQuery(''); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50"
              >
                Limpar filtro
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum resultado</p>
            ) : filtered.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setQuery(''); setOpen(false) }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                  opt.value === value && 'bg-muted font-medium'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Adicionar tipo 'combobox' ao FiltrosGaveta**

Abrir `components/filtros/FiltrosGaveta.tsx`. Localizar onde os campos sao renderizados. Adicionar:

```typescript
// No tipo CampoFiltro (provavelmente em lib/filtros.ts ou inline):
tipo: 'text' | 'select' | 'date' | 'toggle' | 'combobox'

// Na renderizacao:
case 'combobox':
  return (
    <Combobox
      options={(campo.opcoes ?? []).map(o => ({ value: String(o.value), label: o.label }))}
      value={valores[campo.key] ?? ''}
      onChange={v => setValores(prev => ({ ...prev, [campo.key]: v }))}
      placeholder={campo.placeholder ?? `Selecionar ${campo.label.toLowerCase()}...`}
    />
  )
```

- [ ] **Step 4: Usar Combobox no filtro de fornecedor da tela produto**

Em `app/(app)/produto/page.tsx`, trocar o campo `fornecedor` de `tipo: 'select'` para `tipo: 'combobox'`. O Combobox funciona melhor com a lista de fornecedores que pode ter dezenas de opcoes.

- [ ] **Step 5: Testar**

Abrir /produto, clicar em Filtros, ir ao campo Fornecedor. Digitar parte do nome -- a lista deve filtrar em tempo real. Selecionar um fornecedor e confirmar que aplica o filtro.

- [ ] **Step 6: Commit**

```bash
git add components/ui-kit/Combobox.tsx components/filtros/FiltrosGaveta.tsx app/(app)/produto/page.tsx
git commit -m "feat: combobox com busca para selects com muitas opcoes (fornecedor, familia)"
```

---

## Task 11: OMIE-02 -- Download DANFE e XML via DFe (3h)

**Files:**
- Create: `lib/omie/dfe-docs.ts`
- Create: `app/api/nota-fiscal/[id]/xml/route.ts`
- Create: `app/api/nota-fiscal/[id]/danfe/route.ts`
- Modify: `app/(app)/nota-fiscal/[id]/page.tsx`

**Interfaces:**
- Consumes: `nCodNF` salvo na tabela `notas_fiscais`
- Produces: download de arquivo XML ou redirect para PDF do DANFE

- [ ] **Step 1: Criar lib/omie/dfe-docs.ts**

```typescript
// lib/omie/dfe-docs.ts
import { omieRequest } from './cliente'
import type { LojaOmie } from './types'

interface DfeResult {
  linkPDF?: string
  linkXML?: string
  linkPortal?: string
}

export async function obterNfe(loja: LojaOmie, nCodNF: number): Promise<DfeResult> {
  const res = await omieRequest<DfeResult>({
    appKey: loja.omie_app_key,
    appSecret: loja.omie_app_secret,
    endpoint: 'v1/produtos/dfedocs',
    call: 'ObterNfe',
    data: { nIdNfe: nCodNF },
  })
  return res
}
```

- [ ] **Step 2: Criar route de XML**

Criar `app/api/nota-fiscal/[id]/xml/route.ts`:

```typescript
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { obterNfe } from '@/lib/omie/dfe-docs'
import { buscarLoja } from '@/lib/lojas'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('n_cod_nf, loja_id')
    .eq('id', params.id)
    .single()

  if (!nf) return new Response('NF nao encontrada', { status: 404 })

  const loja = await buscarLoja(nf.loja_id)
  const dfe = await obterNfe(loja, nf.n_cod_nf)

  if (!dfe.linkXML) return new Response('XML nao disponivel', { status: 404 })

  // Redirecionar para o link do Omie ou fazer proxy
  return Response.redirect(dfe.linkXML, 302)
}
```

- [ ] **Step 3: Criar route de DANFE**

Criar `app/api/nota-fiscal/[id]/danfe/route.ts` -- identico ao XML mas usando `dfe.linkPDF`.

- [ ] **Step 4: Adicionar botoes na tela de detalhe da NF**

Em `app/(app)/nota-fiscal/[id]/page.tsx`, localizar o header com o numero da NF. Adicionar botoes de download:

```tsx
<div className="flex gap-2">
  <a
    href={`/api/nota-fiscal/${nf.id}/xml`}
    download
    className="inline-flex items-center gap-1 text-sm border border-border rounded px-3 py-1.5 hover:bg-muted/50 transition-colors"
  >
    <svg className="w-4 h-4" .../>
    XML
  </a>
  <a
    href={`/api/nota-fiscal/${nf.id}/danfe`}
    target="_blank"
    rel="noopener"
    className="inline-flex items-center gap-1 text-sm border border-border rounded px-3 py-1.5 hover:bg-muted/50 transition-colors"
  >
    <svg className="w-4 h-4" .../>
    DANFE
  </a>
</div>
```

- [ ] **Step 5: Testar na loja 3**

Abrir uma NF concluida da loja 3, clicar em XML. Confirmar que baixa o arquivo .xml. Clicar em DANFE -- confirmar que abre o PDF.

- [ ] **Step 6: Commit**

```bash
git add lib/omie/dfe-docs.ts app/api/nota-fiscal/ app/(app)/nota-fiscal/
git commit -m "feat: download XML e DANFE direto do sistema via DFe docs Omie"
```

---

## Task 12: FAT-01 -- Probe NFC-e e sync cupons fiscais (10h)

Esta task e dividida em sub-etapas. A sub-etapa A (probe) DEVE ser concluida e validada antes de seguir para B.

**Files:**
- Create: `_qa_probe_cupons.mjs` (descartavel apos probe)
- Create: `supabase/migrations/050_cupons_fiscais.sql`
- Create: `lib/omie/cupom-fiscal.ts`
- Create: `app/api/sync/cupons-fiscais/route.ts`
- Modify: `app/(app)/relatorio-faturamento/page.tsx`

### Sub-etapa A: Probe (2h)

- [ ] **Step A1: Criar script de probe**

Criar `_qa_probe_cupons.mjs` na raiz do projeto:

```javascript
// _qa_probe_cupons.mjs -- SCRIPT DE PROBE READ-ONLY, nao salva nada
// Usar apenas na loja 3 (Donana Rio Vermelho)
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Buscar credenciais da loja 3
const { data: loja } = await sb
  .from('lojas')
  .select('omie_app_key, omie_app_secret, nome_fantasia')
  .eq('id', 3)
  .single()

console.log('Testando loja:', loja?.nome_fantasia)

async function chamarOmie(call, data) {
  const res = await fetch('https://app.omie.com.br/api/v1/produtos/cupomfiscalconsultar/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call,
      app_key: loja.omie_app_key,
      app_secret: loja.omie_app_secret,
      param: [data],
    }),
  })
  return res.json()
}

// Probe 1: CuponsFiscais (cabecalhos)
console.log('\n--- CuponsFiscais ---')
const cabecalhos = await chamarOmie('CuponsFiscais', {
  nPagina: 1,
  nRegPorPagina: 3,
  dDtEmissaoDe: '01/06/2026',
  dDtEmissaoAte: '30/06/2026',
})
console.log('nTotRegistros:', cabecalhos.nTotRegistros)
console.log('Primeiro cupom:', JSON.stringify(cabecalhos.cupons?.[0] ?? cabecalhos.CuponsFiscaisResponse?.[0], null, 2))

// Probe 2: CuponsItens (itens com produto)
if (cabecalhos.nTotRegistros > 0) {
  console.log('\n--- CuponsItens ---')
  const itens = await chamarOmie('CuponsItens', {
    nPagina: 1,
    nRegPorPagina: 5,
    dDtEmissaoDe: '01/06/2026',
    dDtEmissaoAte: '30/06/2026',
  })
  console.log('Primeiro item:', JSON.stringify(itens.items?.[0] ?? itens.CuponsItensResponse?.[0], null, 2))
} else {
  console.log('ATENÇÃO: nenhum cupom encontrado. Verificar se PDV esta ativo nesta loja.')
}
```

- [ ] **Step A2: Rodar o probe**

```bash
node _qa_probe_cupons.mjs
```

Resultado esperado:
- `nTotRegistros > 0`
- Campos `nIdCupom`, `cModeloCupom`, `nValorCupom` no primeiro cupom
- Campos `idProduto`, `cCodigo`, `nQuant`, `vItem` nos itens

Se `nTotRegistros = 0`: verificar com Ramon se o PDV da loja 3 esta ativo no Omie e emitiu NFC-e em junho.

Se erro `faultstring`: o endpoint pode estar bloqueado para este plano Omie -- escalar para Ramon.

- [ ] **Step A3: GO/NO-GO**

GO: `nTotRegistros > 0` E campos de item preenchidos -> continuar para sub-etapa B.

NO-GO: endpoint retorna vazio ou erro -> implementar fallback manual (manter import Excel como unica fonte). Anotar no arquivo `docs/superpowers/specs/2026-06-26-omie-varredura-spec.md` o resultado.

### Sub-etapa B: Migration e Wrapper (4h, so se GO)

- [ ] **Step B1: Criar migration 050**

Criar `supabase/migrations/050_cupons_fiscais.sql`:

```sql
create table if not exists cupons_fiscais (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  n_id_cupom bigint not null,
  n_num_cupom bigint,
  c_chave_cupom text,
  d_emissao date,
  c_hr_emissao text,
  n_valor_total numeric,
  c_modelo text,     -- 65=NFC-e, 59=SAT, 00=ECF
  c_cancelado text,  -- S/N
  c_devolvido text,  -- S/N
  full_object jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint cupons_fiscais_loja_cupom unique (loja_id, n_id_cupom)
);

create index if not exists idx_cupons_fiscais_loja_data on cupons_fiscais(loja_id, d_emissao);

create table if not exists cupom_fiscal_items (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  cupom_id bigint not null references cupons_fiscais(id) on delete cascade,
  n_id_cupom bigint not null,
  n_seq int,
  id_produto bigint,
  c_codigo text,
  x_prod text,
  n_quant numeric,
  v_unit numeric,
  v_item numeric,
  v_desc numeric,
  c_cancelado text,  -- S/N
  c_devolvido text,  -- S/N
  full_object jsonb,
  constraint cupom_items_cupom_seq unique (loja_id, n_id_cupom, n_seq)
);

create index if not exists idx_cupom_items_loja_cupom on cupom_fiscal_items(loja_id, n_id_cupom);
create index if not exists idx_cupom_items_codigo on cupom_fiscal_items(loja_id, c_codigo);

-- RPC para relatorio de faturamento nativo
create or replace function relatorio_faturamento_nativo(
  p_loja_id bigint,
  p_ini date,
  p_fim date
) returns table(
  c_codigo text,
  descricao text,
  qtde_total numeric,
  valor_total numeric,
  ticket_medio numeric
)
language sql stable as $$
  select
    ci.c_codigo,
    ci.x_prod as descricao,
    sum(ci.n_quant) as qtde_total,
    sum(ci.v_item) as valor_total,
    case when sum(ci.n_quant) > 0
      then sum(ci.v_item) / sum(ci.n_quant) else 0 end as ticket_medio
  from cupom_fiscal_items ci
  join cupons_fiscais cf on cf.id = ci.cupom_id
  where ci.loja_id = p_loja_id
    and cf.d_emissao >= p_ini
    and cf.d_emissao <= p_fim
    and coalesce(cf.c_cancelado, 'N') != 'S'
    and coalesce(ci.c_cancelado, 'N') != 'S'
    and coalesce(ci.c_devolvido, 'N') != 'S'
  group by ci.c_codigo, ci.x_prod
  order by valor_total desc;
$$;
```

Aplicar:
```bash
node scripts/aplicar-migration.mjs supabase/migrations/050_cupons_fiscais.sql
```

- [ ] **Step B2: Criar lib/omie/cupom-fiscal.ts**

```typescript
// lib/omie/cupom-fiscal.ts
import { omieRequest, sleep } from './cliente'
import type { LojaOmie } from './types'
import { createClient } from '@/lib/supabase/server'

interface OmieCupomFiscal {
  nIdCupom: number
  nNumCupom: number
  cChaveCupom?: string
  dDtEmissaoCupom: string  // DD/MM/AAAA
  cHrEmisaoCupom?: string
  nValorCupom: number
  cModeloCupom: string     // 65/59/00
  cCupomCancelado: string  // S/N
  cCupomDevolvido: string  // S/N
}

interface OmieCupomItem {
  nIdCupom: number
  nSeqItem?: number
  idProduto?: number
  cCodigo: string
  xProd: string
  nQuant: number
  vUnit: number
  vItem: number
  vDesc?: number
  cItemCancelado: string  // S/N
  cItemDevolvido?: string // S/N
}

interface ListagemCupons {
  nTotRegistros: number
  nTotPaginas: number
  cupons?: OmieCupomFiscal[]
}

interface ListagemItens {
  nTotRegistros: number
  nTotPaginas: number
  items?: OmieCupomItem[]
}

export async function syncCuponsFiscais(
  loja: LojaOmie,
  dataIni: string,  // DD/MM/AAAA
  dataFim: string,
) {
  const supabase = createClient()

  // 1. Sync cabecalhos
  let pagina = 1
  let totalPaginas = 1

  while (pagina <= totalPaginas) {
    const res = await omieRequest<ListagemCupons>({
      appKey: loja.omie_app_key,
      appSecret: loja.omie_app_secret,
      endpoint: 'v1/produtos/cupomfiscalconsultar',
      call: 'CuponsFiscais',
      data: {
        nPagina: pagina,
        nRegPorPagina: 100,
        dDtEmissaoDe: dataIni,
        dDtEmissaoAte: dataFim,
      },
    })

    totalPaginas = res.nTotPaginas ?? 1

    const cupons = res.cupons ?? []
    if (cupons.length > 0) {
      const rows = cupons.map(c => ({
        loja_id: loja.id,
        n_id_cupom: c.nIdCupom,
        n_num_cupom: c.nNumCupom,
        c_chave_cupom: c.cChaveCupom,
        d_emissao: parseDateBR(c.dDtEmissaoCupom),
        c_hr_emissao: c.cHrEmisaoCupom,
        n_valor_total: c.nValorCupom,
        c_modelo: c.cModeloCupom,
        c_cancelado: c.cCupomCancelado,
        c_devolvido: c.cCupomDevolvido,
        full_object: c,
        updated_at: new Date().toISOString(),
      }))

      await supabase
        .from('cupons_fiscais')
        .upsert(rows, { onConflict: 'loja_id,n_id_cupom', ignoreDuplicates: false })
    }

    pagina++
    if (pagina <= totalPaginas) await sleep(300)
  }

  // 2. Sync itens
  pagina = 1
  totalPaginas = 1

  while (pagina <= totalPaginas) {
    const res = await omieRequest<ListagemItens>({
      appKey: loja.omie_app_key,
      appSecret: loja.omie_app_secret,
      endpoint: 'v1/produtos/cupomfiscalconsultar',
      call: 'CuponsItens',
      data: {
        nPagina: pagina,
        nRegPorPagina: 100,
        dDtEmissaoDe: dataIni,
        dDtEmissaoAte: dataFim,
      },
    })

    totalPaginas = res.nTotPaginas ?? 1

    const items = res.items ?? []
    if (items.length > 0) {
      // Buscar IDs dos cupons no banco para FK
      const ids = [...new Set(items.map(i => i.nIdCupom))]
      const { data: cuponsMap } = await supabase
        .from('cupons_fiscais')
        .select('id, n_id_cupom')
        .eq('loja_id', loja.id)
        .in('n_id_cupom', ids)

      const mapaId = new Map(cuponsMap?.map(c => [c.n_id_cupom, c.id]) ?? [])

      const rows = items
        .filter(i => mapaId.has(i.nIdCupom))
        .map((i, idx) => ({
          loja_id: loja.id,
          cupom_id: mapaId.get(i.nIdCupom)!,
          n_id_cupom: i.nIdCupom,
          n_seq: i.nSeqItem ?? idx,
          id_produto: i.idProduto,
          c_codigo: i.cCodigo,
          x_prod: i.xProd,
          n_quant: i.nQuant,
          v_unit: i.vUnit,
          v_item: i.vItem,
          v_desc: i.vDesc ?? 0,
          c_cancelado: i.cItemCancelado,
          c_devolvido: i.cItemDevolvido ?? 'N',
          full_object: i,
        }))

      if (rows.length > 0) {
        await supabase
          .from('cupom_fiscal_items')
          .upsert(rows, { onConflict: 'loja_id,n_id_cupom,n_seq', ignoreDuplicates: false })
      }
    }

    pagina++
    if (pagina <= totalPaginas) await sleep(300)
  }
}

function parseDateBR(s: string): string {
  // DD/MM/AAAA -> YYYY-MM-DD
  const [d, m, a] = s.split('/')
  return `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}
```

- [ ] **Step B3: Criar rota de sync**

Criar `app/api/sync/cupons-fiscais/route.ts` (copiar estrutura de `app/api/sync/notas-fiscais/route.ts` e adaptar para chamar `syncCuponsFiscais`).

- [ ] **Step B4: Adicionar ao SyncButton da home**

Em `components/SyncButton.tsx` (ou onde o sync admin esta), adicionar o endpoint `/api/sync/cupons-fiscais` a lista de endpoints chamados.

- [ ] **Step B5: Atualizar tela de faturamento**

Em `app/(app)/relatorio-faturamento/page.tsx`, detectar se ha cupons sincronizados e usar RPC nativa:

```typescript
// Verificar se tem dados nativos
const { count: totalCupons } = await supabase
  .from('cupons_fiscais')
  .select('*', { count: 'exact', head: true })
  .eq('loja_id', lojaId)
  .gte('d_emissao', dataIni)

const fonteNativa = (totalCupons ?? 0) > 0

// Usar RPC nativa ou manter import manual
const { data: fatData } = fonteNativa
  ? await supabase.rpc('relatorio_faturamento_nativo', {
      p_loja_id: lojaId,
      p_ini: dataIni,
      p_fim: dataFim,
    })
  : await supabase.rpc('relatorio_faturamento_matriz', { p_loja_id: lojaId })
```

Adicionar badge na tela: "Fonte: Omie (NFC-e)" ou "Fonte: Import manual".

- [ ] **Step B6: Backfill de dados historicos**

Criar `scripts/backfill-cupons.mjs`:

```javascript
// scripts/backfill-cupons.mjs -- rodar UMA vez para preencher historico
// Varre mes a mes de 2025-07 ate hoje
import { ... } from './sync-lib.mjs'

const LOJAS = [1, 2, 3, 5, 6, 7]  // excluir loja 4
const meses = gerarMeses('2025-07', format(new Date(), 'yyyy-MM'))

for (const lojaId of LOJAS) {
  for (const mes of meses) {
    const ini = `01/${mes.slice(5, 7)}/${mes.slice(0, 4)}`
    const fim = ultimoDiaDoMes(mes)
    await syncCuponsFiscais(loja, ini, fim)
    await sleep(1000)  // 1s entre lojas/meses
  }
}
```

- [ ] **Step B7: Commit**

```bash
git add supabase/migrations/050_cupons_fiscais.sql lib/omie/cupom-fiscal.ts app/api/sync/cupons-fiscais/ app/(app)/relatorio-faturamento/ scripts/backfill-cupons.mjs
git commit -m "feat: sync NFC-e via cupomfiscalconsultar -- faturamento por produto nativo"
```

---

## Task 13: OMIE-04 -- Pedido de Compra integrado (6h)

**Files:**
- Create: `lib/omie/pedido-compra.ts`
- Create: `components/produtos/GerarPedidoCompra.tsx`
- Modify: `app/(app)/produto/page.tsx`

**Interfaces:**
- Consumes: lista de produtos com `codigo`, `descricao`, `valor_compra` (ultimo preco de compra) e quantidade sugerida
- Produces: PO criado no Omie real com confirmacao ao usuario

- [ ] **Step 1: Criar lib/omie/pedido-compra.ts**

```typescript
// lib/omie/pedido-compra.ts
import { omieRequest, sleep } from './cliente'
import type { LojaOmie } from './types'

interface ItemPedido {
  codigoInterno: string  // cCodIntItem unico por item
  nCodProd: number       // ID do produto no Omie
  quantidade: number
  valorUnit: number
}

interface CabecalhoPedido {
  nCodFor: number        // ID do fornecedor no Omie
  dDtPrevisao: string    // DD/MM/AAAA
  observacao?: string
}

interface ResultadoPedido {
  nIdPedido: number
  cCodIntPed: string
}

export async function incluirPedidoCompra(
  loja: LojaOmie,
  cabecalho: CabecalhoPedido,
  itens: ItemPedido[],
  cCodIntPed: string,
): Promise<ResultadoPedido> {
  await sleep(800)  // anti-rajada para escrita

  const res = await omieRequest<ResultadoPedido>({
    appKey: loja.omie_app_key,
    appSecret: loja.omie_app_secret,
    endpoint: 'v1/produtos/pedidocompra',
    call: 'IncluirPedCompra',
    data: {
      cabecalho: {
        cCodIntPed,
        dDtPrevisao: cabecalho.dDtPrevisao,
        nCodFor: cabecalho.nCodFor,
        cObsInterna: cabecalho.observacao ?? '',
      },
      produtos: itens.map(item => ({
        cCodIntItem: item.codigoInterno,
        nCodProd: item.nCodProd,
        nQtde: item.quantidade,
        nValUnit: item.valorUnit,
      })),
    },
  })

  return res
}
```

- [ ] **Step 2: Criar server action para gerar PO**

Em `lib/actions/pedido-compra.ts`:

```typescript
'use server'
import { requirePermissao } from '@/lib/auth'
import { buscarLoja } from '@/lib/lojas'
import { incluirPedidoCompra } from '@/lib/omie/pedido-compra'
import { createClient } from '@/lib/supabase/server'

export async function gerarPedidoCompra(
  lojaId: number,
  fornecedorOmieId: number,
  itens: Array<{ nCodProd: number; descricao: string; quantidade: number; valorUnit: number }>
) {
  await requirePermissao(lojaId, 'Produtos - Editar')

  const loja = await buscarLoja(lojaId)
  const cCodIntPed = `NTB-PO-${lojaId}-${Date.now()}`

  const resultado = await incluirPedidoCompra(
    loja,
    {
      nCodFor: fornecedorOmieId,
      dDtPrevisao: formatarDataBR(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)), // +7 dias
    },
    itens.map((item, i) => ({
      codigoInterno: `${cCodIntPed}-${i + 1}`,
      nCodProd: item.nCodProd,
      quantidade: item.quantidade,
      valorUnit: item.valorUnit,
    })),
    cCodIntPed,
  )

  // Registrar na auditoria
  const supabase = createClient()
  await supabase.from('auditoria').insert({
    loja_id: lojaId,
    acao: 'GERAR_PEDIDO_COMPRA',
    descricao: `PO ${cCodIntPed} criado no Omie com ${itens.length} itens`,
    dados: { resultado, itens },
  })

  return { ok: true, nIdPedido: resultado.nIdPedido, cCodIntPed }
}

function formatarDataBR(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
```

- [ ] **Step 3: Criar modal GerarPedidoCompra**

Criar `components/produtos/GerarPedidoCompra.tsx` -- modal que:
1. Lista produtos com sugestao > 0
2. Permite selecionar quais incluir (checkbox)
3. Agrupa por fornecedor (usando RPC `compras_fornecedores` que ja existe)
4. Botao "Gerar pedido no Omie" com alerta: "Este pedido sera criado no Omie e nao pode ser desfeito por este sistema"
5. Apos confirmacao, chama `gerarPedidoCompra` e exibe link/numero do pedido gerado

- [ ] **Step 4: Adicionar botao na tela produto (modo compras)**

Em `app/(app)/produto/page.tsx`, no header quando `vista === 'compras'`:

```tsx
{vista === 'compras' && podeEditar && qtdRepor > 0 && (
  <GerarPedidoCompra
    lojaId={lojaId}
    produtos={produtos.filter(p => calcularComprar(p) > 0)}
  />
)}
```

- [ ] **Step 5: Testar na loja 3 com Ramon presente**

ATENCAO: este passo DEVE ser feito com o Ramon presente pois cria um PO real no Omie.
Selecionar 1-2 produtos com quantidade pequena, gerar o pedido, verificar no Omie que apareceu.

- [ ] **Step 6: Commit**

```bash
git add lib/omie/pedido-compra.ts lib/actions/pedido-compra.ts components/produtos/GerarPedidoCompra.tsx app/(app)/produto/page.tsx
git commit -m "feat: gerar pedido de compra no Omie a partir da sugestao de compra do sistema"
```

---

## Self-Review

### Cobertura dos requisitos

- [x] Corrigir auditoria fiscal (NFs canceladas nos totais) -- Task 2
- [x] Fix filtro fornecedor na NF -- Task 3
- [x] Investigar e corrigir erro de transferencia -- Tasks 1 e 4
- [x] Export completo de produtos -- Task 5
- [x] Dashboard com valor do estoque e data de sync -- Task 6
- [x] Filtros de data no faturamento -- Task 7
- [x] Ordenacao por coluna nas tabelas -- Task 8
- [x] Total de registros na paginacao -- Task 9
- [x] Combobox com busca para selects -- Task 10
- [x] Download DANFE/XML -- Task 11
- [x] Sync NFC-e e relatorio de faturamento nativo -- Task 12
- [x] Pedido de Compra integrado -- Task 13

### Ordem de execucao recomendada

Tasks de bug (Tasks 1-4): ~2h total
Tasks de UI quick wins (Tasks 5-10): ~16h total
Tasks de novos endpoints (Tasks 11-13): ~19h total

**TOTAL ESTIMADO FASE 1: ~37h de desenvolvimento**

### Restricoes criticas nao esquecidas

- Testes ao vivo: loja 3 ou 7 (nunca loja 4)
- Omie escrita: 800ms entre calls (pedido de compra, ajustes)
- Probe NFC-e obrigatorio antes de implementar FAT-01
- Pedido de Compra: testar com Ramon presente
- Sem travessao nos textos de UI
