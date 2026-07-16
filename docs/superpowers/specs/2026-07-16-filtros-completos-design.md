# Filtros completos nas telas de lista/relatório

Pedido do usuário: adicionar os filtros que faltam em todas as telas de
lista/relatório do app, replicando o padrão já estabelecido
(`FiltrosGaveta` + tipo `CampoFiltro`), sem inventar nenhum componente novo.

## Contexto de investigação (o que já foi verificado, não precisa refazer)

- **Faturamento** já tem atualização automática — cron `/api/cron/sync-faturamento`
  (commit `50d4ef9`, anterior a este trabalho), agendado em `vercel.json` às
  01:45 diariamente. Confirmado rodando de verdade: 5 das 6 lojas ativas
  atualizaram entre 2026-07-15 e 2026-07-16. Só o texto do botão "Atualizar"
  estava desatualizado ("ainda não roda sozinho") — já corrigido nesta sessão,
  fora deste spec.
- **Auditoria Fiscal e Compras**: ficariam de fora de qualquer trabalho de
  ligar no Contabo (histórico >90 dias) — 736 de 738 itens de nota fiscal
  amostrados no Contabo têm `full_object` vazio, campo do qual essas duas
  RPCs dependem (CFOP de entrada, crédito de ICMS, movimento de estoque).
  Isso é um buraco na sincronização (dual-write, fora deste repo, só no
  servidor Contabo) — não faz parte deste spec, registrado como bloqueio
  conhecido pra quando for revisitado.
- **Margem**: só atualiza via upload manual de Excel exportado do Omie —
  automatizar isso é um projeto à parte (a API do Omie não tem um jeito
  simples de puxar esse dado), não faz parte deste spec.

## Escopo deste spec: só filtros, nas 14 telas

| Tela | Filtros a adicionar |
|---|---|
| `movimentacoes` (aba Histórico) | local de estoque |
| `movimentacoes` (aba Movimentos) | produto (texto), família, tipo, período (data início/fim) |
| `transferencia` | produto (texto) |
| `inventario` | produto (texto), local de estoque |
| `nota-fiscal` | família, local de estoque |
| `relatorio-movimentacao` (modo operação) | produto (texto), família, tipo, período |
| `relatorio-indicadores` | produto (texto), família, local de estoque |
| `auditoria-fiscal` | produto (texto), família, fornecedor (texto), local de estoque |
| `relatorio-margem` | local de estoque |
| `relatorio-faturamento` | produto (texto), local de estoque |
| `relatorio-compras` | produto (texto), local de estoque |
| `validade` | local de estoque |

`produto` (catálogo) e `relatorio-estoque-valorizado` não entram — já têm
todos os filtros relevantes.

## Arquitetura (sem novidade — replicação de padrão existente)

Cada tela já declara um array `campos: CampoFiltro[]` passado pro componente
`FiltrosGaveta`, e lê os valores via `searchParams`. Para cada filtro novo:

1. Adicionar o campo correspondente ao tipo de `searchParams` da página.
2. Adicionar a entrada em `campos` (`{ tipo: 'texto'|'select', nome, label }`,
   com `opcoes` vindo de uma fonte já existente no código — ver "Fontes de
   dados" abaixo).
3. Adicionar o `.eq()`/`.ilike()`/`.in()` correspondente na query do servidor.

### Fontes de dados por tipo de filtro (todas já existem, nenhuma nova)

- **Produto (texto livre)**: mesma lógica de busca já usada em
  `ordem-producao`/`nota-fiscal` — `ilike` em `descricao`/`c_descricao_produto`
  (o nome exato da coluna varia por tabela-fonte de cada tela; usar a coluna
  de descrição de produto já referenciada na query existente daquela tela).
- **Família**: já existe uma função/RPC de busca de famílias (usada em
  `produto`/`nota-fiscal`) — reaproveitar a mesma.
- **Local de estoque**: tabela `locais_estoque`, mesmo componente/padrão já
  usado no filtro de local que já existe em `movimentacoes` (aba Movimentos)
  e `transferencia`.
- **Fornecedor (texto)** em `auditoria-fiscal`: mesma fonte que `nota-fiscal`
  e `relatorio-compras` já usam.
- **Tipo**: já é um enum fixo (`tipo_item`) usado em várias telas — reusar a
  mesma lista de opções já declarada em algum lugar do código (não há uma
  função central; cada tela que já tem esse filtro declara a lista inline —
  copiar dessas).
- **Período (data início/fim)**: mesmo componente `CampoFiltro` tipo `'data'`
  já usado em quase todas as telas.

## Testes

Sem suite automatizada neste repo (confirmado). Verificação manual por tela,
via Playwright + a conta QA já estabelecida (`claude.qa@ntb-estoque.dev`):
abrir cada tela, aplicar cada filtro novo, confirmar que a URL reflete o
parâmetro e que a lista filtra de verdade (não só que o campo aparece).
