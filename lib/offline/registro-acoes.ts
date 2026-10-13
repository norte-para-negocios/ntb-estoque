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
import * as m15 from '@/lib/actions/fornecedor'
import * as m16 from '@/lib/actions/integracao-ntb-vendas'
import * as m17 from '@/lib/actions/inventario-proprio'
import * as m18 from '@/lib/actions/inventario'
import * as m19 from '@/lib/actions/local-estoque'
import * as m20 from '@/lib/actions/loja-selector'
import * as m21 from '@/lib/actions/loja'
import * as m22 from '@/lib/actions/mapeamento-local-estoque'
import * as m23 from '@/lib/actions/meta-faturamento'
import * as m24 from '@/lib/actions/meta-mensal'
import * as m25 from '@/lib/actions/minha-loja'
import * as m26 from '@/lib/actions/movimentacoes-proprio'
import * as m27 from '@/lib/actions/movimentacoes'
import * as m28 from '@/lib/actions/nota-fiscal-proprio'
import * as m29 from '@/lib/actions/nota-fiscal'
import * as m30 from '@/lib/actions/onboarding-loja'
import * as m31 from '@/lib/actions/ops-lote'
import * as m32 from '@/lib/actions/ordem-producao'
import * as m33 from '@/lib/actions/produto-minimo'
import * as m34 from '@/lib/actions/produto-substituicao'
import * as m35 from '@/lib/actions/produto'
import * as m36 from '@/lib/actions/produtos-search'
import * as m37 from '@/lib/actions/sintegra'
import * as m38 from '@/lib/actions/sync-status'
import * as m39 from '@/lib/actions/transferencia'
import * as m40 from '@/lib/actions/usuario'
import * as m41 from '@/lib/actions/validade-proprio'

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
  'fornecedor#criarFornecedor': m15.criarFornecedor as Acao,
  'fornecedor#editarFornecedor': m15.editarFornecedor as Acao,
  'fornecedor#excluirFornecedor': m15.excluirFornecedor as Acao,
  'fornecedor#puxarFornecedoresDoOmie': m15.puxarFornecedoresDoOmie as Acao,
  'integracao-ntb-vendas#gerarChaveIntegracaoNtbVendas': m16.gerarChaveIntegracaoNtbVendas as Acao,
  'integracao-ntb-vendas#removerChaveIntegracaoNtbVendas': m16.removerChaveIntegracaoNtbVendas as Acao,
  'inventario-proprio#abrirInventario': m17.abrirInventario as Acao,
  'inventario-proprio#contarItem': m17.contarItem as Acao,
  'inventario-proprio#definirMotivoItem': m17.definirMotivoItem as Acao,
  'inventario-proprio#fecharInventario': m17.fecharInventario as Acao,
  'inventario-proprio#cancelarInventario': m17.cancelarInventario as Acao,
  'inventario-proprio#buscarProdutosParaContagem': m17.buscarProdutosParaContagem as Acao,
  'inventario-proprio#salvarLimiteMotivo': m17.salvarLimiteMotivo as Acao,
  'inventario#createInventario': m18.createInventario as Acao,
  'inventario#addInventarioItem': m18.addInventarioItem as Acao,
  'inventario#enviarInventarioItem': m18.enviarInventarioItem as Acao,
  'inventario#removeInventarioItem': m18.removeInventarioItem as Acao,
  'inventario#finishInventario': m18.finishInventario as Acao,
  'inventario#forceSyncInventario': m18.forceSyncInventario as Acao,
  'inventario#retryAjustesInventarioPendentes': m18.retryAjustesInventarioPendentes as Acao,
  'inventario#duplicarInventario': m18.duplicarInventario as Acao,
  'inventario#excluirInventario': m18.excluirInventario as Acao,
  'inventario#editQuantidadeInventarioItem': m18.editQuantidadeInventarioItem as Acao,
  'inventario#informarMotivoInventarioItem': m18.informarMotivoInventarioItem as Acao,
  'local-estoque#excluirLocalEstoque': m19.excluirLocalEstoque as Acao,
  'local-estoque#criarLocalEstoque': m19.criarLocalEstoque as Acao,
  'local-estoque#editarLocalEstoque': m19.editarLocalEstoque as Acao,
  'loja-selector#setCurrentLoja': m20.setCurrentLoja as Acao,
  'loja#criarLoja': m21.criarLoja as Acao,
  'loja#editarLoja': m21.editarLoja as Acao,
  'loja#alternarAtivoLoja': m21.alternarAtivoLoja as Acao,
  'loja#excluirLoja': m21.excluirLoja as Acao,
  'loja#forceSyncLoja': m21.forceSyncLoja as Acao,
  'loja#puxarEmpresaDoOmie': m21.puxarEmpresaDoOmie as Acao,
  'mapeamento-local-estoque#salvarMapeamentoLocalEstoque': m22.salvarMapeamentoLocalEstoque as Acao,
  'meta-faturamento#salvarMetaFaturamento': m23.salvarMetaFaturamento as Acao,
  'meta-mensal#salvarMetaMensal': m24.salvarMetaMensal as Acao,
  'minha-loja#editarLojaNegocio': m25.editarLojaNegocio as Acao,
  'minha-loja#salvarEtiquetaConfig': m25.salvarEtiquetaConfig as Acao,
  'movimentacoes-proprio#detalheMovimentoProprio': m26.detalheMovimentoProprio as Acao,
  'movimentacoes#criarAjusteManual': m27.criarAjusteManual as Acao,
  'movimentacoes#retryMovimentosManuaisPendentes': m27.retryMovimentosManuaisPendentes as Acao,
  'nota-fiscal-proprio#confirmarEntradaNF': m28.confirmarEntradaNF as Acao,
  'nota-fiscal-proprio#desfazerEntradaNF': m28.desfazerEntradaNF as Acao,
  'nota-fiscal-proprio#excluirNotaProprio': m28.excluirNotaProprio as Acao,
  'nota-fiscal-proprio#vincularItemNF': m28.vincularItemNF as Acao,
  'nota-fiscal-proprio#definirLoteItemNF': m28.definirLoteItemNF as Acao,
  'nota-fiscal-proprio#criarProdutoDoItemNF': m28.criarProdutoDoItemNF as Acao,
  'nota-fiscal-proprio#buscarProdutosNF': m28.buscarProdutosNF as Acao,
  'nota-fiscal-proprio#salvarConfigSefaz': m28.salvarConfigSefaz as Acao,
  'nota-fiscal-proprio#sincronizarSefazAgora': m28.sincronizarSefazAgora as Acao,
  'nota-fiscal-proprio#criarProdutoParaNF': m28.criarProdutoParaNF as Acao,
  'nota-fiscal#setQuantidadeNFItem': m29.setQuantidadeNFItem as Acao,
  'nota-fiscal#setCategoriaContabilNFItem': m29.setCategoriaContabilNFItem as Acao,
  'nota-fiscal#manifestarNF': m29.manifestarNF as Acao,
  'nota-fiscal#reverterManifestacaoNF': m29.reverterManifestacaoNF as Acao,
  'nota-fiscal#excluirRecebimentoNF': m29.excluirRecebimentoNF as Acao,
  'onboarding-loja#gerarCodigoLoja': m30.gerarCodigoLoja as Acao,
  'onboarding-loja#removerCodigoLoja': m30.removerCodigoLoja as Acao,
  'ops-lote#acaoOPLote': m31.acaoOPLote as Acao,
  'ordem-producao#criarOrdemProducao': m32.criarOrdemProducao as Acao,
  'ordem-producao#criarOrdensProducao': m32.criarOrdensProducao as Acao,
  'ordem-producao#saldoAtualProdutos': m32.saldoAtualProdutos as Acao,
  'ordem-producao#setValidadeOP': m32.setValidadeOP as Acao,
  'ordem-producao#setQuantidadeOP': m32.setQuantidadeOP as Acao,
  'ordem-producao#setDataOP': m32.setDataOP as Acao,
  'ordem-producao#setQtdPlanejadaOP': m32.setQtdPlanejadaOP as Acao,
  'ordem-producao#finishOP': m32.finishOP as Acao,
  'ordem-producao#excluirOP': m32.excluirOP as Acao,
  'ordem-producao#reverterOP': m32.reverterOP as Acao,
  'ordem-producao#retryOPsPendentes': m32.retryOPsPendentes as Acao,
  'ordem-producao#finishOPsEmLote': m32.finishOPsEmLote as Acao,
  'ordem-producao#reverterOPsEmLote': m32.reverterOPsEmLote as Acao,
  'produto-minimo#setEstoqueMinimo': m33.setEstoqueMinimo as Acao,
  'produto-substituicao#criarProdutoSubstituicao': m34.criarProdutoSubstituicao as Acao,
  'produto-substituicao#excluirProdutoSubstituicao': m34.excluirProdutoSubstituicao as Acao,
  'produto#buscarFamilias': m35.buscarFamilias as Acao,
  'produto#sugerirProximoCodigo': m35.sugerirProximoCodigo as Acao,
  'produto#criarProduto': m35.criarProduto as Acao,
  'produto#editarProduto': m35.editarProduto as Acao,
  'produto#excluirProduto': m35.excluirProduto as Acao,
  'produtos-search#buscarProdutos': m36.buscarProdutos as Acao,
  'produtos-search#buscarProdutoPorCodigo': m36.buscarProdutoPorCodigo as Acao,
  'sintegra#consultarCnpj': m37.consultarCnpj as Acao,
  'sintegra#importarParceiro': m37.importarParceiro as Acao,
  'sync-status#reprocessarSync': m38.reprocessarSync as Acao,
  'transferencia#createTransferencia': m39.createTransferencia as Acao,
  'transferencia#addMovimento': m39.addMovimento as Acao,
  'transferencia#enviarMovimento': m39.enviarMovimento as Acao,
  'transferencia#salvarObservacaoTransferencia': m39.salvarObservacaoTransferencia as Acao,
  'transferencia#salvarObservacaoItem': m39.salvarObservacaoItem as Acao,
  'transferencia#removeMovimento': m39.removeMovimento as Acao,
  'transferencia#finishTransferencia': m39.finishTransferencia as Acao,
  'transferencia#forceSyncTransferencia': m39.forceSyncTransferencia as Acao,
  'transferencia#retryMovimentosTransferenciaPendentes': m39.retryMovimentosTransferenciaPendentes as Acao,
  'transferencia#duplicarTransferencia': m39.duplicarTransferencia as Acao,
  'transferencia#excluirTransferencia': m39.excluirTransferencia as Acao,
  'transferencia#editQuantidadeMovimento': m39.editQuantidadeMovimento as Acao,
  'usuario#criarUsuario': m40.criarUsuario as Acao,
  'usuario#editarUsuario': m40.editarUsuario as Acao,
  'usuario#aprovarUsuario': m40.aprovarUsuario as Acao,
  'usuario#recusarUsuario': m40.recusarUsuario as Acao,
  'usuario#excluirUsuario': m40.excluirUsuario as Acao,
  'usuario#togglePermissao': m40.togglePermissao as Acao,
  'usuario#redefinirSenha': m40.redefinirSenha as Acao,
  'usuario#toggleLocal': m40.toggleLocal as Acao,
  'validade-proprio#baixarLoteVencido': m41.baixarLoteVencido as Acao,
  'validade-proprio#salvarAlertaValidade': m41.salvarAlertaValidade as Acao,
  'validade-proprio#reconciliarLotes': m41.reconciliarLotes as Acao,
})
