# Modos de loja e Estoque próprio — Design

Data: 2026-10-06 · Primeira loja: ODARA BEACH · Repos: Norte Estoque (este) e Norte Vendas.

## 1. Entendimento (o que foi pedido)

Cada loja escolhe como trabalha com estoque. Hoje só existe "Vendas + Omie". Passam a existir quatro modos:

| Modo | Dono do estoque | Vendas | Estoque |
|---|---|---|---|
| `omie` | Omie | baixa via Estoque→Omie (como hoje) | espelho + escrita no Omie (como hoje) |
| `proprio` | Norte Estoque | baixa via ledger local | cadastro, locais, saldo, entrada, ajuste, produção, inventário, transferência, NF de entrada |
| `nenhum` | ninguém | só venda e nota | nada |
| só Estoque | Norte Estoque | não usa | igual a `proprio`, sem integração |

Pedidos explícitos do dono: produtos com código nosso no padrão do Omie; **locais de estoque** (onde o item fica) e **locais de consumo** (preparo: bar, cozinha) com mapeamento consumo→estoque; locais criados no Vendas e espelhados no Estoque; produtos sincronizados nos dois sentidos; categorias/famílias; inventário; movimentos (kardex); ordem de produção e consumo; nota fiscal casando com produto cadastrado; tela de estoque organizada; cardápio de teste (parte bar, parte cozinha) **só na loja de teste da ODARA**; NFC-e em homologação primeiro. Meta: "o máximo de coisas hoje", sem comprometer a loja `omie` (Sertão).

## 2. Decisões já tomadas

- **Estoque negativo é permitido.** A venda nunca trava. Alerta ao gerente e painel "itens negativos". Baixa pelo último custo médio conhecido; o custo médio **não** é recalculado enquanto o saldo ≤ 0.
- **Códigos iguais ao padrão do Omie do Sertão:** prefixo pelo tipo do item (90 vendável, 80 matéria-prima, 70 intermediário, 60 uso e consumo, 50 embalagem/outros), resto sequencial automático, `text`, imutável, nunca reaproveitado, único por loja. Bar × cozinha fica em família e local, nunca no código.
- **Ordem de entrega:** Fase 1 completa primeiro (ponta a ponta na ODARA), depois as Fases 2 a 5 na sequência, hoje até onde der, sempre com testes e sem tocar o modo `omie`.

## 3. Arquitetura

1. **Coluna de modo por loja** nos dois sistemas: `lojas.modo_estoque` (Estoque) e `stores.stock_mode` (Vendas), default `omie`. Nunca derivado de `is_test`.
2. **Drivers no Estoque:** `lib/estoque/` com `omie` (código de hoje, intocado) e `proprio` (banco local). Loja `proprio` nunca chama `omieRequest`.
3. **Ledger único append-only** `estoque_movimentos` + saldo atômico `estoque_saldos` por (loja, local, produto), atualizado na mesma transação (`INSERT ... ON CONFLICT DO UPDATE` com lock de linha; vários itens de uma venda em ordem de `codigo_produto` para evitar deadlock). Proteção por trigger contra UPDATE/DELETE. Estorno = movimento inverso com `reverses_id` único. Saldo projetado em `posicao_estoques` para os relatórios atuais seguirem funcionando.
4. **Custo médio móvel, uma média por produto na loja** (local só guarda quantidade; transferência não muda custo). Entrada: `(saldo·cmc + qtd·custo)/(saldo + qtd)`. Saída ao cmc vigente. Entrada sem custo exige custo de referência (marcada bonificação) e nunca zera o cmc. Quantidades `numeric(18,6)`, valores `numeric(18,4)`, sem float.
5. **Idempotência:** `unique (loja, origem, ref, produto, local, linha)`; reenvio do mesmo pedido não baixa de novo.
6. **Unidades:** tudo na unidade base do produto (g, ml, un), imutável após o primeiro movimento; unidade de compra convertida só na borda (entrada de NF e tela).
7. **Retroativo:** lançamento com data passada só no mês aberto; depois, estorno e ajuste na data atual.
8. **IDs locais** de loja `proprio` em sequências próprias (≥ 8.000.000.000.000), sem colisão com ids do Omie nem com os negativos do modo simulado.
9. **Vendas continua PDV + fiscal.** Ganha "Locais de estoque", mapeamento consumo→estoque, seletor de modo, textos sem "Omie" nos modos `proprio` e `nenhum`. NFC-e usa o código do cadastro.

## 4. Fases

