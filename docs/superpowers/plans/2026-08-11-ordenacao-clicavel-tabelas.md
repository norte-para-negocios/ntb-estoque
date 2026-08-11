# Ordenação clicável nas tabelas — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Padronizar ordenação clicável por coluna (cabeçalho vira link,
inverte asc/desc no clique) em 10 telas que já usam o componente `Lista`
mas não expõem a ordenação que ele já suporta.

**Architecture:** Reusar 100% o mecanismo já existente e funcionando em
`app/(app)/inventario/page.tsx` — sem tocar em `components/ui-kit/
Lista.tsx`. Cada task aplica o MESMO padrão (whitelist de colunas
ordenáveis, `sp.ord`/`sp.dir` lidos com default sensato, `.order()` na
query antes de paginar, `buildSortHref` local preservando os outros
filtros, `sortAtual`/`dirAtual`/`sortHref` + `sort:` nas colunas certas
do `<Lista>`) em cada arquivo.

**Tech Stack:** TypeScript (Next.js App Router, Server Components),
Supabase (`@supabase/supabase-js`), componente `Lista` já existente.

---

## Global Constraints (aplicam a TODAS as tasks)

- **Produção real, sem staging.**
- **`npx tsc --noEmit`** limpo antes de qualquer commit de código.
- **Não mudar nenhum comportamento de busca/filtro já existente.** Só
  adicionar ordenação. Sem `sp.ord` na URL (estado atual, link direto
  pra tela), a página deve continuar mostrando os dados na MESMA
  ordem/mesmo default de hoje — o default do novo `ord` é sempre a
  coluna que já é `.order()` hoje, na mesma direção.
- **Nunca mudar `page` no `buildSortHref`** (mesmo padrão do
  Inventário) — trocar a ordenação naturalmente reseta pra página 1 por
  simplesmente não incluir `page` nos parâmetros da nova URL.
- Deploy: `git push origin main` SEMPRE antes do deploy, deploy sempre
  síncrono via SSH (`ssh -i ~/.ssh/notebook_contabo_key
  root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`),
  aguardando terminar por completo. Confirmar depois:
  `curl -s -o /dev/null -w "HTTP %{http_code}\n"
  https://app-estoque.norteparanegocios.com.br/login` (esperar 200) e
  `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd
  /opt/ntb-estoque && git log --oneline -1"` (commit certo).
- Sem acesso a navegador neste ambiente — validação é: ler o código com
  atenção (a URL gerada por `buildSortHref` está certa? a whitelist
  rejeita valor inválido? o default bate com o `.order()` de hoje?) e,
  quando fizer sentido, comparar contagem/resultado via uma query
  isolada.
- Referência funcionando, citada em toda task abaixo:
  `app/(app)/inventario/page.tsx` linhas 27-28 (`COLUNAS_SORT`), 56-58
  (leitura de `ord`/`dir`), 160 (`.order()` na query), 211-221
  (`buildSortHref`), 328-330 e 335/345/368 (uso no `<Lista>`).

---

## Task 1: `categoria-contabil` + `familia` + `local-estoque`

3 telas de cadastro simples, sem paginação (`familia`/`local-estoque`
têm `.limit()`; `categoria-contabil` nem isso), todas as colunas mapeiam
direto pra uma coluna real do banco.

**Files:**
- Modify: `app/(app)/categoria-contabil/page.tsx`
- Modify: `app/(app)/familia/page.tsx`
- Modify: `app/(app)/local-estoque/page.tsx`

### 1a. `categoria-contabil/page.tsx`

Hoje não recebe `searchParams` nenhum. Adicionar:

