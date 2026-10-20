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
import * as m20 from '@/lib/actions/fornecedor'
import * as m21 from '@/lib/actions/importacao'
import * as m22 from '@/lib/actions/importar-pedidos'
import * as m23 from '@/lib/actions/integracao-ntb-vendas'
import * as m24 from '@/lib/actions/inventario-proprio'
import * as m25 from '@/lib/actions/inventario'
import * as m26 from '@/lib/actions/local-estoque'
import * as m27 from '@/lib/actions/loja-selector'
import * as m28 from '@/lib/actions/loja'
import * as m29 from '@/lib/actions/mapeamento-local-estoque'
import * as m30 from '@/lib/actions/meta-faturamento'
import * as m31 from '@/lib/actions/meta-mensal'
import * as m32 from '@/lib/actions/minha-loja'
import * as m33 from '@/lib/actions/movimentacoes-proprio'
import * as m34 from '@/lib/actions/movimentacoes'
import * as m35 from '@/lib/actions/nota-fiscal-proprio'
import * as m36 from '@/lib/actions/nota-fiscal'
import * as m37 from '@/lib/actions/notificacoes'
import * as m38 from '@/lib/actions/onboarding-loja'
import * as m39 from '@/lib/actions/ops-lote'
import * as m40 from '@/lib/actions/ordem-producao'
import * as m41 from '@/lib/actions/pedido-compra'
import * as m42 from '@/lib/actions/periodo-fechado'
import * as m43 from '@/lib/actions/produto-minimo'
import * as m44 from '@/lib/actions/produto-substituicao'
import * as m45 from '@/lib/actions/produto'
import * as m46 from '@/lib/actions/produtos-search'
import * as m47 from '@/lib/actions/requisicao-compra'
import * as m48 from '@/lib/actions/sintegra'
import * as m49 from '@/lib/actions/sync-status'
import * as m50 from '@/lib/actions/transferencia'
import * as m51 from '@/lib/actions/usuario'
import * as m52 from '@/lib/actions/validade-proprio'

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
  'fornecedor#criarFornecedor': m20.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m20.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m20.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m20.puxarFornecedoresDoOmie as Acao,
  'importacao#previaImportacao': m21.previaImportacao as Acao,
  'importacao#confirmarImportacao': m21.confirmarImportacao as Acao,
  'importar-pedidos#previaImportacaoPedidos': m22.previaImportacaoPedidos as Acao,
  'importar-pedidos#confirmarImportacaoPedidos': m22.confirmarImportacaoPedidos as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m23.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m23.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m24.abrirInventario as Acao,
  'inventario-proprio#contarItem': m24.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m24.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m24.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m24.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m24.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m24.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m25.createInventario as Acao,
  'inventario#addInventarioItem': m25.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m25.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m25.removeInventarioItem as Acao,
  'inventario#finishInventario': m25.finishInventario as Acao,
  'inventario#forceSyncInventario': m25.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m25.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m25.duplicarInventario as Acao,
  'inventario#excluirInventario': m25.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m25.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m25.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m26.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m26.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m26.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m27.setCurrentLoja as Acao,
  'loja#criarLoja': m28.criarLoja as Acao,
  'loja#editarLoja': m28.editarLoja as Acao,
  'loja#alternarAtivoLoja': m28.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m28.excluirLoja as Acao,
  'loja#forceSyncLoja': m28.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m28.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m29.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m30.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m31.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m32.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m32.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m33.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m34.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m34.retryMovimentosManuaisPendentes as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m35.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m35.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m35.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m35.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m35.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m35.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m35.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m35.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m35.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m35.criarProdutoParaNF as Acao,
  'nota-fiscal-proprio#configurarItemNF': m35.configurarItemNF as Acao,
  'nota-fiscal-proprio#marcarConferidaNF': m35.marcarConferidaNF as Acao,
  'nota-fiscal-proprio#salvarObservacaoNF': m35.salvarObservacaoNF as Acao,
  'nota-fiscal-proprio#manifestarNotaSefaz': m35.manifestarNotaSefaz as Acao,
  'nota-fiscal-proprio#importarCteNF': m35.importarCteNF as Acao,
  'nota-fiscal-proprio#informarFreteNF': m35.informarFreteNF as Acao,
  'nota-fiscal-proprio#desvincularCteNF': m35.desvincularCteNF as Acao,
  'nota-fiscal-proprio#buscarNotaPorChaveNF': m35.buscarNotaPorChaveNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m36.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m36.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#manifestarNF': m36.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m36.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m36.excluirRecebimentoNF as Acao,
  'notificacoes#minhasNotificacoes': m37.minhasNotificacoes as Acao,
  'notificacoes#marcarNotificacaoLida': m37.marcarNotificacaoLida as Acao,
  'notificacoes#marcarTodasLidas': m37.marcarTodasLidas as Acao,
  'onboarding-loja#gerarCodigoLoja': m38.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m38.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m39.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m40.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m40.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m40.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m40.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m40.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m40.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m40.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m40.finishOP as Acao,
  'ordem-producao#excluirOP': m40.excluirOP as Acao,
  'ordem-producao#reverterOP': m40.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m40.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m40.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m40.reverterOPsEmLote as Acao,
  'pedido-compra#salvarPedidoCompra': m41.salvarPedidoCompra as Acao,
  'pedido-compra#mudarEtapaPedido': m41.mudarEtapaPedido as Acao,
  'pedido-compra#vincularNotaAoPedido': m41.vincularNotaAoPedido as Acao,
  'pedido-compra#desvincularNotaDoPedido': m41.desvincularNotaDoPedido as Acao,
  'pedido-compra#criarPedidosDaSugestao': m41.criarPedidosDaSugestao as Acao,
  'pedido-compra#salvarLeadTime': m41.salvarLeadTime as Acao,
  'pedido-compra#enviarPedidoAoOmieAgora': m41.enviarPedidoAoOmieAgora as Acao,
  'periodo-fechado#fecharMes': m42.fecharMes as Acao,
  'periodo-fechado#reabrirMes': m42.reabrirMes as Acao,
  'periodo-fechado#pendenciasDoMes': m42.pendenciasDoMes as Acao,
  'produto-minimo#setEstoqueMinimo': m43.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m44.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m44.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m45.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m45.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m45.criarProduto as Acao,
  'produto#editarProduto': m45.editarProduto as Acao,
  'produto#excluirProduto': m45.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m46.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m46.buscarProdutoPorCodigo as Acao,
  'requisicao-compra#salvarRequisicao': m47.salvarRequisicao as Acao,
  'requisicao-compra#acaoRequisicao': m47.acaoRequisicao as Acao,
  'requisicao-compra#gerarPedidosDasRequisicoes': m47.gerarPedidosDasRequisicoes as Acao,
  'requisicao-compra#criarRequisicaoDaSugestao': m47.criarRequisicaoDaSugestao as Acao,
  'sintegra#consultarCnpj': m48.consultarCnpj as Acao,
  'sintegra#importarParceiro': m48.importarParceiro as Acao,
  'sync-status#reprocessarSync': m49.reprocessarSync as Acao,
  'transferencia#createTransferencia': m50.createTransferencia as Acao,
  'transferencia#addMovimento': m50.addMovimento as Acao,
  'transferencia#enviarMovimento': m50.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m50.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m50.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m50.removeMovimento as Acao,
  'transferencia#finishTransferencia': m50.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m50.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m50.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m50.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m50.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m50.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m51.criarUsuario as Acao,
  'usuario#editarUsuario': m51.editarUsuario as Acao,
  'usuario#aprovarUsuario': m51.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m51.recusarUsuario as Acao,
  'usuario#excluirUsuario': m51.excluirUsuario as Acao,
  'usuario#togglePermissao': m51.togglePermissao as Acao,
  'usuario#redefinirSenha': m51.redefinirSenha as Acao,
  'usuario#toggleLocal': m51.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m52.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m52.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m52.reconciliarLotes as Acao,
})
