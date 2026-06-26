---
title: Mapa completo API Omie -- NTB Estoque
domain: triforce
type: reference
tags: [omie, api, ntb, faturamento, nfc-e, sync]
sources: []
updated: 2026-06-26
related: []
---

# MAPA COMPLETO API OMIE -- NTB ESTOQUE

Varredura de 17 agentes (2 workflows paralelos) sobre toda a documentacao oficial (`developer.omie.com.br/service-list/`), comunidade, SDKs e casos reais.

---

## 1. ENDPOINTS EM PRODUCAO (ja usamos)

| Endpoint | Calls em uso | Arquivo |
|---|---|---|
| v1/geral/empresas | ListarEmpresas | scripts/sync-empresa.mjs |
| v1/geral/clientes | ListarClientes | lib/omie/cliente-fornecedor.ts |
| v1/geral/produtos | ListarProdutos, IncluirProduto, AlterarProduto, ExcluirProduto | lib/omie/produto.ts |
| v1/geral/familias | PesquisarFamilias | lib/omie/familia.ts |
| v1/geral/malha | ConsultarEstrutura, IncluirEstrutura, AlterarEstrutura, ExcluirEstrutura | lib/omie/malha.ts |
| v1/estoque/consulta | ListarPosEstoque | lib/omie/posicao-estoque.ts |
| v1/estoque/movestoque | ListarMovimentos | lib/omie/movimento.ts |
| v1/estoque/ajuste | IncluirAjusteEstoque, ExcluirAjusteEstoque | lib/omie/ajuste.ts |
| v1/estoque/local | ListarLocaisEstoque, IncluirLocalEstoque, AlterarLocalEstoque | lib/omie/local-estoque.ts |
| v1/produtos/op | ListarOrdemProducao, ConsultarOrdemProducao, IncluirOrdemProducao, ExcluirOrdemProducao, ConcluirOrdemProducao, ReverterOrdemProducao | lib/omie/ordem-producao.ts |
| v1/produtos/recebimentonfe | ListarRecebimentos, ConsultarRecebimento | lib/omie/nota-fiscal.ts |

---

## 2. TODOS OS ENDPOINTS OMIE DOCUMENTADOS

### MODULO GERAL

#### v1/geral/empresas
Calls: `ListarEmpresas`, `ConsultarEmpresa`
Campos relevantes: nCodEmp, cRazaoSocial, cCNPJ, habilita_nfce, regime_tributario, certificado_digital (validade), sincroniza_estoque_analitico
Status NTB: ListarEmpresas EM USO. ConsultarEmpresa NAO USADO -- oportunidade para /minha-loja e etiqueta.
Aviso: Lojas 5 e 6 tem ListarEmpresas bloqueado por consumo indevido. ConsultarEmpresa individual pode ter o mesmo bloqueio -- testar lojas 1-4 primeiro. Cache TTL 24h obrigatorio.

#### v1/geral/clientes
Calls: `ListarClientes`, `ConsultarCliente`, `IncluirCliente`, `AlterarCliente`, `ExcluirCliente`, `UpsertCliente`
Campos: nCodCli, cCNPJCPF, cRazaoSocial, cEmail, cTelefone, cEndereco, nCodVend, nCodProj
Status NTB: EM USO (ListarClientes). Calls de escrita disponiveis mas nao usadas.

#### v1/geral/produtos
Calls: `ListarProdutos`, `ConsultarProduto`, `IncluirProduto`, `AlterarProduto`, `ExcluirProduto`, `UpsertProduto`
Campos: nCodProd, cCodigo, cDescricao, cTipoItem (01=MP, 02=PI, 03=EP, 04=PA, 05=Embalagem, 06=Serv...), nValUnit, nCMC, nEstoqueMinimo, nCodFamilia, cUnidade, cEAN, cImagem
Status NTB: EM USO (CRUD completo).

#### v1/geral/familias
Calls: `PesquisarFamilias`, `IncluirFamilia`, `AlterarFamilia`, `ExcluirFamilia`, `ConsultarFamilia`
Status NTB: EM USO (PesquisarFamilias). Escrita disponivel mas nao usada.

#### v1/geral/malha (BOM/Ficha Tecnica)
Calls: `ConsultarEstrutura`, `IncluirEstrutura`, `AlterarEstrutura`, `ExcluirEstrutura`
Campos: idProduto, idMalha, nCodComp (componente), nQtde, nPerda
Shape escrita: usa wrapper `itemMalhaIncluir`, `itemMalhaAlterar`
Status NTB: EM USO (CRUD completo). Confirmado via probe na loja 3 em 23/06.