```ts
const COLUNAS_SORT = ['nome', 'ativa'] as const
type ColSort = (typeof COLUNAS_SORT)[number]

export default async function CategoriaContabilPage({
  searchParams,
}: {
  searchParams: Promise<{ ord?: string; dir?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Categorias Contabeis'))) notFound()

  const sp = await searchParams
  const ordRaw = sp.ord ?? 'nome'
  const ord: ColSort = (COLUNAS_SORT as readonly string[]).includes(ordRaw) ? (ordRaw as ColSort) : 'nome'
  const dir = sp.dir === 'desc' ? 'desc' : 'asc' // default hoje é nome A-Z (asc)

  const supabase = await createClient()
  // ...permissões continuam iguais...

  const { data: categorias } = await supabase
    .from('categorias_contabeis')
    .select('id, nome, ativa')
    .eq('loja_id', lojaId)
    .order(ord, { ascending: dir === 'asc' })

  function buildSortHref(key: string, newDir: 'asc' | 'desc'): string {
    const params = new URLSearchParams()
    params.set('ord', key)
    params.set('dir', newDir)
    return `/categoria-contabil?${params.toString()}`
  }
  // ...
```

No `<Lista>`: adicionar `sortAtual={ord}`, `dirAtual={dir}`,
`sortHref={buildSortHref}`, e `sort: 'nome'` na coluna "Nome",
`sort: 'ativa'` na coluna "Situação".

**Atenção**: o `.order()` de hoje é só `'nome'` (sem direção explícita —
Postgres usa ascending por padrão), então o default `dir='asc'` bate com
o comportamento atual.

### 1b. `familia/page.tsx`

Tipo de `searchParams` já existe (`{ q?, situacao? }`) — adicionar
`ord?: string; dir?: string`.

```ts
const COLUNAS_SORT = ['nome', 'origem', 'codigo_familia', 'inativo'] as const
type ColSort = (typeof COLUNAS_SORT)[number]
```

Ler `ord`/`dir` do jeito acima (default `'nome'`/`'asc'`, bate com
`.order('nome')` de hoje). Aplicar `.order(ord, { ascending: dir ===
'asc' })` no lugar de `.order('nome')` (linha 57) — **antes** do
`.limit(500)` (linha 58, ordem das chamadas do builder não importa pro
SQL gerado, mas mantenha a mesma sequência visual do Inventário:
`.order(...)` antes de `.limit(...)`).

`buildSortHref(key, dir)` preservando `q`/`situacao`:
```ts
function buildSortHref(key: string, newDir: 'asc' | 'desc'): string {
  const params = new URLSearchParams()
  if (params_.q) params.set('q', params_.q)
  if (params_.situacao) params.set('situacao', params_.situacao)
  params.set('ord', key)
  params.set('dir', newDir)
  return `/familia?${params.toString()}`
}
```
(a variável já se chama `params` na página — renomeie a interna do
`buildSortHref` pra não colidir, ex. `p` no `URLSearchParams`, ou use o
nome que já existe pro searchParams resolvido, `params`, sem sombrear.)

No `<Lista>`: `sort: 'nome'` (Nome), `sort: 'origem'` (Origem),
`sort: 'codigo_familia'` (Código Omie), `sort: 'inativo'` (Situação).

### 1c. `local-estoque/page.tsx`

Mesmo padrão de `familia` (estrutura idêntica: `{ q?, situacao? }`,
`.order('descricao').limit(200)`).

```ts
const COLUNAS_SORT = ['descricao', 'codigo_local_estoque', 'codigo', 'inativo'] as const
```

Default `'descricao'`/`'asc'` (bate com `.order('descricao')` de hoje).
`sort:` em todas as 4 colunas (Descrição, Código local, Código,
Situação).

**Step final (as 3 telas): `npx tsc --noEmit`, depois commit:**
```bash
git add app/\(app\)/categoria-contabil/page.tsx app/\(app\)/familia/page.tsx app/\(app\)/local-estoque/page.tsx
git commit -m "feat: ordenação clicável em categoria-contábil, família e local de estoque"
```

---

## Task 2: `sync-status` + `impressoes`

2 telas com `.limit()` mas sem `.range()`/paginação por página. Mesmo
padrão, com colunas calculadas (join em memória) ficando de fora.

### 2a. `sync-status/page.tsx`

