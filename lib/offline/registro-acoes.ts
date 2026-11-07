// GERADO por scripts/inserir-via-desktop.mjs -- não editar à mão.
// Todas as server actions, pelo nome usado no canal do app desktop (modulo#funcao).
import * as m0 from '@/lib/actions/anexos'
import * as m1 from '@/lib/actions/auth'
import * as m2 from '@/lib/actions/busca-global'
import * as m3 from '@/lib/actions/cadastro'
import * as m4 from '@/lib/actions/cargo'
import * as m5 from '@/lib/actions/catalogo-proprio'
import * as m6 from '@/lib/actions/categoria-contabil'
import * as m7 from '@/lib/actions/central-numeros'
import * as m8 from '@/lib/actions/central'
import * as m9 from '@/lib/actions/certificado'
import * as m10 from '@/lib/actions/clientes'
import * as m11 from '@/lib/actions/compras-cadastros'
import * as m12 from '@/lib/actions/compras-proprio'
import * as m13 from '@/lib/actions/convite'
import * as m14 from '@/lib/actions/detalhe-movimento'
import * as m15 from '@/lib/actions/devolucao-fornecedor'
import * as m16 from '@/lib/actions/estoque-omie'
import * as m17 from '@/lib/actions/estoque-proprio'
import * as m18 from '@/lib/actions/estrutura'
import * as m19 from '@/lib/actions/familia'
import * as m20 from '@/lib/actions/ficha-tecnica'
import * as m21 from '@/lib/actions/fichas-omie'
import * as m22 from '@/lib/actions/financeiro-receber'
import * as m23 from '@/lib/actions/financeiro'
import * as m24 from '@/lib/actions/fornecedor'
import * as m25 from '@/lib/actions/importacao'
import * as m26 from '@/lib/actions/importar-pedidos'
import * as m27 from '@/lib/actions/integracao-ntb-vendas'
import * as m28 from '@/lib/actions/inventario-proprio'
import * as m29 from '@/lib/actions/inventario'
import * as m30 from '@/lib/actions/local-estoque'
import * as m31 from '@/lib/actions/loja-selector'
import * as m32 from '@/lib/actions/loja'
import * as m33 from '@/lib/actions/mapeamento-local-estoque'
import * as m34 from '@/lib/actions/meta-faturamento'
import * as m35 from '@/lib/actions/meta-mensal'
import * as m36 from '@/lib/actions/minha-loja'
import * as m37 from '@/lib/actions/movimentacoes-proprio'
import * as m38 from '@/lib/actions/movimentacoes'
import * as m39 from '@/lib/actions/nfe-saida'
import * as m40 from '@/lib/actions/nota-fiscal-proprio'
import * as m41 from '@/lib/actions/nota-fiscal'
import * as m42 from '@/lib/actions/notificacoes'
import * as m43 from '@/lib/actions/onboarding-loja'
import * as m44 from '@/lib/actions/ops-lote'
import * as m45 from '@/lib/actions/ordem-producao'
import * as m46 from '@/lib/actions/pedido-compra'
import * as m47 from '@/lib/actions/periodo-fechado'
import * as m48 from '@/lib/actions/produto-minimo'
import * as m49 from '@/lib/actions/produto-substituicao'
import * as m50 from '@/lib/actions/produto'
import * as m51 from '@/lib/actions/produtos-search'
import * as m52 from '@/lib/actions/requisicao-compra'
import * as m53 from '@/lib/actions/sintegra'
import * as m54 from '@/lib/actions/sync-status'
import * as m55 from '@/lib/actions/transferencia-loja'
import * as m56 from '@/lib/actions/transferencia'
import * as m57 from '@/lib/actions/usuario'
import * as m58 from '@/lib/actions/validade-proprio'
import * as m59 from '@/lib/actions/variacao-preco'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Acao = (...args: any[]) => Promise<unknown>

