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
import * as m10 from '@/lib/actions/estoque-proprio'
import * as m11 from '@/lib/actions/estrutura'
import * as m12 from '@/lib/actions/familia'
import * as m13 from '@/lib/actions/ficha-tecnica'
import * as m14 from '@/lib/actions/fornecedor'
import * as m15 from '@/lib/actions/integracao-ntb-vendas'
import * as m16 from '@/lib/actions/inventario-proprio'
import * as m17 from '@/lib/actions/inventario'
import * as m18 from '@/lib/actions/local-estoque'
import * as m19 from '@/lib/actions/loja-selector'
import * as m20 from '@/lib/actions/loja'
import * as m21 from '@/lib/actions/mapeamento-local-estoque'
import * as m22 from '@/lib/actions/meta-faturamento'
import * as m23 from '@/lib/actions/meta-mensal'
import * as m24 from '@/lib/actions/minha-loja'
import * as m25 from '@/lib/actions/movimentacoes-proprio'
import * as m26 from '@/lib/actions/movimentacoes'
import * as m27 from '@/lib/actions/nota-fiscal-proprio'
import * as m28 from '@/lib/actions/nota-fiscal'
import * as m29 from '@/lib/actions/onboarding-loja'
import * as m30 from '@/lib/actions/ordem-producao'
import * as m31 from '@/lib/actions/produto-minimo'
import * as m32 from '@/lib/actions/produto-substituicao'
import * as m33 from '@/lib/actions/produto'
import * as m34 from '@/lib/actions/produtos-search'
import * as m35 from '@/lib/actions/sintegra'
import * as m36 from '@/lib/actions/sync-status'
import * as m37 from '@/lib/actions/transferencia'
import * as m38 from '@/lib/actions/usuario'
import * as m39 from '@/lib/actions/validade-proprio'

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
  'estoque-proprio#entradaManual': m10.entradaManual as Acao,
  'estoque-proprio#ajusteManual': m10.ajusteManual as Acao,
  'estoque-proprio#definirMinimo': m10.definirMinimo as Acao,
  'estoque-proprio#transferirEntreLocais': m10.transferirEntreLocais as Acao,
  'estoque-proprio#estornarMovimento': m10.estornarMovimento as Acao,
  'estrutura#verEstrutura': m11.verEstrutura as Acao,
  'estrutura#salvarEstrutura': m11.salvarEstrutura as Acao,
  'familia#criarFamilia': m12.criarFamilia as Acao,
  'familia#editarFamilia': m12.editarFamilia as Acao,
  'familia#excluirFamilia': m12.excluirFamilia as Acao,
  'familia#puxarFamiliasDoOmie': m12.puxarFamiliasDoOmie as Acao,
  'ficha-tecnica#salvarFichaTecnica': m13.salvarFichaTecnica as Acao,
  'ficha-tecnica#desativarFichaTecnica': m13.desativarFichaTecnica as Acao,
  'ficha-tecnica#produzirLoteAction': m13.produzirLoteAction as Acao,
  'fornecedor#criarFornecedor': m14.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m14.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m14.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m14.puxarFornecedoresDoOmie as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m15.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m15.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m16.abrirInventario as Acao,
  'inventario-proprio#contarItem': m16.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m16.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m16.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m16.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m16.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m16.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m17.createInventario as Acao,
  'inventario#addInventarioItem': m17.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m17.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m17.removeInventarioItem as Acao,
  'inventario#finishInventario': m17.finishInventario as Acao,
  'inventario#forceSyncInventario': m17.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m17.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m17.duplicarInventario as Acao,
  'inventario#excluirInventario': m17.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m17.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m17.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m18.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m18.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m18.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m19.setCurrentLoja as Acao,
  'loja#criarLoja': m20.criarLoja as Acao,
  'loja#editarLoja': m20.editarLoja as Acao,
  'loja#alternarAtivoLoja': m20.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m20.excluirLoja as Acao,
  'loja#forceSyncLoja': m20.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m20.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m21.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m22.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m23.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m24.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m24.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m25.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m26.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m26.retryMovimentosManuaisPendentes as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m27.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m27.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m27.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m27.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m27.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m27.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m27.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m27.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m27.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m27.criarProdutoParaNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m28.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m28.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#manifestarNF': m28.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m28.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m28.excluirRecebimentoNF as Acao,
  'onboarding-loja#gerarCodigoLoja': m29.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m29.removerCodigoLoja as Acao,
  'ordem-producao#criarOrdemProducao': m30.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m30.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m30.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m30.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m30.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m30.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m30.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m30.finishOP as Acao,
  'ordem-producao#excluirOP': m30.excluirOP as Acao,
  'ordem-producao#reverterOP': m30.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m30.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m30.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m30.reverterOPsEmLote as Acao,
  'produto-minimo#setEstoqueMinimo': m31.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m32.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m32.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m33.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m33.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m33.criarProduto as Acao,
  'produto#editarProduto': m33.editarProduto as Acao,
  'produto#excluirProduto': m33.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m34.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m34.buscarProdutoPorCodigo as Acao,
  'sintegra#consultarCnpj': m35.consultarCnpj as Acao,
  'sintegra#importarParceiro': m35.importarParceiro as Acao,
  'sync-status#reprocessarSync': m36.reprocessarSync as Acao,
  'transferencia#createTransferencia': m37.createTransferencia as Acao,
  'transferencia#addMovimento': m37.addMovimento as Acao,
  'transferencia#enviarMovimento': m37.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m37.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m37.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m37.removeMovimento as Acao,
  'transferencia#finishTransferencia': m37.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m37.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m37.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m37.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m37.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m37.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m38.criarUsuario as Acao,
  'usuario#editarUsuario': m38.editarUsuario as Acao,
  'usuario#aprovarUsuario': m38.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m38.recusarUsuario as Acao,
  'usuario#excluirUsuario': m38.excluirUsuario as Acao,
  'usuario#togglePermissao': m38.togglePermissao as Acao,
  'usuario#redefinirSenha': m38.redefinirSenha as Acao,
  'usuario#toggleLocal': m38.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m39.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m39.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m39.reconciliarLotes as Acao,
})