Tipo de `searchParams` já tem `{ dias?, model? }` — adicionar `ord?:
string; dir?: string`.

```ts
const COLUNAS_SORT = ['model', 'created_at', 'code'] as const
type ColSort = (typeof COLUNAS_SORT)[number]
```

Default `'created_at'`/`'desc'` (bate com `.order('created_at', {
ascending: false })` de hoje, linha 120). Trocar essa linha por
`.order(ord, { ascending: dir === 'asc' })`.

`buildSortHref` preservando `dias`/`model`:
```ts
function buildSortHref(key: string, newDir: 'asc' | 'desc'): string {
  const p = new URLSearchParams()
  p.set('dias', String(dias))
  if (params.model) p.set('model', params.model)
  p.set('ord', key)
  p.set('dir', newDir)
  return `/sync-status?${p.toString()}`
}
```

No `<Lista>`: `sort: 'model'` (Model), `sort: 'created_at'`
(Data/hora), `sort: 'code'` (Code). "Loja" e "Erro" ficam SEM `sort`
(resolvida via `nomePorLoja`/texto truncado, não são coluna direta).

### 2b. `impressoes/page.tsx`

Tipo já tem `{ data_inicio?, data_final?, origem? }` — adicionar `ord?:
string; dir?: string`.

```ts
const COLUNAS_SORT = ['created_at', 'origem', 'qtd_etiquetas', 'referencia_id'] as const
```

Default `'created_at'`/`'desc'` (bate com linha 49 de hoje). Trocar
`.order('created_at', { ascending: false })` por `.order(ord, {
ascending: dir === 'asc' })`.

`buildSortHref` preservando `data_inicio`/`data_final`/`origem`.

No `<Lista>`: `sort: 'created_at'` (Data/hora), `sort: 'origem'`
(Origem), `sort: 'qtd_etiquetas'` (Qtd), `sort: 'referencia_id'`
(Referência). "Usuário" fica SEM `sort` (resolvida via `nomeMap`).

**Step final (as 2 telas): `npx tsc --noEmit`, commit:**
```bash
git add app/\(app\)/sync-status/page.tsx app/\(app\)/impressoes/page.tsx
git commit -m "feat: ordenação clicável em saúde da integração e impressões"
```

---

## Task 3: `fornecedor` + `transferencia`

2 telas com paginação real (`.range()`, componente `Paginacao`) — mais
parecidas ainda com o Inventário.

### 3a. `fornecedor/page.tsx`

Tipo já tem `{ q?, page? }` — adicionar `ord?: string; dir?: string`.

```ts
const COLUNAS_SORT = ['razao_social', 'cnpj_cpf', 'origem', 'inativo'] as const
type ColSort = (typeof COLUNAS_SORT)[number]
```

Default `'razao_social'`/`'asc'` (bate com `.order('razao_social')`,
linha 97). Trocar por `.order(ord, { ascending: dir === 'asc' })` —
**antes** de `.range(...)` (linha 98), mesma ordem do Inventário.

`buildSortHref` preservando `q` (NÃO incluir `page`):
```ts
function buildSortHref(key: string, newDir: 'asc' | 'desc'): string {
  const p = new URLSearchParams()
  if (params.q) p.set('q', params.q)
  p.set('ord', key)
  p.set('dir', newDir)
  return `/fornecedor?${p.toString()}`
}
```

No `<Lista>`: `sort: 'razao_social'` (Razão social), `sort: 'cnpj_cpf'`
(CNPJ/CPF), `sort: 'origem'` (Origem), `sort: 'inativo'` (Situação).
"Cidade/UF" fica SEM `sort` (concatenação de 2 colunas em JS).

### 3b. `transferencia/page.tsx`

Tipo já é grande (`{ data_inicio?, data_final?, familia?, tipo?,
status?, motivo?, local?, page?, produto? }`) — adicionar `ord?: string;
dir?: string`.

