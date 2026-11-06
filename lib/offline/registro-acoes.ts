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
import * as m10 from '@/lib/actions/compras-cadastros'
import * as m11 from '@/lib/actions/compras-proprio'
import * as m12 from '@/lib/actions/convite'
import * as m13 from '@/lib/actions/detalhe-movimento'
import * as m14 from '@/lib/actions/devolucao-fornecedor'
import * as m15 from '@/lib/actions/estoque-omie'
import * as m16 from '@/lib/actions/estoque-proprio'
import * as m17 from '@/lib/actions/estrutura'
import * as m18 from '@/lib/actions/familia'
import * as m19 from '@/lib/actions/ficha-tecnica'
import * as m20 from '@/lib/actions/fichas-omie'
import * as m21 from '@/lib/actions/financeiro-receber'
import * as m22 from '@/lib/actions/financeiro'
import * as m23 from '@/lib/actions/fornecedor'
import * as m24 from '@/lib/actions/importacao'
import * as m25 from '@/lib/actions/importar-pedidos'
import * as m26 from '@/lib/actions/integracao-ntb-vendas'
import * as m27 from '@/lib/actions/inventario-proprio'
import * as m28 from '@/lib/actions/inventario'
import * as m29 from '@/lib/actions/local-estoque'
import * as m30 from '@/lib/actions/loja-selector'
import * as m31 from '@/lib/actions/loja'
import * as m32 from '@/lib/actions/mapeamento-local-estoque'
import * as m33 from '@/lib/actions/meta-faturamento'
import * as m34 from '@/lib/actions/meta-mensal'
import * as m35 from '@/lib/actions/minha-loja'
import * as m36 from '@/lib/actions/movimentacoes-proprio'
import * as m37 from '@/lib/actions/movimentacoes'
import * as m38 from '@/lib/actions/nfe-saida'
import * as m39 from '@/lib/actions/nota-fiscal-proprio'
import * as m40 from '@/lib/actions/nota-fiscal'
import * as m41 from '@/lib/actions/notificacoes'
import * as m42 from '@/lib/actions/onboarding-loja'
import * as m43 from '@/lib/actions/ops-lote'
import * as m44 from '@/lib/actions/ordem-producao'
import * as m45 from '@/lib/actions/pedido-compra'
import * as m46 from '@/lib/actions/periodo-fechado'
import * as m47 from '@/lib/actions/produto-minimo'
import * as m48 from '@/lib/actions/produto-substituicao'
import * as m49 from '@/lib/actions/produto'
import * as m50 from '@/lib/actions/produtos-search'
import * as m51 from '@/lib/actions/requisicao-compra'
import * as m52 from '@/lib/actions/sintegra'
import * as m53 from '@/lib/actions/sync-status'
import * as m54 from '@/lib/actions/transferencia-loja'
import * as m55 from '@/lib/actions/transferencia'
import * as m56 from '@/lib/actions/usuario'
import * as m57 from '@/lib/actions/validade-proprio'

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
  'compras-cadastros#salvarComprador': m10.salvarComprador as Acao,
  'compras-cadastros#salvarLeadTimeFornecedor': m10.salvarLeadTimeFornecedor as Acao,
  'compras-proprio#previaXml': m11.previaXml as Acao,
  'compras-proprio#lancarCompraXml': m11.lancarCompraXml as Acao,
  'compras-proprio#lancarCompraManual': m11.lancarCompraManual as Acao,
  'compras-proprio#mapearPendentes': m11.mapearPendentes as Acao,
  'compras-proprio#estornarCompra': m11.estornarCompra as Acao,
  'compras-proprio#buscarProdutosCompra': m11.buscarProdutosCompra as Acao,
  'compras-proprio#criarProdutoRapido': m11.criarProdutoRapido as Acao,
  'convite#gerarConvite': m12.gerarConvite as Acao,
  'convite#revogarConvite': m12.revogarConvite as Acao,
  'detalhe-movimento#buscarDetalheOP': m13.buscarDetalheOP as Acao,
  'detalhe-movimento#buscarDetalheTransferencia': m13.buscarDetalheTransferencia as Acao,
  'detalhe-movimento#buscarDetalheNotaFiscal': m13.buscarDetalheNotaFiscal as Acao,
  'detalhe-movimento#buscarDetalheInventario': m13.buscarDetalheInventario as Acao,
  'devolucao-fornecedor#registrarDevolucao': m14.registrarDevolucao as Acao,
  'devolucao-fornecedor#cancelarDevolucao': m14.cancelarDevolucao as Acao,
  'estoque-omie#entradaOmie': m15.entradaOmie as Acao,
  'estoque-omie#ajusteOmie': m15.ajusteOmie as Acao,
  'estoque-omie#transferirOmie': m15.transferirOmie as Acao,
  'estoque-omie#corrigirCustoAjuste': m15.corrigirCustoAjuste as Acao,
  'estoque-omie#relancarCorrecaoCusto': m15.relancarCorrecaoCusto as Acao,
  'estoque-proprio#entradaManual': m16.entradaManual as Acao,
  'estoque-proprio#ajusteManual': m16.ajusteManual as Acao,
  'estoque-proprio#definirMinimo': m16.definirMinimo as Acao,
  'estoque-proprio#transferirEntreLocais': m16.transferirEntreLocais as Acao,
  'estoque-proprio#estornarMovimento': m16.estornarMovimento as Acao,
  'estrutura#verEstrutura': m17.verEstrutura as Acao,
  'estrutura#salvarEstrutura': m17.salvarEstrutura as Acao,
  'familia#criarFamilia': m18.criarFamilia as Acao,
  'familia#editarFamilia': m18.editarFamilia as Acao,
  'familia#excluirFamilia': m18.excluirFamilia as Acao,
  'familia#puxarFamiliasDoOmie': m18.puxarFamiliasDoOmie as Acao,
  'ficha-tecnica#salvarFichaTecnica': m19.salvarFichaTecnica as Acao,
  'ficha-tecnica#desativarFichaTecnica': m19.desativarFichaTecnica as Acao,
  'ficha-tecnica#produzirLoteAction': m19.produzirLoteAction as Acao,
  'fichas-omie#trocarInsumoNoPrato': m20.trocarInsumoNoPrato as Acao,
  'financeiro-receber#salvarFormaRecebimento': m21.salvarFormaRecebimento as Acao,
  'financeiro-receber#gerarContasReceberVendas': m21.gerarContasReceberVendas as Acao,
  'financeiro-receber#registrarRecebimento': m21.registrarRecebimento as Acao,
  'financeiro-receber#estornarRecebimento': m21.estornarRecebimento as Acao,
  'financeiro#salvarContaCorrente': m22.salvarContaCorrente as Acao,
  'financeiro#salvarCategoriaFinanceira': m22.salvarCategoriaFinanceira as Acao,
  'financeiro#criarCategoriasPadrao': m22.criarCategoriasPadrao as Acao,
  'financeiro#salvarTituloPagar': m22.salvarTituloPagar as Acao,
  'financeiro#cancelarTituloPagar': m22.cancelarTituloPagar as Acao,
  'financeiro#registrarPagamentoTitulo': m22.registrarPagamentoTitulo as Acao,
  'financeiro#estornarPagamentoTitulo': m22.estornarPagamentoTitulo as Acao,
  'financeiro#gerarContasPagarDaNota': m22.gerarContasPagarDaNota as Acao,
  'financeiro#salvarFamiliaCategoria': m22.salvarFamiliaCategoria as Acao,
  'financeiro#gerarContasNotasSemConta': m22.gerarContasNotasSemConta as Acao,
  'financeiro#decidirNotaDesfeita': m22.decidirNotaDesfeita as Acao,
  'financeiro#salvarConfigFinanceiro': m22.salvarConfigFinanceiro as Acao,
  'financeiro#decidirAprovacaoTitulo': m22.decidirAprovacaoTitulo as Acao,
  'financeiro#confirmarValorTitulo': m22.confirmarValorTitulo as Acao,
  'financeiro#salvarRecorrente': m22.salvarRecorrente as Acao,
  'financeiro#gerarRecorrentesAgora': m22.gerarRecorrentesAgora as Acao,
  'financeiro#registrarLancamentoAvulso': m22.registrarLancamentoAvulso as Acao,
  'financeiro#estornarLancamentoAvulso': m22.estornarLancamentoAvulso as Acao,
  'financeiro#registrarTransferencia': m22.registrarTransferencia as Acao,
  'financeiro#estornarTransferencia': m22.estornarTransferencia as Acao,
  'fornecedor#criarFornecedor': m23.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m23.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m23.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m23.puxarFornecedoresDoOmie as Acao,
  'importacao#previaImportacao': m24.previaImportacao as Acao,
  'importacao#confirmarImportacao': m24.confirmarImportacao as Acao,
  'importar-pedidos#previaImportacaoPedidos': m25.previaImportacaoPedidos as Acao,
  'importar-pedidos#confirmarImportacaoPedidos': m25.confirmarImportacaoPedidos as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m26.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m26.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m27.abrirInventario as Acao,
  'inventario-proprio#contarItem': m27.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m27.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m27.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m27.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m27.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m27.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m28.createInventario as Acao,
  'inventario#addInventarioItem': m28.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m28.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m28.removeInventarioItem as Acao,
  'inventario#finishInventario': m28.finishInventario as Acao,
  'inventario#forceSyncInventario': m28.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m28.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m28.duplicarInventario as Acao,
  'inventario#excluirInventario': m28.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m28.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m28.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m29.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m29.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m29.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m30.setCurrentLoja as Acao,
  'loja#criarLoja': m31.criarLoja as Acao,
  'loja#editarLoja': m31.editarLoja as Acao,
  'loja#alternarAtivoLoja': m31.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m31.excluirLoja as Acao,
  'loja#forceSyncLoja': m31.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m31.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m32.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m33.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m34.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m35.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m35.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m36.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m37.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m37.retryMovimentosManuaisPendentes as Acao,
  'nfe-saida#conferirNfeSaida': m38.conferirNfeSaida as Acao,
  'nfe-saida#emitirNfeSaida': m38.emitirNfeSaida as Acao,
  'nfe-saida#consultarNfeSaida': m38.consultarNfeSaida as Acao,
  'nfe-saida#cancelarNfeSaida': m38.cancelarNfeSaida as Acao,
  'nfe-saida#corrigirNfeSaida': m38.corrigirNfeSaida as Acao,
  'nfe-saida#descartarNfeSaida': m38.descartarNfeSaida as Acao,
  'nfe-saida#salvarConfigNfe': m38.salvarConfigNfe as Acao,
  'nfe-saida#definirProximoNumeroNfe': m38.definirProximoNumeroNfe as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m39.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m39.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m39.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m39.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m39.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m39.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m39.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m39.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m39.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m39.criarProdutoParaNF as Acao,
  'nota-fiscal-proprio#configurarItemNF': m39.configurarItemNF as Acao,
  'nota-fiscal-proprio#marcarConferidaNF': m39.marcarConferidaNF as Acao,
  'nota-fiscal-proprio#salvarObservacaoNF': m39.salvarObservacaoNF as Acao,
  'nota-fiscal-proprio#manifestarNotaSefaz': m39.manifestarNotaSefaz as Acao,
  'nota-fiscal-proprio#importarCteNF': m39.importarCteNF as Acao,
  'nota-fiscal-proprio#informarFreteNF': m39.informarFreteNF as Acao,
  'nota-fiscal-proprio#desvincularCteNF': m39.desvincularCteNF as Acao,
  'nota-fiscal-proprio#buscarNotaPorChaveNF': m39.buscarNotaPorChaveNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m40.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m40.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNota': m40.setCategoriaContabilNota as Acao,
  'nota-fiscal#classificarItensPeloProduto': m40.classificarItensPeloProduto as Acao,
  'nota-fiscal#manifestarNF': m40.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m40.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m40.excluirRecebimentoNF as Acao,
  'notificacoes#minhasNotificacoes': m41.minhasNotificacoes as Acao,
  'notificacoes#marcarNotificacaoLida': m41.marcarNotificacaoLida as Acao,
  'notificacoes#marcarTodasLidas': m41.marcarTodasLidas as Acao,
  'onboarding-loja#gerarCodigoLoja': m42.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m42.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m43.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m44.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m44.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m44.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m44.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m44.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m44.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m44.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m44.finishOP as Acao,
  'ordem-producao#excluirOP': m44.excluirOP as Acao,
  'ordem-producao#reverterOP': m44.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m44.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m44.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m44.reverterOPsEmLote as Acao,
  'pedido-compra#salvarPedidoCompra': m45.salvarPedidoCompra as Acao,
  'pedido-compra#mudarEtapaPedido': m45.mudarEtapaPedido as Acao,
  'pedido-compra#enviarPedidoAoOmieAgora': m45.enviarPedidoAoOmieAgora as Acao,
  'pedido-compra#vincularNotaAoPedido': m45.vincularNotaAoPedido as Acao,
  'pedido-compra#desvincularNotaDoPedido': m45.desvincularNotaDoPedido as Acao,
  'pedido-compra#criarPedidosDaSugestao': m45.criarPedidosDaSugestao as Acao,
  'pedido-compra#salvarLeadTime': m45.salvarLeadTime as Acao,
  'periodo-fechado#fecharMes': m46.fecharMes as Acao,
  'periodo-fechado#reabrirMes': m46.reabrirMes as Acao,
  'periodo-fechado#pendenciasDoMes': m46.pendenciasDoMes as Acao,
  'produto-minimo#setEstoqueMinimo': m47.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m48.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m48.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m49.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m49.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m49.criarProduto as Acao,
  'produto#editarProduto': m49.editarProduto as Acao,
  'produto#excluirProduto': m49.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m50.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m50.buscarProdutoPorCodigo as Acao,
  'requisicao-compra#salvarRequisicao': m51.salvarRequisicao as Acao,
  'requisicao-compra#acaoRequisicao': m51.acaoRequisicao as Acao,
  'requisicao-compra#gerarPedidosDasRequisicoes': m51.gerarPedidosDasRequisicoes as Acao,
  'requisicao-compra#criarRequisicaoDaSugestao': m51.criarRequisicaoDaSugestao as Acao,
  'sintegra#consultarCnpj': m52.consultarCnpj as Acao,
  'sintegra#importarParceiro': m52.importarParceiro as Acao,
  'sync-status#reprocessarSync': m53.reprocessarSync as Acao,
  'transferencia-loja#registrarTransferenciaLoja': m54.registrarTransferenciaLoja as Acao,
  'transferencia-loja#cancelarTransferenciaLoja': m54.cancelarTransferenciaLoja as Acao,
  'transferencia#createTransferencia': m55.createTransferencia as Acao,
  'transferencia#addMovimento': m55.addMovimento as Acao,
  'transferencia#enviarMovimento': m55.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m55.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m55.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m55.removeMovimento as Acao,
  'transferencia#finishTransferencia': m55.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m55.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m55.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m55.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m55.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m55.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m56.criarUsuario as Acao,
  'usuario#editarUsuario': m56.editarUsuario as Acao,
  'usuario#aprovarUsuario': m56.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m56.recusarUsuario as Acao,
  'usuario#excluirUsuario': m56.excluirUsuario as Acao,
  'usuario#togglePermissao': m56.togglePermissao as Acao,
  'usuario#redefinirSenha': m56.redefinirSenha as Acao,
  'usuario#toggleLocal': m56.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m57.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m57.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m57.reconciliarLotes as Acao,
})
