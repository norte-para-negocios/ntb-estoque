# Catálogo A4 de QR Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o usuário imprimir, em folhas A4 (grade 3×6, 18 itens por página), os QR codes de vários produtos de uma vez — de uma família inteira ou de produtos específicos selecionados — como um "caderno" pra folhear e bipar, complementando a etiqueta pequena avulsa já existente.

**Architecture:** Reaproveita o form GET já existente em `/produto` (checkboxes de `codigos` por linha) adicionando um segundo modo de seleção ("todos que batem o filtro atual", via um novo helper server-side que resolve a lista completa de códigos sem esbarrar no teto de 1000 linhas do PostgREST) e um segundo botão de impressão que aponta pra uma nova rota GET. Essa rota gera QR codes do mesmo jeito que a rota de etiqueta existente, mas renderiza um novo componente PDF em grade A4 (3 colunas × 6 linhas) em vez de uma etiqueta por página.

**Tech Stack:** Next.js App Router route handlers, `@react-pdf/renderer`, `qrcode` (npm), Supabase (service client p/ histórico, client normal p/ leitura).

## Global Constraints

- Reaproveitar a rota/QR-generation existente como referência (`app/(app)/produto/imprimir-etiquetas/route.ts`), sem duplicar a lógica de resolução de seleção — ambas as rotas de impressão usam o MESMO helper `resolverCodigosPorFiltro`.
- QR code encoda só `codigo_produto` (mesmo contrato usado em toda a app, ex.: `QrScanner`) — não mudar o que o QR encoda.
- A etiqueta pequena existente (`EtiquetaPDF`, rota `/produto/imprimir-etiquetas`) permanece intocada em comportamento — só ganha o novo modo de seleção opcional (`todos_filtro`), o resto do arquivo não muda.
- Nunca buscar produtos "que batem um filtro" sem paginar via `.range()`/`buscarTudoPaginado` — o PostgREST corta em 1000 linhas SEM erro, e essa auditoria já achou bugs reais causados exatamente por esquecer isso (ex.: mapa de família em `relatorio-indicadores`). Usar sempre `buscarTudoPaginado` de `@/lib/utils-busca` (já existe, não reinventar).
- Sem framework de testes automatizados neste repo. "Teste" nos passos abaixo significa: `npx tsc --noEmit`, verificação manual via servidor de dev + Playwright (baixar o PDF gerado, contar páginas), e queries diretas via `node scripts/db.mjs` quando aplicável.
- Toda tarefa que altera `app/(app)/produto/page.tsx` ou adiciona rota nova deve ser implantada no Contabo ao final: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"` — só considerar "pronto" depois disso.
- Migrations se aplicam com `node scripts/aplicar-migration.mjs <arquivo>.sql` (não existe `supabase db push` configurado neste projeto).

---

### Task 1: Permitir `'CATALOGO'` como `origem` válida em `impressao_etiquetas`

**Files:**
- Create: `supabase/migrations/086_impressao_etiquetas_origem_catalogo.sql`

**Interfaces:**
- Produces: `impressao_etiquetas.origem` passa a aceitar `'NF' | 'OP' | 'PRODUTO' | 'CATALOGO'` — Task 4 depende de poder inserir `origem: 'CATALOGO'`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 086_impressao_etiquetas_origem_catalogo.sql
-- Catalogo A4 de QR codes (grade 3x6, impressao em lote) precisa de um
-- quarto valor de origem pro historico de impressoes, distinto da etiqueta
-- avulsa (PRODUTO).
alter table impressao_etiquetas drop constraint impressao_etiquetas_origem_check;
alter table impressao_etiquetas add constraint impressao_etiquetas_origem_check
  check (origem in ('NF', 'OP', 'PRODUTO', 'CATALOGO'));
```

- [ ] **Step 2: Aplicar a migration**

Run: `node scripts/aplicar-migration.mjs 086_impressao_etiquetas_origem_catalogo.sql`
Expected output: `MIGRATION APLICADA.`

- [ ] **Step 3: Verificar a constraint**

Run:
```bash
node scripts/db.mjs "select pg_get_constraintdef(oid) from pg_constraint where conname='impressao_etiquetas_origem_check'"
```
Expected: a saída contém `'CATALOGO'::text` na lista (ou `character varying`, dependendo de como o Postgres formata — o importante é `CATALOGO` aparecer no array de valores aceitos).

- [ ] **Step 4: Commit**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque/.claude/worktrees/auditoria-relatorios"
git add supabase/migrations/086_impressao_etiquetas_origem_catalogo.sql
git commit -m "feat: permite origem CATALOGO em impressao_etiquetas"
```

