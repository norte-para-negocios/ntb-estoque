# Task 1.4 — Densidade mobile + integrar busca

## Botao Buscar no mobile

**Antes:** um botao com texto "Buscar" + kbd "/" ocupava uma linha inteira em todos os breakpoints, consumindo espaco vertical desnecessario no mobile.

**Depois:**
- Mobile (< lg): botao icone 36x36 (size-9), sem texto, sem kbd. Classe lg:hidden.
- Desktop (>= lg): botao original completo com texto + kbd "/". Classe hidden lg:inline-flex.
- O atalho de teclado "/" continua funcionando (handler no useEffect do AppShell e inalterado).
- Arquivo: components/shell/AppShell.tsx

## Densidade das listas no mobile

**Antes:** cards empilhados com space-y-3 entre eles, p-4 interno, label dt para cada campo secundario, grid grid-cols-2 para os dados extras.

**Depois:** estilo "extrato de banco":
- Container: divide-y divide-border -- separador de 1px entre linhas, sem espaco vertical extra.
- Cada linha: min-h-[40px] px-3 py-2.5 -- alvo de toque minimo garantido (>= 40px), padding compacto.
- Titulo (coluna primaria): text-sm font-medium, truncado.
- Dados secundarios: flex flex-wrap gap-x-2.5 em linha unica abaixo do titulo, text-xs text-text-muted. Sem labels dt/dd.
- Acao: alinhada a direita, shrink-0.
- Arquivo: components/ui-kit/Lista.tsx

**Listas cobertas (todas usam o componente Lista):**
- Transferencias (/transferencia)
- Inventarios (/inventario)
- Produtos (/produto)
- Movimentacoes (/movimentacoes)
- Nota fiscal, local-estoque, familia, fornecedor, usuario, loja, log e outras que usam Lista

**Ficou de fora:**
- OrdemProducaoCard em /ordem-producao: layout proprio, nao derivado de Lista.tsx.
- DataTable: nao alterado.

## Garantias de nao-regressao

- ListaHeader sticky: intacto.
- DetailHeader: intacto.
- Overflow horizontal das tabelas: desktop usa hidden lg:block com table, inalterado.
- Gating de acoes: prop acao repassada sem alteracao logica.
- Logica de negocio: zero mudancas em server actions, queries ou calculos.

## Resultado do tsc

npx tsc --noEmit => sem erros (saida vazia)

## Commits

- f0d323b -- design(mobile): densidade extrato nas listas + busca como icone no mobile
