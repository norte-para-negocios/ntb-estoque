# Impressão de Programação de Produção — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Item #10 do catálogo da reunião 27/07 — um PDF imprimível de "Programação de
Produção" em formato matriz (produto × dia do mês), com espaço em branco por dia pra
preenchimento manual da quantidade produzida, mais uma variante "em atraso" (mesma matriz,
só ordens ainda não concluídas com previsão já vencida).

**Architecture:** Segue o padrão já estabelecido no repo pra relatórios PDF: uma rota GET
(`app/(app)/ordem-producao/programacao/route.ts`) busca e agrupa os dados direto (sem
`lib/actions/` — mesma convenção de `ordem-producao/relatorio/route.ts`), monta um componente
`@react-pdf/renderer` novo (`components/relatorio/ProgramacaoProducaoPDF.tsx`, usando os
primitivos de `PdfChrome.tsx`) e devolve `renderToBuffer` como resposta PDF. A página de
listagem (`app/(app)/ordem-producao/page.tsx`) ganha um filtro de "Local de produção" (ainda
não existe lá) e dois botões que linkam pra rota nova carregando os filtros atuais.

**Tech Stack:** Next.js 16 App Router (Server Component + Route Handler), `@react-pdf/renderer`,
Supabase (`ordens_producao` + `produtos` + `local_estoques`), TypeScript.

## Global Constraints
- **Não existe suite de testes neste repo** (`package.json` só tem `dev`/`build`/`start`/`lint`).
  Onde este plano diria "rode o teste", a verificação real é: `npx eslint <arquivo>` (deve dar
  zero erros novos) + `npm run build` (deve terminar `EXIT=0` sem "Failed to type check") +
  verificação visual real (renderizar o PDF e checar o conteúdo, via script ad-hoc ou
  navegando pra rota com o dev server rodando).
- Todo PDF deste repo usa os primitivos de `components/relatorio/PdfChrome.tsx`
  (`PdfCabecalho`, `PdfRodape`, `pdfTabela`) — não duplicar estilo.
- `ordens_producao.produto_codigo/produto_descricao/produto_tipo_item` são 100% NULL nesta
  base — sempre buscar produto via `produtos` cruzando por
  `identificacao_n_cod_produto = produtos.codigo_produto` (comentário já existente em
  `app/(app)/ordem-producao/page.tsx:105-107`).
- Local de produção é `local_estoques` (não existe enum núcleo/cozinha/bar — são só valores
  de texto livre em `local_estoques.descricao`, filtrados via
  `ordens_producao.identificacao_codigo_local_estoque`).
- Status "atrasada" vem de `opStatus()` (`lib/op-status.ts`), nunca comparar
  `adicionais_d_dt_conclusao` diretamente (é data planejada, não a de conclusão real).
- Depois de qualquer commit+push neste projeto, rodar o deploy manual
  (`ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`)
  antes de considerar a mudança visível em produção — `git push` sozinho não atualiza o app.

---

### Task 1: Componente PDF da matriz (`ProgramacaoProducaoPDF.tsx`)

**Files:**
- Create: `components/relatorio/ProgramacaoProducaoPDF.tsx`
- Test (ad-hoc, não commitado): `scripts/qa-programacao-pdf.mjs` — script de verificação visual,
  apagado ao final da task

**Interfaces:**
- Produces: `ProgramacaoProducaoPDF({ loja, local, mesLabel, filtros, dias, linhas }: { loja: string; local: string; mesLabel: string; filtros?: string; dias: number[]; linhas: LinhaProgramacao[] })` — usado pela Task 2.
  ```ts
  export interface LinhaProgramacao {
    codigo: string
    descricao: string
    unidade: string
    porDia: Record<number, number> // dia do mes (1-31) -> quantidade prevista
  }
  ```

- [ ] **Step 1: Escrever o componente**

