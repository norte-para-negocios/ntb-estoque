# Gaveta de detalhe da movimentação + colunas customizáveis — Design

## Contexto

Na tela `/movimentacoes`, aba "Movimentos" (`components/movimentacoes/MovimentosTab.tsx`), cada linha mostra hoje um texto puro (ex.: "Ordem de Produção" com "OP 2026/00374479" numa linha secundária) sem nenhum link ou clique. O usuário quer clicar nessa origem e ver TUDO sobre aquela movimentação específica numa janela — e, no caso de Ordem de Produção, poder reverter direto dali.

Levantamento do que já existe (não inventar do zero):

- **Ordem de Produção**: não tem tela de detalhe própria — os dados (produto, quantidade, validade, ingredientes, status) e a ação "Reverter" (`reverterOP`, `lib/actions/ordem-producao.ts:736`, chama a Omie de verdade) vivem hoje só dentro da linha da lista em `/ordem-producao` (`components/ordem-producao/OrdemProducaoRow.tsx`).
- **Transferência**: já tem tela completa (`/transferencia/[id]/contagem`) com itens, quantidade, status, responsável — só não tem ação de reverter (não existe no sistema, não é objetivo desta spec criar).
- **Nota Fiscal**: já tem tela completa (`/nota-fiscal/[id]`) com itens, CFOP, valor, XML/DANFE — também sem reverter.
- `MovimentosTab.tsx` hoje **não seleciona os IDs** que ligariam cada linha ao documento de origem: a query de `movimentos` (linha 167) não traz `transferencia_id`; a query de `nota_fiscal_items` (linha 195) não traz `nota_fiscal_id`. Só a OP já tem `id` disponível (embutido dentro da string `chave`, não exposto).

Decisão confirmada com o usuário: a janela mostra o conteúdo **completo** diretamente nela (não um resumo com "abrir tela completa") — mesma gaveta lateral (`Sheet`, já existe e é genérico em `components/ui/sheet.tsx`) pros 4 tipos, com X pra fechar.

## Escopo

Clicável: **Ordem de Produção**, **Transferência**, **Nota Fiscal**, **Inventário** (as 4 origens que têm um "documento" de verdade por trás). Ajustes manuais simples (ENT/SAI/TPQ sem OP/NF/inventário/transferência por trás) **não** abrem gaveta — já mostram tudo que existe deles na própria linha (data, quantidade, local/destino, obs, status); não há mais nada pra detalhar.

Reverter: só existe pra Ordem de Produção (única com essa ação no sistema hoje). Não criar reverter pra Transferência/NF/Inventário nesta spec.

Fora de escopo: qualquer filtro/busca DENTRO da gaveta (ex.: buscar um ingrediente específico numa OP com muitos itens) — se a lista de itens for grande, mostra todos sem paginação/filtro, igual as telas completas já fazem hoje.

## Componente `DetalheMovimentoSheet`

Um `Sheet` (client component) reaproveitável, montado a partir de um "tipo + id":

```ts
type OrigemMovimento =
  | { tipo: 'op'; id: number }
  | { tipo: 'transferencia'; id: number }
  | { tipo: 'nota_fiscal'; id: number }
  | { tipo: 'inventario'; id: number }
```

Fluxo: a "Tipo" cell de cada linha clicável (OP/Transferência/NF/Inventário) vira um `<button>` que abre o Sheet E dispara a busca dos dados completos daquela origem especificamente — não pré-carrega todas as linhas visíveis (evitaria N buscas caras só porque a tela abriu). A busca é uma Server Action nova por tipo (`buscarDetalheOP(id)`, `buscarDetalheTransferenciaCompleta(id)`, `buscarDetalheNotaFiscalCompleta(id)`, `buscarDetalheInventarioItem(id)`), cada uma reaproveitando as MESMAS queries que já alimentam a tela completa correspondente (não reinventar o SELECT).

Conteúdo por tipo, dentro do Sheet:

- **OP**: número da OP, produto, quantidade planejada e produzida, data prevista e de conclusão real, status (Concluída/Pendente/Atrasada), lista de ingredientes (nome, quantidade, unidade — mesmos dados que `OrdemProducaoRow` já monta pra expandir inline). Rodapé com o botão **Reverter** (só visível quando `concluida && podeReverter`, mesma permissão `Ordens de Producao - Reverter` já usada hoje) — chama a Server Action `reverterOP` já existente, sem reescrever a lógica; mesma confirmação (`window.confirm`) que já existe hoje antes de chamar.
- **Transferência**: local origem → destino, data, responsável, status, lista de itens (produto, quantidade, status) — mesmo conteúdo de `ContagemTransferencia`, renderizado dentro do Sheet em vez de like uma página.
- **Nota Fiscal**: número da NFe, razão social, data emissão, valor, status (via `statusNF`), chave de acesso, lista de itens (produto, CFOP, quantidade, preço) — mesmo conteúdo de `ItensNotaFiscal`. Links de baixar XML/DANFE continuam funcionando dentro do Sheet (são downloads, não navegação).
- **Inventário**: contagem (produto, quantidade contada, status) — mesmo padrão de `/inventario/[id]/contagem`.

## Mudanças em `MovimentosTab.tsx`

1. `LinhaDetalhe` ganha um campo opcional `origem?: OrigemMovimento` (o tipo acima).
2. `opLines` (linha 289): `origem: { tipo: 'op', id: op.id }` — `op.id` já vem da query, só falta expor.
3. Query de `movimentos` (linha 167): adicionar `transferencia_id` ao `.select(...)`. `movLines` (linha 278): quando `m.tipo === 'TRF' && m.transferencia_id`, `origem: { tipo: 'transferencia', id: m.transferencia_id }`.
4. Query de `nota_fiscal_items` (linha 195) e o tipo `RawNFI`/`NFIItem`: adicionar `nota_fiscal_id`. A fatia fria (`RawNFIFrio`, linha 222) **já tem** `nota_fiscal_id` — só falta propagar pro `NFIItem` normalizado (linhas 236-241, 265-268). `entLines` (linha 305): `origem: { tipo: 'nota_fiscal', id: nfi.nota_fiscal_id }`.
5. `sldLines` (linha 322): já tem `inv?.id` disponível — `origem: { tipo: 'inventario', id: inv.id }`.
6. A célula "Tipo" (linha 458-475) passa a renderizar `DetalheMovimentoSheet` quando `m.origem` existe (abre ao clicar no texto), e o texto puro de hoje quando não existe (ajuste manual simples).

## Colunas customizáveis

O usuário também pediu poder escolher quais colunas aparecem na tabela de Movimentos (ex.: "só ver a descrição"). Um controle simples ("Colunas" — botão que abre um popover com checkboxes: Data / Tipo / Quantidade / Local-Destino / Status) grava a preferência no localStorage com escopo por rota, mesmo padrão já usado em `useFiltrosPersistentes` (`hooks/use-filtros-persistentes.ts`) — reaproveitar a mesma ideia de chave (`ntb:colunas:/movimentacoes`) em vez de inventar um mecanismo novo de persistência. "Tipo" nunca pode ser escondida (é a coluna primária da lista, sem ela a linha perde sentido) — as outras 4 são opcionais.

## Testes

Sem framework de teste automatizado no repo — verificação via `tsc`/`build` + QA manual (Playwright, conta QA) abrindo a gaveta pros 4 tipos e conferindo que os dados batem com a tela completa equivalente (ex.: abrir a gaveta de uma OP e comparar com o que a mesma OP mostra hoje na lista de `/ordem-producao`).