---

### Task 2: Helper `resolverCodigosPorFiltro` — seleção "todos que batem o filtro"

**Files:**
- Create: `lib/produtos-selecionados.ts`

**Interfaces:**
- Consumes: `escapeIlikeOr`, `buscarTudoPaginado` de `@/lib/utils-busca` (já existem, ver abaixo); `createClient` de `@/lib/supabase/server` (já existe).
- Produces: `FiltroProdutosSelecao` (interface) e `resolverCodigosPorFiltro(lojaId: number, filtro: FiltroProdutosSelecao): Promise<number[]>` — Tasks 4, 5 e 6 dependem dessa função e desse tipo exatos.

Referência de `buscarTudoPaginado` (já existe em `lib/utils-busca.ts`, não recriar):
```ts
export async function buscarTudoPaginado<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]>
```

Referência da query de filtro que já existe em `app/(app)/produto/page.tsx` (replicar a MESMA lógica, sem paginação de UI — aqui é pra buscar TODOS os códigos que batem, não uma página):
```ts
// app/(app)/produto/page.tsx (trecho existente, não mexer lá — só espelhar aqui)
if (params.q) {
  const q = escapeIlikeOr(params.q)
  query = query.or(`descricao.ilike.%${q}%,codigo.ilike.%${q}%,ean.ilike.%${q}%`)
}
if (params.familia) query = query.eq('descricao_familia', params.familia)
if (params.tipo) query = query.eq('tipo_item', params.tipo)
if (params.pdv === 'sim') query = query.eq('pdv', true)
else if (params.pdv === 'nao') query = query.eq('pdv', false)
if (!params.situacao || params.situacao === 'ativos') query = query.eq('inativo', false)
else if (params.situacao === 'inativos') query = query.eq('inativo', true)
```

E a resolução de `fornecedor` (também existente, mesmo arquivo):
```ts
supabase.rpc('compras_produtos_do_fornecedor', { p_loja_id: lojaId, p_fornecedor: params.fornecedor })
  .then(({ data }) => ((data ?? []) as { cod: number }[]).map((r) => Number(r.cod)))
```

- [ ] **Step 1: Escrever o helper**