```ts
const COLUNAS_SORT = ['data', 'status', 'codigo_local_origem'] as const
type ColSort = (typeof COLUNAS_SORT)[number]
```

Default `'data'`/`'desc'` (bate com `.order('data', { ascending: false
})`, linha 153). Trocar por `.order(ord, { ascending: dir === 'asc'
})` — mantém a posição ANTES dos `if (sp.data_inicio) ...` (a ordem de
`.order()` vs `.eq()`/`.gte()` no builder do Supabase não importa pro
SQL final, mas mantenha o mesmo estilo visual já usado nesse arquivo:
`.order()` logo depois do `.select()`/`.eq()` inicial, como já está).

`buildSortHref` preservando TODOS os filtros já existentes (mesmo
conjunto que `relatorioParams`/`exportParams` já preservam, linhas
213-233 — reuse a mesma lista de campos, não invente um subconjunto
diferente):
```ts
function buildSortHref(key: string, newDir: 'asc' | 'desc'): string {
  const p = new URLSearchParams()
  if (sp.data_inicio) p.set('data_inicio', sp.data_inicio)
  if (sp.data_final) p.set('data_final', sp.data_final)
  if (sp.familia) p.set('familia', sp.familia)
  if (sp.tipo) p.set('tipo', sp.tipo)
  if (sp.produto) p.set('produto', sp.produto)
  if (sp.local) p.set('local', sp.local)
  if (sp.status) p.set('status', sp.status)
  if (sp.motivo) p.set('motivo', sp.motivo)
  p.set('ord', key)
  p.set('dir', newDir)
  return `/transferencia?${p.toString()}`
}
```

No `<Lista>`: `sort: 'data'` (coluna "Data"), `sort: 'status'` (coluna
"Status"), `sort: 'codigo_local_origem'` (coluna "Estoque" — mesmo
padrão do Inventário, que usa `sort: 'codigo_local_estoque'` na coluna
"Local" mesmo essa coluna mostrando mais do que só o código). "Responsável"
e "Integrados" ficam SEM `sort` (join em memória / agregado via embed —
mesma decisão já tomada no Inventário pras colunas equivalentes).

**Step final (as 2 telas): `npx tsc --noEmit`, commit:**
```bash
git add app/\(app\)/fornecedor/page.tsx app/\(app\)/transferencia/page.tsx
git commit -m "feat: ordenação clicável em fornecedores e transferências"
```

---

## Task 4: `validade`

1 tela, com 2 nuances que as outras não têm: (1) a direção de
`validade` já MUDA sozinha conforme o modo (`vencidos` = desc, senão
asc) — o novo `dir` clicável precisa respeitar/sobrescrever isso sem
quebrar o modo; (2) duas colunas têm fallback entre 2 campos (`quantidade
?? identificacao_n_qtde`, `identificacao_c_num_op || num_ordem`).

**Files:**
- Modify: `app/(app)/validade/page.tsx`

Tipo já tem `{ dias?, tipo?, modo?, familia?, produto?, local? }` —
adicionar `ord?: string; dir?: string`.

```ts
const COLUNAS_SORT = ['validade', 'qtd', 'op'] as const
type ColSort = (typeof COLUNAS_SORT)[number]
```

**Decisão de design pra essa task**: quando `sp.ord` NÃO está setado
(estado hoje, link direto), o comportamento continua EXATAMENTE como
está — direção de `validade` decidida pelo modo (`vencidos` → desc,
senão → asc), como já é. Só quando o usuário CLICA explicitamente num
cabeçalho (`sp.ord` presente na URL) é que a ordenação vira o que foi
clicado, sobrepondo o padrão do modo:

```ts
const ordRaw = sp.ord
const ord: ColSort | null = ordRaw && (COLUNAS_SORT as readonly string[]).includes(ordRaw) ? (ordRaw as ColSort) : null
const dir = sp.dir === 'asc' ? 'asc' : 'desc'

// ...

if (ord === 'qtd') {
  // fallback: usa 'quantidade', com nulls por último, depois 'identificacao_n_qtde' como desempate
  ordensQuery = ordensQuery.order('quantidade', { ascending: dir === 'asc', nullsFirst: false }).order('identificacao_n_qtde', { ascending: dir === 'asc' })
} else if (ord === 'op') {
  ordensQuery = ordensQuery.order('identificacao_c_num_op', { ascending: dir === 'asc', nullsFirst: false }).order('num_ordem', { ascending: dir === 'asc' })
} else if (ord === 'validade') {
  ordensQuery = ordensQuery.order('validade', { ascending: dir === 'asc' })
} else {
  // comportamento de hoje, inalterado
  ordensQuery = vencidos
    ? ordensQuery.lt('validade', hojeMais(0)).order('validade', { ascending: false })
    : ordensQuery.gte('validade', hojeMais(0)).lte('validade', hojeMais(dias)).order('validade', { ascending: true })
}
```

Confirme a estrutura EXATA da query real antes de aplicar (ela já tem
`.lt()`/`.gte()`/`.lte()` misturados com `.order()` condicionalmente ao
`vencidos` — o trecho acima é o formato, adapte pra não perder nenhuma
das cláusulas de filtro de data já existentes, só trocando QUAL
`.order()` roda no final).

`sortAtual`/`dirAtual` passados pro `<Lista>` só fazem sentido quando
`ord !== null` (senão não há UM critério clicável ativo — é o padrão do
modo). Passe `sortAtual={ord ?? 'validade'}` mesmo assim (a coluna
"Validade" continua sendo a única sempre "ativa" visualmente por
padrão, batendo com o que já é hoje na prática) e `dirAtual={ord ? dir :
(vencidos ? 'desc' : 'asc')}` (reflete a direção REAL que está sendo
aplicada, inclusive no caso padrão-por-modo).

`buildSortHref` preservando `dias`/`tipo`/`modo`/`familia`/`produto`/`local`
(mesmo conjunto que a variável `extra`/`sufixo` já preserva, linhas
211-219 — reuse a mesma lista de campos).

No `<Lista>`: `sort: 'validade'` (Validade), `sort: 'qtd'` (Qtd),
`sort: 'op'` (OP). "Produto" fica SEM `sort` (nome via `prodMap`, join
em memória).

**`npx tsc --noEmit`, commit:**
```bash
git add app/\(app\)/validade/page.tsx
git commit -m "feat: ordenação clicável em validade"
```

---

## Task 5: `produto-substituicao` (sort em JS)

Único caso de ordenação em JS (não `.order()` no banco) — as 2 colunas
exibem NOME resolvido em memória via `nomeDe()`, e a tela não pagina
(busca tudo de uma vez, dataset pequeno).

**Files:**
- Modify: `app/(app)/produto-substituicao/page.tsx`

Página hoje não recebe `searchParams`. Adicionar:

```ts
const COLUNAS_SORT = ['n_cod_prod', 'substitui_n_cod_prod'] as const
type ColSort = (typeof COLUNAS_SORT)[number]

export default async function ProdutoSubstituicaoPage({
  searchParams,
}: {
  searchParams: Promise<{ ord?: string; dir?: string }>
}) {
  // ...
  const sp = await searchParams
  const ordRaw = sp.ord ?? 'n_cod_prod'
  const ord: ColSort = (COLUNAS_SORT as readonly string[]).includes(ordRaw) ? (ordRaw as ColSort) : 'n_cod_prod'
  const dir = sp.dir === 'desc' ? 'desc' : 'asc'

  // ...busca vinculos/todosProdutos igual hoje...

  const nomeDe = (cod: number) =>
    (todosProdutos as Produto[] | null)?.find((p) => p.n_cod_prod === cod)?.descricao ?? `#${cod}`

  // Sort em JS: ordena pelo NOME resolvido (não pelo código cru), já que é
  // isso que o usuário vê na coluna. Dataset pequeno (cadastro manual de
  // vínculos), sem paginação -- seguro ordenar em memória depois de buscar.
  const vinculosOrdenados = [...(vinculos ?? [])].sort((a, b) => {
    const campo = ord === 'n_cod_prod' ? 'n_cod_prod' : 'substitui_n_cod_prod'
    const cmp = nomeDe(a[campo]).localeCompare(nomeDe(b[campo]), 'pt-BR')
    return dir === 'asc' ? cmp : -cmp
  })

  function buildSortHref(key: string, newDir: 'asc' | 'desc'): string {
    const p = new URLSearchParams()
    p.set('ord', key)
    p.set('dir', newDir)
    return `/produto-substituicao?${p.toString()}`
  }
  // ...