```tsx
// components/relatorio/ProgramacaoProducaoPDF.tsx
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, pdfTabela } from './PdfChrome'

export interface LinhaProgramacao {
  codigo: string
  descricao: string
  unidade: string
  porDia: Record<number, number>
}

const s = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    fontSize: 7,
    fontFamily: 'Helvetica',
    color: '#111',
  },
  linhaCabecalho: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderRadius: 2,
    paddingVertical: 4,
    marginBottom: 2,
  },
  linhaProduto: {
    flexDirection: 'row',
    borderBottom: 0.5,
    borderColor: '#e5e7eb',
    minHeight: 26,
    alignItems: 'stretch',
  },
  colProduto: {
    width: 150,
    paddingRight: 4,
    paddingLeft: 2,
    justifyContent: 'center',
  },
  colDia: {
    flex: 1,
    borderLeft: 0.5,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  thProduto: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, textTransform: 'uppercase' },
  thDia: { fontFamily: 'Helvetica-Bold', fontSize: 6.5, textAlign: 'center' },
  codigo: { fontSize: 6, color: '#6b7280' },
  descricao: { fontSize: 7, fontFamily: 'Helvetica-Bold' },
  unidade: { fontSize: 6, color: '#6b7280' },
  prev: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#111' },
  prevVazio: { fontSize: 7, color: '#d1d5db' },
  linhaReal: {
    marginTop: 3,
    width: '80%',
    borderBottom: 0.5,
    borderColor: '#9ca3af',
    height: 8,
  },
})

export function ProgramacaoProducaoPDF({
  loja,
  local,
  mesLabel,
  filtros,
  dias,
  linhas,
}: {
  loja: string
  local: string
  mesLabel: string
  filtros?: string
  dias: number[]
  linhas: LinhaProgramacao[]
}) {
  const sub = [loja, `Local: ${local}`, mesLabel, filtros].filter(Boolean).join(' · ')

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <PdfCabecalho titulo="Programação de Produção" sub={sub} />

        <View style={pdfTabela.table}>
          <View style={s.linhaCabecalho} fixed>
            <View style={s.colProduto}>
              <Text style={s.thProduto}>Produto</Text>
            </View>
            {dias.map((d) => (
              <View key={d} style={s.colDia}>
                <Text style={s.thDia}>{d}</Text>
              </View>
            ))}
          </View>

          {linhas.map((l) => (
            <View key={l.codigo} style={s.linhaProduto} wrap={false}>
              <View style={s.colProduto}>
                <Text style={s.descricao}>{l.descricao}</Text>
                <Text style={s.codigo}>{l.codigo} · {l.unidade}</Text>
              </View>
              {dias.map((d) => {
                const qtd = l.porDia[d]
                return (
                  <View key={d} style={s.colDia}>
                    <Text style={qtd ? s.prev : s.prevVazio}>{qtd ? qtd : '-'}</Text>
                    <View style={s.linhaReal} />
                  </View>
                )
              })}
            </View>
          ))}

          {!linhas.length && (
            <Text style={{ fontSize: 9, color: '#6b7280', marginTop: 10 }}>
              Nenhuma ordem de produção prevista para este período/local.
            </Text>
          )}
        </View>

        <PdfRodape texto="NTB Estoque · Número em cima = previsto. Linha em baixo = espaço para anotar o produzido." />
      </Page>
    </Document>
  )
}
```

- [ ] **Step 2: Verificar que renderiza sem erro (script ad-hoc, fixture com >20 dias)**

```bash
cat > scripts/qa-programacao-pdf.mjs <<'EOF'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { writeFileSync } from 'node:fs'
import { ProgramacaoProducaoPDF } from '../components/relatorio/ProgramacaoProducaoPDF.tsx'

const dias = Array.from({ length: 30 }, (_, i) => i + 1)
const linhas = [
  { codigo: '70003', descricao: 'FEIJOADA (PI)', unidade: 'UN', porDia: { 5: 8, 16: 8 } },
  { codigo: '70004', descricao: 'CALDO DE SURURU (PI)', unidade: 'UN', porDia: { 3: 17, 13: 17 } },
  { codigo: '70999', descricao: 'PRODUTO SEM PREVISAO NO MES', unidade: 'UN', porDia: {} },
]
const el = createElement(ProgramacaoProducaoPDF, {
  loja: 'Loja Teste', local: 'COZINHA', mesLabel: 'Julho/2026', filtros: 'Tipo: Produto em Processo',
  dias, linhas,
})
const buf = await renderToBuffer(el)
writeFileSync('/tmp/qa-programacao.pdf', buf)
console.log('OK, bytes:', buf.length)
EOF
npx tsx scripts/qa-programacao-pdf.mjs
```

