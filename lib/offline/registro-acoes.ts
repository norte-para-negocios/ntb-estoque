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
import * as m14 from '@/lib/actions/custo-cardapio'
import * as m15 from '@/lib/actions/detalhe-movimento'
import * as m16 from '@/lib/actions/devolucao-fornecedor'
import * as m17 from '@/lib/actions/estoque-omie'
import * as m18 from '@/lib/actions/estoque-proprio'
import * as m19 from '@/lib/actions/estrutura'
import * as m20 from '@/lib/actions/familia'
import * as m21 from '@/lib/actions/ficha-tecnica'
import * as m22 from '@/lib/actions/fichas-omie'
import * as m23 from '@/lib/actions/financeiro-receber'
import * as m24 from '@/lib/actions/financeiro'
import * as m25 from '@/lib/actions/fornecedor'
import * as m26 from '@/lib/actions/importacao'
import * as m27 from '@/lib/actions/importar-pedidos'
import * as m28 from '@/lib/actions/integracao-ntb-vendas'
import * as m29 from '@/lib/actions/inventario-proprio'
import * as m30 from '@/lib/actions/inventario'
import * as m31 from '@/lib/actions/local-estoque'
import * as m32 from '@/lib/actions/loja-selector'
import * as m33 from '@/lib/actions/loja'
import * as m34 from '@/lib/actions/mapeamento-local-estoque'
import * as m35 from '@/lib/actions/meta-faturamento'
import * as m36 from '@/lib/actions/meta-mensal'
import * as m37 from '@/lib/actions/minha-loja'
import * as m38 from '@/lib/actions/movimentacoes-proprio'
import * as m39 from '@/lib/actions/movimentacoes'
import * as m40 from '@/lib/actions/nfe-saida'
import * as m41 from '@/lib/actions/nota-fiscal-proprio'
import * as m42 from '@/lib/actions/nota-fiscal'
import * as m43 from '@/lib/actions/notificacoes'
import * as m44 from '@/lib/actions/onboarding-loja'
import * as m45 from '@/lib/actions/ops-lote'
import * as m46 from '@/lib/actions/ordem-producao'
import * as m47 from '@/lib/actions/pedido-compra'
import * as m48 from '@/lib/actions/periodo-fechado'
import * as m49 from '@/lib/actions/produto-minimo'
import * as m50 from '@/lib/actions/produto-substituicao'
import * as m51 from '@/lib/actions/produto'
import * as m52 from '@/lib/actions/produtos-search'
import * as m53 from '@/lib/actions/requisicao-compra'
import * as m54 from '@/lib/actions/sintegra'
import * as m55 from '@/lib/actions/sync-status'
import * as m56 from '@/lib/actions/transferencia-loja'
import * as m57 from '@/lib/actions/transferencia'
import * as m58 from '@/lib/actions/usuario'
import * as m59 from '@/lib/actions/validade-proprio'
import * as m60 from '@/lib/actions/variacao-preco'

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
  'custo-cardapio#salvarTaxasCardapio': m14.salvarTaxasCardapio as Acao,
  'detalhe-movimento#buscarDetalheOP': m15.buscarDetalheOP as Acao,
  'detalhe-movimento#buscarDetalheTransferencia': m15.buscarDetalheTransferencia as Acao,
  'detalhe-movimento#buscarDetalheNotaFiscal': m15.buscarDetalheNotaFiscal as Acao,
  'detalhe-movimento#buscarDetalheInventario': m15.buscarDetalheInventario as Acao,
  'devolucao-fornecedor#registrarDevolucao': m16.registrarDevolucao as Acao,
  'devolucao-fornecedor#cancelarDevolucao': m16.cancelarDevolucao as Acao,
  'estoque-omie#entradaOmie': m17.entradaOmie as Acao,
  'estoque-omie#ajusteOmie': m17.ajusteOmie as Acao,
  'estoque-omie#transferirOmie': m17.transferirOmie as Acao,
  'estoque-omie#corrigirCustoAjuste': m17.corrigirCustoAjuste as Acao,
  'estoque-omie#relancarCorrecaoCusto': m17.relancarCorrecaoCusto as Acao,
  'estoque-proprio#entradaManual': m18.entradaManual as Acao,
  'estoque-proprio#ajusteManual': m18.ajusteManual as Acao,
  'estoque-proprio#definirMinimo': m18.definirMinimo as Acao,
  'estoque-proprio#transferirEntreLocais': m18.transferirEntreLocais as Acao,
  'estoque-proprio#estornarMovimento': m18.estornarMovimento as Acao,
  'estrutura#verEstrutura': m19.verEstrutura as Acao,
  'estrutura#salvarEstrutura': m19.salvarEstrutura as Acao,
  'familia#criarFamilia': m20.criarFamilia as Acao,
  'familia#editarFamilia': m20.editarFamilia as Acao,
  'familia#excluirFamilia': m20.excluirFamilia as Acao,
  'familia#puxarFamiliasDoOmie': m20.puxarFamiliasDoOmie as Acao,
  'ficha-tecnica#salvarFichaTecnica': m21.salvarFichaTecnica as Acao,
  'ficha-tecnica#desativarFichaTecnica': m21.desativarFichaTecnica as Acao,
  'ficha-tecnica#produzirLoteAction': m21.produzirLoteAction as Acao,
  'fichas-omie#trocarInsumoNoPrato': m22.trocarInsumoNoPrato as Acao,
  'financeiro-receber#salvarFormaRecebimento': m23.salvarFormaRecebimento as Acao,
  'financeiro-receber#gerarContasReceberVendas': m23.gerarContasReceberVendas as Acao,
  'financeiro-receber#registrarRecebimento': m23.registrarRecebimento as Acao,
  'financeiro-receber#estornarRecebimento': m23.estornarRecebimento as Acao,
  'financeiro#salvarContaCorrente': m24.salvarContaCorrente as Acao,
  'financeiro#salvarCategoriaFinanceira': m24.salvarCategoriaFinanceira as Acao,
  'financeiro#criarCategoriasPadrao': m24.criarCategoriasPadrao as Acao,
  'financeiro#salvarTituloPagar': m24.salvarTituloPagar as Acao,
  'financeiro#cancelarTituloPagar': m24.cancelarTituloPagar as Acao,
  'financeiro#registrarPagamentoTitulo': m24.registrarPagamentoTitulo as Acao,
  'financeiro#estornarPagamentoTitulo': m24.estornarPagamentoTitulo as Acao,
  'financeiro#gerarContasPagarDaNota': m24.gerarContasPagarDaNota as Acao,
  'financeiro#salvarFamiliaCategoria': m24.salvarFamiliaCategoria as Acao,
  'financeiro#gerarContasNotasSemConta': m24.gerarContasNotasSemConta as Acao,
  'financeiro#decidirNotaDesfeita': m24.decidirNotaDesfeita as Acao,
  'financeiro#salvarConfigFinanceiro': m24.salvarConfigFinanceiro as Acao,
  'financeiro#decidirAprovacaoTitulo': m24.decidirAprovacaoTitulo as Acao,
  'financeiro#confirmarValorTitulo': m24.confirmarValorTitulo as Acao,
  'financeiro#salvarRecorrente': m24.salvarRecorrente as Acao,
  'financeiro#gerarRecorrentesAgora': m24.gerarRecorrentesAgora as Acao,
  'financeiro#registrarLancamentoAvulso': m24.registrarLancamentoAvulso as Acao,
  'financeiro#estornarLancamentoAvulso': m24.estornarLancamentoAvulso as Acao,
  'financeiro#registrarTransferencia': m24.registrarTransferencia as Acao,
  'financeiro#estornarTransferencia': m24.estornarTransferencia as Acao,
  'fornecedor#criarFornecedor': m25.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m25.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m25.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m25.puxarFornecedoresDoOmie as Acao,
  'importacao#previaImportacao': m26.previaImportacao as Acao,
  'importacao#confirmarImportacao': m26.confirmarImportacao as Acao,
  'importar-pedidos#previaImportacaoPedidos': m27.previaImportacaoPedidos as Acao,
  'importar-pedidos#confirmarImportacaoPedidos': m27.confirmarImportacaoPedidos as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m28.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m28.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m29.abrirInventario as Acao,
  'inventario-proprio#contarItem': m29.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m29.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m29.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m29.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m29.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m29.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m30.createInventario as Acao,
  'inventario#addInventarioItem': m30.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m30.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m30.removeInventarioItem as Acao,
  'inventario#finishInventario': m30.finishInventario as Acao,
  'inventario#forceSyncInventario': m30.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m30.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m30.duplicarInventario as Acao,
  'inventario#excluirInventario': m30.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m30.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m30.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m31.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m31.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m31.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m32.setCurrentLoja as Acao,
  'loja#criarLoja': m33.criarLoja as Acao,
  'loja#editarLoja': m33.editarLoja as Acao,
  'loja#alternarAtivoLoja': m33.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m33.excluirLoja as Acao,
  'loja#forceSyncLoja': m33.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m33.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m34.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m35.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m36.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m37.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m37.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m38.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m39.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m39.retryMovimentosManuaisPendentes as Acao,
  'nfe-saida#conferirNfeSaida': m40.conferirNfeSaida as Acao,
  'nfe-saida#emitirNfeSaida': m40.emitirNfeSaida as Acao,
  'nfe-saida#consultarNfeSaida': m40.consultarNfeSaida as Acao,
  'nfe-saida#cancelarNfeSaida': m40.cancelarNfeSaida as Acao,
  'nfe-saida#corrigirNfeSaida': m40.corrigirNfeSaida as Acao,
  'nfe-saida#descartarNfeSaida': m40.descartarNfeSaida as Acao,
  'nfe-saida#salvarConfigNfe': m40.salvarConfigNfe as Acao,
  'nfe-saida#definirProximoNumeroNfe': m40.definirProximoNumeroNfe as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m41.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m41.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m41.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m41.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m41.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m41.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m41.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m41.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m41.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m41.criarProdutoParaNF as Acao,
  'nota-fiscal-proprio#configurarItemNF': m41.configurarItemNF as Acao,
  'nota-fiscal-proprio#marcarConferidaNF': m41.marcarConferidaNF as Acao,
  'nota-fiscal-proprio#salvarObservacaoNF': m41.salvarObservacaoNF as Acao,
  'nota-fiscal-proprio#manifestarNotaSefaz': m41.manifestarNotaSefaz as Acao,
  'nota-fiscal-proprio#importarCteNF': m41.importarCteNF as Acao,
  'nota-fiscal-proprio#informarFreteNF': m41.informarFreteNF as Acao,
  'nota-fiscal-proprio#desvincularCteNF': m41.desvincularCteNF as Acao,
  'nota-fiscal-proprio#buscarNotaPorChaveNF': m41.buscarNotaPorChaveNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m42.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m42.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNota': m42.setCategoriaContabilNota as Acao,
  'nota-fiscal#classificarItensPeloProduto': m42.classificarItensPeloProduto as Acao,
  'nota-fiscal#manifestarNF': m42.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m42.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m42.excluirRecebimentoNF as Acao,
  'notificacoes#minhasNotificacoes': m43.minhasNotificacoes as Acao,
  'notificacoes#marcarNotificacaoLida': m43.marcarNotificacaoLida as Acao,
  'notificacoes#marcarTodasLidas': m43.marcarTodasLidas as Acao,
  'onboarding-loja#gerarCodigoLoja': m44.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m44.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m45.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m46.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m46.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m46.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m46.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m46.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m46.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m46.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m46.finishOP as Acao,
  'ordem-producao#excluirOP': m46.excluirOP as Acao,
  'ordem-producao#reverterOP': m46.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m46.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m46.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m46.reverterOPsEmLote as Acao,
  'pedido-compra#salvarPedidoCompra': m47.salvarPedidoCompra as Acao,
  'pedido-compra#mudarEtapaPedido': m47.mudarEtapaPedido as Acao,
  'pedido-compra#enviarPedidoAoOmieAgora': m47.enviarPedidoAoOmieAgora as Acao,
  'pedido-compra#vincularNotaAoPedido': m47.vincularNotaAoPedido as Acao,
  'pedido-compra#desvincularNotaDoPedido': m47.desvincularNotaDoPedido as Acao,
  'pedido-compra#criarPedidosDaSugestao': m47.criarPedidosDaSugestao as Acao,
  'pedido-compra#salvarLeadTime': m47.salvarLeadTime as Acao,
  'periodo-fechado#fecharMes': m48.fecharMes as Acao,
  'periodo-fechado#reabrirMes': m48.reabrirMes as Acao,
  'periodo-fechado#pendenciasDoMes': m48.pendenciasDoMes as Acao,
  'produto-minimo#setEstoqueMinimo': m49.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m50.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m50.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m51.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m51.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m51.criarProduto as Acao,
  'produto#editarProduto': m51.editarProduto as Acao,
  'produto#excluirProduto': m51.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m52.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m52.buscarProdutoPorCodigo as Acao,
  'requisicao-compra#salvarRequisicao': m53.salvarRequisicao as Acao,
  'requisicao-compra#acaoRequisicao': m53.acaoRequisicao as Acao,
  'requisicao-compra#gerarPedidosDasRequisicoes': m53.gerarPedidosDasRequisicoes as Acao,
  'requisicao-compra#criarRequisicaoDaSugestao': m53.criarRequisicaoDaSugestao as Acao,
  'sintegra#consultarCnpj': m54.consultarCnpj as Acao,
  'sintegra#importarParceiro': m54.importarParceiro as Acao,
  'sync-status#reprocessarSync': m55.reprocessarSync as Acao,
  'transferencia-loja#registrarTransferenciaLoja': m56.registrarTransferenciaLoja as Acao,
  'transferencia-loja#cancelarTransferenciaLoja': m56.cancelarTransferenciaLoja as Acao,
  'transferencia#createTransferencia': m57.createTransferencia as Acao,
  'transferencia#addMovimento': m57.addMovimento as Acao,
  'transferencia#enviarMovimento': m57.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m57.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m57.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m57.removeMovimento as Acao,
  'transferencia#finishTransferencia': m57.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m57.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m57.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m57.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m57.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m57.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m58.criarUsuario as Acao,
  'usuario#editarUsuario': m58.editarUsuario as Acao,
  'usuario#aprovarUsuario': m58.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m58.recusarUsuario as Acao,
  'usuario#excluirUsuario': m58.excluirUsuario as Acao,
  'usuario#togglePermissao': m58.togglePermissao as Acao,
  'usuario#redefinirSenha': m58.redefinirSenha as Acao,
  'usuario#toggleLocal': m58.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m59.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m59.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m59.reconciliarLotes as Acao,
  'variacao-preco#salvarLimiteVariacaoPreco': m60.salvarLimiteVariacaoPreco as Acao,
})
