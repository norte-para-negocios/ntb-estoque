# Relatório de Inventários (PDF por período) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Item #11 do catálogo da reunião 27/07 — um relatório PDF de Inventários por
período (hoje só existe Excel + PDF individual por inventário), mais um botão de
"Copiar link" (a versão viável de "compartilhar" pedida, já que não existe Web Share API
em lugar nenhum do repo).

**Architecture:** Espelha quase 1:1 o padrão já existente do Relatório de Transferências
(`app/(app)/transferencia/relatorio/route.ts` + `RelatorioTransferenciaPDF.tsx`), adaptado
pro schema/convenção de `inventarios` (status `F`/`A`→Finalizado, não `C`/`A`→Concluido;
sem `motivo` TRF/TPQ; responsável via join com `profiles.name`; local é uma coluna só,
não par origem/destino).

**Tech Stack:** Next.js 16 Route Handler, `@react-pdf/renderer`, Supabase.

## Global Constraints
- Sem suite de testes — verificação real é `npx eslint` + `npm run build` (`EXIT=0` sem
  "Failed to type check") + teste visual com dado real via chrome-devtools/conta QA.
- Paginar QUALQUER query nesta feature em blocos de 1000 (PostgREST corta em silêncio) —
  já achei esse bug ao vivo no item #10, não repetir.
- Dois bugs documentados no código de referência que NÃO podem se repetir aqui:
  (1) export/relatório recebendo filtro na URL mas ignorando-o de verdade na query
  (já corrigido no Excel de Inventário e no PDF de Transferência, comentários em
  `inventario/export/route.ts:31-37` e `transferencia/relatorio/route.ts:75-77`);
  (2) comparar `status` cru do Omie (`"Concluido"`) com o código da URL (`"C"`/`"F"`) —
  sempre mapear código→valor real antes do `.eq()`.
- Depois do commit+push, sempre rodar o deploy manual (SSH `deploy.sh` no Contabo).

---

### Task 1: Componente PDF (`RelatorioInventarioPDF.tsx`)

**Files:** Create `components/relatorio/RelatorioInventarioPDF.tsx`

- [ ] **Step 1: Escrever, espelhando `RelatorioTransferenciaPDF.tsx` quase linha a linha**

```tsx
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, PdfResumoBar, pdfTabela } from './PdfChrome'
import { statusInfo } from '@/lib/status-cor'

const col = StyleSheet.create({
  num:         { width: '10%' },
  local:       { width: '26%' },
  data:        { width: '16%' },
  responsavel: { width: '25%' },
  itens:       { width: '10%', textAlign: 'right' },
  status:      { width: '13%' },
})

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 44, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
})

export interface RelatorioInventarioItem {
  num: string
  local: string
  data: string
  responsavel: string
  itens: number
  status: string
}

export function RelatorioInventarioPDF({
  loja,
  periodo,
  filtros,
  inventarios,
}: {
  loja: string
  periodo: string
  filtros?: string
  inventarios: RelatorioInventarioItem[]
}) {
  const sub = [loja, `Período: ${periodo}`, filtros].filter(Boolean).join(' · ')
  const totalItens = inventarios.reduce((acc, i) => acc + i.itens, 0)

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo="Relatório de Inventários" sub={sub} />

        <PdfResumoBar
          campos={[
            { label: 'Período', valor: periodo },
            { label: 'Inventários', valor: String(inventarios.length) },
            { label: 'Total de itens contados', valor: String(totalItens) },
          ]}
        />

        <View style={pdfTabela.table}>
          <View style={pdfTabela.thead} fixed>
            <Text style={[pdfTabela.th, col.num]}>Nº</Text>
            <Text style={[pdfTabela.th, col.local]}>Local</Text>
            <Text style={[pdfTabela.th, col.data]}>Data</Text>
            <Text style={[pdfTabela.th, col.responsavel]}>Responsável</Text>
            <Text style={[pdfTabela.th, col.itens]}>Itens</Text>
            <Text style={[pdfTabela.th, col.status]}>Status</Text>
          </View>

          {inventarios.map((inv, i) => (
            <View key={i} style={[pdfTabela.tr, i % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
              <Text style={[pdfTabela.tdMuted, col.num]}>{inv.num}</Text>
              <Text style={[pdfTabela.td, col.local]}>{inv.local}</Text>
              <Text style={[pdfTabela.tdMuted, col.data]}>{inv.data}</Text>
              <Text style={[pdfTabela.td, col.responsavel]}>{inv.responsavel}</Text>
              <Text style={[pdfTabela.td, col.itens]}>{inv.itens}</Text>
              <Text style={[pdfTabela.td, col.status]}>{statusInfo(inv.status).label}</Text>
            </View>
          ))}

          <View style={pdfTabela.totalRow} wrap={false}>
            <Text style={[pdfTabela.totalTxt, { flex: 1 }]}>
              Total ({inventarios.length} {inventarios.length === 1 ? 'inventário' : 'inventários'})
            </Text>
            <Text style={[pdfTabela.totalTxt, col.itens, { textAlign: 'right' }]}>{totalItens}</Text>
            <Text style={[pdfTabela.totalTxt, col.status]} />
          </View>
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
```

