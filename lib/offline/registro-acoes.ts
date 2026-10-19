// GERADO por scripts/inserir-via-desktop.mjs -- não editar à mão.
// Todas as server actions, pelo nome usado no canal do app desktop (modulo#funcao).
import * as m0 from '@/lib/actions/auth'
import * as m1 from '@/lib/actions/busca-global'
import * as m2 from '@/lib/actions/cadastro'
import * as m3 from '@/lib/actions/cargo'
import * as m4 from '@/lib/actions/catalogo-proprio'
import * as m5 from '@/lib/actions/categoria-contabil'
import * as m6 from '@/lib/actions/central'
import * as m7 from '@/lib/actions/certificado'
import * as m8 from '@/lib/actions/compras-cadastros'
import * as m9 from '@/lib/actions/compras-proprio'
import * as m10 from '@/lib/actions/convite'
import * as m11 from '@/lib/actions/detalhe-movimento'
import * as m12 from '@/lib/actions/devolucao-fornecedor'
import * as m13 from '@/lib/actions/estoque-omie'
import * as m14 from '@/lib/actions/estoque-proprio'
import * as m15 from '@/lib/actions/estrutura'
import * as m16 from '@/lib/actions/familia'
import * as m17 from '@/lib/actions/ficha-tecnica'
import * as m18 from '@/lib/actions/fichas-omie'
import * as m19 from '@/lib/actions/fornecedor'
import * as m20 from '@/lib/actions/importar-pedidos'
import * as m21 from '@/lib/actions/integracao-ntb-vendas'
import * as m22 from '@/lib/actions/inventario-proprio'
import * as m23 from '@/lib/actions/inventario'
import * as m24 from '@/lib/actions/local-estoque'
import * as m25 from '@/lib/actions/loja-selector'
import * as m26 from '@/lib/actions/loja'
import * as m27 from '@/lib/actions/mapeamento-local-estoque'
import * as m28 from '@/lib/actions/meta-faturamento'
import * as m29 from '@/lib/actions/meta-mensal'
import * as m30 from '@/lib/actions/minha-loja'
import * as m31 from '@/lib/actions/movimentacoes-proprio'
import * as m32 from '@/lib/actions/movimentacoes'
import * as m33 from '@/lib/actions/nota-fiscal-proprio'
import * as m34 from '@/lib/actions/nota-fiscal'
import * as m35 from '@/lib/actions/onboarding-loja'
import * as m36 from '@/lib/actions/ops-lote'
import * as m37 from '@/lib/actions/ordem-producao'
import * as m38 from '@/lib/actions/pedido-compra'
import * as m39 from '@/lib/actions/periodo-fechado'
import * as m40 from '@/lib/actions/produto-minimo'
import * as m41 from '@/lib/actions/produto-substituicao'
import * as m42 from '@/lib/actions/produto'
import * as m43 from '@/lib/actions/produtos-search'
import * as m44 from '@/lib/actions/requisicao-compra'
import * as m45 from '@/lib/actions/sintegra'
import * as m46 from '@/lib/actions/sync-status'
import * as m47 from '@/lib/actions/transferencia'
import * as m48 from '@/lib/actions/usuario'
import * as m49 from '@/lib/actions/validade-proprio'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Acao = (...args: any[]) => Promise<unknown>

