# Faturamento por dia + relatório Meta × Realizado

Data: 2026-10-08 · Origem: pedido do cliente (Ramon) · Classificação: arquitetural

## Objetivo

1. O relatório de Faturamento só mostra o acumulado por mês. O cliente precisa ver **cada dia**.
2. Novo relatório comparativo: o cliente define a **meta diária** de faturamento, escolhe um período (dia, semana ou mês) e vê se bateu a meta, quanto foi cada dia, média, melhor e pior dia.

## Premissas (confirmadas pelo usuário ao aprovar o design)

- Uma meta diária única por loja (sem meta por dia da semana).
- Edita a meta quem já tem `getAtorGestao().podeGerir`.
- "Bateu a meta" = faturamento do dia >= meta diária. Cupom cancelado e devolvido não entra, igual ao relatório atual.
- Meta do período = meta diária × número de dias do período.

## Situação atual (achados no código)

- `lib/faturamento-frio.ts`: `buscarFatAgregado({ group: 'dia' })` já existe e a API fria aceita agrupar por dia, mas `app/(app)/relatorio-faturamento/page.tsx` só usa a visão mensal (matriz dimensão × mês).
- Lojas de estoque próprio: `app/(app)/relatorio-lucro/` já tem dia a dia (`lucro_proprio` com `dim='dia'`, componente `EvolucaoDiaria`).
- `app/(app)/relatorios/page.tsx` lista os relatórios por grupo; o grupo "Faturamento" recebe o novo item.

## Parte A: Faturamento por dia

- Seletor "Mensal | Diário" na página `/relatorio-faturamento`. Modo padrão continua Mensal.
- Modo Diário:
  - Lojas Omie: `buscarFatAgregado({ group: 'dia' })`.
  - Lojas de estoque próprio: `lucro_proprio(dim='dia')`, só a coluna faturamento.
  - Respeita o período (chips e datas personalizadas) e o filtro de Situação já existentes.
- Saída: gráfico de barras diárias (reaproveita `EvolucaoDiaria`, com a série de lucro opcional) e tabela dia a dia.
- Export CSV (`export/route.ts`) ganha o mesmo modo.
- Extrair a busca diária numa função única (`lib/faturamento-diario.ts`) que decide a fonte por modo da loja (`modoDaLoja`). A Parte B usa essa mesma função.

## Parte B: Relatório Meta de faturamento

- Rota `/relatorio-meta`, item novo no grupo "Faturamento" de `/relatorios`. Pergunta do card: "Bati a meta?".
- Dados:
  - Tabela `metas_faturamento (loja_id int primary key, valor_diario numeric not null check (valor_diario >= 0), atualizado_em timestamptz default now(), atualizado_por uuid)`.
  - RLS por `loja_id`, no mesmo padrão das tabelas das fases 2a/2b.
  - Migration numerada a partir do último número em `supabase/migrations/`.
- Período: atalhos Hoje, Esta semana, Este mês e Personalizado. Fuso `America/Bahia` (`hojeBahiaISO`).
- Cálculo (função pura em `lib/meta-faturamento.ts`):
  - entrada: série diária `{dia, valor}[]`, meta diária, intervalo;
  - dias sem venda dentro do intervalo entram com valor 0;
  - saída: total realizado, meta do período, % atingido, média diária, melhor e pior dia, dias que bateram / total de dias, e por dia a diferença contra a meta.
- Tela:
  - campo de meta diária no topo (salvar por server action, validando >= 0);
  - cards com os totais acima;
  - barras diárias com linha da meta;
  - tabela dia a dia com marca de bateu ou não e diferença em R$.
- Sem meta cadastrada: estado vazio pedindo para informar a meta, sem erro.
- Export CSV da tabela dia a dia.

## Erros e casos de borda

- Falha na API fria: mostrar aviso (padrão `onTruncado` / mensagens já usadas nos outros relatórios), nunca mostrar zero como se fosse dado real.
- Dia de hoje ainda incompleto: marcado como "em andamento" e fora de "dias que bateram" e da média.
- Período com mais de 366 dias: limitar e avisar.
- Loja sem nenhuma venda no período: estado vazio.

## Fora de escopo

- Meta por dia da semana, por família ou por mês.
- Notificação ou alerta quando a meta não for batida.
- Comparação entre lojas.

## Verificação

O projeto não tem testes automatizados. A função pura de `lib/meta-faturamento.ts` ganha testes unitários (a primeira do projeto, isolada). No resto:

- a soma dos dias do modo Diário deve bater com o total mensal já exibido, em uma loja Omie e uma de estoque próprio;
- conferir o banco-alvo da migration no `.env.local` do deploy e aplicar nos dois bancos (Supabase e Contabo);
- abrir as telas no navegador (desktop e mobile) e conferir o export CSV;
- deploy manual com `deploy.sh`, depois de testado (push não atualiza a produção).

## Ordem de entrega

1. Parte A (fonte de dado diário e visão Diário), com deploy.
2. Parte B (migration, cálculo, tela, export), com deploy.
