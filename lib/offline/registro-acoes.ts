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
import * as m8 from '@/lib/actions/compras-proprio'
import * as m9 from '@/lib/actions/convite'
import * as m10 from '@/lib/actions/detalhe-movimento'
import * as m11 from '@/lib/actions/estoque-omie'
import * as m12 from '@/lib/actions/estoque-proprio'
import * as m13 from '@/lib/actions/estrutura'
import * as m14 from '@/lib/actions/familia'
import * as m15 from '@/lib/actions/ficha-tecnica'
import * as m16 from '@/lib/actions/fichas-omie'
import * as m17 from '@/lib/actions/fornecedor'
import * as m18 from '@/lib/actions/integracao-ntb-vendas'
import * as m19 from '@/lib/actions/inventario-proprio'
import * as m20 from '@/lib/actions/inventario'
import * as m21 from '@/lib/actions/local-estoque'
import * as m22 from '@/lib/actions/loja-selector'
import * as m23 from '@/lib/actions/loja'
import * as m24 from '@/lib/actions/mapeamento-local-estoque'
import * as m25 from '@/lib/actions/meta-faturamento'
import * as m26 from '@/lib/actions/meta-mensal'
import * as m27 from '@/lib/actions/minha-loja'
import * as m28 from '@/lib/actions/movimentacoes-proprio'
import * as m29 from '@/lib/actions/movimentacoes'
import * as m30 from '@/lib/actions/nota-fiscal-proprio'
import * as m31 from '@/lib/actions/nota-fiscal'
import * as m32 from '@/lib/actions/onboarding-loja'
import * as m33 from '@/lib/actions/ops-lote'
import * as m34 from '@/lib/actions/ordem-producao'
import * as m35 from '@/lib/actions/produto-minimo'
import * as m36 from '@/lib/actions/produto-substituicao'
import * as m37 from '@/lib/actions/produto'
import * as m38 from '@/lib/actions/produtos-search'
import * as m39 from '@/lib/actions/sintegra'
import * as m40 from '@/lib/actions/sync-status'
import * as m41 from '@/lib/actions/transferencia'
import * as m42 from '@/lib/actions/usuario'
import * as m43 from '@/lib/actions/validade-proprio'

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
  'compras-proprio#previaXml': m8.previaXml as Acao,
  'compras-proprio#lancarCompraXml': m8.lancarCompraXml as Acao,
  'compras-proprio#lancarCompraManual': m8.lancarCompraManual as Acao,
  'compras-proprio#mapearPendentes': m8.mapearPendentes as Acao,
  'compras-proprio#estornarCompra': m8.estornarCompra as Acao,
  'compras-proprio#buscarProdutosCompra': m8.buscarProdutosCompra as Acao,
  'compras-proprio#criarProdutoRapido': m8.criarProdutoRapido as Acao,
  'convite#gerarConvite': m9.gerarConvite as Acao,
  'convite#revogarConvite': m9.revogarConvite as Acao,
  'detalhe-movimento#buscarDetalheOP': m10.buscarDetalheOP as Acao,
  'detalhe-movimento#buscarDetalheTransferencia': m10.buscarDetalheTransferencia as Acao,
  'detalhe-movimento#buscarDetalheNotaFiscal': m10.buscarDetalheNotaFiscal as Acao,
  'detalhe-movimento#buscarDetalheInventario': m10.buscarDetalheInventario as Acao,
  'estoque-omie#entradaOmie': m11.entradaOmie as Acao,
  'estoque-omie#ajusteOmie': m11.ajusteOmie as Acao,
  'estoque-omie#transferirOmie': m11.transferirOmie as Acao,
  'estoque-omie#corrigirCustoAjuste': m11.corrigirCustoAjuste as Acao,
  'estoque-omie#relancarCorrecaoCusto': m11.relancarCorrecaoCusto as Acao,
  'estoque-proprio#entradaManual': m12.entradaManual as Acao,
  'estoque-proprio#ajusteManual': m12.ajusteManual as Acao,
  'estoque-proprio#definirMinimo': m12.definirMinimo as Acao,
  'estoque-proprio#transferirEntreLocais': m12.transferirEntreLocais as Acao,
  'estoque-proprio#estornarMovimento': m12.estornarMovimento as Acao,
  'estrutura#verEstrutura': m13.verEstrutura as Acao,
  'estrutura#salvarEstrutura': m13.salvarEstrutura as Acao,
  'familia#criarFamilia': m14.criarFamilia as Acao,
  'familia#editarFamilia': m14.editarFamilia as Acao,
  'familia#excluirFamilia': m14.excluirFamilia as Acao,
  'familia#puxarFamiliasDoOmie': m14.puxarFamiliasDoOmie as Acao,
  'ficha-tecnica#salvarFichaTecnica': m15.salvarFichaTecnica as Acao,
  'ficha-tecnica#desativarFichaTecnica': m15.desativarFichaTecnica as Acao,
  'ficha-tecnica#produzirLoteAction': m15.produzirLoteAction as Acao,
  'fichas-omie#trocarInsumoNoPrato': m16.trocarInsumoNoPrato as Acao,
  'fornecedor#criarFornecedor': m17.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m17.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m17.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m17.puxarFornecedoresDoOmie as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m18.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m18.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m19.abrirInventario as Acao,
  'inventario-proprio#contarItem': m19.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m19.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m19.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m19.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m19.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m19.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m20.createInventario as Acao,
  'inventario#addInventarioItem': m20.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m20.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m20.removeInventarioItem as Acao,
  'inventario#finishInventario': m20.finishInventario as Acao,
  'inventario#forceSyncInventario': m20.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m20.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m20.duplicarInventario as Acao,
  'inventario#excluirInventario': m20.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m20.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m20.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m21.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m21.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m21.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m22.setCurrentLoja as Acao,
  'loja#criarLoja': m23.criarLoja as Acao,
  'loja#editarLoja': m23.editarLoja as Acao,
  'loja#alternarAtivoLoja': m23.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m23.excluirLoja as Acao,
  'loja#forceSyncLoja': m23.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m23.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m24.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m25.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m26.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m27.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m27.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m28.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m29.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m29.retryMovimentosManuaisPendentes as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m30.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m30.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m30.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m30.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m30.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m30.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m30.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m30.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m30.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m30.criarProdutoParaNF as Acao,
  'nota-fiscal-proprio#configurarItemNF': m30.configurarItemNF as Acao,
  'nota-fiscal-proprio#marcarConferidaNF': m30.marcarConferidaNF as Acao,
  'nota-fiscal-proprio#salvarObservacaoNF': m30.salvarObservacaoNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m31.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m31.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#manifestarNF': m31.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m31.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m31.excluirRecebimentoNF as Acao,
  'onboarding-loja#gerarCodigoLoja': m32.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m32.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m33.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m34.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m34.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m34.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m34.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m34.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m34.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m34.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m34.finishOP as Acao,
  'ordem-producao#excluirOP': m34.excluirOP as Acao,
  'ordem-producao#reverterOP': m34.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m34.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m34.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m34.reverterOPsEmLote as Acao,
  'produto-minimo#setEstoqueMinimo': m35.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m36.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m36.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m37.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m37.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m37.criarProduto as Acao,
  'produto#editarProduto': m37.editarProduto as Acao,
  'produto#excluirProduto': m37.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m38.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m38.buscarProdutoPorCodigo as Acao,
  'sintegra#consultarCnpj': m39.consultarCnpj as Acao,
  'sintegra#importarParceiro': m39.importarParceiro as Acao,
  'sync-status#reprocessarSync': m40.reprocessarSync as Acao,
  'transferencia#createTransferencia': m41.createTransferencia as Acao,
  'transferencia#addMovimento': m41.addMovimento as Acao,
  'transferencia#enviarMovimento': m41.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m41.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m41.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m41.removeMovimento as Acao,
  'transferencia#finishTransferencia': m41.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m41.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m41.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m41.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m41.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m41.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m42.criarUsuario as Acao,
  'usuario#editarUsuario': m42.editarUsuario as Acao,
  'usuario#aprovarUsuario': m42.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m42.recusarUsuario as Acao,
  'usuario#excluirUsuario': m42.excluirUsuario as Acao,
  'usuario#togglePermissao': m42.togglePermissao as Acao,
  'usuario#redefinirSenha': m42.redefinirSenha as Acao,
  'usuario#toggleLocal': m42.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m43.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m43.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m43.reconciliarLotes as Acao,
})
