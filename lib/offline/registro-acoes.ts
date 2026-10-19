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
import * as m12 from '@/lib/actions/estoque-omie'
import * as m13 from '@/lib/actions/estoque-proprio'
import * as m14 from '@/lib/actions/estrutura'
import * as m15 from '@/lib/actions/familia'
import * as m16 from '@/lib/actions/ficha-tecnica'
import * as m17 from '@/lib/actions/fichas-omie'
import * as m18 from '@/lib/actions/fornecedor'
import * as m19 from '@/lib/actions/importar-pedidos'
import * as m20 from '@/lib/actions/integracao-ntb-vendas'
import * as m21 from '@/lib/actions/inventario-proprio'
import * as m22 from '@/lib/actions/inventario'
import * as m23 from '@/lib/actions/local-estoque'
import * as m24 from '@/lib/actions/loja-selector'
import * as m25 from '@/lib/actions/loja'
import * as m26 from '@/lib/actions/mapeamento-local-estoque'
import * as m27 from '@/lib/actions/meta-faturamento'
import * as m28 from '@/lib/actions/meta-mensal'
import * as m29 from '@/lib/actions/minha-loja'
import * as m30 from '@/lib/actions/movimentacoes-proprio'
import * as m31 from '@/lib/actions/movimentacoes'
import * as m32 from '@/lib/actions/nota-fiscal-proprio'
import * as m33 from '@/lib/actions/nota-fiscal'
import * as m34 from '@/lib/actions/onboarding-loja'
import * as m35 from '@/lib/actions/ops-lote'
import * as m36 from '@/lib/actions/ordem-producao'
import * as m37 from '@/lib/actions/pedido-compra'
import * as m38 from '@/lib/actions/periodo-fechado'
import * as m39 from '@/lib/actions/produto-minimo'
import * as m40 from '@/lib/actions/produto-substituicao'
import * as m41 from '@/lib/actions/produto'
import * as m42 from '@/lib/actions/produtos-search'
import * as m43 from '@/lib/actions/requisicao-compra'
import * as m44 from '@/lib/actions/sintegra'
import * as m45 from '@/lib/actions/sync-status'
import * as m46 from '@/lib/actions/transferencia'
import * as m47 from '@/lib/actions/usuario'
import * as m48 from '@/lib/actions/validade-proprio'

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
  'estoque-omie#entradaOmie': m12.entradaOmie as Acao,
  'estoque-omie#ajusteOmie': m12.ajusteOmie as Acao,
  'estoque-omie#transferirOmie': m12.transferirOmie as Acao,
  'estoque-omie#corrigirCustoAjuste': m12.corrigirCustoAjuste as Acao,
  'estoque-omie#relancarCorrecaoCusto': m12.relancarCorrecaoCusto as Acao,
  'estoque-proprio#entradaManual': m13.entradaManual as Acao,
  'estoque-proprio#ajusteManual': m13.ajusteManual as Acao,
  'estoque-proprio#definirMinimo': m13.definirMinimo as Acao,
  'estoque-proprio#transferirEntreLocais': m13.transferirEntreLocais as Acao,
  'estoque-proprio#estornarMovimento': m13.estornarMovimento as Acao,
  'estrutura#verEstrutura': m14.verEstrutura as Acao,
  'estrutura#salvarEstrutura': m14.salvarEstrutura as Acao,
  'familia#criarFamilia': m15.criarFamilia as Acao,
  'familia#editarFamilia': m15.editarFamilia as Acao,
  'familia#excluirFamilia': m15.excluirFamilia as Acao,
  'familia#puxarFamiliasDoOmie': m15.puxarFamiliasDoOmie as Acao,
  'ficha-tecnica#salvarFichaTecnica': m16.salvarFichaTecnica as Acao,
  'ficha-tecnica#desativarFichaTecnica': m16.desativarFichaTecnica as Acao,
  'ficha-tecnica#produzirLoteAction': m16.produzirLoteAction as Acao,
  'fichas-omie#trocarInsumoNoPrato': m17.trocarInsumoNoPrato as Acao,
  'fornecedor#criarFornecedor': m18.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m18.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m18.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m18.puxarFornecedoresDoOmie as Acao,
  'importar-pedidos#previaImportacaoPedidos': m19.previaImportacaoPedidos as Acao,
  'importar-pedidos#confirmarImportacaoPedidos': m19.confirmarImportacaoPedidos as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m20.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m20.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m21.abrirInventario as Acao,
  'inventario-proprio#contarItem': m21.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m21.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m21.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m21.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m21.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m21.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m22.createInventario as Acao,
  'inventario#addInventarioItem': m22.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m22.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m22.removeInventarioItem as Acao,
  'inventario#finishInventario': m22.finishInventario as Acao,
  'inventario#forceSyncInventario': m22.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m22.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m22.duplicarInventario as Acao,
  'inventario#excluirInventario': m22.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m22.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m22.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m23.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m23.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m23.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m24.setCurrentLoja as Acao,
  'loja#criarLoja': m25.criarLoja as Acao,
  'loja#editarLoja': m25.editarLoja as Acao,
  'loja#alternarAtivoLoja': m25.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m25.excluirLoja as Acao,
  'loja#forceSyncLoja': m25.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m25.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m26.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m27.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m28.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m29.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m29.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m30.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m31.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m31.retryMovimentosManuaisPendentes as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m32.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m32.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m32.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m32.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m32.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m32.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m32.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m32.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m32.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m32.criarProdutoParaNF as Acao,
  'nota-fiscal-proprio#configurarItemNF': m32.configurarItemNF as Acao,
  'nota-fiscal-proprio#marcarConferidaNF': m32.marcarConferidaNF as Acao,
  'nota-fiscal-proprio#salvarObservacaoNF': m32.salvarObservacaoNF as Acao,
  'nota-fiscal-proprio#manifestarNotaSefaz': m32.manifestarNotaSefaz as Acao,
  'nota-fiscal-proprio#importarCteNF': m32.importarCteNF as Acao,
  'nota-fiscal-proprio#informarFreteNF': m32.informarFreteNF as Acao,
  'nota-fiscal-proprio#desvincularCteNF': m32.desvincularCteNF as Acao,
  'nota-fiscal-proprio#buscarNotaPorChaveNF': m32.buscarNotaPorChaveNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m33.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m33.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#manifestarNF': m33.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m33.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m33.excluirRecebimentoNF as Acao,
  'onboarding-loja#gerarCodigoLoja': m34.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m34.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m35.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m36.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m36.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m36.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m36.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m36.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m36.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m36.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m36.finishOP as Acao,
  'ordem-producao#excluirOP': m36.excluirOP as Acao,
  'ordem-producao#reverterOP': m36.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m36.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m36.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m36.reverterOPsEmLote as Acao,
  'pedido-compra#salvarPedidoCompra': m37.salvarPedidoCompra as Acao,
  'pedido-compra#mudarEtapaPedido': m37.mudarEtapaPedido as Acao,
  'pedido-compra#vincularNotaAoPedido': m37.vincularNotaAoPedido as Acao,
  'pedido-compra#desvincularNotaDoPedido': m37.desvincularNotaDoPedido as Acao,
  'pedido-compra#criarPedidosDaSugestao': m37.criarPedidosDaSugestao as Acao,
  'pedido-compra#salvarLeadTime': m37.salvarLeadTime as Acao,
  'periodo-fechado#fecharMes': m38.fecharMes as Acao,
  'periodo-fechado#reabrirMes': m38.reabrirMes as Acao,
  'periodo-fechado#pendenciasDoMes': m38.pendenciasDoMes as Acao,
  'produto-minimo#setEstoqueMinimo': m39.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m40.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m40.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m41.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m41.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m41.criarProduto as Acao,
  'produto#editarProduto': m41.editarProduto as Acao,
  'produto#excluirProduto': m41.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m42.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m42.buscarProdutoPorCodigo as Acao,
  'requisicao-compra#salvarRequisicao': m43.salvarRequisicao as Acao,
  'requisicao-compra#acaoRequisicao': m43.acaoRequisicao as Acao,
  'requisicao-compra#gerarPedidosDasRequisicoes': m43.gerarPedidosDasRequisicoes as Acao,
  'requisicao-compra#criarRequisicaoDaSugestao': m43.criarRequisicaoDaSugestao as Acao,
  'sintegra#consultarCnpj': m44.consultarCnpj as Acao,
  'sintegra#importarParceiro': m44.importarParceiro as Acao,
  'sync-status#reprocessarSync': m45.reprocessarSync as Acao,
  'transferencia#createTransferencia': m46.createTransferencia as Acao,
  'transferencia#addMovimento': m46.addMovimento as Acao,
  'transferencia#enviarMovimento': m46.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m46.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m46.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m46.removeMovimento as Acao,
  'transferencia#finishTransferencia': m46.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m46.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m46.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m46.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m46.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m46.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m47.criarUsuario as Acao,
  'usuario#editarUsuario': m47.editarUsuario as Acao,
  'usuario#aprovarUsuario': m47.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m47.recusarUsuario as Acao,
  'usuario#excluirUsuario': m47.excluirUsuario as Acao,
  'usuario#togglePermissao': m47.togglePermissao as Acao,
  'usuario#redefinirSenha': m47.redefinirSenha as Acao,
  'usuario#toggleLocal': m47.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m48.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m48.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m48.reconciliarLotes as Acao,
})
