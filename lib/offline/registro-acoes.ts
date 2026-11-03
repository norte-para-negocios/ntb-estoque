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
import * as m21 from '@/lib/actions/financeiro'
import * as m22 from '@/lib/actions/fornecedor'
import * as m23 from '@/lib/actions/importacao'
import * as m24 from '@/lib/actions/importar-pedidos'
import * as m25 from '@/lib/actions/integracao-ntb-vendas'
import * as m26 from '@/lib/actions/inventario-proprio'
import * as m27 from '@/lib/actions/inventario'
import * as m28 from '@/lib/actions/local-estoque'
import * as m29 from '@/lib/actions/loja-selector'
import * as m30 from '@/lib/actions/loja'
import * as m31 from '@/lib/actions/mapeamento-local-estoque'
import * as m32 from '@/lib/actions/meta-faturamento'
import * as m33 from '@/lib/actions/meta-mensal'
import * as m34 from '@/lib/actions/minha-loja'
import * as m35 from '@/lib/actions/movimentacoes-proprio'
import * as m36 from '@/lib/actions/movimentacoes'
import * as m37 from '@/lib/actions/nfe-saida'
import * as m38 from '@/lib/actions/nota-fiscal-proprio'
import * as m39 from '@/lib/actions/nota-fiscal'
import * as m40 from '@/lib/actions/notificacoes'
import * as m41 from '@/lib/actions/onboarding-loja'
import * as m42 from '@/lib/actions/ops-lote'
import * as m43 from '@/lib/actions/ordem-producao'
import * as m44 from '@/lib/actions/pedido-compra'
import * as m45 from '@/lib/actions/periodo-fechado'
import * as m46 from '@/lib/actions/produto-minimo'
import * as m47 from '@/lib/actions/produto-substituicao'
import * as m48 from '@/lib/actions/produto'
import * as m49 from '@/lib/actions/produtos-search'
import * as m50 from '@/lib/actions/requisicao-compra'
import * as m51 from '@/lib/actions/sintegra'
import * as m52 from '@/lib/actions/sync-status'
import * as m53 from '@/lib/actions/transferencia-loja'
import * as m54 from '@/lib/actions/transferencia'
import * as m55 from '@/lib/actions/usuario'
import * as m56 from '@/lib/actions/validade-proprio'

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
  'financeiro#salvarContaCorrente': m21.salvarContaCorrente as Acao,
  'financeiro#salvarCategoriaFinanceira': m21.salvarCategoriaFinanceira as Acao,
  'financeiro#criarCategoriasPadrao': m21.criarCategoriasPadrao as Acao,
  'financeiro#salvarTituloPagar': m21.salvarTituloPagar as Acao,
  'financeiro#cancelarTituloPagar': m21.cancelarTituloPagar as Acao,
  'financeiro#registrarPagamentoTitulo': m21.registrarPagamentoTitulo as Acao,
  'financeiro#estornarPagamentoTitulo': m21.estornarPagamentoTitulo as Acao,
  'fornecedor#criarFornecedor': m22.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m22.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m22.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m22.puxarFornecedoresDoOmie as Acao,
  'importacao#previaImportacao': m23.previaImportacao as Acao,
  'importacao#confirmarImportacao': m23.confirmarImportacao as Acao,
  'importar-pedidos#previaImportacaoPedidos': m24.previaImportacaoPedidos as Acao,
  'importar-pedidos#confirmarImportacaoPedidos': m24.confirmarImportacaoPedidos as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m25.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m25.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m26.abrirInventario as Acao,
  'inventario-proprio#contarItem': m26.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m26.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m26.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m26.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m26.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m26.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m27.createInventario as Acao,
  'inventario#addInventarioItem': m27.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m27.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m27.removeInventarioItem as Acao,
  'inventario#finishInventario': m27.finishInventario as Acao,
  'inventario#forceSyncInventario': m27.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m27.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m27.duplicarInventario as Acao,
  'inventario#excluirInventario': m27.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m27.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m27.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m28.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m28.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m28.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m29.setCurrentLoja as Acao,
  'loja#criarLoja': m30.criarLoja as Acao,
  'loja#editarLoja': m30.editarLoja as Acao,
  'loja#alternarAtivoLoja': m30.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m30.excluirLoja as Acao,
  'loja#forceSyncLoja': m30.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m30.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m31.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m32.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m33.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m34.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m34.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m35.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m36.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m36.retryMovimentosManuaisPendentes as Acao,
  'nfe-saida#conferirNfeSaida': m37.conferirNfeSaida as Acao,
  'nfe-saida#emitirNfeSaida': m37.emitirNfeSaida as Acao,
  'nfe-saida#consultarNfeSaida': m37.consultarNfeSaida as Acao,
  'nfe-saida#cancelarNfeSaida': m37.cancelarNfeSaida as Acao,
  'nfe-saida#corrigirNfeSaida': m37.corrigirNfeSaida as Acao,
  'nfe-saida#descartarNfeSaida': m37.descartarNfeSaida as Acao,
  'nfe-saida#salvarConfigNfe': m37.salvarConfigNfe as Acao,
  'nfe-saida#definirProximoNumeroNfe': m37.definirProximoNumeroNfe as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m38.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m38.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m38.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m38.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m38.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m38.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m38.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m38.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m38.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m38.criarProdutoParaNF as Acao,
  'nota-fiscal-proprio#configurarItemNF': m38.configurarItemNF as Acao,
  'nota-fiscal-proprio#marcarConferidaNF': m38.marcarConferidaNF as Acao,
  'nota-fiscal-proprio#salvarObservacaoNF': m38.salvarObservacaoNF as Acao,
  'nota-fiscal-proprio#manifestarNotaSefaz': m38.manifestarNotaSefaz as Acao,
  'nota-fiscal-proprio#importarCteNF': m38.importarCteNF as Acao,
  'nota-fiscal-proprio#informarFreteNF': m38.informarFreteNF as Acao,
  'nota-fiscal-proprio#desvincularCteNF': m38.desvincularCteNF as Acao,
  'nota-fiscal-proprio#buscarNotaPorChaveNF': m38.buscarNotaPorChaveNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m39.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m39.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNota': m39.setCategoriaContabilNota as Acao,
  'nota-fiscal#classificarItensPeloProduto': m39.classificarItensPeloProduto as Acao,
  'nota-fiscal#manifestarNF': m39.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m39.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m39.excluirRecebimentoNF as Acao,
  'notificacoes#minhasNotificacoes': m40.minhasNotificacoes as Acao,
  'notificacoes#marcarNotificacaoLida': m40.marcarNotificacaoLida as Acao,
  'notificacoes#marcarTodasLidas': m40.marcarTodasLidas as Acao,
  'onboarding-loja#gerarCodigoLoja': m41.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m41.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m42.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m43.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m43.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m43.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m43.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m43.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m43.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m43.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m43.finishOP as Acao,
  'ordem-producao#excluirOP': m43.excluirOP as Acao,
  'ordem-producao#reverterOP': m43.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m43.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m43.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m43.reverterOPsEmLote as Acao,
  'pedido-compra#salvarPedidoCompra': m44.salvarPedidoCompra as Acao,
  'pedido-compra#mudarEtapaPedido': m44.mudarEtapaPedido as Acao,
  'pedido-compra#enviarPedidoAoOmieAgora': m44.enviarPedidoAoOmieAgora as Acao,
  'pedido-compra#vincularNotaAoPedido': m44.vincularNotaAoPedido as Acao,
  'pedido-compra#desvincularNotaDoPedido': m44.desvincularNotaDoPedido as Acao,
  'pedido-compra#criarPedidosDaSugestao': m44.criarPedidosDaSugestao as Acao,
  'pedido-compra#salvarLeadTime': m44.salvarLeadTime as Acao,
  'periodo-fechado#fecharMes': m45.fecharMes as Acao,
  'periodo-fechado#reabrirMes': m45.reabrirMes as Acao,
  'periodo-fechado#pendenciasDoMes': m45.pendenciasDoMes as Acao,
  'produto-minimo#setEstoqueMinimo': m46.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m47.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m47.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m48.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m48.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m48.criarProduto as Acao,
  'produto#editarProduto': m48.editarProduto as Acao,
  'produto#excluirProduto': m48.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m49.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m49.buscarProdutoPorCodigo as Acao,
  'requisicao-compra#salvarRequisicao': m50.salvarRequisicao as Acao,
  'requisicao-compra#acaoRequisicao': m50.acaoRequisicao as Acao,
  'requisicao-compra#gerarPedidosDasRequisicoes': m50.gerarPedidosDasRequisicoes as Acao,
  'requisicao-compra#criarRequisicaoDaSugestao': m50.criarRequisicaoDaSugestao as Acao,
  'sintegra#consultarCnpj': m51.consultarCnpj as Acao,
  'sintegra#importarParceiro': m51.importarParceiro as Acao,
  'sync-status#reprocessarSync': m52.reprocessarSync as Acao,
  'transferencia-loja#registrarTransferenciaLoja': m53.registrarTransferenciaLoja as Acao,
  'transferencia-loja#cancelarTransferenciaLoja': m53.cancelarTransferenciaLoja as Acao,
  'transferencia#createTransferencia': m54.createTransferencia as Acao,
  'transferencia#addMovimento': m54.addMovimento as Acao,
  'transferencia#enviarMovimento': m54.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m54.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m54.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m54.removeMovimento as Acao,
  'transferencia#finishTransferencia': m54.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m54.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m54.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m54.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m54.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m54.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m55.criarUsuario as Acao,
  'usuario#editarUsuario': m55.editarUsuario as Acao,
  'usuario#aprovarUsuario': m55.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m55.recusarUsuario as Acao,
  'usuario#excluirUsuario': m55.excluirUsuario as Acao,
  'usuario#togglePermissao': m55.togglePermissao as Acao,
  'usuario#redefinirSenha': m55.redefinirSenha as Acao,
  'usuario#toggleLocal': m55.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m56.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m56.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m56.reconciliarLotes as Acao,
})