- **Fase 1 (base + ODARA):** modo, ledger, drivers, códigos, criar loja `proprio`, tela de Estoque (design pass, capturas), baixa na venda e estorno, locais no Vendas, ODARA com cardápio de teste só nela, NFC-e em homologação. Detalhe das tarefas: `docs/superpowers/plans/2026-10-06-modos-de-loja-estoque-proprio.md`.
- **Fase 2 (produção):** ficha técnica (quantidade líquida, fator de correção, quantidade bruta baixada, versão da receita no movimento), sub-receitas, ordem de produção que consome insumos e entrega o intermediário com custo = custo consumido ÷ produzido, consumo por receita na venda (baixa no pagamento, não na comanda aberta).
- **Fase 3 (inventário e transferência):** contagem cega por local (snapshot na abertura, delta vira ajuste ao custo médio, motivo obrigatório acima de limite), transferência como par de movimentos na mesma transação (local "em trânsito" opcional), estoque mínimo e par level com sugestão de compra.
- **Fase 4 (compras):** NF-e de entrada manual e por XML; chave de 44 dígitos é a idempotência da compra; de-para fornecedor+`cProd`→produto com fator; custo de entrada = total da nota (frete rateado, ICMS conforme regime); respeita o CFOP do XML. Consulta SEFAZ (DistribuicaoDFe) com controle de NSU fica opcional e depois.
- **Fase 5 (relatórios):** valorizado, movimentação, parados, CMV, real × teórico por insumo, crons e saúde da integração por modo, modo "só Estoque".

## 4b. Cadastro de loja nos dois painéis (pedido do dono, 06/10 à noite; só plano por enquanto)

- **Escopo do Estoque próprio:** vale para todas as lojas. Lojas `omie` continuam espelhando o Omie e, num passo posterior, copiam o histórico do Omie para o ledger local, de modo que, se algum dia a loja ficar independente, o histórico já esteja no Estoque. Loja que não é do Omie nasce com tudo local.
- **Painel Master do Vendas (AdminModule, "Nova Loja" / "Editar Loja"):** o modal hoje é estreito no meio da tela (ver print de 06/10). Passa a ocupar cerca de 70% da tela, em seções com navegação lateral: Identidade (logo, capa, nome, CNPJ, link), Contrato (status, meses/sem prazo, plano), Operação (balcão + mesas, só balcão, número de mesas, módulos, fluxo de pedido, taxa de serviço), Estoque (modo: Omie / Estoque próprio / Nenhum; "criar também no Norte Estoque"; trocar o modo depois, com as travas da seção 6), Fiscal e Integrações. Muito mais opções que hoje, no padrão do Norte Estoque.
- **Norte Estoque (tela de Lojas):** já tem criar/editar loja. Passa a ter: modo de estoque, "criar também no Norte Vendas", ativar/desativar, e editar o tipo da loja depois. Loja criada de um lado aparece no outro quando a opção "criar lá também" é marcada (já existe o pareamento por chave de integração).
- **Design:** padrão visual de cada app (kit do Estoque; azul-violeta Norte do Vendas). Capturas antes de entregar.

## 5. Regras de segurança do projeto

- Modo `omie` não muda nada (teste de regressão por fase).
- Coluna nova em `lojas` exige `GRANT SELECT (col)` e entrar nos `select` explícitos.
- Migrations do Estoque aplicadas por `docker exec ... -d postgres`, testadas antes em transação com ROLLBACK; deploy do Estoque manual (`deploy.sh`, síncrono).
- Vendas: portão (`scripts/e2e/portao-deploy.sh`) passa antes de qualquer deploy; nunca com o Sertão operando; nunca testar no Sertão.
- Omie nunca é alterado sem ok; fiscal só em homologação até o dono liberar produção.
- Textos: loja `proprio`/`nenhum` nunca vê "Omie".

## 6. Riscos e casos de borda (cada um vira teste)

1. 20 baixas paralelas no mesmo produto/local: saldo final = soma do ledger, `saldo_apos` coerente.
2. Mesmo `ref` reenviado 50 vezes: uma linha só.
3. Venda de item sem código ou com código duplicado: resultado "pulada" visível, nunca "ok" silencioso; código repetido recusado na criação.
4. Venda cancelada/estornada: inverso com `reverses_id`, sem apagar histórico; estorno duplo recusado.
5. Saldo negativo: vende, alerta, cmc preservado, ao receber entrada o saldo normaliza.
6. Entrada com custo zero: nunca zera o cmc.
7. Troca de modo de loja existente: bloqueada depois do primeiro movimento; antes, só admin.
8. Receita em g com estoque em kg: sempre unidade base, unidade exibida ao lado de todo número.

## 7. Fora de escopo (não faremos agora)

EFD/Bloco K (Simples dispensado, confirmar com o contador a EFD na Bahia), PEPS por camada, importação do histórico do Omie para loja `proprio`, app de contagem por leitor de código de barras.