#### v1/geral/categorias
Calls: `ListarCategorias`, `ConsultarCategoria`, `IncluirCategoria`, `AlterarCategoria`, `ExcluirCategoria`, `ListarCadastroDRE`
Campos: codigo, descricao, codigo_dre, nivelDRE, sinalDRE (+ = receita, - = despesa), tipo (R/D/T)
Status NTB: NAO USADO. Necessario para DRE por categoria (P2).
Nota: JOIN CR.codigo_categoria -> categorias.codigo -> categorias.codigo_dre -> DRE.

#### v1/geral/departamentos
Calls: `ListarDepartamentos`, `ConsultarDepartamento`, `IncluirDepartamento`, `AlterarDepartamento`, `ExcluirDepartamento`
Campos: nCodDep, cDescricao, cAtivo
Status NTB: NAO USADO. Rateio de receitas/despesas por departamento -- fora de escopo atual.

#### v1/geral/projetos
Calls: `ListarProjetos`, `ConsultarProjeto`, `IncluirProjeto`, `AlterarProjeto`, `ExcluirProjeto`
Status NTB: NAO USADO. Filtro em CR/CP por projeto -- fora de escopo NTB.

#### v1/geral/vendedores
Calls: `ListarVendedores`, `ConsultarVendedor`, `IncluirVendedor`, `AlterarVendedor`, `ExcluirVendedor`
Status NTB: NAO USADO. Campos de vendedor disponiveis em CR/Pedidos mas nao relevante.

#### v1/geral/contacorrente
Calls: `ListarContasCorrentes`, `ConsultarContaCorrente`, `IncluirContaCorrente`, `AlterarContaCorrente`, `ExcluirContaCorrente`
Campos: nCodCC, cDescricao, cTipo (BANCO/CAIXA), nSaldo
Status NTB: NAO USADO. Necessario para saldo bancario em tempo real -- vem via v1/financas/resumo/ mais facil.

#### v1/geral/anexo
Calls: `ListarAnexos`, `ConsultarAnexo`, `IncluirAnexo`, `ExcluirAnexo`
Nota: Upload de arquivos para entidades Omie (clientes, NFs, etc.). Usado para certificado digital -- fluxo manual dentro do Omie, nao via API de forma util.
Status NTB: NAO USADO. IGNORAR -- o upload de certificado digital por loja e feito pelo Ramon diretamente no Omie.

#### v1/geral/produtoskit (Kits/Combos)
Calls: `AlterarComponentesKit`
Campos: acao_componente (I/A/E), codigo_produto_componente, quantidade_componente, valor_unitario_componente, codigo_local_estoque
Status NTB: NAO USADO -- P2. Util para combos em restaurante e cestas em distribuidora. Quando um kit e vendido, o Omie baixa estoque de cada componente automaticamente.
Diferenca de Malha: Kit (cTipoItem='KT') e diferente de BOM/Ficha Tecnica (v1/geral/malha). Kit e para venda como produto unico; Malha e para producao.

#### v1/geral/dre (Estrutura DRE)
Calls: `ListarCadastroDRE`, `ConsultarCadastroDRE`, `IncluirCadastroDRE`, `AlterarCadastroDRE`, `ExcluirCadastroDRE`
Nota critica: retorna apenas o CADASTRO de contas do DRE (arvore de categorias), NAO um relatorio com valores calculados. O DRE real com valores e gerado apenas dentro do Omie -- nao existe via API.
Status NTB: IGNORAR. Para construir DRE real e necessario: ListarCategorias + ListarContasReceber/Pagar + agregacao local no Supabase.

---

### MODULO ESTOQUE

#### v1/estoque/consulta
Calls: `ListarPosEstoque`, `ConsultarPosEstoque`
Campos: nCodProd, nCodLocal, nSaldoQtdeFisico, nSaldoQtdeDisponivel, nCMC
Paginacao: 50/pagina. Sem filtro de local = so Local Padrao. Total = soma dos locais.
Status NTB: EM USO (ListarPosEstoque). Sync em 2 varreduras (minimo + saldos 'N').

#### v1/estoque/resumo (KPI nativo por produto)
Calls: `ObterEstoqueProduto`
Campos: nQuantFisico, nQuantReservado, nQuantDisponivel, nQuantPrevisaoEntrada, nQuantPrevisaoSaida, cmc, nUltCusto, nEstoqueMinimo (readonly), dUltimaCompra, nValorTotalEstoque
Status NTB: NAO USADO -- P0. Lookup rapido de um produto individual. Ideal para cards de KPI no dashboard -- substitui 3 chamadas por 1. nEstoqueMinimo e readonly (Omie nao aceita escrita).

#### v1/estoque/movestoque
Calls: `ListarMovimentos`, `ConsultarPrevisao`, `ConsultarMovimento`
Campos ListarMovimentos: id_movimento, nCodProd, nCodLocal, nQtde, cTpMovimento, dDtMovimento, dHrMovimento, nValUnit
Campos ConsultarPrevisao: nCodProd, dDtInicial, dDtFinal -> nQtdePrevista
Status NTB: EM USO (ListarMovimentos). ConsultarPrevisao NAO USADO -- P0 para automatizar sugestao de compra.