Expected: imprime `OK, bytes: <N>` sem lançar exceção, e `/tmp/qa-programacao.pdf` existe com
tamanho > 0. Abrir o arquivo (`open /tmp/qa-programacao.pdf` no Mac) e conferir visualmente:
30 colunas de dia cabem na página landscape, produto sem previsão mostra "-", linha em branco
aparece embaixo de cada número.

- [ ] **Step 3: Lint**

Run: `npx eslint components/relatorio/ProgramacaoProducaoPDF.tsx`
Expected: 0 erros.

- [ ] **Step 4: Apagar o script ad-hoc (não é parte do produto, só verificação)**

```bash
rm scripts/qa-programacao-pdf.mjs
```

- [ ] **Step 5: Commit**

```bash
git add components/relatorio/ProgramacaoProducaoPDF.tsx
git commit -m "feat: componente PDF da matriz de Programação de Produção"
```

---

### Task 2: Rota de dados + geração do PDF (`ordem-producao/programacao/route.ts`)

**Files:**
- Create: `app/(app)/ordem-producao/programacao/route.ts`

**Interfaces:**
- Consumes: `ProgramacaoProducaoPDF` (Task 1), `isOpConcluida`/`opStatus` de `lib/op-status.ts`
  (assinatura: `opStatus(o: {concluida, c_concluida, full_object, identificacao_d_dt_previsao}, hojeISO: string): 'concluida'|'prevista'|'atrasada'|'pendente'`),
  `hojeBahiaISO()` de `lib/data-bahia.ts`, `PRODUTO_TIPO_ITEM` de `lib/constants-omie.ts`.
- Produces: endpoint `GET /ordem-producao/programacao?mes=YYYY-MM&local=<codigo>&tipo_produto=<csv>&atraso=1`
  usado pela Task 3.

- [ ] **Step 1: Escrever a rota**