- [ ] **Step 2: Lint** — `npx eslint components/relatorio/RelatorioInventarioPDF.tsx` → 0 erros.
- [ ] **Step 3: Commit** — `git commit -m "feat: componente PDF do Relatório de Inventários"`

---

### Task 2: Rota do relatório (`inventario/relatorio/route.ts`)

**Files:** Create `app/(app)/inventario/relatorio/route.ts`

- [ ] **Step 1: Escrever, espelhando `transferencia/relatorio/route.ts` mas com a
  resolução de filtro mais simples do `inventario/export/route.ts` (família/tipo/produto
  direto via `inventario_items`, sem o hop de `movimentos`/Contabo — inventário não
  precisa disso) e a convenção de status certa (F/A → Finalizado)**

```ts
import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { fmtData, fmtDataParam } from '@/lib/pdf-utils'
import { RelatorioInventarioPDF, type RelatorioInventarioItem } from '@/components/relatorio/RelatorioInventarioPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { labelTipoItem } from '@/lib/constants-omie'
import { escapeIlikeOr } from '@/lib/utils-busca'

async function pdfErroResponse(titulo: string, mensagem: string) {
  const el = createElement(PdfErro, { titulo, mensagem }) as Parameters<typeof renderToBuffer>[0]
  const buf = await renderToBuffer(el)
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="erro.pdf"' },
  })
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) {
    return pdfErroResponse('Sem permissão', 'Você não tem permissão para acessar este relatório.')
  }

  const { searchParams } = new URL(request.url)
  const dataInicio = searchParams.get('data_inicio') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = searchParams.get('data_final') || new Date().toISOString().split('T')[0]
  const familia = searchParams.get('familia') || ''
  const tipo = searchParams.get('tipo') || ''
  const produto = searchParams.get('produto') || ''
  const status = searchParams.get('status') || ''
  const locaisArr = valoresMulti(searchParams.get('local') || undefined).map(Number).filter((n) => !Number.isNaN(n))

  const supabase = await createClient()

  const { data: loja } = await supabase.from('lojas').select('nome, nome_fantasia').eq('id', lojaId).single()
  const nomeLoja = loja?.nome_fantasia || loja?.nome || 'Loja'

  const { data: locais } = await supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId)
  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  // Filtro familia/tipo/produto -> inventario_items -> inventario_id (direto, sem hop de
  // movimentos/Contabo -- inventario_items ja tem produto_familia/produto_codigo_produto
  // proprios, ver inventario/export/route.ts:38-88).
  let idsFiltrados: number[] | null = null
  if (familia || tipo || produto) {
    let codigosTipo: number[] | null = null
    if (tipo) {
      const prods: { codigo_produto: number | null }[] = []
      for (let from = 0; ; from += 1000) {
        const { data: bloco } = await supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).eq('tipo_item', tipo).order('codigo_produto').range(from, from + 999)
        if (!bloco?.length) break
        prods.push(...bloco)
        if (bloco.length < 1000) break
      }
      codigosTipo = [...new Set(prods.map((p) => p.codigo_produto).filter((v): v is number => v != null))]
    }
    if (codigosTipo !== null && codigosTipo.length === 0) {
      idsFiltrados = []
    } else {
      const items: { inventario_id: number | null }[] = []
      for (let from = 0; ; from += 1000) {
        let q = supabase.from('inventario_items').select('inventario_id').eq('loja_id', lojaId)
        if (familia) q = q.eq('produto_familia', familia)
        if (codigosTipo !== null) q = q.in('produto_codigo_produto', codigosTipo)
        if (produto) {
          const termo = escapeIlikeOr(produto)
          q = q.or(`produto_descricao.ilike.%${termo}%,produto_codigo.ilike.%${termo}%`)
        }
        const { data: bloco } = await q.order('id').range(from, from + 999)
        if (!bloco?.length) break
        items.push(...bloco)
        if (bloco.length < 1000) break
      }
      idsFiltrados = [...new Set(items.map((i) => i.inventario_id).filter((v): v is number => v != null))]
    }
  }

  type Linha = {
    id: number
    data: string | null
    codigo_local_estoque: number | null
    status: string | null
    user_id: string | null
    items: { count: number }[] | null
  }
  const invRaw: Linha[] = []
  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('inventarios')
      .select('id, data, codigo_local_estoque, status, user_id, items:inventario_items(count)')
      .eq('loja_id', lojaId)
      .gte('data', dataInicio)
      .lte('data', `${dataFinal}T23:59:59`)
      .order('data', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
    if (idsFiltrados !== null) q = q.in('id', idsFiltrados.length ? idsFiltrados : [-1])
    if (status === 'F') q = q.eq('status', 'Finalizado')
    else if (status === 'A') q = q.neq('status', 'Finalizado')
    if (locaisArr.length) q = q.in('codigo_local_estoque', locaisArr)
    return q
  }
  for (let pagina = 0; ; pagina++) {
    const from = pagina * 1000
    const { data: bloco } = await buildQuery(from, from + 999)
    if (!bloco?.length) break
    invRaw.push(...(bloco as unknown as Linha[]))
    if (bloco.length < 1000) break
  }

  const userIds = [...new Set(invRaw.map((i) => i.user_id).filter(Boolean))]
  const { data: profs } = userIds.length
    ? await supabase.from('profiles').select('id, name').in('id', userIds as string[])
    : { data: [] as { id: string; name: string | null }[] }
  const nomeMap = new Map((profs ?? []).map((p) => [p.id, p.name]))

  const itens: RelatorioInventarioItem[] = invRaw.map((inv) => ({
    num: `#${inv.id}`,
    local: String(localMap.get(inv.codigo_local_estoque ?? -1) || inv.codigo_local_estoque || '-'),
    data: fmtData(inv.data),
    responsavel: nomeMap.get(inv.user_id ?? '') || '-',
    itens: Array.isArray(inv.items) ? inv.items[0]?.count ?? 0 : 0,
    status: inv.status || '-',
  }))

  const filtrosAtivos: string[] = []
  if (familia) filtrosAtivos.push(`Família: ${familia}`)
  if (tipo) filtrosAtivos.push(`Tipo: ${labelTipoItem(tipo)}`)
  if (produto) filtrosAtivos.push(`Produto: ${produto}`)
  if (locaisArr.length) filtrosAtivos.push(`Local: ${locaisArr.map((c) => localMap.get(c) || String(c)).join(', ')}`)
  if (status === 'F') filtrosAtivos.push('Status: Finalizado')
  else if (status === 'A') filtrosAtivos.push('Status: Em aberto')

  const periodo = `${fmtDataParam(dataInicio)} a ${fmtDataParam(dataFinal)}`
  const nomeArquivo = `relatorio-inventarios-${nomeLoja.replace(/\s+/g, '-').toLowerCase()}-${dataInicio}-${dataFinal}.pdf`

  const element = createElement(RelatorioInventarioPDF, {
    loja: nomeLoja,
    periodo,
    filtros: filtrosAtivos.length ? filtrosAtivos.join(', ') : undefined,
    inventarios: itens,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nomeArquivo}"` },
  })
}
```

- [ ] **Step 2: Lint + Build** — `npx eslint` na rota + `npm run build` → `EXIT=0`.
- [ ] **Step 3: Commit**

---

### Task 3: Botão "Relatório PDF" + "Copiar link" na listagem

**Files:**
- Modify: `app/(app)/inventario/page.tsx` (botão de relatório, ao lado do Excel existente)
- Create: `components/inventario/CopiarLinkRelatorio.tsx` (botão de copiar, mesmo idioma de
  `components/loja/CopyWebhook.tsx` — `navigator.clipboard.writeText`, sem precedente de
  Web Share API real no repo, então isso é a versão viável de "compartilhar")

- [ ] **Step 1: Componente de copiar link**

```tsx
// components/inventario/CopiarLinkRelatorio.tsx
'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'