#### v1/estoque/ajuste
Calls: `IncluirAjusteEstoque`, `ExcluirAjusteEstoque`, `ListarAjusteEstoque`, `ConsultarAjusteEstoque`
Campos: id_ajuste, nCodProd, nCodLocal, nQtde, cTipoAjuste (ENT/SAI/SLD/TRF), dDtAjuste, cObservacao, nValor
cTipoAjuste='SAI' + cObservacao='perda' = distingue perda real de ajuste contabil
Status NTB: EM USO (Incluir/Excluir). ListarAjusteEstoque NAO USADO -- P0 para relatorio de perdas/movimentacao.

#### v1/estoque/local
Calls: `ListarLocaisEstoque`, `IncluirLocalEstoque`, `AlterarLocalEstoque`, `ExcluirLocalEstoque`, `ConsultarLocalEstoque`
Status NTB: EM USO (ListarLocaisEstoque, Incluir, Alterar).

#### v1/estoque/produtofornecedor
Calls: `ListarProdutoFornecedor`, `IncluirProdutoFornecedor`, `AlterarProdutoFornecedor`, `ExcluirProdutoFornecedor`
Campos: nCodFornecedor, cCNPJ_Forn, nCodProd, cCodProdForn (codigo do produto no catalogo do fornecedor)
Status NTB: NAO USADO -- P1. Mapeia produto -> fornecedor preferencial. Necessario para pre-preencher PedidoCompra automaticamente a partir da sugestao de compra.

---

### MODULO PRODUTOS

#### v1/produtos/op (Ordem de Producao)
Calls: `ListarOrdemProducao`, `ConsultarOrdemProducao`, `IncluirOrdemProducao`, `ExcluirOrdemProducao`, `ConcluirOrdemProducao`, `ReverterOrdemProducao`
Status NTB: EM USO (CRUD completo).

#### v1/produtos/recebimentonfe (NF de Entrada -- fornecedor)
Calls: `ListarRecebimentos`, `ConsultarRecebimento`, `AlterarEtapaRecebimento`, `ConcluirRecebimento`, `ImportarNFe`
Campos chave: cEtapa (60=Concluida), infoCadastro.cCancelada (S/N), infoCadastro.cDenegado (S/N), infoCadastro.cAutorizado (S/N), infoCadastro.cFaturado (S/N), infoCadastro.cRecebido (S/N), infoCadastro.cDevolvido (S/N), infoCadastro.cBloqueado (S/N)
Status NTB: EM USO (Listar, Consultar). AlterarEtapaRecebimento e ConcluirRecebimento NAO USADOS -- P1 para workflow de conferencia de NF.
Nota: ImportarNFe aceita XML+MD5 -- exclusivamente de ESCRITA, nao de leitura.

#### v1/produtos/nfconsultar (NF emitidas pela empresa -- saida)
Calls: `ListarNF`, `ConsultarNF`
Filtros request: tpNF ('0'=entrada, '1'=saida), dEmiInicial/dEmiFinal, dSaiEntInicial/dSaiEntFinal, dRegInicial/dRegFinal, filtrar_por_status
Campos por item (det[]): det[].prod.cProd, det[].prod.xProd (= cDescricao), det[].prod.qCom, det[].prod.vUnCom, det[].prod.vProd, det[].prod.CFOP, det[].prod.NCM, det[].prod.vDesc, det[].nfProdInt.nCodProd (ID interno Omie)
Filtros de status: dCan preenchida = cancelada; cDeneg='S' = denegada; dInut = inutilizada
finNFe: '1'=Normal, '2'=Complementar, '3'=Ajuste
cModeloNFe: '55'=NF-e, '65'=NFC-e (mas NFC-e so vem via cupomfiscalconsultar -- ver abaixo)
CRITICO: cApenasResumo='N' obrigatorio -- sem isso det[] nao retorna
nRegistrosPorPagina recomendado: 20-50 (cada NF pode ter muitos itens)
Status NTB: NAO USADO -- P1 para faturamento B2B (tpNF=1 com cApenasResumo=N).
Diferenca de recebimentonfe: recebimentonfe e para NF de ENTRADA recebidas de fornecedores. nfconsultar e para NF EMITIDAS pela empresa (saida principalmente).

