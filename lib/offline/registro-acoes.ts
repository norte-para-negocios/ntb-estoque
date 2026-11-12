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
import * as m14 from '@/lib/actions/cozinha-cardapios'
import * as m15 from '@/lib/actions/cozinha-eventos'
import * as m16 from '@/lib/actions/custo-cardapio'
import * as m17 from '@/lib/actions/detalhe-movimento'
import * as m18 from '@/lib/actions/devolucao-fornecedor'
import * as m19 from '@/lib/actions/estoque-omie'
import * as m20 from '@/lib/actions/estoque-proprio'
import * as m21 from '@/lib/actions/estrutura'
import * as m22 from '@/lib/actions/familia'
import * as m23 from '@/lib/actions/ficha-tecnica'
import * as m24 from '@/lib/actions/fichas-omie'
import * as m25 from '@/lib/actions/financeiro-receber'
import * as m26 from '@/lib/actions/financeiro'
import * as m27 from '@/lib/actions/fornecedor'
import * as m28 from '@/lib/actions/importacao'
import * as m29 from '@/lib/actions/importar-pedidos'
import * as m30 from '@/lib/actions/integracao-ntb-vendas'
import * as m31 from '@/lib/actions/inventario-proprio'
import * as m32 from '@/lib/actions/inventario'
import * as m33 from '@/lib/actions/local-estoque'
import * as m34 from '@/lib/actions/loja-selector'
import * as m35 from '@/lib/actions/loja'
import * as m36 from '@/lib/actions/mapeamento-local-estoque'
import * as m37 from '@/lib/actions/meta-faturamento'
import * as m38 from '@/lib/actions/meta-mensal'
import * as m39 from '@/lib/actions/minha-loja'
import * as m40 from '@/lib/actions/movimentacoes-proprio'
import * as m41 from '@/lib/actions/movimentacoes'
import * as m42 from '@/lib/actions/nfe-saida'
import * as m43 from '@/lib/actions/nota-fiscal-proprio'
import * as m44 from '@/lib/actions/nota-fiscal'
import * as m45 from '@/lib/actions/notificacoes'
import * as m46 from '@/lib/actions/onboarding-loja'
import * as m47 from '@/lib/actions/ops-lote'
import * as m48 from '@/lib/actions/ordem-producao'
import * as m49 from '@/lib/actions/pedido-compra'
import * as m50 from '@/lib/actions/periodo-fechado'
import * as m51 from '@/lib/actions/produto-minimo'
import * as m52 from '@/lib/actions/produto-substituicao'
import * as m53 from '@/lib/actions/produto'
import * as m54 from '@/lib/actions/produtos-search'
import * as m55 from '@/lib/actions/requisicao-compra'
import * as m56 from '@/lib/actions/sintegra'
import * as m57 from '@/lib/actions/sync-status'
import * as m58 from '@/lib/actions/transferencia-loja'
import * as m59 from '@/lib/actions/transferencia'
import * as m60 from '@/lib/actions/usuario'
import * as m61 from '@/lib/actions/validade-proprio'
import * as m62 from '@/lib/actions/variacao-preco'

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
  'cozinha-cardapios#criarCardapio': m14.criarCardapio as Acao,
  'cozinha-cardapios#editarCardapio': m14.editarCardapio as Acao,
  'cozinha-cardapios#arquivarCardapio': m14.arquivarCardapio as Acao,
  'cozinha-cardapios#adicionarPratoCardapio': m14.adicionarPratoCardapio as Acao,
  'cozinha-cardapios#removerItemCardapio': m14.removerItemCardapio as Acao,
  'cozinha-cardapios#moverItemCardapio': m14.moverItemCardapio as Acao,
  'cozinha-cardapios#definirPrecoItemCardapio': m14.definirPrecoItemCardapio as Acao,
  'cozinha-cardapios#definirPrecosCardapio': m14.definirPrecosCardapio as Acao,
  'cozinha-eventos#criarEvento': m15.criarEvento as Acao,
  'cozinha-eventos#salvarEvento': m15.salvarEvento as Acao,
  'cozinha-eventos#excluirEvento': m15.excluirEvento as Acao,
  'cozinha-eventos#adicionarItemEvento': m15.adicionarItemEvento as Acao,
  'cozinha-eventos#definirPorcoesItemEvento': m15.definirPorcoesItemEvento as Acao,
  'cozinha-eventos#removerItemEvento': m15.removerItemEvento as Acao,
  'custo-cardapio#salvarTaxasCardapio': m16.salvarTaxasCardapio as Acao,
  'detalhe-movimento#buscarDetalheOP': m17.buscarDetalheOP as Acao,
  'detalhe-movimento#buscarDetalheTransferencia': m17.buscarDetalheTransferencia as Acao,
  'detalhe-movimento#buscarDetalheNotaFiscal': m17.buscarDetalheNotaFiscal as Acao,
  'detalhe-movimento#buscarDetalheInventario': m17.buscarDetalheInventario as Acao,
  'devolucao-fornecedor#registrarDevolucao': m18.registrarDevolucao as Acao,
  'devolucao-fornecedor#cancelarDevolucao': m18.cancelarDevolucao as Acao,
  'estoque-omie#entradaOmie': m19.entradaOmie as Acao,
  'estoque-omie#ajusteOmie': m19.ajusteOmie as Acao,
  'estoque-omie#transferirOmie': m19.transferirOmie as Acao,
  'estoque-omie#corrigirCustoAjuste': m19.corrigirCustoAjuste as Acao,
  'estoque-omie#relancarCorrecaoCusto': m19.relancarCorrecaoCusto as Acao,
  'estoque-proprio#entradaManual': m20.entradaManual as Acao,
  'estoque-proprio#ajusteManual': m20.ajusteManual as Acao,
  'estoque-proprio#definirMinimo': m20.definirMinimo as Acao,
  'estoque-proprio#transferirEntreLocais': m20.transferirEntreLocais as Acao,
  'estoque-proprio#estornarMovimento': m20.estornarMovimento as Acao,
  'estrutura#verEstrutura': m21.verEstrutura as Acao,
  'estrutura#salvarEstrutura': m21.salvarEstrutura as Acao,
  'familia#criarFamilia': m22.criarFamilia as Acao,
  'familia#editarFamilia': m22.editarFamilia as Acao,
  'familia#excluirFamilia': m22.excluirFamilia as Acao,
  'familia#puxarFamiliasDoOmie': m22.puxarFamiliasDoOmie as Acao,
  'ficha-tecnica#salvarFichaTecnica': m23.salvarFichaTecnica as Acao,
  'ficha-tecnica#desativarFichaTecnica': m23.desativarFichaTecnica as Acao,
  'ficha-tecnica#produzirLoteAction': m23.produzirLoteAction as Acao,
  'fichas-omie#trocarInsumoNoPrato': m24.trocarInsumoNoPrato as Acao,
  'financeiro-receber#salvarFormaRecebimento': m25.salvarFormaRecebimento as Acao,
  'financeiro-receber#gerarContasReceberVendas': m25.gerarContasReceberVendas as Acao,
  'financeiro-receber#registrarRecebimento': m25.registrarRecebimento as Acao,
  'financeiro-receber#estornarRecebimento': m25.estornarRecebimento as Acao,
  'financeiro#salvarContaCorrente': m26.salvarContaCorrente as Acao,
  'financeiro#salvarCategoriaFinanceira': m26.salvarCategoriaFinanceira as Acao,
  'financeiro#criarCategoriasPadrao': m26.criarCategoriasPadrao as Acao,
  'financeiro#salvarTituloPagar': m26.salvarTituloPagar as Acao,
  'financeiro#cancelarTituloPagar': m26.cancelarTituloPagar as Acao,
  'financeiro#registrarPagamentoTitulo': m26.registrarPagamentoTitulo as Acao,
  'financeiro#estornarPagamentoTitulo': m26.estornarPagamentoTitulo as Acao,
  'financeiro#gerarContasPagarDaNota': m26.gerarContasPagarDaNota as Acao,
  'financeiro#salvarFamiliaCategoria': m26.salvarFamiliaCategoria as Acao,
  'financeiro#gerarContasNotasSemConta': m26.gerarContasNotasSemConta as Acao,
  'financeiro#decidirNotaDesfeita': m26.decidirNotaDesfeita as Acao,
  'financeiro#salvarConfigFinanceiro': m26.salvarConfigFinanceiro as Acao,
  'financeiro#decidirAprovacaoTitulo': m26.decidirAprovacaoTitulo as Acao,
  'financeiro#confirmarValorTitulo': m26.confirmarValorTitulo as Acao,
  'financeiro#salvarRecorrente': m26.salvarRecorrente as Acao,
  'financeiro#gerarRecorrentesAgora': m26.gerarRecorrentesAgora as Acao,
  'financeiro#registrarLancamentoAvulso': m26.registrarLancamentoAvulso as Acao,
  'financeiro#estornarLancamentoAvulso': m26.estornarLancamentoAvulso as Acao,
  'financeiro#registrarTransferencia': m26.registrarTransferencia as Acao,
  'financeiro#estornarTransferencia': m26.estornarTransferencia as Acao,
  'fornecedor#criarFornecedor': m27.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m27.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m27.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m27.puxarFornecedoresDoOmie as Acao,
  'importacao#previaImportacao': m28.previaImportacao as Acao,
  'importacao#confirmarImportacao': m28.confirmarImportacao as Acao,
  'importar-pedidos#previaImportacaoPedidos': m29.previaImportacaoPedidos as Acao,
  'importar-pedidos#confirmarImportacaoPedidos': m29.confirmarImportacaoPedidos as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m30.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m30.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m31.abrirInventario as Acao,
  'inventario-proprio#contarItem': m31.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m31.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m31.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m31.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m31.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m31.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m32.createInventario as Acao,
  'inventario#addInventarioItem': m32.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m32.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m32.removeInventarioItem as Acao,
  'inventario#finishInventario': m32.finishInventario as Acao,
  'inventario#forceSyncInventario': m32.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m32.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m32.duplicarInventario as Acao,
  'inventario#excluirInventario': m32.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m32.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m32.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m33.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m33.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m33.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m34.setCurrentLoja as Acao,
  'loja#criarLoja': m35.criarLoja as Acao,
  'loja#editarLoja': m35.editarLoja as Acao,
  'loja#alternarAtivoLoja': m35.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m35.excluirLoja as Acao,
  'loja#forceSyncLoja': m35.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m35.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m36.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m37.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m38.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m39.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m39.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m40.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m41.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m41.retryMovimentosManuaisPendentes as Acao,
  'nfe-saida#conferirNfeSaida': m42.conferirNfeSaida as Acao,
  'nfe-saida#emitirNfeSaida': m42.emitirNfeSaida as Acao,
  'nfe-saida#consultarNfeSaida': m42.consultarNfeSaida as Acao,
  'nfe-saida#cancelarNfeSaida': m42.cancelarNfeSaida as Acao,
  'nfe-saida#corrigirNfeSaida': m42.corrigirNfeSaida as Acao,
  'nfe-saida#descartarNfeSaida': m42.descartarNfeSaida as Acao,
  'nfe-saida#salvarConfigNfe': m42.salvarConfigNfe as Acao,
  'nfe-saida#definirProximoNumeroNfe': m42.definirProximoNumeroNfe as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m43.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m43.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m43.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m43.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m43.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m43.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m43.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m43.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m43.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m43.criarProdutoParaNF as Acao,
  'nota-fiscal-proprio#configurarItemNF': m43.configurarItemNF as Acao,
  'nota-fiscal-proprio#marcarConferidaNF': m43.marcarConferidaNF as Acao,
  'nota-fiscal-proprio#salvarObservacaoNF': m43.salvarObservacaoNF as Acao,
  'nota-fiscal-proprio#manifestarNotaSefaz': m43.manifestarNotaSefaz as Acao,
  'nota-fiscal-proprio#importarCteNF': m43.importarCteNF as Acao,
  'nota-fiscal-proprio#informarFreteNF': m43.informarFreteNF as Acao,
  'nota-fiscal-proprio#desvincularCteNF': m43.desvincularCteNF as Acao,
  'nota-fiscal-proprio#buscarNotaPorChaveNF': m43.buscarNotaPorChaveNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m44.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m44.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNota': m44.setCategoriaContabilNota as Acao,
  'nota-fiscal#classificarItensPeloProduto': m44.classificarItensPeloProduto as Acao,
  'nota-fiscal#manifestarNF': m44.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m44.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m44.excluirRecebimentoNF as Acao,
  'notificacoes#minhasNotificacoes': m45.minhasNotificacoes as Acao,
  'notificacoes#marcarNotificacaoLida': m45.marcarNotificacaoLida as Acao,
  'notificacoes#marcarTodasLidas': m45.marcarTodasLidas as Acao,
  'onboarding-loja#gerarCodigoLoja': m46.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m46.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m47.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m48.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m48.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m48.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m48.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m48.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m48.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m48.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m48.finishOP as Acao,
  'ordem-producao#excluirOP': m48.excluirOP as Acao,
  'ordem-producao#reverterOP': m48.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m48.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m48.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m48.reverterOPsEmLote as Acao,
  'pedido-compra#salvarPedidoCompra': m49.salvarPedidoCompra as Acao,
  'pedido-compra#mudarEtapaPedido': m49.mudarEtapaPedido as Acao,
  'pedido-compra#enviarPedidoAoOmieAgora': m49.enviarPedidoAoOmieAgora as Acao,
  'pedido-compra#vincularNotaAoPedido': m49.vincularNotaAoPedido as Acao,
  'pedido-compra#desvincularNotaDoPedido': m49.desvincularNotaDoPedido as Acao,
  'pedido-compra#criarPedidosDaSugestao': m49.criarPedidosDaSugestao as Acao,
  'pedido-compra#salvarLeadTime': m49.salvarLeadTime as Acao,
  'periodo-fechado#fecharMes': m50.fecharMes as Acao,
  'periodo-fechado#reabrirMes': m50.reabrirMes as Acao,
  'periodo-fechado#pendenciasDoMes': m50.pendenciasDoMes as Acao,
  'produto-minimo#setEstoqueMinimo': m51.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m52.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m52.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m53.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m53.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m53.criarProduto as Acao,
  'produto#editarProduto': m53.editarProduto as Acao,
  'produto#excluirProduto': m53.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m54.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m54.buscarProdutoPorCodigo as Acao,
  'requisicao-compra#salvarRequisicao': m55.salvarRequisicao as Acao,
  'requisicao-compra#acaoRequisicao': m55.acaoRequisicao as Acao,
  'requisicao-compra#gerarPedidosDasRequisicoes': m55.gerarPedidosDasRequisicoes as Acao,
  'requisicao-compra#criarRequisicaoDaSugestao': m55.criarRequisicaoDaSugestao as Acao,
  'sintegra#consultarCnpj': m56.consultarCnpj as Acao,
  'sintegra#importarParceiro': m56.importarParceiro as Acao,
  'sync-status#reprocessarSync': m57.reprocessarSync as Acao,
  'transferencia-loja#registrarTransferenciaLoja': m58.registrarTransferenciaLoja as Acao,
  'transferencia-loja#cancelarTransferenciaLoja': m58.cancelarTransferenciaLoja as Acao,
  'transferencia#createTransferencia': m59.createTransferencia as Acao,
  'transferencia#addMovimento': m59.addMovimento as Acao,
  'transferencia#enviarMovimento': m59.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m59.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m59.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m59.removeMovimento as Acao,
  'transferencia#finishTransferencia': m59.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m59.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m59.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m59.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m59.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m59.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m60.criarUsuario as Acao,
  'usuario#editarUsuario': m60.editarUsuario as Acao,
  'usuario#aprovarUsuario': m60.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m60.recusarUsuario as Acao,
  'usuario#excluirUsuario': m60.excluirUsuario as Acao,
  'usuario#togglePermissao': m60.togglePermissao as Acao,
  'usuario#redefinirSenha': m60.redefinirSenha as Acao,
  'usuario#toggleLocal': m60.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m61.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m61.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m61.reconciliarLotes as Acao,
  'variacao-preco#salvarLimiteVariacaoPreco': m62.salvarLimiteVariacaoPreco as Acao,
})