```typescript
// lib/produtos-selecionados.ts
import { createClient } from '@/lib/supabase/server'
import { escapeIlikeOr, buscarTudoPaginado } from '@/lib/utils-busca'

export interface FiltroProdutosSelecao {
  q?: string
  familia?: string
  tipo?: string
  situacao?: string
  fornecedor?: string
  pdv?: string
}

/**
 * Resolve TODOS os codigo_produto que batem o filtro (nao so uma pagina) --
 * usado pelo modo de selecao "todos que batem o filtro atual" das rotas de
 * impressao. Espelha exatamente a logica de filtro de app/(app)/produto/page.tsx.
 */
export async function resolverCodigosPorFiltro(
  lojaId: number,
  filtro: FiltroProdutosSelecao,
): Promise<number[]> {
  const supabase = await createClient()

  let restricaoCods: number[] | null = null
  if (filtro.fornecedor) {
    const { data } = await supabase.rpc('compras_produtos_do_fornecedor', {
      p_loja_id: lojaId,
      p_fornecedor: filtro.fornecedor,
    })
    restricaoCods = ((data ?? []) as { cod: number }[]).map((r) => Number(r.cod))
  }

  const linhas = await buscarTudoPaginado<{ codigo_produto: number | null }>((from, to) => {
    let query = supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', lojaId)
      .range(from, to)

    if (filtro.q) {
      const q = escapeIlikeOr(filtro.q)
      query = query.or(`descricao.ilike.%${q}%,codigo.ilike.%${q}%,ean.ilike.%${q}%`)
    }
    if (filtro.familia) query = query.eq('descricao_familia', filtro.familia)
    if (filtro.tipo) query = query.eq('tipo_item', filtro.tipo)
    if (filtro.pdv === 'sim') query = query.eq('pdv', true)
    else if (filtro.pdv === 'nao') query = query.eq('pdv', false)
    if (!filtro.situacao || filtro.situacao === 'ativos') query = query.eq('inativo', false)
    else if (filtro.situacao === 'inativos') query = query.eq('inativo', true)
    if (restricaoCods !== null) {
      query = query.in('codigo_produto', restricaoCods.length ? restricaoCods : [-1])
    }

    return query
  })

  return [...new Set(linhas.map((l) => l.codigo_produto).filter((c): c is number => c != null))]
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a `lib/produtos-selecionados.ts`.

- [ ] **Step 3: Verificar contra dado real**

Escolha uma loja com filtro conhecido (ex.: loja 3, família "Geladas" ou outra família real da loja). Rode um script ad-hoc temporário pra confirmar que a contagem bate com o que `/produto?familia=Geladas&situacao=ativos` mostra na paginação (`X produtos` no rodapé da lista, ou some as páginas). Exemplo de verificação via SQL direta (sem precisar do helper, só pra ter o número de referência):

```bash
node scripts/db.mjs "select count(*) from produtos where loja_id=3 and descricao_familia='Geladas' and inativo=false"
```

Depois, num script temporário (`/tmp` ou scratchpad, apagar depois), importe e chame `resolverCodigosPorFiltro(3, { familia: 'Geladas', situacao: 'ativos' })` e confirme que `.length` bate com a contagem SQL acima.

- [ ] **Step 4: Commit**

```bash
git add lib/produtos-selecionados.ts
git commit -m "feat: helper para resolver codigos de produto por filtro (selecao 'todos')"
```

---

### Task 3: Componente `CatalogoPDF` — grade A4 3×6

**Files:**
- Create: `components/etiqueta/CatalogoPDF.tsx`

**Interfaces:**
- Consumes: `NTB_LOGO_DATA_URL` de `@/lib/etiqueta-logo` (já existe).
- Produces: `ItemCatalogo` (interface) e `CatalogoPDF` (componente React) — Task 4 depende exatamente desses nomes e desse shape.

- [ ] **Step 1: Escrever o componente**

```tsx
// components/etiqueta/CatalogoPDF.tsx
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { NTB_LOGO_DATA_URL } from '@/lib/etiqueta-logo'

// Fator de conversao mm -> pt (1 mm = 2.83465 pt), mesmo padrao de EtiquetaPDF.tsx
const MM = 2.83465

const ITENS_POR_PAGINA = 18
const COLUNAS = 3
const LINHAS = 6

const MARGEM = 10 * MM
const ALTURA_CABECALHO = 12 * MM
const GAP_CABECALHO_GRID = 3 * MM
const GAP_CELULA = 2 * MM

// A4 = 210mm x 297mm
const LARGURA_UTIL = 210 * MM - 2 * MARGEM
const ALTURA_GRID = 297 * MM - 2 * MARGEM - ALTURA_CABECALHO - GAP_CABECALHO_GRID

const LARGURA_CELULA = (LARGURA_UTIL - (COLUNAS - 1) * GAP_CELULA) / COLUNAS
const ALTURA_CELULA = (ALTURA_GRID - (LINHAS - 1) * GAP_CELULA) / LINHAS

const LARGURA_QR = 15 * MM
const LARGURA_COLUNA_QR = 18 * MM

const styles = StyleSheet.create({
  page: {
    paddingTop: MARGEM,
    paddingBottom: MARGEM,
    paddingLeft: MARGEM,
    paddingRight: MARGEM,
  },
  cabecalho: {
    height: ALTURA_CABECALHO,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 0.75,
    borderBottomColor: '#ccc',
    marginBottom: GAP_CABECALHO_GRID,
    paddingHorizontal: 2,
  },
  nomeLoja: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  logo: { width: 36, height: 'auto' },
  linha: {
    flexDirection: 'row',
    marginBottom: GAP_CELULA,
  },
  celula: {
    width: LARGURA_CELULA,
    height: ALTURA_CELULA,
    borderWidth: 0.5,
    borderColor: '#ddd',
    flexDirection: 'row',
    padding: 2 * MM,
    overflow: 'hidden',
  },
  celulaComMargem: { marginRight: GAP_CELULA },
  celulaTexto: { flex: 1, minWidth: 0, justifyContent: 'center', paddingRight: 2 },
  descricao: { fontSize: 8, lineHeight: 1.15, marginBottom: 3 },
  codigo: { fontSize: 7, color: '#555' },
  celulaQr: { width: LARGURA_COLUNA_QR, alignItems: 'center', justifyContent: 'center' },
  qr: { width: LARGURA_QR, height: LARGURA_QR },
})