#### v1/produtos/cupomfiscalconsultar (NFC-e / PDV)
Calls: `CuponsFiscais`, `CuponsItens`, `CuponsPagamentos`
Campos cabecalho (CuponsFiscais): nIdCupom, nNumCupom, nSerieCupom, cChaveCupom, dDtEmissaoCupom, cHrEmisaoCupom, nValorCupom, cModeloCupom (65=NFC-e, 59=CFe-SAT, 00=ECF), cCupomCancelado (S/N), cCupomDevolvido (S/N), nValorICMS, nValorPIS, nValorCOFINS
Campos item (CuponsItens): idProduto, cCodigo (codigo PDV), xProd, nQuant, vUnit, vItem, vDesc, vAcresc, cUn, cItemCancelado (S/N), cItemDevolvido (S/N), nAliqICMS, nValorICMS
Filtros request: dDtEmissaoDe/dDtEmissaoAte, dDtAlteracaoDe/dDtAlteracaoAte, dDtInclusaoDe/dDtInclusaoAte, nIdCupom, nPagina, nRegPorPagina (max 100)
SEM filtro nativo por status nem por cModeloCupom -- filtrar client-side apos receber
Paginacao: nPagina + nRegPorPagina, resposta tem nTotPaginas + nTotRegistros
Rate: 300ms entre requests. Mesmo nIdCupom 2x em menos de 60s nao retorna dados.
Volume estimado: 100 cupons/dia x 12 meses x 5 itens = ~180k linhas = ~1.800 paginas CuponsItens = ~9 min de sync inicial
Sync incremental: usar dDtAlteracaoDe (nao emissao) para pegar cancelamentos retroativos
Status NTB: NAO USADO -- P0. UNICA fonte de NFC-e/PDV com itens por produto.

#### v1/produtos/cupomfiscalincluir (emissao NFC-e -- escrita)
Calls: `IncluirNfce`, `IncluirCfeSat`, `IncluirCupom`, `FecharCaixa`, `InutilizarNfce`
Status NTB: IGNORAR. Emitir NFC-e/SAT requer certificado digital por CNPJ e homologacao SEFAZ por estado. Nao e plug-and-play. Alto risco operacional.

#### v1/produtos/cupomfiscal (cancelar/excluir cupom -- escrita)
Calls: `CancelarCupomFiscal`, `ExcluirCupomFiscal`
Status NTB: IGNORAR. Operacoes de escrita de cancelamento -- sem caso de uso no NTB.

#### v1/produtos/nfce (importar XML NFC-e -- escrita)
Calls: `ImportarNFCe`
Campos: chNFe, nfceXml (base64 sem acentos), nfceMd5
Status NTB: IGNORAR. Exclusivamente de ESCRITA -- recebe XML bruto de PDV externo. NAO lista nem consulta NFC-e. Confundir com cupomfiscalconsultar e o erro mais comum.

#### v1/produtos/pedido (Pedidos de Venda)
Calls: `IncluirPedido`, `AlterarPedido`, `ConsultarPedido`, `ExcluirPedido`, `ListarPedidos`, `StatusPedido`, `TrocarEtapaPedido`, `DevolverPedido`, `SimularImpostos`, `AlterarPedFaturado`
Campos: cCodIntPed, etapa (status do pedido), det[].produto.codigo_produto, det[].produto.quantidade, det[].produto.valor_unitario, numero_nf (NF de referencia)
Status NTB: NAO USADO -- P1. Listar pedidos de venda do Omie no painel NTB. SimularImpostos calcula impostos antes de emitir NF. Nao usar como fonte de faturamento por produto (pedidos cancelados/parciais poluem).

#### v1/produtos/pedidocompra (Pedidos de Compra)
Calls: `IncluirPedCompra`, `AlteraPedCompra`, `ConsultarPedCompra`, `PesquisarPedCompra`, `UpsertPedCompra`, `ExcluirPedCompra`
Campos: cabecalho.cCodIntPed, cabecalho.dDtPrevisao, cabecalho.nCodFor, cabecalho.cCodParc, produtos[].cCodIntItem, produtos[].nCodProd, produtos[].nQtde, produtos[].nValUnit
Status NTB: NAO USADO -- P1. Fechar o loop da sugestao de compra: NTB gera lista -> cria PedidoCompra no Omie automaticamente.
Risco: escreve no Omie real. Testar apenas com Ramon presente na loja 3.
O Omie cria automaticamente a conta a pagar vinculada ao PedidoCompra.

#### v1/produtos/notaentrada (Nota de Entrada -- recebimento de mercadoria)
Calls: `IncluirNotaEnt`, `ListarNotaEnt`, `ConsultarNotaEnt`, `StatusNotaEnt`, `AlterarNotaEnt`, `ExcluirNotaEnt`
Status NTB: NAO USADO -- P1. Registra entrada de mercadorias com NF. Diferente de recebimentonfe (que e so consulta de NF recebida). Permite conciliar o que chegou fisicamente no NTB sem entrar no Omie.

#### v1/produtos/pedidovendafat (Faturar Pedido de Venda -- escrita)
Calls: provavelmente `FaturarPedidoVenda` (calls exatos nao documentados publicamente)
Status NTB: IGNORAR por agora -- P2. Converte pedido aprovado em NF-e. Calls exatos nao estao no service-list publico. Precisa de sandbox Omie para testar antes de implementar.