```

No `<Lista>`: `linhas={vinculosOrdenados as VinculoRow[]}` (no lugar de
`(vinculos ?? []) as VinculoRow[]`), `sortAtual={ord}`, `dirAtual={dir}`,
`sortHref={buildSortHref}`, `sort: 'n_cod_prod'` na coluna "Produto sem
histórico", `sort: 'substitui_n_cod_prod'` na coluna "Usa o histórico
de".

**Nota importante**: o default (`ord ?? 'n_cod_prod'`) muda o
comportamento visual hoje (que é `.order('id')`, ordem de criação do
vínculo) para "por nome A-Z" — isso É uma mudança de default, mas é a
única leitura sensata (ordenar por `id` cru não seria uma opção
"clicável" que faça sentido pro usuário, e a spec já aceitou que
Grupo 2 ordena pelo nome exibido). Documente essa mudança de default no
relatório da task para o controller confirmar que está de acordo antes
de considerar a task fechada — se for um problema, a alternativa é
manter o default em `.order('id')` do jeito que já é hoje E só mudar
quando `sp.ord` estiver explicitamente presente (mesmo padrão de
"default preservado, override só no clique" já usado na Task 4 pra
`validade`).

**`npx tsc --noEmit`, commit:**
```bash
git add app/\(app\)/produto-substituicao/page.tsx
git commit -m "feat: ordenação clicável em produtos substitutos"
```

---

## Task 6: `produto` (ligar ao `ord` existente)

Já tem ordenação funcional (`searchParams.ord` com 4 valores fixos:
`descricao_az`/`descricao_za`/`venda_desc`/`venda_asc`), hoje só via
`<select>` "Ordenar por" na gaveta de filtros (`app/(app)/produto/
page.tsx` linhas 393-403). Vamos ADICIONAR clique no cabeçalho SEM
remover o select — os dois controlam o mesmo `ord`.

**Files:**
- Modify: `app/(app)/produto/page.tsx`

Leia o arquivo INTEIRO antes de editar (é o mais complexo dos 10) —
confirme os nomes exatos de variável (`params`, `ord`, `exportParams`,
`query`) antes de aplicar qualquer trecho, podem ter mudado desde este
plano.

**Mapeamento coluna → valor de `ord`** (2 pares, cada clique alterna
entre os dois valores do par, MESMA lógica de "2 valores distintos por
coluna" já usada em Ordens de Produção — aqui é mais simples porque só
tem 2 colunas):

```ts
// Bridge: o cabecalho clicavel controla o MESMO `ord` que o <select>
// "Ordenar por" da gaveta de filtros ja usa (4 valores fixos) -- sem
// remover o select, os dois refletem o mesmo estado.
function sortHrefProduto(coluna: 'descricao' | 'valor_unitario'): string {
  const p = new URLSearchParams(exportParams.toString())
  p.delete('page')
  if (coluna === 'descricao') {
    p.set('ord', ord === 'descricao_az' ? 'descricao_za' : 'descricao_az')
  } else {
    p.set('ord', ord === 'venda_asc' ? 'venda_desc' : 'venda_asc')
  }
  return `/produto?${p.toString()}`
}
```

(`exportParams` já existe e já preserva TODOS os filtros ativos —
confirme lendo o código real antes de reusar; é o mesmo padrão que o
link "Excel" já usa, linha 437.)

No `<Lista>` (linhas ~540+), adicionar na chamada: `sortAtual={ord ===
'descricao_za' ? 'descricao' : ord === 'venda_asc' || ord ===
'venda_desc' ? 'valor_unitario' : 'descricao'}`, `dirAtual={ord ===
'descricao_za' || ord === 'venda_desc' ? 'desc' : 'asc'}`. Como o
`sortHref` daqui não segue o padrão genérico `(key, dir) => string` de
2 argumentos das outras 9 telas (é específico dessa tela, alterna entre
os 2 valores fixos do PAR), adapte a assinatura: `Lista`'s prop
`sortHref` é `(key: string, dir: 'asc'|'desc') => string` — construa um
wrapper:

```ts
const sortHref = (key: string): string =>
  sortHrefProduto(key === 'descricao' ? 'descricao' : 'valor_unitario')
