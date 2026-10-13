// GERADO por scripts/inserir-via-desktop.mjs -- não editar à mão.
// Todas as server actions, pelo nome usado no canal do app desktop (modulo#funcao).
import * as m0 from '@/lib/actions/auth'
import * as m1 from '@/lib/actions/busca-global'
import * as m2 from '@/lib/actions/cadastro'
import * as m3 from '@/lib/actions/cargo'
import * as m4 from '@/lib/actions/catalogo-proprio'
import * as m5 from '@/lib/actions/categoria-contabil'
import * as m6 from '@/lib/actions/certificado'
import * as m7 from '@/lib/actions/compras-proprio'
import * as m8 from '@/lib/actions/convite'
import * as m9 from '@/lib/actions/detalhe-movimento'
import * as m10 from '@/lib/actions/estoque-omie'
import * as m11 from '@/lib/actions/estoque-proprio'
import * as m12 from '@/lib/actions/estrutura'
import * as m13 from '@/lib/actions/familia'
import * as m14 from '@/lib/actions/ficha-tecnica'
import * as m15 from '@/lib/actions/fichas-omie'
import * as m16 from '@/lib/actions/fornecedor'
import * as m17 from '@/lib/actions/integracao-ntb-vendas'
import * as m18 from '@/lib/actions/inventario-proprio'
import * as m19 from '@/lib/actions/inventario'
import * as m20 from '@/lib/actions/local-estoque'
import * as m21 from '@/lib/actions/loja-selector'
import * as m22 from '@/lib/actions/loja'
import * as m23 from '@/lib/actions/mapeamento-local-estoque'
import * as m24 from '@/lib/actions/meta-faturamento'
import * as m25 from '@/lib/actions/meta-mensal'
import * as m26 from '@/lib/actions/minha-loja'
import * as m27 from '@/lib/actions/movimentacoes-proprio'
import * as m28 from '@/lib/actions/movimentacoes'
import * as m29 from '@/lib/actions/nota-fiscal-proprio'
import * as m30 from '@/lib/actions/nota-fiscal'
import * as m31 from '@/lib/actions/onboarding-loja'
import * as m32 from '@/lib/actions/ops-lote'
import * as m33 from '@/lib/actions/ordem-producao'
import * as m34 from '@/lib/actions/produto-minimo'
import * as m35 from '@/lib/actions/produto-substituicao'
import * as m36 from '@/lib/actions/produto'
import * as m37 from '@/lib/actions/produtos-search'
import * as m38 from '@/lib/actions/sintegra'
import * as m39 from '@/lib/actions/sync-status'
import * as m40 from '@/lib/actions/transferencia'
import * as m41 from '@/lib/actions/usuario'
import * as m42 from '@/lib/actions/validade-proprio'

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
  'certificado#salvarCertificado': m6.salvarCertificado as Acao,
  'compras-proprio#previaXml': m7.previaXml as Acao,
  'compras-proprio#lancarCompraXml': m7.lancarCompraXml as Acao,
  'compras-proprio#lancarCompraManual': m7.lancarCompraManual as Acao,
  'compras-proprio#mapearPendentes': m7.mapearPendentes as Acao,
  'compras-proprio#estornarCompra': m7.estornarCompra as Acao,
  'compras-proprio#buscarProdutosCompra': m7.buscarProdutosCompra as Acao,
  'compras-proprio#criarProdutoRapido': m7.criarProdutoRapido as Acao,
  'convite#gerarConvite': m8.gerarConvite as Acao,
  'convite#revogarConvite': m8.revogarConvite as Acao,
  'detalhe-movimento#buscarDetalheOP': m9.buscarDetalheOP as Acao,
  'detalhe-movimento#buscarDetalheTransferencia': m9.buscarDetalheTransferencia as Acao,
  'detalhe-movimento#buscarDetalheNotaFiscal': m9.buscarDetalheNotaFiscal as Acao,
  'detalhe-movimento#buscarDetalheInventario': m9.buscarDetalheInventario as Acao,
  'estoque-omie#entradaOmie': m10.entradaOmie as Acao,
  'estoque-omie#ajusteOmie': m10.ajusteOmie as Acao,
  'estoque-omie#transferirOmie': m10.transferirOmie as Acao,
  'estoque-proprio#entradaManual': m11.entradaManual as Acao,
  'estoque-proprio#ajusteManual': m11.ajusteManual as Acao,
  'estoque-proprio#definirMinimo': m11.definirMinimo as Acao,
  'estoque-proprio#transferirEntreLocais': m11.transferirEntreLocais as Acao,
  'estoque-proprio#estornarMovimento': m11.estornarMovimento as Acao,
  'estrutura#verEstrutura': m12.verEstrutura as Acao,
  'estrutura#salvarEstrutura': m12.salvarEstrutura as Acao,
  'familia#criarFamilia': m13.criarFamilia as Acao,
  'familia#editarFamilia': m13.editarFamilia as Acao,
  'familia#excluirFamilia': m13.excluirFamilia as Acao,
  'familia#puxarFamiliasDoOmie': m13.puxarFamiliasDoOmie as Acao,
  'ficha-tecnica#salvarFichaTecnica': m14.salvarFichaTecnica as Acao,
  'ficha-tecnica#desativarFichaTecnica': m14.desativarFichaTecnica as Acao,
  'ficha-tecnica#produzirLoteAction': m14.produzirLoteAction as Acao,
  'fichas-omie#trocarInsumoNoPrato': m15.trocarInsumoNoPrato as Acao,
  'fornecedor#criarFornecedor': m16.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m16.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m16.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m16.puxarFornecedoresDoOmie as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m17.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m17.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m18.abrirInventario as Acao,
  'inventario-proprio#contarItem': m18.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m18.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m18.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m18.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m18.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m18.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m19.createInventario as Acao,
  'inventario#addInventarioItem': m19.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m19.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m19.removeInventarioItem as Acao,
  'inventario#finishInventario': m19.finishInventario as Acao,
  'inventario#forceSyncInventario': m19.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m19.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m19.duplicarInventario as Acao,
  'inventario#excluirInventario': m19.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m19.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m19.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m20.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m20.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m20.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m21.setCurrentLoja as Acao,
  'loja#criarLoja': m22.criarLoja as Acao,
  'loja#editarLoja': m22.editarLoja as Acao,
  'loja#alternarAtivoLoja': m22.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m22.excluirLoja as Acao,
  'loja#forceSyncLoja': m22.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m22.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m23.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m24.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m25.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m26.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m26.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m27.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m28.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m28.retryMovimentosManuaisPendentes as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m29.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m29.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m29.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m29.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m29.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m29.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m29.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m29.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m29.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m29.criarProdutoParaNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m30.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m30.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#manifestarNF': m30.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m30.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m30.excluirRecebimentoNF as Acao,
  'onboarding-loja#gerarCodigoLoja': m31.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m31.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m32.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m33.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m33.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m33.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m33.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m33.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m33.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m33.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m33.finishOP as Acao,
  'ordem-producao#excluirOP': m33.excluirOP as Acao,
  'ordem-producao#reverterOP': m33.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m33.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m33.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m33.reverterOPsEmLote as Acao,
  'produto-minimo#setEstoqueMinimo': m34.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m35.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m35.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m36.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m36.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m36.criarProduto as Acao,
  'produto#editarProduto': m36.editarProduto as Acao,
  'produto#excluirProduto': m36.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m37.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m37.buscarProdutoPorCodigo as Acao,
  'sintegra#consultarCnpj': m38.consultarCnpj as Acao,
  'sintegra#importarParceiro': m38.importarParceiro as Acao,
  'sync-status#reprocessarSync': m39.reprocessarSync as Acao,
  'transferencia#createTransferencia': m40.createTransferencia as Acao,
  'transferencia#addMovimento': m40.addMovimento as Acao,
  'transferencia#enviarMovimento': m40.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m40.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m40.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m40.removeMovimento as Acao,
  'transferencia#finishTransferencia': m40.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m40.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m40.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m40.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m40.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m40.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m41.criarUsuario as Acao,
  'usuario#editarUsuario': m41.editarUsuario as Acao,
  'usuario#aprovarUsuario': m41.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m41.recusarUsuario as Acao,
  'usuario#excluirUsuario': m41.excluirUsuario as Acao,
  'usuario#togglePermissao': m41.togglePermissao as Acao,
  'usuario#redefinirSenha': m41.redefinirSenha as Acao,
  'usuario#toggleLocal': m41.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m42.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m42.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m42.reconciliarLotes as Acao,
})