#### v1/produtos/pedidoetapas (Etapas de Pedido)
Calls: provavelmente `ListarEtapas` (a confirmar)
Campos: cCodEtapa, cDesEtapa (ex: Orcamento, Aprovado, Em Separacao, Faturado, Entregue)
Status NTB: NAO USADO -- P2. Kanban/stepper de pedidos refletindo pipeline do Omie.

#### v1/produtos/produtoslote (Lotes com Validade)
Calls: `ListarLotes`, `ConsultarLote`
Campos: cNumLote, nCodProd, dDataValidade, dDataFabricacao, nQuantDisponivel, nQuantReservada, nSaldoLote, nIdLocal
Filtro por data de validade: NAO EXISTE. Varredura paginada + filtro client-side obrigatorio.
Ativar controle de lote: NAO e possivel via API -- requer acao manual no Omie por produto.
Status NTB: EM USO mas dDataValidade e dDataFabricacao nunca foram expostos na UI -- P0 para alerta de vencimento.

#### v1/produtos/variacao (Variacoes de Produto)
Calls: `ListarVariacoes`, `ConsultarVariacoes`, `IncluirVariacoes`, `ExcluirVariacoes`
Campos: maxCaracteristicas=2, associarProdutoExistente
Status NTB: NAO USADO -- P2. Variantes de um produto pai (ex: bebida em 300ml/600ml/1L). Confirmar com Ramon se as lojas usam variacoes no Omie antes de implementar.

#### v1/produtos/malha (alias de v1/geral/malha)
Mesmo endpoint, alias documentado no service-list.
Status NTB: EM USO via v1/geral/malha.

#### v1/produtos/cfop (Tabela CFOP)
Status NTB: IGNORAR. Tabela estatica de codigos CFOP. Desnecessario consumir via API -- CFOP ja vem em cada item das NFs.

#### v1/produtos/tabelaprecos (Tabela de Precos)
Calls: `ListarTabelaPreco`, `ConsultarTabelaPreco`, `IncluirTabelaPreco`, `AlterarTabelaPreco`, `ExcluirTabelaPreco`
Status NTB: NAO USADO -- P2. Util se as lojas tiverem politicas de preco diferenciadas por cliente/canal. Confirmar uso no Omie antes de implementar.

#### v1/produtos/dfedocs (Download DANFE/XML)
Calls: `ObterNfe`, `ObterCupom`, `ObterCTe`, `ObterDanfeSimp`, `ObterPedVenda`
Campos: nIdNfe -> linkPDF, linkXML, linkPortal
Status NTB: NAO USADO -- P1. Botao "Baixar DANFE" e "Baixar XML" em qualquer NF listada no NTB. Input e o nCodNF que ja esta salvo no banco.

#### v1/produtos/vendas-resumo (Dashboard Vendas)
Calls: `ObterResumoProdutos`
Campos: dDataInicio, dDataFim, painelNfeVenda (totais NF-e), painelNfce (totais NFC-e), painelCfeSat, painelCupom, faturamentoResumo, pedidoVenda
Nota: totais por canal (NF-e/NFC-e/SAT), incluindo cancelados/pendentes/rejeitados. NAO tem breakdown por produto.
Status NTB: NAO USADO -- P1. Cards de faturamento no painel do gestor sem varrer nota a nota.

#### v1/produtos/compras-resumo (Dashboard Compras)
Calls: `ObterResumoCompras`
Campos: dDataInicio, dDataFim, painelNfeEntrada, painelCte, requisicaoCompra, pedidoCompra (aberto/recebido/aprovacao), ordemProducao (6 etapas)
Status NTB: NAO USADO -- P1. Bloco de compras/abastecimento no painel do gestor.

#### v1/produtos/requisicaocompra (Requisicao de Compra)
Calls: `IncluirReq`, `PesquisarReq`, `AlterarReq`, `UpsertReq`, `ExcluirReq`, `ConsultarReq`
Status NTB: NAO USADO -- P2. Fluxo de solicitacao interna com aprovacao antes do pedido de compra. Confirmar com Ramon se existe esse processo antes de construir.

---

### MODULO FINANCEIRO