```

e passe `sortHref={(key, _dir) => sortHref(key)}` pro `<Lista>` (o
`dir` do callback genérico é ignorado aqui — a alternância real é
decidida por `sortHrefProduto` olhando o `ord` ATUAL, não o `dir`
pedido, já que os 4 valores fixos já embutem a direção).

Coluna "Descrição" (linha ~558+): adicionar `sort: 'descricao'`.
Coluna "Venda" (dentro do spread condicional `vista === 'precos'`):
adicionar `sort: 'valor_unitario'`.

Colunas calculadas (Custo, Margem, Sugerido, Mínimo, Atual, Prev. venda,
Repor, Preço últ. compra) continuam SEM `sort` — já documentado no
próprio código como limitação conhecida, não mude isso.

**`npx tsc --noEmit`, commit:**
```bash
git add app/\(app\)/produto/page.tsx
git commit -m "feat: ligar ordenação clicável ao seletor existente em produtos"
```

---

## Task 7: QA final + deploy

**Depende de:** Tasks 1-6 completas.

**Step 1: `npx tsc --noEmit`** no repo inteiro, confirmar limpo.

**Step 2: Checklist de leitura de código** (sem navegador disponível),
pra CADA uma das 10 telas tocadas:
- [ ] A whitelist (`COLUNAS_SORT`) rejeita qualquer `ord` fora dela
      (cai no default)?
- [ ] O default (sem `sp.ord` na URL) bate byte a byte com o
      `.order()`/comportamento que a tela já tinha ANTES deste plano?
- [ ] `buildSortHref` preserva TODOS os outros filtros que a tela já
      tinha (confira contra a lista real de `searchParams` de cada
      arquivo, não uma lista de memória)?
- [ ] Nenhuma coluna calculada/join-em-memória ganhou `sort` por
      engano?

**Step 3: Deploy**

Seguir a seção de deploy dos Global Constraints.

**Step 4: Confirmar com dado real**

Pra pelo menos 3 das 10 telas (escolha as com mais dado real hoje —
provavelmente `produto`, `fornecedor`, `transferencia`), acessar a URL
com `?ord=<coluna>&dir=asc` e `&dir=desc` manualmente (`curl` autenticado
não é viável aqui — pode ser necessário pedir pro controller confirmar
visualmente depois, ou usar uma query SQL equivalente pra comparar a
ORDEM das primeiras linhas contra o que a tela deveria mostrar).

**Step 5: Documentar**

Não precisa de entrada nova no AGENTS.md pra essa mudança (é aditivo,
UI, sem achado de bug de dado) — só escreva o relatório final da task
resumindo as 10 telas tocadas + qualquer desvio do plano encontrado
durante a execução (ex: a mudança de default em `produto-substituicao`,
se o controller confirmou que está OK).

---

## Execução

Oferecida via `superpowers:subagent-driven-development`, nesta mesma
sessão. Produção real, mas risco baixo (mudança aditiva, mesmo padrão
replicado 10x, sem alterar filtro/busca existente) — revisão de task
padrão (spec + qualidade) é suficiente pra todas as 7 tasks.
