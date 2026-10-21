// GERADO por scripts/inserir-via-desktop.mjs -- não editar à mão.
// Todas as server actions, pelo nome usado no canal do app desktop (modulo#funcao).
import * as m0 from '@/lib/actions/anexos'
import * as m1 from '@/lib/actions/auth'
import * as m2 from '@/lib/actions/busca-global'
import * as m3 from '@/lib/actions/cadastro'
import * as m4 from '@/lib/actions/cargo'
import * as m5 from '@/lib/actions/catalogo-proprio'
import * as m6 from '@/lib/actions/categoria-contabil'
import * as m7 from '@/lib/actions/central'
import * as m8 from '@/lib/actions/certificado'
import * as m9 from '@/lib/actions/compras-cadastros'
import * as m10 from '@/lib/actions/compras-proprio'
import * as m11 from '@/lib/actions/convite'
import * as m12 from '@/lib/actions/detalhe-movimento'
import * as m13 from '@/lib/actions/devolucao-fornecedor'
import * as m14 from '@/lib/actions/estoque-omie'
import * as m15 from '@/lib/actions/estoque-proprio'
import * as m16 from '@/lib/actions/estrutura'
import * as m17 from '@/lib/actions/familia'
import * as m18 from '@/lib/actions/ficha-tecnica'
import * as m19 from '@/lib/actions/fichas-omie'
import * as m20 from '@/lib/actions/financeiro'
import * as m21 from '@/lib/actions/fornecedor'
import * as m22 from '@/lib/actions/importacao'
import * as m23 from '@/lib/actions/importar-pedidos'
import * as m24 from '@/lib/actions/integracao-ntb-vendas'
import * as m25 from '@/lib/actions/inventario-proprio'
import * as m26 from '@/lib/actions/inventario'
import * as m27 from '@/lib/actions/local-estoque'
import * as m28 from '@/lib/actions/loja-selector'
import * as m29 from '@/lib/actions/loja'
import * as m30 from '@/lib/actions/mapeamento-local-estoque'
import * as m31 from '@/lib/actions/meta-faturamento'
import * as m32 from '@/lib/actions/meta-mensal'
import * as m33 from '@/lib/actions/minha-loja'
import * as m34 from '@/lib/actions/movimentacoes-proprio'
import * as m35 from '@/lib/actions/movimentacoes'
import * as m36 from '@/lib/actions/nfe-saida'
import * as m37 from '@/lib/actions/nota-fiscal-proprio'
import * as m38 from '@/lib/actions/nota-fiscal'
import * as m39 from '@/lib/actions/notificacoes'
import * as m40 from '@/lib/actions/onboarding-loja'
import * as m41 from '@/lib/actions/ops-lote'
import * as m42 from '@/lib/actions/ordem-producao'
import * as m43 from '@/lib/actions/pedido-compra'
import * as m44 from '@/lib/actions/periodo-fechado'
import * as m45 from '@/lib/actions/produto-minimo'
import * as m46 from '@/lib/actions/produto-substituicao'
import * as m47 from '@/lib/actions/produto'
import * as m48 from '@/lib/actions/produtos-search'
import * as m49 from '@/lib/actions/requisicao-compra'
import * as m50 from '@/lib/actions/sintegra'
import * as m51 from '@/lib/actions/sync-status'
import * as m52 from '@/lib/actions/transferencia-loja'
import * as m53 from '@/lib/actions/transferencia'
import * as m54 from '@/lib/actions/usuario'
import * as m55 from '@/lib/actions/validade-proprio'

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
  'central#marcarEstadoProblema': m7.marcarEstadoProblema as Acao,
  'central#marcarNaoControla': m7.marcarNaoControla as Acao,
  'central#lancarOPCorrecao': m7.lancarOPCorrecao as Acao,
  'central#carregarPainel': m7.carregarPainel as Acao,
  'central#previaRefazerInventario': m7.previaRefazerInventario as Acao,
  'central#refazerInventario': m7.refazerInventario as Acao,
  'certificado#salvarCertificado': m8.salvarCertificado as Acao,
  'compras-cadastros#salvarComprador': m9.salvarComprador as Acao,
  'compras-cadastros#salvarLeadTimeFornecedor': m9.salvarLeadTimeFornecedor as Acao,
  'compras-proprio#previaXml': m10.previaXml as Acao,
  'compras-proprio#lancarCompraXml': m10.lancarCompraXml as Acao,
  'compras-proprio#lancarCompraManual': m10.lancarCompraManual as Acao,
  'compras-proprio#mapearPendentes': m10.mapearPendentes as Acao,
  'compras-proprio#estornarCompra': m10.estornarCompra as Acao,
  'compras-proprio#buscarProdutosCompra': m10.buscarProdutosCompra as Acao,
  'compras-proprio#criarProdutoRapido': m10.criarProdutoRapido as Acao,
  'convite#gerarConvite': m11.gerarConvite as Acao,
  'convite#revogarConvite': m11.revogarConvite as Acao,
  'detalhe-movimento#buscarDetalheOP': m12.buscarDetalheOP as Acao,
  'detalhe-movimento#buscarDetalheTransferencia': m12.buscarDetalheTransferencia as Acao,
  'detalhe-movimento#buscarDetalheNotaFiscal': m12.buscarDetalheNotaFiscal as Acao,
  'detalhe-movimento#buscarDetalheInventario': m12.buscarDetalheInventario as Acao,
  'devolucao-fornecedor#registrarDevolucao': m13.registrarDevolucao as Acao,
  'devolucao-fornecedor#cancelarDevolucao': m13.cancelarDevolucao as Acao,
  'estoque-omie#entradaOmie': m14.entradaOmie as Acao,
  'estoque-omie#ajusteOmie': m14.ajusteOmie as Acao,
  'estoque-omie#transferirOmie': m14.transferirOmie as Acao,
  'estoque-omie#corrigirCustoAjuste': m14.corrigirCustoAjuste as Acao,
  'estoque-omie#relancarCorrecaoCusto': m14.relancarCorrecaoCusto as Acao,
  'estoque-proprio#entradaManual': m15.entradaManual as Acao,
  'estoque-proprio#ajusteManual': m15.ajusteManual as Acao,
  'estoque-proprio#definirMinimo': m15.definirMinimo as Acao,
  'estoque-proprio#transferirEntreLocais': m15.transferirEntreLocais as Acao,
  'estoque-proprio#estornarMovimento': m15.estornarMovimento as Acao,
  'estrutura#verEstrutura': m16.verEstrutura as Acao,
  'estrutura#salvarEstrutura': m16.salvarEstrutura as Acao,
  'familia#criarFamilia': m17.criarFamilia as Acao,
  'familia#editarFamilia': m17.editarFamilia as Acao,
  'familia#excluirFamilia': m17.excluirFamilia as Acao,
  'familia#puxarFamiliasDoOmie': m17.puxarFamiliasDoOmie as Acao,
  'ficha-tecnica#salvarFichaTecnica': m18.salvarFichaTecnica as Acao,
  'ficha-tecnica#desativarFichaTecnica': m18.desativarFichaTecnica as Acao,
  'ficha-tecnica#produzirLoteAction': m18.produzirLoteAction as Acao,
  'fichas-omie#trocarInsumoNoPrato': m19.trocarInsumoNoPrato as Acao,
  'financeiro#salvarContaCorrente': m20.salvarContaCorrente as Acao,
  'financeiro#salvarCategoriaFinanceira': m20.salvarCategoriaFinanceira as Acao,
  'financeiro#criarCategoriasPadrao': m20.criarCategoriasPadrao as Acao,
  'financeiro#salvarTituloPagar': m20.salvarTituloPagar as Acao,
  'financeiro#cancelarTituloPagar': m20.cancelarTituloPagar as Acao,
  'financeiro#registrarPagamentoTitulo': m20.registrarPagamentoTitulo as Acao,
  'financeiro#estornarPagamentoTitulo': m20.estornarPagamentoTitulo as Acao,
  'fornecedor#criarFornecedor': m21.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m21.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m21.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m21.puxarFornecedoresDoOmie as Acao,
  'importacao#previaImportacao': m22.previaImportacao as Acao,
  'importacao#confirmarImportacao': m22.confirmarImportacao as Acao,
  'importar-pedidos#previaImportacaoPedidos': m23.previaImportacaoPedidos as Acao,
  'importar-pedidos#confirmarImportacaoPedidos': m23.confirmarImportacaoPedidos as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m24.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m24.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m25.abrirInventario as Acao,
  'inventario-proprio#contarItem': m25.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m25.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m25.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m25.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m25.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m25.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m26.createInventario as Acao,
  'inventario#addInventarioItem': m26.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m26.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m26.removeInventarioItem as Acao,
  'inventario#finishInventario': m26.finishInventario as Acao,
  'inventario#forceSyncInventario': m26.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m26.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m26.duplicarInventario as Acao,
  'inventario#excluirInventario': m26.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m26.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m26.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m27.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m27.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m27.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m28.setCurrentLoja as Acao,
  'loja#criarLoja': m29.criarLoja as Acao,
  'loja#editarLoja': m29.editarLoja as Acao,
  'loja#alternarAtivoLoja': m29.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m29.excluirLoja as Acao,
  'loja#forceSyncLoja': m29.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m29.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m30.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m31.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m32.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m33.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m33.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m34.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m35.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m35.retryMovimentosManuaisPendentes as Acao,
  'nfe-saida#conferirNfeSaida': m36.conferirNfeSaida as Acao,
  'nfe-saida#emitirNfeSaida': m36.emitirNfeSaida as Acao,
  'nfe-saida#consultarNfeSaida': m36.consultarNfeSaida as Acao,
  'nfe-saida#cancelarNfeSaida': m36.cancelarNfeSaida as Acao,
  'nfe-saida#corrigirNfeSaida': m36.corrigirNfeSaida as Acao,
  'nfe-saida#descartarNfeSaida': m36.descartarNfeSaida as Acao,
  'nfe-saida#salvarConfigNfe': m36.salvarConfigNfe as Acao,
  'nfe-saida#definirProximoNumeroNfe': m36.definirProximoNumeroNfe as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m37.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m37.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m37.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m37.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m37.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m37.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m37.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m37.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m37.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m37.criarProdutoParaNF as Acao,
  'nota-fiscal-proprio#configurarItemNF': m37.configurarItemNF as Acao,
  'nota-fiscal-proprio#marcarConferidaNF': m37.marcarConferidaNF as Acao,
  'nota-fiscal-proprio#salvarObservacaoNF': m37.salvarObservacaoNF as Acao,
  'nota-fiscal-proprio#manifestarNotaSefaz': m37.manifestarNotaSefaz as Acao,
  'nota-fiscal-proprio#importarCteNF': m37.importarCteNF as Acao,
  'nota-fiscal-proprio#informarFreteNF': m37.informarFreteNF as Acao,
  'nota-fiscal-proprio#desvincularCteNF': m37.desvincularCteNF as Acao,
  'nota-fiscal-proprio#buscarNotaPorChaveNF': m37.buscarNotaPorChaveNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m38.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m38.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#manifestarNF': m38.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m38.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m38.excluirRecebimentoNF as Acao,
  'notificacoes#minhasNotificacoes': m39.minhasNotificacoes as Acao,
  'notificacoes#marcarNotificacaoLida': m39.marcarNotificacaoLida as Acao,
  'notificacoes#marcarTodasLidas': m39.marcarTodasLidas as Acao,
  'onboarding-loja#gerarCodigoLoja': m40.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m40.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m41.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m42.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m42.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m42.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m42.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m42.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m42.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m42.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m42.finishOP as Acao,
  'ordem-producao#excluirOP': m42.excluirOP as Acao,
  'ordem-producao#reverterOP': m42.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m42.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m42.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m42.reverterOPsEmLote as Acao,
  'pedido-compra#salvarPedidoCompra': m43.salvarPedidoCompra as Acao,
  'pedido-compra#mudarEtapaPedido': m43.mudarEtapaPedido as Acao,
  'pedido-compra#enviarPedidoAoOmieAgora': m43.enviarPedidoAoOmieAgora as Acao,
  'pedido-compra#vincularNotaAoPedido': m43.vincularNotaAoPedido as Acao,
  'pedido-compra#desvincularNotaDoPedido': m43.desvincularNotaDoPedido as Acao,
  'pedido-compra#criarPedidosDaSugestao': m43.criarPedidosDaSugestao as Acao,
  'pedido-compra#salvarLeadTime': m43.salvarLeadTime as Acao,
  'periodo-fechado#fecharMes': m44.fecharMes as Acao,
  'periodo-fechado#reabrirMes': m44.reabrirMes as Acao,
  'periodo-fechado#pendenciasDoMes': m44.pendenciasDoMes as Acao,
  'produto-minimo#setEstoqueMinimo': m45.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m46.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m46.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m47.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m47.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m47.criarProduto as Acao,
  'produto#editarProduto': m47.editarProduto as Acao,
  'produto#excluirProduto': m47.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m48.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m48.buscarProdutoPorCodigo as Acao,
  'requisicao-compra#salvarRequisicao': m49.salvarRequisicao as Acao,
  'requisicao-compra#acaoRequisicao': m49.acaoRequisicao as Acao,
  'requisicao-compra#gerarPedidosDasRequisicoes': m49.gerarPedidosDasRequisicoes as Acao,
  'requisicao-compra#criarRequisicaoDaSugestao': m49.criarRequisicaoDaSugestao as Acao,
  'sintegra#consultarCnpj': m50.consultarCnpj as Acao,
  'sintegra#importarParceiro': m50.importarParceiro as Acao,
  'sync-status#reprocessarSync': m51.reprocessarSync as Acao,
  'transferencia-loja#registrarTransferenciaLoja': m52.registrarTransferenciaLoja as Acao,
  'transferencia-loja#cancelarTransferenciaLoja': m52.cancelarTransferenciaLoja as Acao,
  'transferencia#createTransferencia': m53.createTransferencia as Acao,
  'transferencia#addMovimento': m53.addMovimento as Acao,
  'transferencia#enviarMovimento': m53.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m53.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m53.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m53.removeMovimento as Acao,
  'transferencia#finishTransferencia': m53.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m53.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m53.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m53.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m53.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m53.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m54.criarUsuario as Acao,
  'usuario#editarUsuario': m54.editarUsuario as Acao,
  'usuario#aprovarUsuario': m54.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m54.recusarUsuario as Acao,
  'usuario#excluirUsuario': m54.excluirUsuario as Acao,
  'usuario#togglePermissao': m54.togglePermissao as Acao,
  'usuario#redefinirSenha': m54.redefinirSenha as Acao,
  'usuario#toggleLocal': m54.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m55.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m55.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m55.reconciliarLotes as Acao,
})