export const ACOES: Readonly<Record<string, Acao>> = Object.freeze({
  'auth#login': m0.login as Acao,
  'auth#logout': m0.logout as Acao,
  'busca-global#buscaGlobal': m1.buscaGlobal as Acao,
  'cadastro#cadastrar': m2.cadastrar as Acao,
  'cargo#listarCargos': m3.listarCargos as Acao,
  'cargo#criarCargo': m3.criarCargo as Acao,
  'cargo#editarCargo': m3.editarCargo as Acao,
  'cargo#excluirCargo': m3.excluirCargo as Acao,
  'cargo#definirCargoUsuario': m3.definirCargoUsuario as Acao,
  'catalogo-proprio#listarGrupos': m4.listarGrupos as Acao,
  'catalogo-proprio#criarGrupo': m4.criarGrupo as Acao,
  'catalogo-proprio#editarGrupo': m4.editarGrupo as Acao,
  'catalogo-proprio#excluirGrupo': m4.excluirGrupo as Acao,
  'catalogo-proprio#criarProdutoCatalogo': m4.criarProdutoCatalogo as Acao,
  'catalogo-proprio#carregarProdutoCatalogo': m4.carregarProdutoCatalogo as Acao,
  'catalogo-proprio#salvarProdutoCatalogo': m4.salvarProdutoCatalogo as Acao,
  'catalogo-proprio#sincronizarAgora': m4.sincronizarAgora as Acao,
  'categoria-contabil#criarCategoriaContabil': m5.criarCategoriaContabil as Acao,
  'categoria-contabil#editarCategoriaContabil': m5.editarCategoriaContabil as Acao,
  'categoria-contabil#excluirCategoriaContabil': m5.excluirCategoriaContabil as Acao,
  'central#marcarEstadoProblema': m6.marcarEstadoProblema as Acao,
  'central#marcarNaoControla': m6.marcarNaoControla as Acao,
  'central#lancarOPCorrecao': m6.lancarOPCorrecao as Acao,
  'central#carregarPainel': m6.carregarPainel as Acao,
  'central#previaRefazerInventario': m6.previaRefazerInventario as Acao,
  'central#refazerInventario': m6.refazerInventario as Acao,
  'certificado#salvarCertificado': m7.salvarCertificado as Acao,
  'compras-cadastros#salvarComprador': m8.salvarComprador as Acao,
  'compras-cadastros#salvarLeadTimeFornecedor': m8.salvarLeadTimeFornecedor as Acao,
  'compras-proprio#previaXml': m9.previaXml as Acao,
  'compras-proprio#lancarCompraXml': m9.lancarCompraXml as Acao,
  'compras-proprio#lancarCompraManual': m9.lancarCompraManual as Acao,
  'compras-proprio#mapearPendentes': m9.mapearPendentes as Acao,
  'compras-proprio#estornarCompra': m9.estornarCompra as Acao,
  'compras-proprio#buscarProdutosCompra': m9.buscarProdutosCompra as Acao,
  'compras-proprio#criarProdutoRapido': m9.criarProdutoRapido as Acao,
  'convite#gerarConvite': m10.gerarConvite as Acao,
  'convite#revogarConvite': m10.revogarConvite as Acao,
  'detalhe-movimento#buscarDetalheOP': m11.buscarDetalheOP as Acao,
  'detalhe-movimento#buscarDetalheTransferencia': m11.buscarDetalheTransferencia as Acao,
  'detalhe-movimento#buscarDetalheNotaFiscal': m11.buscarDetalheNotaFiscal as Acao,
  'detalhe-movimento#buscarDetalheInventario': m11.buscarDetalheInventario as Acao,
  'devolucao-fornecedor#registrarDevolucao': m12.registrarDevolucao as Acao,
  'devolucao-fornecedor#cancelarDevolucao': m12.cancelarDevolucao as Acao,
  'estoque-omie#entradaOmie': m13.entradaOmie as Acao,
  'estoque-omie#ajusteOmie': m13.ajusteOmie as Acao,
  'estoque-omie#transferirOmie': m13.transferirOmie as Acao,
  'estoque-omie#corrigirCustoAjuste': m13.corrigirCustoAjuste as Acao,
  'estoque-omie#relancarCorrecaoCusto': m13.relancarCorrecaoCusto as Acao,
  'estoque-proprio#entradaManual': m14.entradaManual as Acao,
  'estoque-proprio#ajusteManual': m14.ajusteManual as Acao,
  'estoque-proprio#definirMinimo': m14.definirMinimo as Acao,
  'estoque-proprio#transferirEntreLocais': m14.transferirEntreLocais as Acao,
  'estoque-proprio#estornarMovimento': m14.estornarMovimento as Acao,
  'estrutura#verEstrutura': m15.verEstrutura as Acao,
  'estrutura#salvarEstrutura': m15.salvarEstrutura as Acao,
  'familia#criarFamilia': m16.criarFamilia as Acao,
  'familia#editarFamilia': m16.editarFamilia as Acao,
  'familia#excluirFamilia': m16.excluirFamilia as Acao,
  'familia#puxarFamiliasDoOmie': m16.puxarFamiliasDoOmie as Acao,
  'ficha-tecnica#salvarFichaTecnica': m17.salvarFichaTecnica as Acao,
  'ficha-tecnica#desativarFichaTecnica': m17.desativarFichaTecnica as Acao,
  'ficha-tecnica#produzirLoteAction': m17.produzirLoteAction as Acao,
  'fichas-omie#trocarInsumoNoPrato': m18.trocarInsumoNoPrato as Acao,
  'fornecedor#criarFornecedor': m19.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m19.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m19.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m19.puxarFornecedoresDoOmie as Acao,
  'importar-pedidos#previaImportacaoPedidos': m20.previaImportacaoPedidos as Acao,
  'importar-pedidos#confirmarImportacaoPedidos': m20.confirmarImportacaoPedidos as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m21.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m21.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m22.abrirInventario as Acao,
  'inventario-proprio#contarItem': m22.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m22.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m22.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m22.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m22.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m22.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m23.createInventario as Acao,
  'inventario#addInventarioItem': m23.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m23.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m23.removeInventarioItem as Acao,
  'inventario#finishInventario': m23.finishInventario as Acao,
  'inventario#forceSyncInventario': m23.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m23.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m23.duplicarInventario as Acao,
  'inventario#excluirInventario': m23.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m23.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m23.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m24.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m24.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m24.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m25.setCurrentLoja as Acao,
  'loja#criarLoja': m26.criarLoja as Acao,
  'loja#editarLoja': m26.editarLoja as Acao,
  'loja#alternarAtivoLoja': m26.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m26.excluirLoja as Acao,
  'loja#forceSyncLoja': m26.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m26.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m27.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m28.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m29.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m30.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m30.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m31.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m32.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m32.retryMovimentosManuaisPendentes as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m33.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m33.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m33.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m33.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m33.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m33.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m33.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m33.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m33.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m33.criarProdutoParaNF as Acao,
  'nota-fiscal-proprio#configurarItemNF': m33.configurarItemNF as Acao,
  'nota-fiscal-proprio#marcarConferidaNF': m33.marcarConferidaNF as Acao,
  'nota-fiscal-proprio#salvarObservacaoNF': m33.salvarObservacaoNF as Acao,
  'nota-fiscal-proprio#manifestarNotaSefaz': m33.manifestarNotaSefaz as Acao,
  'nota-fiscal-proprio#importarCteNF': m33.importarCteNF as Acao,
  'nota-fiscal-proprio#informarFreteNF': m33.informarFreteNF as Acao,
  'nota-fiscal-proprio#desvincularCteNF': m33.desvincularCteNF as Acao,
  'nota-fiscal-proprio#buscarNotaPorChaveNF': m33.buscarNotaPorChaveNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m34.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m34.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#manifestarNF': m34.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m34.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m34.excluirRecebimentoNF as Acao,
  'onboarding-loja#gerarCodigoLoja': m35.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m35.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m36.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m37.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m37.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m37.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m37.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m37.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m37.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m37.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m37.finishOP as Acao,
  'ordem-producao#excluirOP': m37.excluirOP as Acao,
  'ordem-producao#reverterOP': m37.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m37.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m37.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m37.reverterOPsEmLote as Acao,
  'pedido-compra#salvarPedidoCompra': m38.salvarPedidoCompra as Acao,
  'pedido-compra#mudarEtapaPedido': m38.mudarEtapaPedido as Acao,
  'pedido-compra#vincularNotaAoPedido': m38.vincularNotaAoPedido as Acao,
  'pedido-compra#desvincularNotaDoPedido': m38.desvincularNotaDoPedido as Acao,
  'pedido-compra#criarPedidosDaSugestao': m38.criarPedidosDaSugestao as Acao,
  'pedido-compra#salvarLeadTime': m38.salvarLeadTime as Acao,
  'periodo-fechado#fecharMes': m39.fecharMes as Acao,
  'periodo-fechado#reabrirMes': m39.reabrirMes as Acao,
  'periodo-fechado#pendenciasDoMes': m39.pendenciasDoMes as Acao,
  'produto-minimo#setEstoqueMinimo': m40.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m41.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m41.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m42.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m42.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m42.criarProduto as Acao,
  'produto#editarProduto': m42.editarProduto as Acao,
  'produto#excluirProduto': m42.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m43.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m43.buscarProdutoPorCodigo as Acao,
  'requisicao-compra#salvarRequisicao': m44.salvarRequisicao as Acao,
  'requisicao-compra#acaoRequisicao': m44.acaoRequisicao as Acao,
  'requisicao-compra#gerarPedidosDasRequisicoes': m44.gerarPedidosDasRequisicoes as Acao,
  'requisicao-compra#criarRequisicaoDaSugestao': m44.criarRequisicaoDaSugestao as Acao,
  'sintegra#consultarCnpj': m45.consultarCnpj as Acao,
  'sintegra#importarParceiro': m45.importarParceiro as Acao,
  'sync-status#reprocessarSync': m46.reprocessarSync as Acao,
  'transferencia#createTransferencia': m47.createTransferencia as Acao,
  'transferencia#addMovimento': m47.addMovimento as Acao,
  'transferencia#enviarMovimento': m47.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m47.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m47.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m47.removeMovimento as Acao,
  'transferencia#finishTransferencia': m47.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m47.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m47.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m47.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m47.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m47.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m48.criarUsuario as Acao,
  'usuario#editarUsuario': m48.editarUsuario as Acao,
  'usuario#aprovarUsuario': m48.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m48.recusarUsuario as Acao,
  'usuario#excluirUsuario': m48.excluirUsuario as Acao,
  'usuario#togglePermissao': m48.togglePermissao as Acao,
  'usuario#redefinirSenha': m48.redefinirSenha as Acao,
  'usuario#toggleLocal': m48.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m49.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m49.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m49.reconciliarLotes as Acao,
})
