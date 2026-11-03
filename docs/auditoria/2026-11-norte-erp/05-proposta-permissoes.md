# Proposta: permissões que hoje não chegam a nenhum cargo

Fonte: leitura do banco de produção em 03/11/2026 (`permissoes`, `cargos`, `cargo_permissao`). Nada foi gravado.
Migration `supabase/migrations/310_permissoes_nos_cargos.sql` **escrita e não aplicada**; depende do OK do dono a esta tabela.

## Situação
- 79 permissões; **57** não estão em nenhum cargo (a auditoria contou 56). Cargos padrão: Gerente 22, Estoquista 9, Conferente 5.
- O cargo é lido na hora (`lib/auth.ts`), então aplicar a 310 vale na hora, sem mexer nos usuários.
- Admin e AdminLoja já passam em tudo; esta proposta só muda o que um funcionário com cargo padrão enxerga.
- Várias telas (Compras, Financeiro, NF-e de saída) continuam travadas por `ROTAS_SO_DEV`/flags; dar a permissão não as liga sozinha.
- Regra da migration 046 mantida: **Gerente = sem a parte de cadastro** (Produtos, Famílias, Fornecedores, Locais e as importações de planilha).

## Resumo (o que a 310 acrescenta)
| Cargo | Hoje | Acrescenta | Fica com |
|---|---|---|---|
| Gerente | 22 | 27 | 49 |
| Estoquista | 9 | 8 | 17 |
| Conferente | 5 | 3 | 8 |

Permissões que passam a ter cargo: 27 (as do Estoquista e do Conferente são subconjunto das do Gerente).
Continuam só com Admin/AdminLoja: **30** = 22 de cadastro + 8 sensíveis (abaixo).

## Gerente (+27): operação, compras, notas, financeiro de leitura e lançamento
| Permissão | Por quê |
|---|---|
| Movimentacoes - Criar | lançar movimento do dia a dia; hoje ele vê a tela e não cria |
| Categorias Contabeis (acesso) | classificar nota/compra; só ver, não editar |
| Produto Substituicoes (acesso, Criar, Excluir) | operação de ficha/insumo, não é cadastro de produto |
| Notas Fiscais - Manifestar, Manifestar na SEFAZ, Reverter | rotina de nota de entrada |
| Compras (8: acesso, Criar, Pedidos, Aprovar pedidos, Sugestao, Requisicoes, Devolucao ao fornecedor, Emitir NF-e) | gerente responde pelas compras da loja |
| Estoque - Lancar no Omie, Fichas - Trocar insumo, OP - Acoes em lote, Correcoes - Executar | operação nas lojas em modo Omie e Central de correções (cada uma ainda exige a permissão de sempre da ação) |
| Fechamento - Fechar mes, Contador - Pacote | fechamento mensal e entrega ao contador |
| Anexos - Enviar, Anexos - Excluir | anexo de nota/compra, risco baixo |
| Transferencias - Entre lojas | gerente move estoque entre lojas |
| Financeiro - Contas a pagar, Contas correntes | ver e lançar contas (cobre editar/cancelar); sem pagar |

## Estoquista (+8): estoque, inventário, transferência, movimentação, OP
Movimentacoes - Criar; Ordens de Producao (acesso, Criar, Editar, Concluir); Estoque - Lancar no Omie; Transferencias - Entre lojas; Anexos - Enviar.
Fora: excluir/reverter OP, compras, notas, financeiro.

## Conferente (+3): notas e recebimento
Notas Fiscais (só ver), Compras (só acessar, sem Criar), Anexos - Enviar. Continua sem permissão de escrita em estoque.

## Ficam só com Admin/AdminLoja (30)
| Permissão | Por quê |
|---|---|
| Cadastros: Produtos, Locais de Estoque, Familias, Fornecedores (acesso, Sincronizar, Criar, Editar, Excluir) + Produtos/Fornecedores - Importar planilha (22) | regra da 046 (Gerente sem cadastro); mudar é decisão do dono |
| Notas Fiscais - Excluir | apaga nota, destrutivo |
| Estoque - Corrigir custo | mexe no custo médio e no CMV |
| Fechamento - Reabrir mes | reabre período contábil fechado |
| Financeiro - Contas a pagar - Pagar | movimenta dinheiro |
| Financeiro - Categorias | estrutura do DRE |
| Categorias Contabeis - Criar/Editar/Excluir | cadastro contábil |

## Decisões que o dono pode inverter antes de aplicar
1. Gerente com cadastro de produto/local/família/fornecedor (fora por desenho da 046; sem isso nenhum cargo vê a lista de Produtos).
2. Gerente com Financeiro - Pagar e Fechamento - Reabrir mes.
3. Estoquista concluindo OP (mexe no estoque; incluído porque o plano pede OP para ele).

Para tirar ou pôr uma linha: editar a lista `desejo` da migration 310 (e `SO_ADMIN` em `lib/permissoes-cargos.test.ts` se algo ficar de fora).