```ts
// app/(app)/ordem-producao/programacao/route.ts
import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { opStatus } from '@/lib/op-status'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { ProgramacaoProducaoPDF, type LinhaProgramacao } from '@/components/relatorio/ProgramacaoProducaoPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'

const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

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
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) {
    return pdfErroResponse('Sem permissão', 'Você não tem permissão para acessar este relatório.')
  }

  const { searchParams } = new URL(request.url)
  const mesParam = /^\d{4}-\d{2}$/.test(searchParams.get('mes') ?? '') ? searchParams.get('mes')! : hojeBahiaISO().slice(0, 7)
  const localCod = searchParams.get('local') && !Number.isNaN(Number(searchParams.get('local'))) ? Number(searchParams.get('local')) : null
  const tiposArr = valoresMulti(searchParams.get('tipo_produto') ?? undefined)
  const soAtrasadas = searchParams.get('atraso') === '1'

  const [ano, mes] = mesParam.split('-').map(Number)
  const numDias = new Date(ano, mes, 0).getDate()
  const dias = Array.from({ length: numDias }, (_, i) => i + 1)
  const mesIni = `${mesParam}-01`
  const mesFim = `${mesParam}-${String(numDias).padStart(2, '0')}`

  const supabase = await createClient()

  const { data: loja } = await supabase.from('lojas').select('nome, nome_fantasia').eq('id', lojaId).single()
  const lojaNome = loja?.nome_fantasia || loja?.nome || ''

  let localNome = 'Todos'
  if (localCod !== null) {
    const { data: localRow } = await supabase
      .from('local_estoques')
      .select('descricao')
      .eq('loja_id', lojaId)
      .eq('codigo_local_estoque', localCod)
      .maybeSingle()
    localNome = localRow?.descricao ?? String(localCod)
  }

  let query = supabase
    .from('ordens_producao')
    .select('identificacao_n_cod_produto, identificacao_n_qtde, identificacao_d_dt_previsao, identificacao_codigo_local_estoque, concluida, full_object')
    .eq('loja_id', lojaId)
    .gte('identificacao_d_dt_previsao', mesIni)
    .lte('identificacao_d_dt_previsao', mesFim)
  if (localCod !== null) query = query.eq('identificacao_codigo_local_estoque', localCod)

  const { data: opsRaw } = await query
  const hojeISO = hojeBahiaISO()
  const ops = (opsRaw ?? []).filter((o) => !soAtrasadas || opStatus(o, hojeISO) === 'atrasada')

  const codigosProduto = [...new Set(ops.map((o) => o.identificacao_n_cod_produto).filter((c): c is number => c != null))]
  const metaPorCodigo = new Map<number, { codigo: string; descricao: string; unidade: string; tipo: string | null }>()
  if (codigosProduto.length) {
    const { data: prods } = await supabase
      .from('produtos')
      .select('codigo_produto, codigo, descricao, unidade, tipo_item')
      .eq('loja_id', lojaId)
      .in('codigo_produto', codigosProduto)
    for (const p of prods ?? []) {
      metaPorCodigo.set(Number(p.codigo_produto), {
        codigo: p.codigo ?? String(p.codigo_produto),
        descricao: p.descricao ?? '(sem descrição)',
        unidade: p.unidade ?? '',
        tipo: p.tipo_item,
      })
    }
  }

  const tiposSet = tiposArr.length ? new Set(tiposArr) : null
  const porProduto = new Map<number, LinhaProgramacao>()
  for (const o of ops) {
    const cod = o.identificacao_n_cod_produto
    if (cod == null) continue
    const meta = metaPorCodigo.get(cod)
    if (tiposSet && !(meta?.tipo && tiposSet.has(meta.tipo))) continue
    const dia = Number(o.identificacao_d_dt_previsao?.slice(8, 10))
    if (!dia) continue
    const linha = porProduto.get(cod) ?? {
      codigo: meta?.codigo ?? String(cod),
      descricao: meta?.descricao ?? `Produto ${cod}`,
      unidade: meta?.unidade ?? '',
      porDia: {},
    }
    linha.porDia[dia] = (linha.porDia[dia] ?? 0) + Number(o.identificacao_n_qtde ?? 0)
    porProduto.set(cod, linha)
  }
  const linhas = [...porProduto.values()].sort((a, b) => a.descricao.localeCompare(b.descricao))

  const filtrosAtivos: string[] = []
  if (tiposArr.length) filtrosAtivos.push(`Tipo: ${tiposArr.map((t) => TIPO_LABEL.get(t) ?? t).join(', ')}`)
  if (soAtrasadas) filtrosAtivos.push('Somente atrasadas')

  const nomeArquivo = `programacao-producao-${mesParam}${soAtrasadas ? '-atrasadas' : ''}.pdf`
  const element = createElement(ProgramacaoProducaoPDF, {
    loja: lojaNome,
    local: localNome,
    mesLabel: `${soAtrasadas ? 'Em atraso · ' : ''}${MESES[mes - 1]}/${ano}`,
    filtros: filtrosAtivos.length ? filtrosAtivos.join(', ') : undefined,
    dias,
    linhas,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nomeArquivo}"` },
  })
}
```

- [ ] **Step 2: Lint**

Run: `npx eslint "app/(app)/ordem-producao/programacao/route.ts"`
Expected: 0 erros.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `EXIT=0`, sem "Failed to type check".

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/ordem-producao/programacao/route.ts"
git commit -m "feat: rota de geracao do PDF de Programacao de Producao"
```

---

### Task 3: Filtro de Local + botões de impressão na listagem

**Files:**
- Modify: `app/(app)/ordem-producao/page.tsx`

**Interfaces:**
- Consumes: rota da Task 2 (`GET /ordem-producao/programacao`).

- [ ] **Step 1: Adicionar `local` ao tipo de `searchParams` (linha ~46-57)**

