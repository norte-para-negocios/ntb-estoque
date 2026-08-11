# Ordenação clicável nas tabelas — Design

**Data:** 2026-08-11

**Gatilho:** usuário pediu ordenação clicável por coluna (ex: clicar em
"Data" pra ordenar mais recente/mais antigo) como padrão em todas as
tabelas do sistema — hoje só funciona em 2-3 telas, de forma
inconsistente.

## Contexto já investigado (não re-investigar)

Levantamento completo feito hoje (não repetir):

- **Já existe um mecanismo reusável e funcionando**:
  `components/ui-kit/Lista.tsx` aceita `sort?: string` por coluna +
  `sortAtual`/`dirAtual`/`sortHref` na chamada — quando preenchidos, o
  `<th>` vira link clicável com ícone (`ChevronUp`/`Down`/`ChevronsUpDown`).
  100% via searchParam da URL, Server Component, sem client-side
  JS/`useState`. `app/(app)/inventario/page.tsx` é a referência de uso
  correto (whitelist `COLUNAS_SORT`, `buildSortHref`, `.order(ord, {
  ascending: dir === 'asc' })` no Supabase antes de paginar).
- **14 telas usam `Lista`**, só 2 preenchem `sort`/`sortHref`
  (Inventário, Notas Fiscais). As outras 12 usam `Lista` com cabeçalho
  estático.
- **1 tela** (Ordens de Produção) tem ordenação própria, não reusa
  `Lista` — fora de escopo deste plano (fica como está, funciona).
- **12 tabelas são relatórios/matrizes agregadas** (Faturamento,
  Movimentação "Por operação", Margem, Compras, Auditoria Fiscal, etc.)
  — fora de escopo (ordenar pivô é problema de design diferente).
- **2 tabelas usam `DataTable`** (wrapper só visual) — fora de escopo
  desta rodada.

## Escopo desta rodada: as 12 telas que usam `Lista` sem `sort`

Divididas em 3 grupos pelo levantamento de hoje:

### Grupo 1 — direto, mesmo padrão do Inventário (8 telas)

Todas com colunas que mapeiam 1:1 pra uma coluna real do banco, query já
com `.order()`/`.range()`:

| Tela | Colunas que ganham `sort` | Coluna(s) que ficam de fora (calculada/join em memória) |
|---|---|---|
| `categoria-contabil` | Nome (`nome`), Situação (`ativa`) | — |
| `familia` | Nome (`nome`), Origem (`origem`), Código Omie (`codigo_familia`), Situação (`inativo`) | — |
| `local-estoque` | Descrição (`descricao`), Código local (`codigo_local_estoque`), Código (`codigo`), Situação (`inativo`) | — |
| `sync-status` | Model (`model`), Data/hora (`created_at`), Code (`code`) | Loja (nome via join em memória), Erro (texto truncado) |
| `impressoes` | Data/hora (`created_at`), Origem (`origem`), Qtd (`qtd_etiquetas`), Referência (`referencia_id`) | Usuário (nome via join em memória) |
| `fornecedor` | Razão social (`razao_social`), CNPJ/CPF (`cnpj_cpf`), Origem (`origem`), Situação (`inativo`) | Cidade/UF (concatenação de 2 colunas) |
| `transferencia` | Data (`data`), Status (`status`), Estoque→origem (`codigo_local_origem`) | Responsável (join em memória), Integrados (agregado via embed) |
| `validade` | Validade (`validade`), Qtd (`quantidade`/`identificacao_n_qtde` com fallback), OP (`identificacao_c_num_op`/`num_ordem` com fallback) | Produto (nome via join em memória) |

Mecânica idêntica em cada uma (copiar o padrão do Inventário):
1. Whitelist de chaves de ordenação válidas pra essa tela.
2. Ler `sp.ord`/`sp.dir` (default: a coluna que já é `.order()` padrão
   hoje, mesma direção que já é padrão).
3. Aplicar `.order(ord, { ascending: dir === 'asc' })` na query real
   (antes de `.range()`/`.limit()`, quando existir).
4. `buildSortHref(key, dir)` local preservando os demais filtros já
   existentes na tela.
5. Passar `sortAtual`/`dirAtual`/`sortHref` pro `<Lista>`, adicionar
   `sort: '<coluna>'` só nas colunas da tabela acima.

### Grupo 2 — sort em JS (1 tela, sem paginação, dataset pequeno)

`produto-substituicao`: as 2 colunas exibem NOME resolvido em memória
(`nomeDe(codigo)`), não uma coluna direta. Como a tela não pagina (busca
tudo de uma vez, cadastro pequeno — vínculos manuais), ordenar em JS
sobre o array já carregado é seguro e simples: `vinculos.slice().sort(
(a, b) => nomeDe(a.campo).localeCompare(nomeDe(b.campo), 'pt-BR') * (dir
=== 'asc' ? 1 : -1))`, aplicado depois de buscar, antes de passar pro
`<Lista>`. Mesmo mecanismo de URL/`sortHref`/ícone do `Lista` — só a
ORIGEM da ordenação muda (JS em vez de `ORDER BY`).

### Grupo 3 — ligar ordenação existente ao cabeçalho clicável (1 tela)

`produto`: já tem ordenação funcional (`searchParams.ord` com 4 valores
fixos: `descricao_az`/`descricao_za`/`venda_desc`/`venda_asc`), hoje só
acessível via `<select>` "Ordenar por" na gaveta de filtros. Vamos
ADICIONAR `sort`/`sortAtual`/`dirAtual`/`sortHref` no `<Lista>` também,
mapeando duas colunas existentes:

- `Descrição` → `sort: 'descricao'`; clique alterna entre
  `ord=descricao_az` (asc) e `ord=descricao_za` (desc).
- `Venda` → `sort: 'valor_unitario'`; clique alterna entre
  `ord=venda_asc` e `ord=venda_desc`.

O `<select>` da gaveta de filtros **continua existindo** (não remover —
outras pessoas podem preferir o select, e ele já tem os mesmos 4
valores) — os dois controles passam a refletir o mesmo estado
(`searchParams.ord`), sem conflito. As colunas calculadas em memória
(Custo, Margem, Sugerido, Mínimo, Atual, Prev. venda, Repor) continuam
SEM `sort` — limitação já documentada no próprio código-fonte hoje, não
mudamos isso aqui.

## Fora de escopo (explícito)

- `HistoricoTab`/`ListaMovimentos` (aba Movimentações) — dado
  heterogêneo fundido de até 4 tabelas em JS antes de exibir, merece
  design próprio (fica pra depois).
- `Ordens de Produção` — já tem ordenação própria funcionando, migrar
  pro padrão comum é limpeza de consistência, não parte do valor
  imediato deste plano.
- As 12 tabelas de relatório/matriz agregada e as 2 tabelas
  `DataTable`-only — decisão de escopo já tomada na conversa de hoje,
  ordenar pivô é problema de design diferente.
- Mudar QUALQUER comportamento de busca/filtro já existente nas 10
  telas tocadas — só adiciona ordenação, não mexe em mais nada.

## Testes

Não há suite automatizada cobrindo essas páginas. Validação é manual:
pra cada tela, clicar em cada cabeçalho ordenável, confirmar (a) a URL
muda com `ord`/`dir` corretos, (b) os dados reordenam de verdade
(comparar com uma query/contagem direta quando fizer sentido), (c) os
outros filtros ativos continuam aplicados depois do clique, (d) clicar
de novo na mesma coluna inverte a direção.
