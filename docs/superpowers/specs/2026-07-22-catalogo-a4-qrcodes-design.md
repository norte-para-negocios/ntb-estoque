# Catálogo A4 de QR Codes — Design Spec

**Data:** 2026-07-22
**Origem:** pedido feito ao vivo pelo Ramon (cliente que opera o app nas
lojas) numa reunião de teste do app de Estoque, transcrita via `/etl-audio`.
Citação: "Eu quero fazer um caderno de etiquetas... poder criar um caderno
de etiquetas, eu poder folhear e bipar." Declarado pelo usuário como
prioridade nº1 do dia seguinte à reunião.

## Contexto atual

A tela `/produto` (`app/(app)/produto/page.tsx`) já tem:
- Um `<form id="form-etiquetas-produto" action="/produto/imprimir-etiquetas" method="GET">`
  envolvendo a listagem, com um `<input type="checkbox" name="codigos" value={p.codigo_produto}>`
  por linha.
- Um botão fora do form, associado via `form="form-etiquetas-produto"`, que
  submete essa lista de códigos.
- A rota `/produto/imprimir-etiquetas/route.ts` (GET) recebe `codigos`
  (repetido na querystring), busca os produtos correspondentes, gera um QR
  por produto (`qrcode`) e renderiza um PDF via `@react-pdf/renderer` usando
  `EtiquetaPDF` — **uma etiqueta de 7.26cm × 4cm por página**, com nome do
  produto + código + QR + logo NTB obrigatória no rodapé (config mínima,
  sem campos de NF/OP).
- Filtros de listagem existentes em `/produto`: `q` (busca), `familia`,
  `tipo`, `situacao` (ativos/inativos, default ativos), `fornecedor`, `pdv`.
  A query usa `.range()` para paginação (`POR_PAGINA` por página).

Essa etiqueta pequena continua existindo sem mudanças — o pedido é um
**segundo formato**, para impressão em lote tipo catálogo/livro.

## O que muda

### 1. Seleção "todos que batem o filtro atual"

Hoje só dá para marcar produtos visíveis na página atual da listagem. Uma
família inteira pode ter centenas de produtos espalhados em várias páginas.

Adiciona-se, dentro do mesmo form, logo acima da tabela:
- Inputs escondidos espelhando os filtros atuais da URL: `q`, `familia`,
  `tipo`, `situacao`, `fornecedor`, `pdv` (valores vindos de `params`, os
  mesmos já lidos no topo da página).
- Um checkbox `<input type="checkbox" name="todos_filtro" value="1">` com
  o rótulo "Selecionar todos os N produtos deste filtro" — `N` vem de uma
  contagem (`{ count: 'exact', head: true }` na mesma query já filtrada,
  sem os campos de select nem `.range()`) buscada em paralelo com as outras
  queries da página (`Promise.all` já existente).

**Regra de precedência**: se `todos_filtro=1` estiver presente e marcado,
as rotas de impressão ignoram completamente `codigos` e resolvem a lista
de produtos pelos filtros. Isso remove qualquer ambiguidade de "marcou os
dois ao mesmo tempo".

### 2. Helper compartilhado de resolução de seleção

Novo arquivo `lib/produtos-selecionados.ts`:

```ts
export interface FiltroProdutosSelecao {
  q?: string
  familia?: string
  tipo?: string
  situacao?: string
  fornecedor?: string
  pdv?: string
}

// Resolve a lista de codigo_produto que batem o filtro, SEM o teto de 1000
// linhas do PostgREST -- pagina com .range() até a página vir mais curta que
// o tamanho pedido, igual ao padrão já usado em outros lugares do app pra
// esse mesmo problema (ex.: /produto/export, estoque-valorizado).
export async function resolverCodigosPorFiltro(
  lojaId: string,
  filtro: FiltroProdutosSelecao,
): Promise<number[]>
```

A implementação reaplica exatamente a mesma lógica de filtro já usada em
`app/(app)/produto/page.tsx` (mesmos `.eq`/`.ilike`/`.or`, mesma regra de
`situacao` → coluna `inativo`, default `ativos`), mas sem paginação de UI —
busca TODOS os códigos que batem, em lotes de 1000 via `.range()`, e
retorna só a lista de `codigo_produto` (não os produtos inteiros — os dados
de exibição são buscados depois, já filtrados por essa lista, exatamente
como a rota atual já faz com `codigos`).

