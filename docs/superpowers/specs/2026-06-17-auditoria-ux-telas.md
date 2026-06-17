# Auditoria de UX — filtros e tabelas, tela por tela (17/06/2026)

Base: inventário real das telas + boas práticas (presets de data, tabelas densas, chips de
filtros ativos, busca com debounce, estados vazios). Foco: uso real de restaurante (operação),
não data analyst — evitar overkill.

## Melhorias TRANSVERSAIS (1 componente, valem em várias telas) — MAIOR GANHO
- **A. Presets de data** no FiltrosGaveta: botões "Hoje · 7 dias · Este mês · Mês passado · Este ano"
  além do calendário. Hoje só tem calendário manual (chato de usar todo dia). Afeta: nota-fiscal,
  ordem-producao, transferencia, inventario, movimentacoes, impressoes. **TOP prioridade.**
- **B. Chips de filtros ativos** acima da tabela + "Limpar tudo". Hoje os filtros ficam escondidos
  na gaveta; o usuário não vê o que está aplicado. Afeta TODAS as telas com filtro.
- **C. Resumo/totais no topo** da tabela (atualiza com o filtro): NF → soma R$; movimentações →
  total entradas/saídas; OP → contagem por status. Hoje a tabela é "conteúdo cru" sem síntese.

## Tela por tela (opinião: 🔴 melhorar / 🟡 pode / 🟢 ok)
| Tela | Filtros hoje | Diagnóstico |
|---|---|---|
| **validade** | só `tipo` | 🔴 **pobre**. Falta data range, família, busca por produto. |
| **movimentacoes** | data + produto | 🔴 falta família, tipo, **totais (entra/sai)**, ordenar por + movimentado. |
| **nota-fiscal** | 7 filtros | 🟡 rico; falta presets de data, chips, **soma R$ no topo**. |
| **ordem-producao** | 7 filtros (já ordena) | 🟡 rico; falta presets, chips, contagem por status. |
| **transferencia** | 6 filtros | 🟡 bom; falta presets, chips. |
| **inventario** | 5 filtros | 🟡 bom; falta presets, chips. |
| **produto** | q, família, tipo, situação | 🟡 bom; falta ordenar por preço/margem/saldo, chips. |
| **impressoes** | data + origem | 🟢 ok (+ presets vêm de graça do item A). |
| **home** (dashboard) | nenhum | 🟢 ok; no futuro um seletor de período global. |
| **local-estoque** | situação (chips) | 🟢 ok (cadastro simples). |
| **sync-status** | dias, model | 🟢 ok (técnico). |
| **log** | 6 filtros | 🟢 ok (técnico/admin). |
| **loja** / **usuario** | nenhum | 🟢 ok (poucos registros, admin). |

## Minha opinião — o que VALE e o que NÃO
**Vale muito (alto impacto, custo baixo, centralizado):**
1. Presets de data (A) — 1 componente, melhora 6 telas de uma vez.
2. Chips de filtros ativos + limpar tudo (B) — 1 componente, todas as telas.
3. Consertar **validade** e **movimentacoes** (os 2 filtros pobres).

**Vale (médio):**
4. Totais/resumo no topo (C) nas 3 tabelas principais (NF, movimentações, OP).
5. Ordenação por coluna onde falta (produto, movimentações).

**NÃO precisa mexer (deixar como está):** loja, usuario, sync-status, log, local-estoque, home.
**Overkill pro caso deles (descartar):** densidade ajustável, reordenar colunas drag-drop, scroll
infinito, salvar preferências de coluna por usuário. É restaurante, não BI.

## Ordem de execução proposta
1. Presets de data (A) no FiltrosGaveta — destrava 6 telas.
2. Chips de filtros ativos (B).
3. validade + movimentacoes (filtros pobres).
4. Totais no topo (C) + ordenação faltante.
5. → depois disso, começar os RELATÓRIOS (Bloco 7).
