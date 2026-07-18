# Drill-down nos relatórios + fim dos rótulos opacos

Pedido do usuário (2026-07-18): "melhore tudo o que você puder melhorar nessa
questão dos relatórios: pegar os dados, botar não outros, o que são outros, o
que é classificado, clicar para ver". Decisões tomadas no brainstorm:

- Drill **nível a nível até o item individual** (onde o dado permite).
- "Sem classificação"/"Outros": ver o que tem dentro **+ tela de pendências**
  (correção continua sendo feita no Omie; o app mostra exatamente o quê).
- Faturamento desce **até produto** (cupom individual fica de fora — o app não
  guarda itens de cupom e não vamos mudar a ingestão pra isso).
- Navegação: **mesma página, trilha na URL** (breadcrumb, link compartilhável),
  padrão SSR + searchParams do app inteiro.

## 1. Modelo de navegação (comum a todos os relatórios)

Parâmetro `drill` na URL com a trilha em pares `dimensao:rotulo` separados por
`|` (URL-encoded): `/relatorio-compras?drill=familia:CARNES|produto:PICANHA`.

- Breadcrumb no topo: `Compras › CARNES › Picanha`, cada segmento clicável
  (volta pra aquele nível), mais um "✕ limpar".
- Cada nível da trilha vira filtro da consulta do nível seguinte; a dimensão
  exibida é a próxima da cadeia daquele relatório.
- Filtros da `FiltrosGaveta` continuam aplicando em TODOS os níveis (drill e
  filtro são ortogonais; o drill só acrescenta restrições).
- Linha de matriz/tabela vira `<Link>` que appenda o próximo par ao `drill`.
- Componente novo (único): `components/ui-kit/DrillBreadcrumb.tsx` — server
  component que recebe `basePath`, os pares e os searchParams atuais e
  renderiza a trilha preservando os demais parâmetros.
- Parser/serializer compartilhado: `lib/drill.ts` com
  `parseDrill(valor?: string): {dim: string; rotulo: string}[]` e
  `appendDrill(sp: URLSearchParams, dim: string, rotulo: string): string`.
  Rótulos passam por `encodeURIComponent` (têm `|`, `:` e acentos).

## 2. Cadeias por relatório

### Compras (`relatorio-compras`)
- Cadeia: dimensão atual (familia | tipo | fornecedor | cfop) → **produto** →
  **itens**. Se a dimensão atual já é produto, clique vai direto pra itens.
- Nível "itens": tabela com data, NF, fornecedor, produto, CFOP entrada,
  valor — via RPC `relatorio_compras_detalhe`, que ganha `p_produto text
  default null` e `p_local bigint default null` (migration 077, espelhando a
  075; mesmas condições ilike/JSON-path).
- Rótulo clicado vira o filtro correspondente da RPC no nível seguinte
  (`p_familias:[rotulo]`, `p_tipos`, `p_fornecedor`, `p_cfops`, `p_produto`).
- "Sem classificação" clicado → nível seguinte com filtro "valor nulo":
  `p_familias: null` NÃO serve — precisa de um marcador. Solução: valor
  sentinela `__sem__` no par de drill; as RPCs ganham a convenção
  `'__sem__' = any(p_familias)` → condição `p.descricao_familia is null`
  (idem `p_tipos` → `p.tipo_item is null`, `p_cfops` → `cfop_entrada is
  null`, `p_fornecedor = '__sem__'` → `coalesce(nf.c_razao_social,
  nf.c_nome) is null`). Incluído na migration 077 (altera as 4 funções
  `relatorio_compras_*` de uma vez, drop+recreate como nas migrations
  065/067/075) e replicado nas 2 de auditoria SE o rótulo nulo aparecer lá
  (cfop_entrada null já aparece — cobrir).

### Auditoria Fiscal (`auditoria-fiscal`)
- Já tem CFOP → itens; muda só a UX: o clique passa a usar o mesmo `drill`/
  breadcrumb (substitui o parâmetro `cfop` atual — manter compat lendo `cfop`
  antigo como alias por uma versão).
- Os itens já respeitam os filtros novos (produto/família/fornecedor/local,
  migration 076) — nada de SQL novo.
- Categoria "Outros" de CFOP: tooltip com a descrição do CFOP (`lib/cfop.ts`
  já tem `descreverCFOP`) em toda célula de CFOP.

### Faturamento (`relatorio-faturamento`)
- Cadeia: tipo → família → produto (fim).
- A tabela `faturamento_importado` guarda dimensões paralelas sem cruzamento —
  pra descer é preciso gravar **dimensões compostas** na ingestão
  (`lib/omie/faturamento.ts`): além de `tipo`/`familia`/`produto`/`forma_pgto`,
  gravar `tipo>familia` (rotulo `"<tipo>>><familia>"`) e `familia>produto`
  (rotulo `"<familia>>><produto>"`). Separador literal `>>` (não aparece nos
  nomes do Omie). O delete de re-sync inclui as dimensões novas.
- Drill: clicou tipo X → consulta `dimensao='tipo>familia'`, filtra rotulos
  com prefixo `X>>`, exibe a parte depois do `>>`. Análogo pra família.
