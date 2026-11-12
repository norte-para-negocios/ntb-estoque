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
import * as m16 from '@/lib/actions/cozinha-receitas'
import * as m17 from '@/lib/actions/custo-cardapio'
import * as m18 from '@/lib/actions/detalhe-movimento'
import * as m19 from '@/lib/actions/devolucao-fornecedor'
import * as m20 from '@/lib/actions/estoque-omie'
import * as m21 from '@/lib/actions/estoque-proprio'
import * as m22 from '@/lib/actions/estrutura'
import * as m23 from '@/lib/actions/familia'
import * as m24 from '@/lib/actions/ficha-tecnica'
import * as m25 from '@/lib/actions/fichas-omie'
import * as m26 from '@/lib/actions/financeiro-receber'
import * as m27 from '@/lib/actions/financeiro'
import * as m28 from '@/lib/actions/fornecedor'
import * as m29 from '@/lib/actions/importacao'
import * as m30 from '@/lib/actions/importar-pedidos'
import * as m31 from '@/lib/actions/integracao-ntb-vendas'
import * as m32 from '@/lib/actions/inventario-proprio'
import * as m33 from '@/lib/actions/inventario'
import * as m34 from '@/lib/actions/local-estoque'
import * as m35 from '@/lib/actions/loja-selector'
import * as m36 from '@/lib/actions/loja'
import * as m37 from '@/lib/actions/mapeamento-local-estoque'
import * as m38 from '@/lib/actions/meta-faturamento'
import * as m39 from '@/lib/actions/meta-mensal'
import * as m40 from '@/lib/actions/minha-loja'
import * as m41 from '@/lib/actions/movimentacoes-proprio'
import * as m42 from '@/lib/actions/movimentacoes'
import * as m43 from '@/lib/actions/nfe-saida'
import * as m44 from '@/lib/actions/nota-fiscal-proprio'
import * as m45 from '@/lib/actions/nota-fiscal'
import * as m46 from '@/lib/actions/notificacoes'
import * as m47 from '@/lib/actions/onboarding-loja'
import * as m48 from '@/lib/actions/ops-lote'
import * as m49 from '@/lib/actions/ordem-producao'
import * as m50 from '@/lib/actions/pedido-compra'
import * as m51 from '@/lib/actions/periodo-fechado'
import * as m52 from '@/lib/actions/produto-minimo'
import * as m53 from '@/lib/actions/produto-substituicao'
import * as m54 from '@/lib/actions/produto'
import * as m55 from '@/lib/actions/produtos-search'
import * as m56 from '@/lib/actions/requisicao-compra'
import * as m57 from '@/lib/actions/sintegra'
import * as m58 from '@/lib/actions/sync-status'
import * as m59 from '@/lib/actions/transferencia-loja'
import * as m60 from '@/lib/actions/transferencia'
import * as m61 from '@/lib/actions/usuario'
import * as m62 from '@/lib/actions/validade-proprio'
import * as m63 from '@/lib/actions/variacao-preco'

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
  'cozinha-cardapios#definirPorcoesItemCardapio': m14.definirPorcoesItemCardapio as Acao,
  'cozinha-cardapios#duplicarCardapio': m14.duplicarCardapio as Acao,
  'cozinha-eventos#criarEvento': m15.criarEvento as Acao,
  'cozinha-eventos#salvarEvento': m15.salvarEvento as Acao,
  'cozinha-eventos#excluirEvento': m15.excluirEvento as Acao,
  'cozinha-eventos#adicionarItemEvento': m15.adicionarItemEvento as Acao,
  'cozinha-eventos#definirPorcoesItemEvento': m15.definirPorcoesItemEvento as Acao,
  'cozinha-eventos#removerItemEvento': m15.removerItemEvento as Acao,
  'cozinha-eventos#definirStatusEvento': m15.definirStatusEvento as Acao,
  'cozinha-eventos#finalizarEvento': m15.finalizarEvento as Acao,
  'cozinha-eventos#reabrirEvento': m15.reabrirEvento as Acao,
  'cozinha-eventos#darBaixaEvento': m15.darBaixaEvento as Acao,
  'cozinha-eventos#marcarConsumoLancado': m15.marcarConsumoLancado as Acao,
  'cozinha-receitas#salvarInfoReceita': m16.salvarInfoReceita as Acao,
  'cozinha-receitas#removerFotoReceita': m16.removerFotoReceita as Acao,
  'custo-cardapio#salvarTaxasCardapio': m17.salvarTaxasCardapio as Acao,
  'detalhe-movimento#buscarDetalheOP': m18.buscarDetalheOP as Acao,
  'detalhe-movimento#buscarDetalheTransferencia': m18.buscarDetalheTransferencia as Acao,
  'detalhe-movimento#buscarDetalheNotaFiscal': m18.buscarDetalheNotaFiscal as Acao,
  'detalhe-movimento#buscarDetalheInventario': m18.buscarDetalheInventario as Acao,
  'devolucao-fornecedor#registrarDevolucao': m19.registrarDevolucao as Acao,
  'devolucao-fornecedor#cancelarDevolucao': m19.cancelarDevolucao as Acao,
  'estoque-omie#entradaOmie': m20.entradaOmie as Acao,
  'estoque-omie#ajusteOmie': m20.ajusteOmie as Acao,
  'estoque-omie#transferirOmie': m20.transferirOmie as Acao,
  'estoque-omie#corrigirCustoAjuste': m20.corrigirCustoAjuste as Acao,
  'estoque-omie#relancarCorrecaoCusto': m20.relancarCorrecaoCusto as Acao,
  'estoque-proprio#entradaManual': m21.entradaManual as Acao,
  'estoque-proprio#ajusteManual': m21.ajusteManual as Acao,
  'estoque-proprio#definirMinimo': m21.definirMinimo as Acao,
  'estoque-proprio#transferirEntreLocais': m21.transferirEntreLocais as Acao,
  'estoque-proprio#estornarMovimento': m21.estornarMovimento as Acao,
  'estrutura#verEstrutura': m22.verEstrutura as Acao,
  'estrutura#salvarEstrutura': m22.salvarEstrutura as Acao,
  'familia#criarFamilia': m23.criarFamilia as Acao,
  'familia#editarFamilia': m23.editarFamilia as Acao,
  'familia#excluirFamilia': m23.excluirFamilia as Acao,
  'familia#puxarFamiliasDoOmie': m23.puxarFamiliasDoOmie as Acao,
  'ficha-tecnica#salvarFichaTecnica': m24.salvarFichaTecnica as Acao,
  'ficha-tecnica#desativarFichaTecnica': m24.desativarFichaTecnica as Acao,
  'ficha-tecnica#produzirLoteAction': m24.produzirLoteAction as Acao,
  'fichas-omie#trocarInsumoNoPrato': m25.trocarInsumoNoPrato as Acao,
  'financeiro-receber#salvarFormaRecebimento': m26.salvarFormaRecebimento as Acao,
  'financeiro-receber#gerarContasReceberVendas': m26.gerarContasReceberVendas as Acao,
  'financeiro-receber#registrarRecebimento': m26.registrarRecebimento as Acao,
  'financeiro-receber#estornarRecebimento': m26.estornarRecebimento as Acao,
  'financeiro#salvarContaCorrente': m27.salvarContaCorrente as Acao,
  'financeiro#salvarCategoriaFinanceira': m27.salvarCategoriaFinanceira as Acao,
  'financeiro#criarCategoriasPadrao': m27.criarCategoriasPadrao as Acao,
  'financeiro#salvarTituloPagar': m27.salvarTituloPagar as Acao,
  'financeiro#cancelarTituloPagar': m27.cancelarTituloPagar as Acao,
  'financeiro#registrarPagamentoTitulo': m27.registrarPagamentoTitulo as Acao,
  'financeiro#estornarPagamentoTitulo': m27.estornarPagamentoTitulo as Acao,
  'financeiro#gerarContasPagarDaNota': m27.gerarContasPagarDaNota as Acao,
  'financeiro#salvarFamiliaCategoria': m27.salvarFamiliaCategoria as Acao,
  'financeiro#gerarContasNotasSemConta': m27.gerarContasNotasSemConta as Acao,
  'financeiro#decidirNotaDesfeita': m27.decidirNotaDesfeita as Acao,
  'financeiro#salvarConfigFinanceiro': m27.salvarConfigFinanceiro as Acao,
  'financeiro#decidirAprovacaoTitulo': m27.decidirAprovacaoTitulo as Acao,
  'financeiro#confirmarValorTitulo': m27.confirmarValorTitulo as Acao,
  'financeiro#salvarRecorrente': m27.salvarRecorrente as Acao,
  'financeiro#gerarRecorrentesAgora': m27.gerarRecorrentesAgora as Acao,
  'financeiro#registrarLancamentoAvulso': m27.registrarLancamentoAvulso as Acao,
  'financeiro#estornarLancamentoAvulso': m27.estornarLancamentoAvulso as Acao,
  'financeiro#registrarTransferencia': m27.registrarTransferencia as Acao,
  'financeiro#estornarTransferencia': m27.estornarTransferencia as Acao,
  'fornecedor#criarFornecedor': m28.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m28.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m28.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m28.puxarFornecedoresDoOmie as Acao,
  'importacao#previaImportacao': m29.previaImportacao as Acao,
  'importacao#confirmarImportacao': m29.confirmarImportacao as Acao,
  'importar-pedidos#previaImportacaoPedidos': m30.previaImportacaoPedidos as Acao,
  'importar-pedidos#confirmarImportacaoPedidos': m30.confirmarImportacaoPedidos as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m31.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m31.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m32.abrirInventario as Acao,
  'inventario-proprio#contarItem': m32.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m32.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m32.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m32.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m32.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m32.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m33.createInventario as Acao,
  'inventario#addInventarioItem': m33.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m33.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m33.removeInventarioItem as Acao,
  'inventario#finishInventario': m33.finishInventario as Acao,
  'inventario#forceSyncInventario': m33.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m33.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m33.duplicarInventario as Acao,
  'inventario#excluirInventario': m33.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m33.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m33.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m34.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m34.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m34.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m35.setCurrentLoja as Acao,
  'loja#criarLoja': m36.criarLoja as Acao,
  'loja#editarLoja': m36.editarLoja as Acao,
  'loja#alternarAtivoLoja': m36.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m36.excluirLoja as Acao,
  'loja#forceSyncLoja': m36.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m36.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m37.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m38.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m39.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m40.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m40.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m41.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m42.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m42.retryMovimentosManuaisPendentes as Acao,
  'nfe-saida#conferirNfeSaida': m43.conferirNfeSaida as Acao,
  'nfe-saida#emitirNfeSaida': m43.emitirNfeSaida as Acao,
  'nfe-saida#consultarNfeSaida': m43.consultarNfeSaida as Acao,
  'nfe-saida#cancelarNfeSaida': m43.cancelarNfeSaida as Acao,
  'nfe-saida#corrigirNfeSaida': m43.corrigirNfeSaida as Acao,
  'nfe-saida#descartarNfeSaida': m43.descartarNfeSaida as Acao,
  'nfe-saida#salvarConfigNfe': m43.salvarConfigNfe as Acao,
  'nfe-saida#definirProximoNumeroNfe': m43.definirProximoNumeroNfe as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m44.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m44.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m44.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m44.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m44.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m44.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m44.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m44.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m44.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m44.criarProdutoParaNF as Acao,
  'nota-fiscal-proprio#configurarItemNF': m44.configurarItemNF as Acao,
  'nota-fiscal-proprio#marcarConferidaNF': m44.marcarConferidaNF as Acao,
  'nota-fiscal-proprio#salvarObservacaoNF': m44.salvarObservacaoNF as Acao,
  'nota-fiscal-proprio#manifestarNotaSefaz': m44.manifestarNotaSefaz as Acao,
  'nota-fiscal-proprio#importarCteNF': m44.importarCteNF as Acao,
  'nota-fiscal-proprio#informarFreteNF': m44.informarFreteNF as Acao,
  'nota-fiscal-proprio#desvincularCteNF': m44.desvincularCteNF as Acao,
  'nota-fiscal-proprio#buscarNotaPorChaveNF': m44.buscarNotaPorChaveNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m45.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m45.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNota': m45.setCategoriaContabilNota as Acao,
  'nota-fiscal#classificarItensPeloProduto': m45.classificarItensPeloProduto as Acao,
  'nota-fiscal#manifestarNF': m45.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m45.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m45.excluirRecebimentoNF as Acao,
  'notificacoes#minhasNotificacoes': m46.minhasNotificacoes as Acao,
  'notificacoes#marcarNotificacaoLida': m46.marcarNotificacaoLida as Acao,
  'notificacoes#marcarTodasLidas': m46.marcarTodasLidas as Acao,
  'onboarding-loja#gerarCodigoLoja': m47.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m47.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m48.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m49.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m49.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m49.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m49.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m49.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m49.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m49.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m49.finishOP as Acao,
  'ordem-producao#excluirOP': m49.excluirOP as Acao,
  'ordem-producao#reverterOP': m49.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m49.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m49.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m49.reverterOPsEmLote as Acao,
  'pedido-compra#salvarPedidoCompra': m50.salvarPedidoCompra as Acao,
  'pedido-compra#mudarEtapaPedido': m50.mudarEtapaPedido as Acao,
  'pedido-compra#enviarPedidoAoOmieAgora': m50.enviarPedidoAoOmieAgora as Acao,
  'pedido-compra#vincularNotaAoPedido': m50.vincularNotaAoPedido as Acao,
  'pedido-compra#desvincularNotaDoPedido': m50.desvincularNotaDoPedido as Acao,
  'pedido-compra#criarPedidosDaSugestao': m50.criarPedidosDaSugestao as Acao,
  'pedido-compra#salvarLeadTime': m50.salvarLeadTime as Acao,
  'periodo-fechado#fecharMes': m51.fecharMes as Acao,
  'periodo-fechado#reabrirMes': m51.reabrirMes as Acao,
  'periodo-fechado#pendenciasDoMes': m51.pendenciasDoMes as Acao,
  'produto-minimo#setEstoqueMinimo': m52.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m53.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m53.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m54.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m54.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m54.criarProduto as Acao,
  'produto#editarProduto': m54.editarProduto as Acao,
  'produto#excluirProduto': m54.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m55.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m55.buscarProdutoPorCodigo as Acao,
  'requisicao-compra#salvarRequisicao': m56.salvarRequisicao as Acao,
  'requisicao-compra#acaoRequisicao': m56.acaoRequisicao as Acao,
  'requisicao-compra#gerarPedidosDasRequisicoes': m56.gerarPedidosDasRequisicoes as Acao,
  'requisicao-compra#criarRequisicaoDaSugestao': m56.criarRequisicaoDaSugestao as Acao,
  'sintegra#consultarCnpj': m57.consultarCnpj as Acao,
  'sintegra#importarParceiro': m57.importarParceiro as Acao,
  'sync-status#reprocessarSync': m58.reprocessarSync as Acao,
  'transferencia-loja#registrarTransferenciaLoja': m59.registrarTransferenciaLoja as Acao,
  'transferencia-loja#cancelarTransferenciaLoja': m59.cancelarTransferenciaLoja as Acao,
  'transferencia#createTransferencia': m60.createTransferencia as Acao,
  'transferencia#addMovimento': m60.addMovimento as Acao,
  'transferencia#enviarMovimento': m60.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m60.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m60.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m60.removeMovimento as Acao,
  'transferencia#finishTransferencia': m60.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m60.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m60.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m60.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m60.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m60.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m61.criarUsuario as Acao,
  'usuario#editarUsuario': m61.editarUsuario as Acao,
  'usuario#aprovarUsuario': m61.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m61.recusarUsuario as Acao,
  'usuario#excluirUsuario': m61.excluirUsuario as Acao,
  'usuario#togglePermissao': m61.togglePermissao as Acao,
  'usuario#redefinirSenha': m61.redefinirSenha as Acao,
  'usuario#toggleLocal': m61.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m62.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m62.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m62.reconciliarLotes as Acao,
  'variacao-preco#salvarLimiteVariacaoPreco': m63.salvarLimiteVariacaoPreco as Acao,
})
