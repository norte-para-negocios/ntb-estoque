# Notas Fiscais: filtro de tipo/família/produto/local cruzando 90 dias — Design

## Contexto

`app/(app)/nota-fiscal/page.tsx` (e os arquivos irmãos `export/route.ts` e
`relatorio/route.ts`) resolvem, ANTES da query principal, um conjunto de
`notaIds` quando um filtro de tipo/família/produto/local está ativo: buscam
`produtos` (pra tipo/família) e `nota_fiscal_items` (pra achar quais
`nota_fiscal_id` batem com o filtro), tudo isso **só contra o Supabase**.
Esse conjunto único (`idsIn`/`idsInSet`) é aplicado via `.in('id', idsIn)` na
query quente e como pós-filtro (`idsInSet.has(r.id)`) na fatia fria já
mesclada com o Contabo — documentado como limitação conhecida desde
2026-07-18 ("o cruzamento com o Contabo não foi implementado para esse caso
específico").

**Achado da investigação (2026-07-26)**: hoje essa limitação está **dormente**
— confirmado com dado real (loja 2: toda NF desde 2025-06-28, a mais antiga
existente, já tem seus itens em `nota_fiscal_items` no Supabase; 0 NFs sem
itens). O Supabase não poda essas tabelas, então o filtro "funciona por
sorte" mesmo cruzando 90 dias.

**Mas o dual-write de NF (implementado nesta mesma sessão, 2026-07-26) muda
isso**: agora o Contabo gera seu próprio `id` (bigserial independente) pra
cada NF nova, desde que o dual-write entrou em produção. O pós-filtro atual
(`idsInSet.has(r.id)`) compara o `id` de uma linha **do Contabo** contra um
conjunto de IDs **derivado só do Supabase** — um descompasso de espaço de
IDs. Qualquer NF nova (pós-dual-write) que precise vir do Contabo no futuro
(se o Supabase algum dia podar, ou por qualquer outro motivo de divergência)
será excluída silenciosamente de qualquer filtro de tipo/família/produto/
local — a mesma classe de bug já corrigida hoje mais cedo pra `movimentos`/
NF/OP (commits `3f02341`, `46b6279`, `2ea39ce`), só que neste ponto
específico do código, que usa uma lógica de filtro própria (não passa pelas
funções centrais `complementarNotasFiscais`/`complementarNotaFiscalItems`).

## Arquitetura

Separar o conjunto único de IDs em dois, cada um no espaço de ID da sua
própria base, aplicados **antes** de mesclar (não depois):

1. **`notaIdsQuente`**: exatamente como hoje — resolvido contra
   `produtos`/`nota_fiscal_items` do Supabase, aplicado via `.in('id', ...)`
   na query quente (sem mudança de comportamento aqui).
2. **`notaIdsFrio`** (novo): resolvido contra `produtos` (mesmo local,
   compartilhado) e `nota_fiscal_items` **do Contabo** (busca crua, mesma
   técnica de paginação já usada por `agregarMovimentacaoJS`/
   `buscarFaturamentoFrioHistorico`), devolvendo o `Set<number>` de
   `nota_fiscal_id` no espaço de ID do Contabo.
3. A fatia fria (Contabo) é filtrada por `notaIdsFrio` **antes** de mesclar
   com a quente (que já foi filtrada por `notaIdsQuente` via `.in()`) — o
   merge continua deduplicando por `n_id_receb` (já corrigido hoje), sem
   nenhum pós-filtro por `.id` cru sobrando.

## Componentes

### `lib/relatorio-frio-nf.ts`: nova função `buscarNotaIdsFrio`

```ts
export async function buscarNotaIdsFrio(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  codigosProduto: string[] | null   // já resolvido localmente (tipo/família), null = sem filtro por produto
  produtoBusca: string | null        // termo de busca (descrição/código do item)
  localCod: number | null            // codigo_local_estoque
}): Promise<Set<number>>
```

Busca `nota_fiscal_items` cru do Contabo pro período (`buscarFrioTudo`, mesma
paginação já usada por `buscarFaturamentoFrioHistorico`), filtra em JS pelos
mesmos 3 critérios que a query quente já aplica (produto_codigo no conjunto
de códigos, busca por descrição/código, local via o campo equivalente do
lado frio), devolve o `Set` de `nota_fiscal_id` (id do CABEÇALHO no Contabo,
já presente nas linhas de `nota_fiscal_items` do endpoint). Se nenhum dos 3
filtros estiver ativo, a função nem é chamada (mesmo comportamento de hoje:
sem filtro = sem restrição de IDs).

### `app/(app)/nota-fiscal/page.tsx` e os 2 arquivos irmãos

Trocar o bloco de resolução de `notaIds`/`idsIn`/`idsInSet` único por:
- `notaIdsQuente` (lógica atual, inalterada) → `.in('id', ...)` na query
  quente (inalterado).
- `notaIdsFrio` (novo, só calculado quando `dataInicio < limiteJanelaQuente()`
  E algum dos 3 filtros está ativo) → filtra a fatia fria (`friasFiltradas`/
  equivalentes) por `notaIdsFrio.has(r.id)` **antes** do merge com a quente,
  no lugar do `idsInSet.has(r.id)` pós-merge atual.

Sem mudança de comportamento pro caso comum (sem filtro, ou período todo
dentro dos 90 dias) — só afeta quando os dois fatores coincidem: filtro de
tipo/família/produto/local ativo E período cruzando 90 dias.

## Tratamento de erro

Mesma filosofia do resto do sistema: falha ao buscar `notaIdsFrio` (Contabo
fora do ar, timeout) não pode quebrar a tela — se `buscarFrioTudo` já
devolve `[]` em erro (comportamento herdado do resto do módulo), o pior caso
é a fatia fria ficar mais restritiva que deveria (nenhuma nota fria passa no
filtro), nunca um erro na tela.

## Verificação

Sem suite automatizada (convenção já estabelecida). Verificação manual: (1)
reproduzir com dado real de uma loja/filtro que cruze os 90 dias e comparar
a contagem contra uma reconstrução independente via SQL+API direto (mesma
técnica já usada nesta sessão pros outros fixes); (2) confirmar que o caso
comum (sem filtro cruzando o corte) continua idêntico ao comportamento
anterior.

## Fora de escopo

- O drill-down do Faturamento (tipo>familia/familia>produto) — subsistema
  independente, spec própria em separado.
- Qualquer mudança na lógica de dedupe por `n_id_receb` já corrigida hoje
  (commits `46b6279`/`2ea39ce`) — este projeto só ataca o filtro por
  tipo/família/produto/local, não o merge quente+frio em si.