#### v1/financas/contareceber
Calls: `ListarContasReceber`, `ConsultarContaReceber`, `IncluirContaReceber`, `AlterarContaReceber`, `ExcluirContaReceber`, `LancarRecebimento`, `CancelarRecebimento`
Filtros ListarContasReceber: filtrar_por_emissao_de/ate, filtrar_por_data_de/ate, filtrar_por_registro_de/ate, filtrar_por_status (RECEBIDO/CANCELADO/LIQUIDADO/EMABERTO/PAGTO_PARCIAL/VENCEHOJE/AVENCER/ATRASADO), filtrar_cliente, filtrar_por_cpf_cnpj, filtrar_apenas_alteracao (sync incremental), ordenar_por
Campos chave: codigo_lancamento_omie, numero_documento_fiscal, chave_nfe (44 digitos -- so preenchido quando gerado por NF-e), nCodPedido, data_emissao, data_vencimento, valor_documento, codigo_categoria, status_titulo, id_conta_corrente, recebimento{} (data_credito, valor_recebido, desconto, juros, multa), categorias[] (rateio), distribuicao[], boleto{}
IMPORTANTE: NAO tem produto -- e financeiro puro. chave_nfe e a ponte para buscar itens via nfconsultar.
Status NTB: NAO USADO -- P1 para DRV financeiro do Andre.
Volume: 124k registros. Sync incremental via filtrar_apenas_alteracao=S obrigatorio.

#### v1/financas/contapagar
Calls: `ListarContasPagar`, `ConsultarContaPagar`, `IncluirContaPagar`, `AlterarContaPagar`, `ExcluirContaPagar`, `LancarPagamento`, `CancelarPagamento`
Campos: mesmos padroes de contareceber mas para despesas. codigo_categoria vincula ao DRE.
Status NTB: NAO USADO -- P2. Relevante para DRE por categoria quando combinado com contareceber.

#### v1/financas/mf (Movimento Financeiro -- mais rico)
Calls: `ListarMovimentos`
Filtros: dDtEmisDe/dDtEmisAte, dDtVencDe/dDtVencAte, dDtPagtoDe/dDtPagtoAte, cStatus (mesmo enum de CR), cNatureza (R=receita, P=despesa), cTpLancamento (CR/CP/BX/CC/PV/POS/PPV), cCodCateg, cNumDocFiscal, nCodNF
Campos chave: nCodTitulo, dDtEmissao, dDtVenc, dDtPagamento, nCodNF (FK direta para NF), cChaveNFe, cNumDocFiscal, nValorTitulo, nValPago, nValAberto, nValLiquido, nDesconto, nJuros, nMulta, cOrigem (NFEP=NF emitida produto, NFER=NF entrada, BAXP=baixa pagar, BAXR=baixa receber), cLiquidado (S/N)
Status NTB: NAO USADO -- P2. Mais granular que contareceber: tem nCodNF como FK direta, cNatureza para isolar receitas, cTpLancamento para separar CR de CP. Endpoint ideal para DW financeiro mas o volume (1.240+ paginas) exige sync incremental robusto.

#### v1/financas/pesquisartitulos
Calls: `PesquisarLancamentos`
Filtros: status, datas (emissao/vencimento/pagamento/previsao/registro/cancelamento), tipo documento, chave NF-e, barcode, CPF/CNPJ, categoria, projeto, vendedor, nCodNF
Campos chave: campos basicos do titulo + nTotRegistros (util para estimar volume)
Status NTB: NAO USADO -- P2. Alternativa unificada CR+CP. Mais simples que ListarMovimentos mas menos granular. Util para relatorio financeiro unificado (pagar + receber + status).

#### v1/financas/resumo (Dashboard Financeiro)
Calls: `ObterResumoFinancas`, `ObterListaEmAberto`, `ObterListaFinancas`, `ObterDetalhesLancamento`
Campos ObterResumoFinancas: dDataInicio, dDataFim (por dia), saldoBancario, totalAPagar, totalAReceber, totalVencido, fluxoDeCaixa (por dia)
Status NTB: NAO USADO -- P1. Widget de saude financeira no dashboard do gestor. Tres chamadas (resumo + vendas + compras) montam o cabecalho financeiro completo.

#### v1/financas/extrato
Calls: `ListarExtrato`, `ConsultarExtrato`
Campos: saldo real por conta corrente, movimentos bancarios (creditos/debitos)
Status NTB: NAO USADO -- P2. Util para conciliar saldo bancario com contareceber. Baixa prioridade.

#### v1/financas/contareceberboleto
Calls: `EmitirBoleto`, `CancelarBoleto`, `ConsultarBoleto`
Status NTB: IGNORAR. Operacoes de boleto bancario -- fora do escopo NTB (distribuicao de alimentos, nao banco).

#### v1/financas/pix
Calls: `GerarPix`, `ConsultarPix`, `CancelarPix`
Status NTB: IGNORAR. Operacoes PIX -- fora do escopo NTB.

---

### MODULO SERVICOS

#### v1/servicos/os (Ordem de Servico)
Calls: `IncluirOS`, `AlterarOS`, `ConsultarOS`, `ListarOS`, `ExcluirOS`
Campos: nCodServico, nCodCli, cEtapa, nQtde, nValUnit, cTribServ, cCodServLC116
Status NTB: IGNORAR. Prestacao de servicos com emissao de NFS-e. Restaurante/distribuidora nao emite OS.

