# Mapa da API do Omie — o que dá pra puxar (varredura real, loja Donana Rio Vermelho)

Testado de verdade em 15/06/2026. Volumes são da loja 3 (Donana Rio Vermelho).
Legenda: ✅ funciona e retornou dados | 🔧 existe, só ajustar parâmetro | ❌ endpoint não existe nesse caminho.

## CADASTROS (Geral)
| Recurso | Endpoint / call | Volume | Pra que serve |
|---|---|---|---|
| Empresas ✅ | `v1/geral/empresas` ListarEmpresas | 1 | Dados da empresa (CNPJ, CNAE, IE/IM, CSC, regime, contador) → **cadastro de loja auto-preenchido** |
| Clientes/Fornecedores ✅ | `v1/geral/clientes` ListarClientes | 3.350 | Relatórios por fornecedor/cliente, entrada de NF |
| Famílias ✅ | `v1/geral/familias` ListarFamilias | — | Filtro/agrupamento dos relatórios |
| Categorias (DRE) ✅ | `v1/geral/categorias` ListarCategorias | 147 | Classificação contábil/DRE, relatórios financeiros |
| Projetos ✅ | `v1/geral/projetos` | 7 | Rateio/centro de custo |
| Vendedores ✅ | `v1/geral/vendedores` | 14 | Faturamento por vendedor |
| Departamentos ✅ | `v1/geral/departamentos` | 4 | Rateio |
| Conta corrente (bancos) ✅ | `v1/geral/contacorrente` | 39 | Saldos bancários, extrato, conciliação |
| Tabelas de preço 🔧 | `v1/produtos/tabelaprecos` | — | Preços de venda |
| CFOP ✅ | `v1/produtos/cfop` PesquisarCFOP | — | Validação fiscal na entrada de NF |
| Características de produto ✅ | `v1/geral/prodcaract` | — | Atributos extras |

## ESTOQUE
| Recurso | Endpoint / call | Volume | Pra que serve |
|---|---|---|---|
| Posição ✅ | `v1/estoque/consulta` ListarPosEstoque | 1.197 | Campos reais (probe 15/06): `nSaldo`, `nCMC`, `nPrecoUnitario`, `nPendente`, **`estoque_minimo`** (👈 fonte do mínimo!), `reservado`, `fisico`, `nCodProd`, `cCodigo`, `cDescricao` |
| Movimentos ✅ | `v1/estoque/movestoque` ListarMovimentos | 566 | Entradas/saídas por produto → **movimentações, rejeito, consumo** |
| Locais ✅ | `v1/estoque/local` ListarLocaisEstoque | 12 | Locais de estoque |
| Resumo de estoque ✅ | `v1/estoque/resumo` | — | Resumo por produto |
| **Previsão ✅** | `v1/estoque/movestoque` ConsultarPrevisao | — | **Previsão nativa do Omie por produto** (útil na sugestão de compra) |

## PRODUÇÃO
| Recurso | Endpoint / call | Volume | Pra que serve |
|---|---|---|---|
| Ordens de Produção ✅ | `v1/produtos/op` ListarOrdemProducao | 193.625 | OP (a malha/componentes vem dentro, em itensDetalhes) |

## VENDAS / COMPRAS
| Recurso | Endpoint / call | Volume | Pra que serve |
|---|---|---|---|
| Pedido de venda | `v1/produtos/pedido` | 0 | NÃO usam (vendem por PDV/cupom) |
| Pedido de compra ✅ | `v1/produtos/pedidocompra` | — | Compras (pedidos) |
| NFC-e / cupom ✅ | `v1/produtos/nfce` | — | Cupons fiscais (vendas do balcão) |

## NOTAS FISCAIS
| Recurso | Endpoint / call | Volume | Pra que serve |
|---|---|---|---|
| Consultar NF ✅ | `v1/produtos/nfconsultar` ListarNF | 6.781 | NF entrada+saída (itens, impostos, totais) → relatório de NF |
| Recebimento NFe 🔧 | `v1/produtos/recebimentonfe` | — | **Entrada de NF em 2 cliques** |
| **DF-e / Manifestação ✅** | `v1/produtos/dfedocs` ListarDocumentos | — | **Notas recebidas do Sefaz** (puxar com certificado) |

## FINANCEIRO (o ouro dos relatórios)
| Recurso | Endpoint / call | Volume | Pra que serve |
|---|---|---|---|
| **Contas a Receber ✅** | `v1/financas/contareceber` | **123.949** | **Faturamento/vendas** |
| **Contas a Pagar ✅** | `v1/financas/contapagar` | **23.109** | **Compras/despesas** |
| **Movimento Financeiro ✅** | `v1/financas/mf` ListarMovimentos | **387.732** | Fluxo completo (detalhes + resumo) |
| Resumo financeiro ✅ | `v1/financas/resumo` | — | Resumo por período |
| Caixa ✅ | `v1/financas/caixa` | — | Resumo de caixa |
| Extrato 🔧 | `v1/financas/extrato` | — | Extrato por conta |

## SERVIÇOS (não usam hoje, mas existe)
OS (`v1/servicos/os`), Cadastro de serviço, NFS-e, Contratos — todos existem 🔧/✅.

---

## Achados que mudam o plano
1. **Estoque mínimo** → vem em `ListarPosEstoque` (campo `estoque_minimo`), NÃO no cadastro de produto (que vem 0). É de lá que tem que puxar.
2. **Faturamento/vendas** → não há pedido de venda; o real está em **Contas a Receber + NF saída + Movimento Financeiro**. É a fonte dos relatórios do Excel.
3. **Compras** → Contas a Pagar + Recebimento NFe.
4. **Sefaz** → `dfedocs` (manifestação) puxa notas direto do Sefaz com o certificado.
5. **Previsão nativa** → o Omie tem `ConsultarPrevisao` (previsão de estoque por produto).