Ambas as rotas de impressão (`/produto/imprimir-etiquetas` e a nova
`/produto/imprimir-catalogo`) passam a aceitar dois modos de seleção:
- `codigos` (repetido) — comportamento atual, lista explícita.
- `todos_filtro=1` + os campos de filtro na querystring — novo modo, resolve
  via `resolverCodigosPorFiltro`.

### 3. Novo componente `components/etiqueta/CatalogoPDF.tsx`

Grade A4 retrato, **3 colunas × 6 linhas = 18 itens por página**. Página A4
(210mm × 297mm), margem de 10mm em cada lado, cabeçalho de ~12mm no topo
(logo NTB + nome da loja, **uma vez por página**, não repetido por item —
decisão explícita: com 18 itens compactos, repetir a logo 18× desperdiça
espaço que pode ir pro QR). Cada célula da grade (~62mm × 42mm, área
comparável à etiqueta pequena atual de 72.56mm × 40.04mm — "um pouco menor"
como pedido) mostra:
- Nome do produto (truncado do mesmo jeito que `EtiquetaPDF` já trunca —
  reaproveita `formatarNomeProduto`).
- Código do produto.
- QR code (reaproveita a mesma geração via `qrcode`, tamanho ajustado pra
  caber na célula menor).

Sem logo, sem CNPJ, sem campos de NF/OP/validade/lote por item — só o
essencial pro "bipar" funcionar, igual ao pedido do Ramon ("não precisa ser
na etiqueta mesmo que a gente imprime, pode ser um PDF tipo Word").

Múltiplas páginas A4 conforme a quantidade de produtos selecionados (18 por
página, sem limite artificial de páginas — uma família com 200 produtos
gera ~12 páginas).

Interface do item (subconjunto do que `Etiqueta` já tem em `EtiquetaPDF.tsx`):

```ts
export interface ItemCatalogo {
  descricao: string
  codigo_produto: string
  qr: string // data URL do QR code
}

export interface CatalogoPDFProps {
  itens: ItemCatalogo[]
  nomeLoja: string
}
```

### 4. Nova rota `app/(app)/produto/imprimir-catalogo/route.ts`

Espelha `app/(app)/produto/imprimir-etiquetas/route.ts`:
- Mesma checagem de permissão (`requirePermissao(lojaId, 'Produtos')`).
- Aceita `codigos` OU (`todos_filtro=1` + filtros) via o helper novo.
- Gera um QR por produto do mesmo jeito (`QRCode.toDataURL`).
- Renderiza `CatalogoPDF` via `renderToBuffer`.
- Registra o histórico em `impressao_etiquetas` com `origem: 'CATALOGO'`
  (mesmo padrão de try/catch silencioso da rota atual, pra não quebrar o
  download se o registro de histórico falhar).
- Retorna o PDF com `Content-Disposition: inline; filename="catalogo-produtos.pdf"`.

### 5. Novo botão em `/produto`

Ao lado do botão existente "Imprimir etiquetas selecionadas", um segundo
botão "Imprimir catálogo A4", com `form="form-etiquetas-produto"` e
`formAction="/produto/imprimir-catalogo"` (mesmo form, `formAction`
diferente — não precisa duplicar a UI de seleção nem os hidden inputs de
filtro).

## Casos de borda

- Nenhum produto selecionado (nem `codigos` nem `todos_filtro`) → 400,
  igual à rota atual.
- `todos_filtro=1` mas filtro não bate nenhum produto → 404, igual ao "não
  encontrados" da rota atual.
- Produto sem `codigo_produto` (null) → já excluído hoje na query da
  listagem, mantém igual.
- Família muito grande → várias páginas A4, sem limite artificial.

## Testes

Sem suíte automatizada no projeto (convenção já estabelecida nesta sessão).
Verificação manual via Playwright: baixar o PDF gerado pela nova rota (com
`codigos` explícito e depois com `todos_filtro`), confirmar `Content-Type:
application/pdf`, contar número de páginas (`itens.length / 18`
arredondado pra cima) e conferir visualmente o grid de 3×6 numa página de
exemplo.

## Fora de escopo (não pedido, não incluído)

- Reordenar/agrupar os itens dentro da grade por família (a ordem segue a
  mesma da listagem/filtro, sem agrupamento visual extra).
- Configuração de layout (colunas/linhas) pelo usuário — fixo em 3×6,
  igual ao valor aprovado nesta spec.
- Mudança na etiqueta pequena existente (`EtiquetaPDF`) — permanece
  intocada.