- RPCs `relatorio_faturamento_matriz`/`_opcoes` são agnósticas de dimensão —
  **sem migration**; o filtro de prefixo é feito em TS sobre o resultado
  (cardinalidade baixa) ou via `p_rotulos` quando exato.
- "Não classificado"/"Sem família"/"Produto não identificado" são rotulos
  normais nas dimensões compostas — drill funciona neles sem caso especial.
- Backfill: os agregados compostos só existem após o próximo sync — rodar o
  cron uma vez após o deploy (mesmo procedimento já usado pra dimensão
  produto). Meses de lojas sem re-sync ficam sem drill composto até o cron
  noturno rodar (aceitável, 1 dia).

### Relatório de Movimentação — modo operação
- Tudo em memória (a tela já carrega todas as linhas): cadeia
  dimensão-exibida → próxima dimensão da lista `familia → local → tipo_sped`
  (pulando a que já está na trilha), com cada nível filtrando as linhas.
  Sem nível de item (a tabela importada não tem produto — limitação já
  documentada no spec de filtros).
- "N/D" é rotulo normal — clicável igual.

### Relatório de Movimentação — modo quantidade
- Cadeia: tipo → produto e família → produto (produto é o fim; o relatório é
  de quantidades agregadas, o "item" aqui seria movimento diário — fora de
  escopo).
- Verificar na implementação se `relatorio_movimentacao_matriz` (migration
  066) já aceita filtro de família/tipo como parâmetro; se não aceitar,
  migration 078 adiciona (`p_familias text[]`/`p_tipos text[]` default null),
  espelhando em `agregarMovimentacaoJS`/caminho frio.

### Margem (`relatorio-margem`)
- Já é por produto (nível máximo do dado). Sem drill novo; mantém o link
  produto → Movimentações. Fora do escopo de drill.

## 3. Rótulos opacos explicáveis

- Renomear na exibição (não no dado): `Sem classificação` → "Sem cadastro de
  produto"; `Não classificado` (tipo, faturamento) → "Produto sem tipo";
  `Sem família` → "Produto sem família"; `Produto não identificado` →
  "Cupom sem produto vinculado"; `N/D` (mov. operação) → "Sem valor no BD".
  Mapa central em `lib/rotulos-opacos.ts`:
  `explicarRotulo(rotulo: string): {label: string; motivo: string} | null`.
- Toda linha com rótulo opaco: exibe o label claro + ícone ⓘ com tooltip
  (`title=`) do motivo + continua clicável pro drill (sentinela `__sem__`
  quando a origem é campo null).

## 4. Tela de pendências (`/pendencias-classificacao`)

Página nova, permissão de gestor (mesmo gate `getAtorGestao().podeGerir` dos
relatórios financeiros), card de entrada no hub `/relatorios`.

Três blocos, cada um com contagem, R$ associado e tabela dos casos:

1. **Produtos sem família** — `produtos` com `descricao_familia` null/'',
   ativos; colunas: código, descrição, tipo. R$: soma dos itens de NF desses
   produtos nos últimos 12 meses (Supabase + Contabo).
2. **Produtos sem tipo** — idem com `tipo_item` null/''.
3. **Itens de NF sem produto no cadastro** — `nota_fiscal_items` (12 meses,
   híbrido) com `n_id_produto` null OU sem linha correspondente em `produtos`;
   colunas: descrição do item, código na NF, fornecedor, nº de ocorrências,
   R$ total. É a lista exata do que gera "Sem cadastro de produto" em Compras.

Sem ação de escrita (correção é no Omie). Botão de export CSV por bloco
(mesmo padrão dos exports existentes).

## 5. Dados, migrations e híbrido

- Migration 077: `relatorio_compras_total/_dim/_matriz/_detalhe` — adiciona
  `p_produto`/`p_local` ao `_detalhe` (paridade com 075) e a convenção
  sentinela `__sem__` em `p_familias`/`p_tipos` nas 4.
- Migration 078 (condicional): filtros de família/tipo em
  `relatorio_movimentacao_matriz`, se ainda não existirem.
- **Espelhar tudo em `lib/relatorio-frio-nf.ts`** (regra do AGENTS.md): o
  sentinela `__sem__`, o filtro de produto/local no caminho de detalhe e as
  agregações de nível — o drill tem que funcionar em período que cruza os
  90 dias igual funciona dentro deles.
- `lib/omie/faturamento.ts`: dimensões compostas (item 2). Sem mudança no
  servidor Contabo.

## 6. Verificação

Sem suite automatizada. Playwright + conta QA (`claude.qa@ntb-estoque.dev`):

- Em Compras, Faturamento, Auditoria e Movimentação: navegar um drill
  completo (dim → ... → último nível), conferindo em cada descida que a soma
  das linhas do nível bate com o valor da linha clicada no nível acima.
- Repetir um drill de Compras com período cruzando os 90 dias (valida o
  espelho frio).
- Clicar num rótulo opaco ("Sem cadastro de produto") e conferir que o drill
  mostra conteúdo coerente.
- Abrir `/pendencias-classificacao` e cruzar: o R$ do bloco 3 tem que bater
  com a linha "Sem cadastro de produto" de Compras no mesmo período.
