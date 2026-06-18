# NTB Estoque — MEGA PLANO de execução (17/06/2026)

> Plano de FASES consolidando os pedidos/bugs da reunião 17/06 (ver
> `2026-06-17-pedidos-reuniao.md`, seções VISÃO + A-O). Cada tarefa tem deliverable
> testável e é validada RODANDO no navegador antes de dar por pronta.

**Goal:** Estabilizar os bugs e entregar os pedidos da reunião, preparando o sistema pra
substituir o Omie no futuro (banco = fonte da verdade).

**Constraints globais:** custo zero (free tier) · commit no branch `joaquim/plano-omie-15-06`
→ merge `main` → push · ver a UI rodando antes de concluir · testes de escrita no Omie =
criar+excluir · sem travessão · assinar "Joaquim Salles" · histórico rolling 12 meses.

---

## FASE 0 — Estabilizar bugs (faz primeiro: trava o uso real)
| # | Tarefa | Onde (provável) | Validação |
|---|---|---|---|
| 0.1 ✅ | Etiqueta: nunca imprimir 0; default 1 quando vazio | geração de etiqueta / impressão | gerar etiqueta sem nº → sai 1 |
| 0.2 ✅ | Unidade de medida + quantidade zero ao add produto | OP/transf/inventário (ProdutoSearch + linha do item) | add produto → unidade aparece, qtd começa 1 |
| 0.3 ✅ | Transferência não "volta"/zera o produto | `lib/actions/transferencia.ts` + tela contagem | transferir → produto fica, não some no refresh |
| 0.4 ✅ | Inventário trava em "Iniciado" | fluxo de envio do inventário | item com erro não trava os outros |
| 0.5 ✅ | Cabeçalho fixo (sticky) das tabelas (eu removi) | `ui-kit/Lista.tsx`, `DataTable.tsx` | rolar → cabeçalho fica cravado + cantos curvos |
| 0.6 | CMC/estoque negativo: sinalizar | tela produto/posição | produto negativo aparece sinalizado |
| 0.7 | Estoque mínimo sumindo | sync/tela produto | mínimo aparece em todos |
| 0.8 ✅ | Sugestão de preço só com preço de venda | `app/(app)/produto/page.tsx` | sem preço de venda → sem sugestão |
| 0.9 ✅ | NF por loja (investigar vs Omie) | `db.mjs` + sync NF | confirmar se falta mês real ou é tela |

## FASE 1 — Operação (inventário/transferência + movimentações + OP)
| # | Tarefa | Onde | Validação |
|---|---|---|---|
| 1.1 ✅ | Inventário/transferência: **envio item-a-item** (sai do campo→envia; mexeu→reprocessa; erro passa adiante) | ContagemInventario/Transferencia + actions | lançar item → integra na hora |
| 1.2 | Inventário: editar/excluir item + imprimir da lista | tela inventário | editar item finalizado; imprimir direto |
| 1.3 | Movimentações: **filtros completos** (tipo mov, rejeito, PDV, local, família, origem) | `app/(app)/movimentacoes` | cada filtro funciona |
| 1.4 | Movimentações: **valor (R$) x quantidade** alternável + por mês/data | idem | alternar valor/qtd; agrupar por mês |
| 1.5 | OP: **reverter** (concluída) + **excluir** (aberta) | varredura Omie + action OP | reverter/excluir testado (criar+limpar) |
| 1.6 | Botões rápidos de status (Concluídos/Pendentes) em cima da tabela | OP/inventário/transf | 1 clique filtra |

## FASE 2 — UI / polimento + exportação
| # | Tarefa | Onde | Validação |
|---|---|---|---|
| 2.1 | Scroll customizado (estilizado, fino) global | globals.css / shell | scroll bonito em todas as telas |
| 2.2 | Produtos selecionados mais finos/compactos | listas de seleção | linhas mais finas |
| 2.3 | Busca de produto melhor (OP/transf/inventário) | `ProdutoSearch` + action | busca rápida/inteligente |
| 2.4 | Exportar **PDF bonito** + escolher conteúdo pelos filtros antes | rotas de impressão/export | filtra → escolhe → PDF só com aquilo |
| 2.5 | Exportar **Excel (.xlsx) lindo** (não CSV) | export + lib xlsx | planilha formatada |
| 2.6 | NF: total do período no topo (nº notas) | tela NF | mostra "N notas de X a Y" |

## FASE 3 — Cadastros + estrutura de produto
| # | Tarefa | Onde | Validação |
|---|---|---|---|
| 3.1 | **Estrutura de produto (BOM)**: itens, kg, rendimento, ver consumo | cadastro produto + Omie (malha) | cadastrar ficha; ver consumo na OP |
| 3.2 | Cadastro de **fornecedor** (+ puxar do Omie) | nova tela/cadastro | criar/listar fornecedor |
| 3.3 | Cadastro de **família** | nova tela/cadastro | criar/listar família |
| 3.4 | Cadastro de **cliente** + CEST | nova tela/cadastro | criar/listar |
| 3.5 | **Endereço das lojas** (+ puxar do Omie) | cadastro de loja | informar/puxar endereço |
| 3.6 | **SINTEGRA**: puxar cadastros por CNPJ | nova tela | puxar produto/cliente/fornecedor |

## FASE 4 — Usuários / permissões / onboarding
| # | Tarefa | Onde | Validação |
|---|---|---|---|
| 4.1 | Permissões granulares por módulo ao criar usuário | tela usuário + auth | escolher permissões |
| 4.2 | Esconder do menu o que não tem permissão | shell/NavItems + auth | menu só mostra o permitido |
| 4.3 | Esconder seletor de loja p/ quem só tem 1 (mostrar só o nome) | shell | 1 loja → sem dropdown |
| 4.4 | **Admin por loja** (multi-admin, mais logins) | auth/perfis | cada loja com seu admin |
| 4.5 | **Onboarding por código de loja** (alinhar c/ André 18/06) | fluxo de cadastro/login | código → perfil → loja → login |
| 4.6 | Visual do cadastro de usuário (tá feio) | tela usuário | UI revisada |

## FASE 5 — Relatórios + independência do Omie
| # | Tarefa | Onde | Validação |
|---|---|---|---|
| 5.1 | Relatórios (Bloco 7): agregações + gráficos + PDF/Excel | novo módulo | relatórios saem certos |
| 5.2 | Preparar independência do Omie (banco = fonte da verdade) | arquitetura | cadastros/histórico próprios completos |

## Ordem recomendada
FASE 0 (inteira) → 1.1/1.2 (inventário/transf) → 1.3/1.4 (movimentações) → resto da 1 →
FASE 2 → FASE 3 → FASE 4 (depende do André) → FASE 5.