export function CopiarLinkRelatorio({ href }: { href: string }) {
  const [copiado, setCopiado] = useState(false)
  function copiar() {
    const url = new URL(href, window.location.origin).toString()
    navigator.clipboard.writeText(url)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }
  return (
    <button type="button" onClick={copiar} className={btnClass('outline')} title="Copiar link do relatório pra compartilhar">
      {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copiado ? 'Copiado' : 'Copiar link'}
    </button>
  )
}
```

- [ ] **Step 2: No `page.tsx`, ao lado do botão "Excel" existente (linhas ~275-292),
  montar `relatorioParams` (mesmos 7 campos do `exportParams` já ali) e adicionar:**

```tsx
              <a
                href={`/inventario/relatorio?${relatorioParams.toString()}`}
                target="_blank" rel="noopener noreferrer" className={btnClass('outline')}
              >
                <FileText className="size-4" /> Relatório PDF
              </a>
              <CopiarLinkRelatorio href={`/inventario/relatorio?${relatorioParams.toString()}`} />
```
(precisa importar `FileText` de `lucide-react` e `CopiarLinkRelatorio`; extrair
`relatorioParams` como uma `const` reaproveitando o mesmo objeto de filtros já montado
pro Excel, em vez de duplicar a lista de 7 campos — ver comentário de bug já documentado
em `inventario/export/route.ts:31-37` sobre filtro ficar pra trás num dos dois links.)

- [ ] **Step 3: Lint + Build**
- [ ] **Step 4: Commit**

---

### Task 4: Verificação visual com dado real (QA)

- [ ] Subir dev server (`npx next dev -p 3008`), logar com a conta QA.
- [ ] Ir em `/inventario`, aplicar um período com dado real, clicar "Relatório PDF" —
  conferir que abre com inventários reais, nome/local/responsável/itens/status corretos.
- [ ] Testar "Copiar link" — conferir que o clipboard recebe a URL absoluta certa.
- [ ] Testar com um filtro de local/família/status ativo — conferir que o PDF reflete o
  filtro (não traz tudo).
- [ ] Parar dev server, deploy manual, confirmar HTTP 200, atualizar
  `docs/reuniao-2026-07-27-pedidos.md` (item #11).
