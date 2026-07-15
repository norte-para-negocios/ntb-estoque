# Fase A: melhorias pós-reunião 2026-07-14

Reunião de ~55min entre Ramon (opera o app nas lojas reais Donana Rio
Vermelho e Vinhas & Vinhetos) e Joaquim, testando ao vivo o NTB Estoque.
Transcrita via `/etl-audio`. Lista completa de achados em
`AGENTS.md` ("Reunião com o Ramon de 2026-07-14"). Este spec cobre só a
**Fase A** (itens rápidos, independentes) — os 4 relatórios financeiros
(Margem, Faturamento, Auditoria Fiscal, Compras) formam uma Fase B
separada, deixada pro final por decisão explícita do usuário, e não estão
neste spec.

## Escopo

1. Renomear coluna "Comprar" → "Repor" em `produto/page.tsx`.
2. Renomear campo de quantidade na Ordem de Produção → "QTD Etiqueta".
3. Janela de previsão de reposição editável (1 semana / 15 dias / 1 mês).
4. Triangulação: previsão de produto sem histórico via substituto cadastrado manualmente.
5. Clareza visual "origem → destino" no relatório de Transferências.
6. Link produto → tela de Movimentos, a partir de relatórios que listam produto por linha.
7. Tooltip no nome de produto truncado em listas de OP.

Fora de escopo (confirmado com o usuário): OP em lote de 4 (já corrigido
no commit `a71c168`, 2026-07-14 — este spec só cobre validar que resolveu,
não reimplementar) e qualquer coisa relacionada aos 4 relatórios
financeiros (Fase B).

## 1. Renomeações (sem desenho — mudança direta de string)

- `app/(app)/produto/page.tsx:592`: `label: 'Comprar'` → `label: 'Repor'`.
- Campo de quantidade na Ordem de Produção (tela/formulário de OP, achar
  via grep por `Quantidade OP` ou label equivalente): renomear pra
  "QTD Etiqueta", mesmo texto já usado em
  `components/minha-loja/EtiquetaEditor.tsx:40` ("Qtde Etiqueta").

## 2. Validar fix de OP em lote (sem código novo)

`lib/actions/ordem-producao.ts:779-821` já limita a 4 chamadas
simultâneas ao Omie (`CONCORRENCIA_OMIE = 4`), corrigido no mesmo dia da
reunião. Ação: pedir pro Ramon testar de novo selecionando um lote grande
de OPs atrasadas e confirmar que não trava mais a aba. Sem mudança de
código a menos que ele reproduza o problema de novo.

## 3. Janela de previsão editável

**Situação atual:** `lib/omie/previsao-venda.ts:20-24` calcula só uma
janela fixa de 7 dias, comparando com o mesmo período um ano atrás
(confirmado com o usuário que essa base de comparação — ano anterior, não
semana anterior — está correta e não muda). O cálculo roda via
`app/api/cron/sync-previsao/route.ts`.

**Design:** o cron passa a calcular as **3 janelas de uma vez** por
produto (7 dias / 15 dias / 30 dias), sempre comparando com o mesmo
período um ano atrás, e persiste os 3 valores (3 colunas novas ou uma
struct/jsonb, a decidir na hora de mexer no schema real). Na tela de Repor
(`produto/page.tsx`), um seletor (abas ou dropdown: "1 semana" / "15 dias"
/ "1 mês") troca só qual coluna já calculada é exibida — sem recalcular
na hora, instantâneo pro usuário.

**Por quê pré-calcular em vez de sob demanda:** o cron já roda
periodicamente; calcular 3 janelas em vez de 1 é barato comparado ao
custo de puxar dado da API do Omie a cada troca de seletor na tela.
Decisão do usuário, confirmada explicitamente.

## 4. Triangulação (produto substituto)

**Problema:** produtos que trocaram de marca/fornecedor (ex.: Heineken
descontinuado, substituído por Spaten; Coca-Cola por Pepsi) não têm
histórico de venda próprio no período comparado, então a previsão fica
zerada/ausente mesmo o produto sendo vendido normalmente (só que sob outro
nome/SKU).

**Design:** mapeamento manual 1:1, não agrupamento automático por
família (decisão do usuário — mais preciso pro caso real de troca
pontual de fornecedor do que uma heurística automática).

- Nova tabela `produto_substituicoes` (migration nova): `id`,
  `produto_id` (o produto atual, sem histórico), `substitui_produto_id`
  (o produto antigo cujo histórico deve ser usado), `loja_id`,
  `created_at`. Um produto tem no máximo um substituto (constraint
  única em `produto_id` por loja).
- Tela de administração simples (buscar dois produtos por nome, vincular)
  — local exato a decidir no plano de implementação (provavelmente perto
  de Cadastros/Produtos, seguindo o padrão de telas admin já existentes
  no app).
- `previsao-venda.ts`: ao calcular a previsão de um produto, se não houver
  venda própria no período comparado E existir uma linha em
  `produto_substituicoes` pra esse produto, usar o histórico do
  `substitui_produto_id` no lugar do produto atual pro cálculo.

## 5. Transferências — clareza origem → destino

**Atual:** `app/(app)/transferencia/page.tsx:267-271` renderiza
`{origem} {' → '} {destino}` como texto plano.

**Design:** badge/cor diferenciando origem (cinza) de destino (verde),
com ícone de seta entre eles — mudança puramente visual, mesmo dado,
sem tocar lógica de negócio.

## 6. Link produto → Movimentos

`app/(app)/movimentacoes/page.tsx` já aceita filtro `?produto=` (linha
~21, ~44) — a plumbing já existe, só falta o link de origem. Envolver o
nome do produto (em `relatorio-compras`, `relatorio-margem`,
`auditoria-fiscal` — os relatórios que listam produto por linha) num
`Link` do Next pra `/movimentacoes?produto=<nome do produto>`.

## 7. Tooltip em nome de produto truncado

`components/ordem-producao/OrdemProducaoRow.tsx:631,786,865` truncam
`op.produto` com `className="truncate"` mas sem atributo `title` (ao
contrário de `auditoria-fiscal/page.tsx:224` e
`relatorio-movimentacao/page.tsx:292`, que já têm). Adicionar
`title={op.produto}` nesses 3 pontos. O sintoma relatado na reunião
("abre link novo em vez de mostrar o nome") não foi reproduzido no código
— nenhum `<a>`/`Link`/`window.open` envolve o nome do produto nesses
locais. Depois de adicionar o tooltip, pedir pro Ramon confirmar se o
"abrir link novo" ainda acontece (pode ser em outra tela não identificada
ainda).

## Testes

Cada item é pequeno e independente — testar manualmente cada tela
afetada após a mudança (não há necessidade de suite de testes automatizada
nova para mudanças de rótulo/link/tooltip). O item 4 (triangulação) e o
item 3 (janela editável) merecem um teste manual mais deliberado: cadastrar
uma substituição de teste e confirmar que a previsão do produto sem
histórico passa a refletir o histórico do substituto; trocar o seletor de
janela e confirmar que os 3 valores pré-calculados aparecem certos.
