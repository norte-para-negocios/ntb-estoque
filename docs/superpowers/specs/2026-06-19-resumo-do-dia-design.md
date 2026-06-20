# Resumo do dia — painel gerencial (design)

Data: 2026-06-19 · Ideia do fundador (reunião pós-18/06).

## Objetivo
Aba gerencial que mostra, para um **dia escolhido**, os **números do dia** + um **feed de quem fez o quê**, com botão de **PDF**. Para admin geral (todas as lojas) e admin de loja (só a dele).

## Acesso
- Rota `/resumo` no grupo **Administração** do menu.
- Visível/acessível para **admin global** OU **admin de loja** (mesma regra da gestão de usuários: `isAdmin || podeGerirUsuarios`). Usuário comum não vê.
- Admin global: pode escolher a loja ou "Todas" (consolidado). Admin de loja: escopo fixo nas lojas dele.

## Arquitetura (escolhida: consulta ao vivo)
Página RSC (`app/(app)/resumo/page.tsx`) que consulta as tabelas existentes filtrando por data + loja. **Sem** audit log novo, **sem** migration, **sem** backfill — os dados já têm `user_id` e timestamp. Volume baixo (dezenas de ações/dia por loja) torna as queries baratas. Funciona para qualquer dia passado imediatamente.
> Alternativas descartadas: tabela de eventos central (over-engineering, exige instrumentar todas as actions); híbrido (deixar para quando crescer).

## Janela do dia (fuso)
O "dia" é em **America/Bahia (UTC-3)**. Para um dia D, o range UTC é `[D 03:00Z, D+1 03:00Z)`. Helper converte D (YYYY-MM-DD) para esse range e filtra os timestamps.
- **Atividade da equipe** (feed + contagens de ações feitas no app): filtra por `created_at`/`updated_at` (quando a pessoa fez a ação no sistema).
- **Movimentações do Omie** (entradas/saídas): filtra pela `data` do movimento (data contábil do Omie).

## Layout
```
┌ Resumo do dia ──────────  [◀ data ▶]   [Loja: Todas ▾]   [PDF] ┐
│ NÚMEROS DO DIA (cards)                                          │
│ [Transferências] [Inventários] [OPs · concluídas]              │
│ [Movimentações: entradas/saídas] [Etiquetas] [Erros Omie]     │
│ ATIVIDADE (quem fez o quê, mais recente no topo)               │
│  14:32 João  criou transferência ADEGA→BAR   Concluída         │
│  14:10 Maria contou inventário COZINHA       Em contagem        │
│  13:50 João  concluiu OP 2026/00123 (4 kg)                     │
│  13:20 Maria imprimiu 12 etiquetas                              │
│ (admin geral) POR LOJA: Rio Vermelho 8 · Vilas 4 · ...         │
└─────────────────────────────────────────────────────────────────┘
```

## Fontes de dados
| Item | Tabela | Filtro do dia | Quem fez |
|---|---|---|---|
| Transferências | `transferencias` | created_at | user_id → profiles.name |
| Inventários | `inventarios` | created_at | user_id → profiles.name |
| OPs criadas / concluídas | `ordens_producao` | created_at / dt_conclusao_real | carimbo (tenta extrair; senão sem nome) |
| Movimentações (entra/sai) | `movimentos` | data | — (anônimo, vem do Omie) |
| Etiquetas impressas | `impressao_etiquetas` | created_at | user_id se houver |
| Erros de integração | `integration_attempts` | created_at, error=true | — |

## Feed
União de eventos (transferência criada, inventário criado/finalizado, OP concluída, lote de etiquetas) ordenados por horário desc. Cada item: hora · pessoa · ação · local/alvo · status. Loja exibida quando escopo = Todas.

## PDF
Botão "PDF" gera o relatório do dia reusando o motor existente (`lib/pdf-utils` + componentes `components/relatorio/*`): cabeçalho (loja/data), bloco de números, tabela do feed. Nome de arquivo `resumo-<loja>-<data>.pdf`.

## Limitação honesta
Movimentações de estoque (entradas/saídas) vêm do Omie e são **anônimas** — entram nos números, não no feed de pessoas. O feed cobre o que é feito **dentro do app**.

## Fora de escopo (YAGNI)
- Audit log/event sourcing central.
- Tempo real / auto-refresh (recarregar a página basta).
- "Pendências do dia" (o que falta) — só o que foi feito. Pode entrar depois.
- Gráficos/tendências entre dias.

## Critérios de aceite
- Aba "Resumo do dia" aparece só para admin global/loja, escopada por loja.
- Trocar a data muda os números e o feed daquele dia.
- Números batem com a realidade (conferir contra o banco em um dia com dados).
- Feed mostra nome + ação + local + hora; admin global vê a loja.
- PDF do dia gera e abre.
- Verificado ao vivo (print) num dia com atividade.