```ts
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    ordem_producao?: string
    op_produto?: string
    tipo_produto?: string
    familia?: string
    op_concluido?: string
    op_status?: string
    local?: string
    ord?: string
    page?: string
  }>
```

- [ ] **Step 2: Adicionar o campo "Local de produção" em `campos` (após `familia`, antes de `op_status`, ~linha 484)**

O array `locais` já é buscado no arquivo (usado por `CriarOrdemProducao`, ver import
existente) — reusar a mesma variável, não duplicar a query.

```ts
    {
      tipo: 'select',
      nome: 'local',
      label: 'Local de produção',
      opcoes: (locais ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
```

- [ ] **Step 3: Adicionar `local: sp.local ?? ''` aos `defaults` do `FiltrosGaveta`** (no objeto em torno da linha 524-533).

- [ ] **Step 4: Montar os parâmetros e os 2 botões de impressão** (na área de `actions`, ao lado
  do botão "Excel" existente, ~linha 536-541):

```tsx
              <a
                href={`/ordem-producao/programacao?mes=${dataInicio.slice(0, 7)}${sp.local ? `&local=${sp.local}` : ''}${sp.tipo_produto ? `&tipo_produto=${encodeURIComponent(sp.tipo_produto)}` : ''}`}
                target="_blank" rel="noopener noreferrer" className={btnClass('outline')}
                title="Matriz produto x dia do mes, com espaco para anotar o produzido"
              >
                <Factory className="size-4" /> Imprimir Programação
              </a>
              <a
                href={`/ordem-producao/programacao?mes=${dataInicio.slice(0, 7)}&atraso=1${sp.local ? `&local=${sp.local}` : ''}${sp.tipo_produto ? `&tipo_produto=${encodeURIComponent(sp.tipo_produto)}` : ''}`}
                target="_blank" rel="noopener noreferrer" className={btnClass('outline')}
                title="So as ordens ainda nao concluidas com previsao ja vencida"
              >
                <Factory className="size-4" /> Imprimir Atrasadas
              </a>
```

- [ ] **Step 5: Lint**

Run: `npx eslint "app/(app)/ordem-producao/page.tsx"`
Expected: 0 erros novos (pode já existir 1 warning pré-existente de import não usado, como em
outras páginas do repo — checar se já existia antes da mudança com `git diff` antes de
assumir regressão).

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/ordem-producao/page.tsx"
git commit -m "feat: filtro de local de producao + botoes de imprimir programacao"
```

---

### Task 4: Verificação visual ponta a ponta (dev server + conta QA)

**Files:** nenhum (só verificação).

- [ ] **Step 1: Subir o dev server na porta 3008**

```bash
npx next dev -p 3008 &
```

- [ ] **Step 2: Login com a conta QA (chrome-devtools MCP)**

Navegar pra `http://localhost:3008/login`, preencher `claude.qa@ntb-estoque.dev` /
`claudeqa123456`, submeter.

- [ ] **Step 3: Ir em `/ordem-producao`, aplicar um filtro de mês com dado real, clicar em
  "Imprimir Programação"**

Verificar: a nova aba abre um PDF (não erro 500/403), landscape, com colunas de dia
correspondentes ao mês selecionado, produtos ordenados alfabeticamente, linha em branco
visível abaixo de cada número previsto.

- [ ] **Step 4: Clicar em "Imprimir Atrasadas"**

Verificar: mesma matriz, mas só produtos com ordens em atraso aparecem (ou "Nenhuma ordem...
para este período" se não houver nenhuma atrasada no mês/local selecionado).

- [ ] **Step 5: Testar o filtro de Local de produção** — selecionar um local específico (ex.
  cozinha), clicar em "Imprimir Programação" de novo, conferir que o subtítulo do PDF mostra
  o nome do local e que as linhas mudam em relação ao "Todos".

- [ ] **Step 6: Parar o dev server**

```bash
pkill -f "next dev -p 3008"
```

- [ ] **Step 7: Deploy manual em produção**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```

- [ ] **Step 8: Atualizar `docs/reuniao-2026-07-27-pedidos.md`** — marcar item #10 como
  corrigido/em produção, com o commit final.