export const ACOES: Readonly<Record<string, Acao>> = Object.freeze({
  'anexos#excluirAnexo': m0.excluirAnexo as Acao,
  'auth#login': m1.login as Acao,
  'auth#logout': m1.logout as Acao,
  'busca-global#buscaGlobal': m2.buscaGlobal as Acao,
  'cadastro#cadastrar': m3.cadastrar as Acao,
  'cargo#listarCargos': m4.listarCargos as Acao,
  'cargo#criarCargo': m4.criarCargo as Acao,
  'cargo#editarCargo': m4.editarCargo as Acao,
  'cargo#excluirCargo': m4.excluirCargo as Acao,
  'cargo#definirCargoUsuario': m4.definirCargoUsuario as Acao,
  'catalogo-proprio#listarGrupos': m5.listarGrupos as Acao,
  'catalogo-proprio#criarGrupo': m5.criarGrupo as Acao,
  'catalogo-proprio#editarGrupo': m5.editarGrupo as Acao,
  'catalogo-proprio#excluirGrupo': m5.excluirGrupo as Acao,
  'catalogo-proprio#criarProdutoCatalogo': m5.criarProdutoCatalogo as Acao,
  'catalogo-proprio#carregarProdutoCatalogo': m5.carregarProdutoCatalogo as Acao,
  'catalogo-proprio#salvarProdutoCatalogo': m5.salvarProdutoCatalogo as Acao,
  'catalogo-proprio#sincronizarAgora': m5.sincronizarAgora as Acao,
  'categoria-contabil#criarCategoriaContabil': m6.criarCategoriaContabil as Acao,
  'categoria-contabil#editarCategoriaContabil': m6.editarCategoriaContabil as Acao,
  'categoria-contabil#excluirCategoriaContabil': m6.excluirCategoriaContabil as Acao,
  'central-numeros#numerosDaCentral': m7.numerosDaCentral as Acao,
  'central#marcarEstadoProblema': m8.marcarEstadoProblema as Acao,
  'central#marcarNaoControla': m8.marcarNaoControla as Acao,
  'central#lancarOPCorrecao': m8.lancarOPCorrecao as Acao,
  'central#carregarPainel': m8.carregarPainel as Acao,
  'central#previaRefazerInventario': m8.previaRefazerInventario as Acao,
  'central#refazerInventario': m8.refazerInventario as Acao,
  'certificado#salvarCertificado': m9.salvarCertificado as Acao,
  'clientes#criarCliente': m10.criarCliente as Acao,
  'clientes#editarCliente': m10.editarCliente as Acao,
  'clientes#excluirCliente': m10.excluirCliente as Acao,
  'clientes#trazerTransportadorasDasNotas': m10.trazerTransportadorasDasNotas as Acao,
  'compras-cadastros#salvarComprador': m11.salvarComprador as Acao,
  'compras-cadastros#salvarLeadTimeFornecedor': m11.salvarLeadTimeFornecedor as Acao,
  'compras-proprio#previaXml': m12.previaXml as Acao,
  'compras-proprio#lancarCompraXml': m12.lancarCompraXml as Acao,
  'compras-proprio#lancarCompraManual': m12.lancarCompraManual as Acao,
  'compras-proprio#mapearPendentes': m12.mapearPendentes as Acao,
  'compras-proprio#estornarCompra': m12.estornarCompra as Acao,
  'compras-proprio#buscarProdutosCompra': m12.buscarProdutosCompra as Acao,
  'compras-proprio#criarProdutoRapido': m12.criarProdutoRapido as Acao,
  'convite#gerarConvite': m13.gerarConvite as Acao,
  'convite#revogarConvite': m13.revogarConvite as Acao,
  'detalhe-movimento#buscarDetalheOP': m14.buscarDetalheOP as Acao,
  'detalhe-movimento#buscarDetalheTransferencia': m14.buscarDetalheTransferencia as Acao,
  'detalhe-movimento#buscarDetalheNotaFiscal': m14.buscarDetalheNotaFiscal as Acao,
  'detalhe-movimento#buscarDetalheInventario': m14.buscarDetalheInventario as Acao,
  'devolucao-fornecedor#registrarDevolucao': m15.registrarDevolucao as Acao,
  'devolucao-fornecedor#cancelarDevolucao': m15.cancelarDevolucao as Acao,
  'estoque-omie#entradaOmie': m16.entradaOmie as Acao,
  'estoque-omie#ajusteOmie': m16.ajusteOmie as Acao,
  'estoque-omie#transferirOmie': m16.transferirOmie as Acao,
  'estoque-omie#corrigirCustoAjuste': m16.corrigirCustoAjuste as Acao,
  'estoque-omie#relancarCorrecaoCusto': m16.relancarCorrecaoCusto as Acao,
  'estoque-proprio#entradaManual': m17.entradaManual as Acao,
  'estoque-proprio#ajusteManual': m17.ajusteManual as Acao,
  'estoque-proprio#definirMinimo': m17.definirMinimo as Acao,
  'estoque-proprio#transferirEntreLocais': m17.transferirEntreLocais as Acao,
  'estoque-proprio#estornarMovimento': m17.estornarMovimento as Acao,
  'estrutura#verEstrutura': m18.verEstrutura as Acao,
  'estrutura#salvarEstrutura': m18.salvarEstrutura as Acao,
  'familia#criarFamilia': m19.criarFamilia as Acao,
  'familia#editarFamilia': m19.editarFamilia as Acao,
  'familia#excluirFamilia': m19.excluirFamilia as Acao,
  'familia#puxarFamiliasDoOmie': m19.puxarFamiliasDoOmie as Acao,
  'ficha-tecnica#salvarFichaTecnica': m20.salvarFichaTecnica as Acao,
  'ficha-tecnica#desativarFichaTecnica': m20.desativarFichaTecnica as Acao,
  'ficha-tecnica#produzirLoteAction': m20.produzirLoteAction as Acao,
  'fichas-omie#trocarInsumoNoPrato': m21.trocarInsumoNoPrato as Acao,
  'financeiro-receber#salvarFormaRecebimento': m22.salvarFormaRecebimento as Acao,
  'financeiro-receber#gerarContasReceberVendas': m22.gerarContasReceberVendas as Acao,
  'financeiro-receber#registrarRecebimento': m22.registrarRecebimento as Acao,
  'financeiro-receber#estornarRecebimento': m22.estornarRecebimento as Acao,
  'financeiro#salvarContaCorrente': m23.salvarContaCorrente as Acao,
  'financeiro#salvarCategoriaFinanceira': m23.salvarCategoriaFinanceira as Acao,
  'financeiro#criarCategoriasPadrao': m23.criarCategoriasPadrao as Acao,
  'financeiro#salvarTituloPagar': m23.salvarTituloPagar as Acao,
  'financeiro#cancelarTituloPagar': m23.cancelarTituloPagar as Acao,
  'financeiro#registrarPagamentoTitulo': m23.registrarPagamentoTitulo as Acao,
  'financeiro#estornarPagamentoTitulo': m23.estornarPagamentoTitulo as Acao,
  'financeiro#gerarContasPagarDaNota': m23.gerarContasPagarDaNota as Acao,
  'financeiro#salvarFamiliaCategoria': m23.salvarFamiliaCategoria as Acao,
  'financeiro#gerarContasNotasSemConta': m23.gerarContasNotasSemConta as Acao,
  'financeiro#decidirNotaDesfeita': m23.decidirNotaDesfeita as Acao,
  'financeiro#salvarConfigFinanceiro': m23.salvarConfigFinanceiro as Acao,
  'financeiro#decidirAprovacaoTitulo': m23.decidirAprovacaoTitulo as Acao,
  'financeiro#confirmarValorTitulo': m23.confirmarValorTitulo as Acao,
  'financeiro#salvarRecorrente': m23.salvarRecorrente as Acao,
  'financeiro#gerarRecorrentesAgora': m23.gerarRecorrentesAgora as Acao,
  'financeiro#registrarLancamentoAvulso': m23.registrarLancamentoAvulso as Acao,
  'financeiro#estornarLancamentoAvulso': m23.estornarLancamentoAvulso as Acao,
  'financeiro#registrarTransferencia': m23.registrarTransferencia as Acao,
  'financeiro#estornarTransferencia': m23.estornarTransferencia as Acao,
  'fornecedor#criarFornecedor': m24.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m24.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m24.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m24.puxarFornecedoresDoOmie as Acao,
  'importacao#previaImportacao': m25.previaImportacao as Acao,
  'importacao#confirmarImportacao': m25.confirmarImportacao as Acao,
  'importar-pedidos#previaImportacaoPedidos': m26.previaImportacaoPedidos as Acao,
  'importar-pedidos#confirmarImportacaoPedidos': m26.confirmarImportacaoPedidos as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m27.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m27.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m28.abrirInventario as Acao,
  'inventario-proprio#contarItem': m28.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m28.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m28.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m28.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m28.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m28.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m29.createInventario as Acao,
  'inventario#addInventarioItem': m29.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m29.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m29.removeInventarioItem as Acao,
  'inventario#finishInventario': m29.finishInventario as Acao,
  'inventario#forceSyncInventario': m29.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m29.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m29.duplicarInventario as Acao,
  'inventario#excluirInventario': m29.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m29.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m29.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m30.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m30.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m30.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m31.setCurrentLoja as Acao,
  'loja#criarLoja': m32.criarLoja as Acao,
  'loja#editarLoja': m32.editarLoja as Acao,
  'loja#alternarAtivoLoja': m32.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m32.excluirLoja as Acao,
  'loja#forceSyncLoja': m32.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m32.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m33.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m34.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m35.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m36.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m36.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m37.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m38.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m38.retryMovimentosManuaisPendentes as Acao,
  'nfe-saida#conferirNfeSaida': m39.conferirNfeSaida as Acao,
  'nfe-saida#emitirNfeSaida': m39.emitirNfeSaida as Acao,
  'nfe-saida#consultarNfeSaida': m39.consultarNfeSaida as Acao,
  'nfe-saida#cancelarNfeSaida': m39.cancelarNfeSaida as Acao,
  'nfe-saida#corrigirNfeSaida': m39.corrigirNfeSaida as Acao,
  'nfe-saida#descartarNfeSaida': m39.descartarNfeSaida as Acao,
  'nfe-saida#salvarConfigNfe': m39.salvarConfigNfe as Acao,
  'nfe-saida#definirProximoNumeroNfe': m39.definirProximoNumeroNfe as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m40.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m40.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m40.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m40.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m40.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m40.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m40.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m40.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m40.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m40.criarProdutoParaNF as Acao,
  'nota-fiscal-proprio#configurarItemNF': m40.configurarItemNF as Acao,
  'nota-fiscal-proprio#marcarConferidaNF': m40.marcarConferidaNF as Acao,
  'nota-fiscal-proprio#salvarObservacaoNF': m40.salvarObservacaoNF as Acao,
  'nota-fiscal-proprio#manifestarNotaSefaz': m40.manifestarNotaSefaz as Acao,
  'nota-fiscal-proprio#importarCteNF': m40.importarCteNF as Acao,
  'nota-fiscal-proprio#informarFreteNF': m40.informarFreteNF as Acao,
  'nota-fiscal-proprio#desvincularCteNF': m40.desvincularCteNF as Acao,
  'nota-fiscal-proprio#buscarNotaPorChaveNF': m40.buscarNotaPorChaveNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m41.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m41.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNota': m41.setCategoriaContabilNota as Acao,
  'nota-fiscal#classificarItensPeloProduto': m41.classificarItensPeloProduto as Acao,
  'nota-fiscal#manifestarNF': m41.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m41.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m41.excluirRecebimentoNF as Acao,
  'notificacoes#minhasNotificacoes': m42.minhasNotificacoes as Acao,
  'notificacoes#marcarNotificacaoLida': m42.marcarNotificacaoLida as Acao,
  'notificacoes#marcarTodasLidas': m42.marcarTodasLidas as Acao,
  'onboarding-loja#gerarCodigoLoja': m43.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m43.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m44.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m45.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m45.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m45.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m45.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m45.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m45.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m45.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m45.finishOP as Acao,
  'ordem-producao#excluirOP': m45.excluirOP as Acao,
  'ordem-producao#reverterOP': m45.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m45.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m45.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m45.reverterOPsEmLote as Acao,
  'pedido-compra#salvarPedidoCompra': m46.salvarPedidoCompra as Acao,
  'pedido-compra#mudarEtapaPedido': m46.mudarEtapaPedido as Acao,
  'pedido-compra#enviarPedidoAoOmieAgora': m46.enviarPedidoAoOmieAgora as Acao,
  'pedido-compra#vincularNotaAoPedido': m46.vincularNotaAoPedido as Acao,
  'pedido-compra#desvincularNotaDoPedido': m46.desvincularNotaDoPedido as Acao,
  'pedido-compra#criarPedidosDaSugestao': m46.criarPedidosDaSugestao as Acao,
  'pedido-compra#salvarLeadTime': m46.salvarLeadTime as Acao,
  'periodo-fechado#fecharMes': m47.fecharMes as Acao,
  'periodo-fechado#reabrirMes': m47.reabrirMes as Acao,
  'periodo-fechado#pendenciasDoMes': m47.pendenciasDoMes as Acao,
  'produto-minimo#setEstoqueMinimo': m48.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m49.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m49.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m50.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m50.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m50.criarProduto as Acao,
  'produto#editarProduto': m50.editarProduto as Acao,
  'produto#excluirProduto': m50.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m51.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m51.buscarProdutoPorCodigo as Acao,
  'requisicao-compra#salvarRequisicao': m52.salvarRequisicao as Acao,
  'requisicao-compra#acaoRequisicao': m52.acaoRequisicao as Acao,
  'requisicao-compra#gerarPedidosDasRequisicoes': m52.gerarPedidosDasRequisicoes as Acao,
  'requisicao-compra#criarRequisicaoDaSugestao': m52.criarRequisicaoDaSugestao as Acao,
  'sintegra#consultarCnpj': m53.consultarCnpj as Acao,
  'sintegra#importarParceiro': m53.importarParceiro as Acao,
  'sync-status#reprocessarSync': m54.reprocessarSync as Acao,
  'transferencia-loja#registrarTransferenciaLoja': m55.registrarTransferenciaLoja as Acao,
  'transferencia-loja#cancelarTransferenciaLoja': m55.cancelarTransferenciaLoja as Acao,
  'transferencia#createTransferencia': m56.createTransferencia as Acao,
  'transferencia#addMovimento': m56.addMovimento as Acao,
  'transferencia#enviarMovimento': m56.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m56.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m56.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m56.removeMovimento as Acao,
  'transferencia#finishTransferencia': m56.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m56.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m56.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m56.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m56.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m56.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m57.criarUsuario as Acao,
  'usuario#editarUsuario': m57.editarUsuario as Acao,
  'usuario#aprovarUsuario': m57.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m57.recusarUsuario as Acao,
  'usuario#excluirUsuario': m57.excluirUsuario as Acao,
  'usuario#togglePermissao': m57.togglePermissao as Acao,
  'usuario#redefinirSenha': m57.redefinirSenha as Acao,
  'usuario#toggleLocal': m57.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m58.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m58.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m58.reconciliarLotes as Acao,
  'variacao-preco#salvarLimiteVariacaoPreco': m59.salvarLimiteVariacaoPreco as Acao,
})
