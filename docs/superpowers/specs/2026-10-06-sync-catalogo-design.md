# Sincronização automática de loja e catálogo Vendas ↔ Estoque — Design

Escopo: lojas em modo `proprio`. Lojas `omie` e `nenhum` não mudam (continua o fluxo manual atual). Atende R5 e R6 do plano mestre.

## Princípios
1. **Sem passo manual.** Quem altera o catálogo num lado não precisa chamar nada: triggers no banco gravam num **outbox** e um worker/cron entrega ao outro lado. A UI não decide sincronizar.
2. **Idempotente e à prova de laço.** Toda escrita que chega do outro lado roda dentro de uma função SQL que liga `ntb.sync_skip=1` na transação; os triggers de outbox ignoram essas escritas (nada volta ao remetente).
3. **Nada some em silêncio.** Falha fica no outbox (`erro`, tentativas, próxima tentativa com backoff) e aparece na tela **Divergências da sincronização** de cada app; uma reconciliação periódica compara os dois catálogos inteiros e registra o que existe só de um lado.

## Modelo (mesma estrutura nos dois sistemas)
| Conceito | Estoque | Vendas |
|---|---|---|
| Grupo / subgrupo (árvore) | `grupos_produto(id, loja_id, pai_id, nome, ordem, ativo, vendas_ref)` | raiz → `category_groups`; 2º nível → `categories`; níveis 3+ ficam só no Estoque (a categoria do Vendas é a do ancestral de nível 2) |
| Produto simples | `produtos` (código por tipo, `grupo_id`, `atributos`) | `products` com `omie_codigo = produtos.codigo` |
| **Produto mãe** | `produtos.eh_mae=true`, sem saldo e sem movimento (trigger barra) | `products` com `estoque_pai_codigo = codigo da mãe` e **`omie_codigo` nulo** (evita baixa em dobro) |
| **Variação** | `produtos.produto_pai_codigo = codigo_produto da mãe`, tem saldo, ficha e preço próprios | opção do grupo de opção **"Variação"** (single, obrigatório) do produto; `product_options.omie_codigo = codigo da variação`; `price_delta = preço da variação − menor preço entre as variações` |
| Atributos da variação (tamanho, sabor…) | `produtos.atributos jsonb` | nome da opção = valores dos atributos juntados |

Chave de ligação de produto: **`codigo`** (texto, único por loja em `proprio`, imutável). Chave de grupo: `vendas_ref` (uuid) no Estoque e `estoque_grupo_id` (bigint) no Vendas. Chave de loja: CNPJ normalizado; o Estoque guarda `lojas.vendas_store_id`.

## Regras de conflito
- **Preço de venda: o Vendas manda.** Sempre sobrescreve `valor_unitario` do Estoque.
- **Código, unidade, tipo de item, NCM e custo: o Estoque manda.** O Vendas nunca altera.
- **Nome, ativo/inativo, grupo: vence o `updated_at` mais recente** (relógio do banco de cada lado, comparado com o `updatedAt` enviado no payload).
- Produto criado **só no Estoque** aparece no Vendas com `available=false`, sem categoria até haver grupo, e preço do Estoque como sugestão. Produto criado **só no Vendas** aparece no Estoque com código novo por tipo (`90…`) e volta o código para o Vendas (`omie_codigo`).
- Exclusão: nunca apaga do outro lado; vira `inativo`/`available=false` (histórico e movimentos preservados).

## Fluxo técnico
- **Outbox** em cada banco (`sync_outbox` no Estoque, `sync_estoque_outbox` no Vendas): linha única pendente por (entidade, ref); drenado por worker (Vendas: `instrumentation.ts`, 2 min; Estoque: `/api/cron/sync-catalogo`, 10 min e logo após escritas via `after()`), retry com backoff 2→60 min, 8 tentativas.
- **Entrega:** `POST /api/integracao/catalogo` no outro lado (Bearer = chave de integração da loja, a mesma das demais rotas). Resposta devolve o mapa de ids/códigos criados, que o remetente grava por função SQL com `sync_skip`.
- **Reconciliação:** `GET /api/integracao/catalogo` devolve o catálogo inteiro; o cron compara e (a) enfileira o que falta, (b) grava divergências que não resolve sozinho (ex.: mesmo código com dois produtos).
- **Ligação de loja automática (só `proprio`):** cron do Estoque cria no Vendas, pelo CNPJ, a loja que falta (rota bootstrap idempotente) e configura a integração; o worker do Vendas faz o inverso. Se a loja já existe do outro lado com o mesmo CNPJ, só liga.

## Fora de escopo desta rodada
Sincronizar ficha técnica/receita para o Vendas, imagens e descrição do cardápio no Estoque, grupos de opção que não são "Variação" (adicionais continuam só no Vendas).