export interface ItemCatalogo {
  descricao: string
  codigo_produto: string
  qr: string // data URL do QR code
}

export interface CatalogoPDFProps {
  itens: ItemCatalogo[]
  nomeLoja: string
}

function paginar<T>(itens: T[], porPagina: number): T[][] {
  const paginas: T[][] = []
  for (let i = 0; i < itens.length; i += porPagina) paginas.push(itens.slice(i, i + porPagina))
  return paginas
}

function agruparEmLinhas<T>(itens: T[], colunas: number): T[][] {
  const linhas: T[][] = []
  for (let i = 0; i < itens.length; i += colunas) linhas.push(itens.slice(i, i + colunas))
  return linhas
}

export function CatalogoPDF({ itens, nomeLoja }: CatalogoPDFProps) {
  const paginas = paginar(itens, ITENS_POR_PAGINA)
  const nome = (nomeLoja || '').trim().toUpperCase()

  return (
    <Document>
      {paginas.map((pagina, p) => (
        <Page key={p} size="A4" style={styles.page} wrap={false}>
          <View style={styles.cabecalho}>
            <Text style={styles.nomeLoja}>{nome || 'NTB NORTE PARA NEGOCIOS'}</Text>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.logo} src={NTB_LOGO_DATA_URL} />
          </View>

          {agruparEmLinhas(pagina, COLUNAS).map((linha, li) => (
            <View key={li} style={styles.linha}>
              {linha.map((item, ci) => (
                <View key={ci} style={[styles.celula, ci < COLUNAS - 1 ? styles.celulaComMargem : {}]}>
                  <View style={styles.celulaTexto}>
                    <Text style={styles.descricao}>{item.descricao}</Text>
                    <Text style={styles.codigo}>Cod: {item.codigo_produto}</Text>
                  </View>
                  <View style={styles.celulaQr}>
                    {/* eslint-disable-next-line jsx-a11y/alt-text */}
                    <Image style={styles.qr} src={item.qr} />
                  </View>
                </View>
              ))}
            </View>
          ))}
        </Page>
      ))}
    </Document>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a `components/etiqueta/CatalogoPDF.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/etiqueta/CatalogoPDF.tsx
git commit -m "feat: componente CatalogoPDF (grade A4 3x6 de QR codes)"
```

---

### Task 4: Rota `/produto/imprimir-catalogo`

**Files:**
- Create: `app/(app)/produto/imprimir-catalogo/route.ts`

**Interfaces:**
- Consumes: `CatalogoPDF`, `ItemCatalogo` de `@/components/etiqueta/CatalogoPDF` (Task 3); `resolverCodigosPorFiltro`, `FiltroProdutosSelecao` de `@/lib/produtos-selecionados` (Task 2); `formatarNomeProduto` de `@/lib/formatar-nome` (já existe); origem `'CATALOGO'` liberada em `impressao_etiquetas` (Task 1).
- Produces: `GET /produto/imprimir-catalogo?codigos=123&codigos=456` **ou** `GET /produto/imprimir-catalogo?todos_filtro=1&familia=Geladas&situacao=ativos` → resposta `application/pdf`. Task 6 depende desse path e desses nomes de parâmetro exatos.

- [ ] **Step 1: Escrever a rota**

```typescript
// app/(app)/produto/imprimir-catalogo/route.ts
import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import QRCode from 'qrcode'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { CatalogoPDF, type ItemCatalogo } from '@/components/etiqueta/CatalogoPDF'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { resolverCodigosPorFiltro } from '@/lib/produtos-selecionados'

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const url = new URL(request.url)
  let codigos: number[]
  if (url.searchParams.get('todos_filtro') === '1') {
    codigos = await resolverCodigosPorFiltro(lojaId, {
      q: url.searchParams.get('q') ?? undefined,
      familia: url.searchParams.get('familia') ?? undefined,
      tipo: url.searchParams.get('tipo') ?? undefined,
      situacao: url.searchParams.get('situacao') ?? undefined,
      fornecedor: url.searchParams.get('fornecedor') ?? undefined,
      pdv: url.searchParams.get('pdv') ?? undefined,
    })
  } else {
    codigos = [...new Set(url.searchParams.getAll('codigos').map(Number).filter((n) => Number.isFinite(n) && n > 0))]
  }
  if (!codigos.length) {
    return NextResponse.json({ error: 'Nenhum produto selecionado' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: loja } = await supabase.from('lojas').select('nome, nome_fantasia').eq('id', lojaId).single()
  const { data: produtosRaw } = await supabase
    .from('produtos')
    .select('codigo_produto, codigo, descricao')
    .eq('loja_id', lojaId)
    .in('codigo_produto', codigos)
  const produtos = produtosRaw ?? []
  if (!produtos.length) {
    return NextResponse.json({ error: 'Produtos não encontrados' }, { status: 404 })
  }

  const nomeLoja = loja?.nome_fantasia || loja?.nome || ''
  const itens: ItemCatalogo[] = []
  for (const p of produtos) {
    const codigoExibido = p.codigo || String(p.codigo_produto)
    const qr = await QRCode.toDataURL(String(p.codigo_produto), { margin: 1, width: 160 })
    itens.push({
      codigo_produto: codigoExibido,
      descricao: formatarNomeProduto(p.descricao),
      qr,
    })
  }

  const element = createElement(CatalogoPDF, { itens, nomeLoja }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  try {
    const service = createServiceClient()
    await service.from('impressao_etiquetas').insert({
      loja_id: lojaId,
      origem: 'CATALOGO',
      referencia_id: 0,
      qtd_etiquetas: itens.length,
      user_id: (await getUser())?.id ?? null,
    })
  } catch {
    // ignora falha de registro de historico, igual as outras rotas de impressao
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="catalogo-produtos.pdf"',
    },
  })
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a esta rota.

- [ ] **Step 3: Testar manualmente com o servidor de dev**

```bash
npm run dev &
sleep 3
curl -s -o /tmp/catalogo-teste.pdf -w "%{http_code}\n" "http://localhost:3000/produto/imprimir-catalogo?codigos=<um_codigo_produto_real_da_loja_atual>" \
  -H "Cookie: <cookie de sessao autenticada, ver convencao de QA do projeto>"
file /tmp/catalogo-teste.pdf
```
Expected: `200`, e `file` reporta `PDF document`. (Rodar autenticado igual às outras verificações desta sessão — via Playwright com o usuário `claude.qa@ntb-estoque.dev`/`claudeqa123456`, loja de teste real, se o `curl` direto não carregar sessão.)

Testar também os casos de borda: `GET /produto/imprimir-catalogo` sem nenhum parâmetro → espera `400` com `{"error":"Nenhum produto selecionado"}`; `GET /produto/imprimir-catalogo?codigos=999999999` (código inexistente) → espera `404` com `{"error":"Produtos não encontrados"}`.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/produto/imprimir-catalogo/route.ts"
git commit -m "feat: rota de impressao do catalogo A4 de QR codes"
```

---

### Task 5: Modo "todos_filtro" na rota de etiqueta avulsa existente

**Files:**
- Modify: `app/(app)/produto/imprimir-etiquetas/route.ts`

**Interfaces:**
- Consumes: `resolverCodigosPorFiltro` de `@/lib/produtos-selecionados` (Task 2).
- Produces: `GET /produto/imprimir-etiquetas?todos_filtro=1&familia=...` agora também funciona (além do `codigos=...` que já existia, inalterado). Task 6 depende desse comportamento (o botão "Imprimir etiquetas selecionadas" também precisa respeitar o checkbox "todos_filtro").

O arquivo atual resolve `codigos` assim (não mexer no resto do arquivo, só nesse trecho):

```typescript
  const url = new URL(request.url)
  const codigos = [...new Set(url.searchParams.getAll('codigos').map(Number).filter((n) => Number.isFinite(n) && n > 0))]
  if (!codigos.length) {
    return NextResponse.json({ error: 'Nenhum produto selecionado' }, { status: 400 })
  }
```

- [ ] **Step 1: Adicionar o import**

No topo do arquivo, junto dos outros imports:

```typescript
import { resolverCodigosPorFiltro } from '@/lib/produtos-selecionados'
```

- [ ] **Step 2: Substituir a resolução de `codigos`**

Trocar o trecho citado acima por:

```typescript
  const url = new URL(request.url)
  let codigos: number[]
  if (url.searchParams.get('todos_filtro') === '1') {
    codigos = await resolverCodigosPorFiltro(lojaId, {
      q: url.searchParams.get('q') ?? undefined,
      familia: url.searchParams.get('familia') ?? undefined,
      tipo: url.searchParams.get('tipo') ?? undefined,
      situacao: url.searchParams.get('situacao') ?? undefined,
      fornecedor: url.searchParams.get('fornecedor') ?? undefined,
      pdv: url.searchParams.get('pdv') ?? undefined,
    })
  } else {
    codigos = [...new Set(url.searchParams.getAll('codigos').map(Number).filter((n) => Number.isFinite(n) && n > 0))]
  }
  if (!codigos.length) {
    return NextResponse.json({ error: 'Nenhum produto selecionado' }, { status: 400 })
  }
```

(`lojaId` já existe no escopo da função, definido na linha logo acima deste trecho — `const lojaId = await getCurrentLojaId()`.)

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Confirmar que o comportamento antigo não quebrou**

Repita a mesma verificação manual que já era feita nesta rota antes desta tarefa (baixar o PDF com `codigos=<algum_codigo_real>` sem `todos_filtro`, confirmar `200` + `application/pdf`) — deve continuar idêntico.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/produto/imprimir-etiquetas/route.ts"
git commit -m "feat: modo 'todos que batem o filtro' na impressao de etiqueta avulsa"
```

---

### Task 6: Tela `/produto` — checkbox "selecionar todos" + botão do catálogo A4

**Files:**
- Modify: `app/(app)/produto/page.tsx`

**Interfaces:**
- Consumes: `resolverCodigosPorFiltro` de `@/lib/produtos-selecionados` (Task 2); rotas `/produto/imprimir-etiquetas` (Task 5) e `/produto/imprimir-catalogo` (Task 4).

O arquivo hoje tem, perto do topo da função (depois de montar `familiasOpcoes`), o `Promise.all` que busca dados em paralelo, e mais abaixo o form + botão de impressão + tabela. São 3 pontos de mudança.

- [ ] **Step 1: Import**

No topo do arquivo, junto dos outros imports (perto de `import { buscarFamilias } from '@/lib/actions/produto'`):

```typescript
import { resolverCodigosPorFiltro } from '@/lib/produtos-selecionados'
```

- [ ] **Step 2: Contagem "todos que batem o filtro" em paralelo com as outras queries**

Local: logo depois de `const ord = params.ord ?? ''` (linha ~136, antes do `let query = supabase.from('produtos')...`), adicionar:

```typescript
  // Contagem de "todos que batem o filtro atual" -- mesmos campos que a query
  // principal já filtra abaixo, usados pro checkbox "selecionar todos" do form
  // de impressao (etiqueta avulsa e catalogo A4).
  const filtroSelecaoAtual = {
    q: params.q,
    familia: params.familia,
    tipo: params.tipo,
    situacao: params.situacao,
    fornecedor: params.fornecedor,
    pdv: params.pdv,
  }
  const qtdTodosFiltroPromise = resolverCodigosPorFiltro(lojaId, filtroSelecaoAtual).then((c) => c.length)
```

Depois, no bloco `Promise.all` existente (linhas ~113-133), adicionar `qtdTodosFiltroPromise` como mais um item do array e capturar o resultado. O bloco fica:

```typescript
  const [{ data: lojaSync }, { data: familiasRows }, reporCodigos, familiasComCodigo, fornecedoresList, fornecedorCodigos, qtdTodosFiltro] = await Promise.all([
    supabase
      .from('lojas')
      .select('produto_ultima_atualizacao, produto_status')
      .eq('id', lojaId)
      .single(),
    supabase.rpc('familias_da_loja', { p_loja_id: lojaId }),
    repor
      ? supabase.rpc('produtos_repor', { p_loja_id: lojaId }).then(({ data }) => (data ?? []) as number[])
      : Promise.resolve<number[] | null>(null),
    buscarFamilias(),
    supabase.rpc('compras_fornecedores', { p_loja_id: lojaId }).then(({ data }) => (data ?? []) as { fornecedor: string }[]),
    params.fornecedor
      ? supabase
          .rpc('compras_produtos_do_fornecedor', { p_loja_id: lojaId, p_fornecedor: params.fornecedor })
          .then(({ data }) => ((data ?? []) as { cod: number }[]).map((r) => Number(r.cod)))
      : Promise.resolve<number[] | null>(null),
    qtdTodosFiltroPromise,
  ])
```

(Só o `.then((c) => c.length)` de `qtdTodosFiltroPromise` foi adicionado como 7º elemento do array e da desestruturação — as 6 linhas anteriores são exatamente as que já existem no arquivo hoje, sem mudança de conteúdo.)

- [ ] **Step 3: Hidden inputs + checkbox "selecionar todos" no form**

Local: dentro do `<form id="form-etiquetas-produto" ...>` (linha ~516), logo depois da tag de abertura do form e antes de `<Lista ...>`, adicionar:

```tsx
        <div className="mb-2 flex items-center gap-2 text-[13px] text-text-muted">
          <input type="hidden" name="q" value={params.q ?? ''} />
          <input type="hidden" name="familia" value={params.familia ?? ''} />
          <input type="hidden" name="tipo" value={params.tipo ?? ''} />
          <input type="hidden" name="situacao" value={params.situacao ?? ''} />
          <input type="hidden" name="fornecedor" value={params.fornecedor ?? ''} />
          <input type="hidden" name="pdv" value={params.pdv ?? ''} />
          <input
            type="checkbox"
            id="todos-filtro-produto"
            name="todos_filtro"
            value="1"
            className="size-4 accent-[var(--brand)]"
          />
          <label htmlFor="todos-filtro-produto">
            Selecionar todos os {qtdTodosFiltro} produtos deste filtro (ignora as marcações individuais abaixo)
          </label>
        </div>
```

- [ ] **Step 4: Segundo botão de impressão**

Local: logo depois do botão existente "Imprimir etiquetas selecionadas" (linha ~424-426):

```tsx
              <button type="submit" form="form-etiquetas-produto" formTarget="_blank" className={btnClass('outline')}>
                <Printer className="size-4" /> Imprimir etiquetas selecionadas
              </button>
```

Adicionar logo abaixo:

```tsx
              <button
                type="submit"
                form="form-etiquetas-produto"
                formAction="/produto/imprimir-catalogo"
                formTarget="_blank"
                className={btnClass('outline')}
              >
                <Printer className="size-4" /> Imprimir catálogo A4
              </button>
```

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Verificação manual end-to-end**

Com o servidor de dev rodando e autenticado como `claude.qa@ntb-estoque.dev` (loja de teste, lembrar de voltar pra loja 3 no final):
1. Ir em `/produto`, aplicar um filtro (ex.: uma família real), confirmar que "Selecionar todos os N produtos deste filtro" mostra um N plausível (comparar com a contagem visível no rodapé da paginação, ou com `node scripts/db.mjs` contando `descricao_familia`/`inativo` iguais ao filtro).
2. Marcar o checkbox "todos_filtro", clicar em "Imprimir catálogo A4", confirmar que abre um PDF com `18 * ceil(N/18)`-ish número de páginas (aproximado, já que a última página pode ter menos de 18 itens) e grade 3×6 visualmente coerente.
3. Desmarcar "todos_filtro", marcar 2-3 checkboxes individuais de linhas específicas, clicar em "Imprimir etiquetas selecionadas" (comportamento antigo intacto) e depois em "Imprimir catálogo A4" com a mesma seleção pequena — confirmar que ambos os PDFs saem corretos pra seleção específica.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/produto/page.tsx"
git commit -m "feat: selecionar todos por filtro + botao de catalogo A4 em /produto"
```

---

### Task 7: Verificação final e deploy

**Files:** nenhum arquivo novo — só verificação.

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Typecheck do branch inteiro**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build conclui sem erros.

- [ ] **Step 3: Revisão final de branch inteiro**

Rodar a revisão de código de branch completo (via `superpowers:requesting-code-review`, mesmo padrão já usado nas outras features desta sessão), cobrindo os commits das Tasks 1-6 deste plano.

- [ ] **Step 4: Merge e deploy**

Seguir `superpowers:finishing-a-development-branch` pra decidir merge (provavelmente merge local pra `main`, mesmo padrão das features anteriores desta sessão). Depois do merge em `main`:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

- [ ] **Step 5: Verificação em produção**

Repetir a verificação manual do Step 6 da Task 6, mas apontando pro domínio real (`https://app-estoque.norteparanegocios.com.br`), confirmando que o catálogo A4 funciona em produção antes de reportar a feature como concluída ao usuário.