#### v1/servicos/nfse (Nota Fiscal de Servico)
Calls: `ListarNFSEs`, `ConsultarNFSe`, `IncluirNFSe`, `EmitirNFSe`, `CancelarNFSe`
Campos: cNumNFSe, cRPS, dDtEmissao, nValorServicos, cCodServLC116, nCodMunicipio, nISS
Status NTB: IGNORAR por agora. Se alguma loja NTB prestar servicos e emitir NFS-e, tornar P2. Confirmar com Ramon.

#### v1/servicos/contrato (Contratos de Servico)
Calls: `IncluirContrato`, `AlterarContrato`, `ConsultarContrato`, `ListarContratos`, `ExcluirContrato`
Status NTB: IGNORAR. Contratos de prestacao de servicos -- fora do escopo.

---

### MODULO CRM

#### v1/crm/* (CRM completo)
Endpoints: v1/crm/leads, v1/crm/oportunidades, v1/crm/atividades, v1/crm/contatos, v1/crm/funil
Calls tipicas: ListarLeads, ConsultarLead, IncluirLead, AlterarLead, ExcluirLead (e equivalentes para cada entidade)
Status NTB: IGNORAR. CRM de vendas -- fora do escopo de gestao de estoque/producao.

---

### MODULO CONTADOR

#### v1/contador/xml (XMLs para Contador)
Calls: provavelmente `ListarDocumentos` (a confirmar)
Campos: xmlNfe, xmlNfce, xmlNfse, periodoReferencia
Status NTB: NAO USADO -- P2. Area do contador para download em lote de todos os XMLs do mes sem entrar no Omie. Baixa prioridade -- Ramon pode fazer isso diretamente no Omie.

---

## 3. WEBHOOKS OMIE

Configuracao em developer.omie.com.br. Eventos disponiveis (nao documentados publicamente sem login):
- Grupos confirmados: produto, pedido, NF, OS, conta
- Evento `NF_EMITIDA`: dispara quando NF e autorizada pela SEFAZ
- Evento `NF_CANCELADA`: dispara quando NF e cancelada
- Sem evento de movimentacao de estoque confirmado

**FILA FIFO BLOQUEANTE:** Um POST falho do endpoint receptor suspende TODOS os eventos do mesmo grupo ate o Omie resolver (ate 5 dias de retry com 10min de intervalo).

Status NTB: NAO IMPLEMENTAR agora. Manter polling via cron ate o sistema estabilizar. Se implementar no futuro: endpoint receptor deve sempre retornar HTTP 200 imediatamente e processar de forma assincrona (nunca bloquear na resposta).

---

## 4. RATE LIMITS

- 240 req/min por IP+AppKey+Metodo
- 4 requests simultaneas
- Bloqueio 30min apos 10 requests incorretos (HTTP 425)
- Mesmo ID 2x em menos de 60s: sem retorno de dados
- Intervalo seguro: 300ms entre requests (~200 req/min)
- Escrita (Incluir/Alterar/Excluir): usar 800ms entre calls para seguranca extra

---

## 5. DECISOES DE ARQUITETURA

### Fonte de faturamento por produto (decisao confirmada)

| Canal | Fonte | Status |
|---|---|---|
| PDV/balcao (NFC-e, SAT) | v1/produtos/cupomfiscalconsultar CuponsItens | P0 -- implementar apos probe QW-1 |
| Venda B2B (NF-e modelo 55) | v1/produtos/nfconsultar ListarNF tpNF=1 cApenasResumo=N | P1 |
| DRV financeiro (valor total, status pagamento) | v1/financas/contareceber ListarContasReceber | P1 |
| Financeiro completo (DW) | v1/financas/mf ListarMovimentos | P2 |

`ListarContasReceber` NAO tem produto -- serve para DRV financeiro, nunca para mix de produto.

### Schema unificado `faturamento_itens`

```sql
faturamento_itens (
  loja_id, data_emissao,
  origem,    -- 'cupom' ou 'nf_saida'
  origem_id, -- n_id_cupom ou n_cod_nf
  c_codigo,  -- codigo produto
  n_cod_prod,-- ID interno Omie (FK para produtos)
  descricao,
  cfop,      -- so para nf_saida; null para cupom
  quantidade, valor_unit, valor_total,
  cancelado, devolvido -- bool
)
```

---

## 6. PLANO DE EXECUCAO

### P0 -- 1-2 dias cada (impacto imediato)

| ID | Tarefa | Endpoint | Prioridade |
|---|---|---|---|
| QW-2 | Fix migration auditoria fiscal (bug) | Supabase migration 047 -- sem chamada Omie | CRITICO |
| QW-1 | Probe CuponsFiscais loja 3 -- confirmar PDV | cupomfiscalconsultar CuponsFiscais | GO/NO-GO |
| QW-1b | Se GO: sync CuponsItens + tabelas cupons_fiscais/cupom_itens | cupomfiscalconsultar CuponsItens | Alto |
| QW-3 | ConsultarPrevisao para sugestao de compra | v1/estoque/movestoque ConsultarPrevisao | Medio |
| QW-4 | ListarAjusteEstoque para relatorio de perdas | v1/estoque/ajuste ListarAjusteEstoque | Medio |
| QW-5 | Expor dDataValidade nos lotes (UI, sem nova API) | v1/produtos/produtoslote -- ja vem no sync | Medio |
| QW-6 | KPI estoque individual | v1/estoque/resumo ObterEstoqueProduto | Medio |

### P1 -- 3-5 dias cada

| ID | Tarefa | Endpoint |
|---|---|---|
| P1-A | Faturamento NF-e saida B2B | nfconsultar ListarNF tpNF=1 |
| P1-B | DRV financeiro (sistema do Andre) | contareceber ListarContasReceber |
| P1-C | Pedido de Compra integrado | pedidocompra IncluirPedCompra + produtofornecedor |
| P1-D | Download DANFE/XML | dfedocs ObterNfe/ObterCupom |
| P1-E | Dados completos empresa (/minha-loja e etiqueta) | geral/empresas ConsultarEmpresa |
| P1-F | Blocos financeiros no dashboard | financas/resumo + vendas-resumo + compras-resumo |
| P1-G | Workflow conferencia NF | recebimentonfe AlterarEtapaRecebimento, ConcluirRecebimento |

### P2 -- backlog ou depende de decisao externa

| ID | Tarefa | Endpoint | Dependencia |
|---|---|---|---|
| P2-A | DRE por categoria | geral/categorias + contareceber + contapagar | Confirmar setup categorias no Omie com Ramon |
| P2-B | DW financeiro completo | financas/mf ListarMovimentos | P1-B validado |
| P2-C | Pedidos de Venda no painel | produtos/pedido ListarPedidos | Decisao Ramon |
| P2-D | Kits/Combos | geral/produtoskit | Confirmar uso no Omie |
| P2-E | Variacoes de produto | produtos/variacao | Confirmar uso no Omie |
| P2-F | Requisicao de Compra | produtos/requisicaocompra | Confirmar fluxo de aprovacao com Ramon |
| P2-G | Area do Contador (XMLs) | contador/xml | Baixa prioridade |
| P2-H | Webhooks (sync reativo) | developer.omie.com.br | Sistema estabilizado |

---

## 7. O QUE NAO FAZER E POR QUE

| O que | Por que nao |
|---|---|
| ContasReceber como fonte de faturamento por produto | Endpoint financeiro puro -- sem produto, quantidade, valor unitario por item. Exige cruzar com NF via chave_nfe, dobrando as chamadas. |
| nfconsultar como fonte de NFC-e | Empiricamente confirmado (spike 22/06): nfconsultar NAO retorna NFC-e. So via cupomfiscalconsultar. |
| ImportarNFe/ImportarNFCe para leitura | Esses endpoints sao exclusivamente de ESCRITA (recebem XML). Para leitura usar recebimentonfe (entrada) e nfconsultar (saida). |
| Webhooks como estrategia primaria agora | Fila FIFO bloqueante -- uma falha do endpoint NTB suspende TODOS os eventos fiscais do grupo por ate 5 dias. |
| Migrar entrada de NFs de recebimentonfe para nfconsultar | recebimentonfe e o endpoint correto para NF de ENTRADA de fornecedor. Sao endpoints com propositos distintos. |
| Ativar controle de lote via API | Nao existe call para isso -- requer acao manual no Omie por produto. |
| ConsultarEmpresa em loop por request | Mesmo risco de bloqueio das lojas 5/6. Cache TTL 24h obrigatorio. |
| ListarMovimentos (mf) sem sync incremental | 124k+ registros. Sync completo sem filtro filtrar_apenas_alteracao gasta 1.240+ paginas por varredura diaria. |
| DRE via v1/geral/dre | So retorna cadastro de contas (estrutura), nao valores calculados. DRE real nao e exportavel via API. |
| PedidoVenda como fonte de faturamento | Pedidos cancelados/parciais/duplicados poluem. Usar sempre nfconsultar (fonte fiscal definitiva). |
| v1/produtos/pedidovendafat sem sandbox | Calls exatos nao documentados publicamente. Requer teste no ambiente sandbox Omie antes de implementar. |
| SPED via API | Nao existe endpoint SPED. Exportacao e feita dentro do Omie manualmente. |

---

*Varredura de 17 agentes em 2026-06-26. Fontes: developer.omie.com.br/service-list/, ajuda.omie.com.br, SDKs (devdiogenes, mikalron, IKauedev), MCP server omie (geraldoaax), Kondado, WSDL dos endpoints.*
