// O que cada server action faz no app desktop. Ação fora desta lista: com internet vai ao servidor;
// sem internet devolve "Esta ação precisa de internet".
//   leitura  = roda sempre no banco local (busca, detalhe, login).
//   local    = com internet vai ao servidor; sem internet roda no banco local e entra na fila
//              (só mexe no banco, em qualquer modo de loja).
//   fila     = com internet vai ao servidor; sem internet só entra na fila (fala com o Omie).
//   depende  = 'local' se a loja atual é de estoque próprio, 'fila' se é loja Omie.
// Conferido ação a ação em 2026-10-09 (corpo de cada função: chamadas ao Omie/SEFAZ/rede e
// desvio por modoDaLoja/ehLojaProprio).
// Fase C (19/10/2026): as ações de pedido-compra (salvar, mudar etapa, vincular/desvincular nota, criar da sugestão,
// lead time) ficam FORA de propósito: as tabelas novas (migrations 200/201) não estão em offline_tabelas, então só com internet.
// C1 (20/10/2026): idem para pedido-compra#enviarPedidoAoOmieAgora (grava no Omie; tabela da 270 fora de offline_tabelas).
// Fase C2 (19/10/2026): idem para requisicao-compra (salvar, ação, gerar pedidos, criar da sugestão), compras-cadastros
// (comprador, prazo do fornecedor) e importar-pedidos (prévia e confirmação): tabelas das migrations 240–242, só com internet.
// Fase G (19/10/2026): anexos#excluirAnexo, notificacoes#* e importacao#* ficam FORA de propósito: as tabelas novas
// (migrations 221–223) não estão em offline_tabelas e o envio de anexo/planilha precisa do servidor (Storage). Só com internet.
// Finanças etapa 1 (21/10/2026): financeiro#* ficam FORA de propósito: escrevem nas tabelas fin_* das migrations 285/286 (fora de
// offline_tabelas) e exigem a trava do título e a chave de idempotência do servidor. Só com internet.
// Fase F NF-e de saída (20/10/2026): nfe-saida#* e transferencia-loja#* ficam FORA de propósito: assinam com o certificado
// e falam com a SEFAZ (ou gravam nas tabelas das migrations 260/261, fora de offline_tabelas). Só com internet.
export type ModoOffline = 'leitura' | 'local' | 'fila' | 'depende'

const leitura = [
  'auth#login',
  'auth#logout',
  'busca-global#buscaGlobal',
  'central#carregarPainel',
  'cargo#listarCargos',
  'catalogo-proprio#carregarProdutoCatalogo',
  'catalogo-proprio#listarGrupos',
  'compras-proprio#buscarProdutosCompra',
  'compras-proprio#previaXml',
  'detalhe-movimento#buscarDetalheInventario',
  'detalhe-movimento#buscarDetalheNotaFiscal',
  'detalhe-movimento#buscarDetalheOP',
  'detalhe-movimento#buscarDetalheTransferencia',
  'inventario-proprio#buscarProdutosParaContagem',
  'movimentacoes-proprio#detalheMovimentoProprio',
  'nota-fiscal-proprio#buscarProdutosNF',
  'ordem-producao#saldoAtualProdutos',
  'produto#buscarFamilias',
  'produtos-search#buscarProdutoPorCodigo',
  'produtos-search#buscarProdutos',
]

const local = [
  'catalogo-proprio#criarGrupo',
  'catalogo-proprio#criarProdutoCatalogo',
  'catalogo-proprio#editarGrupo',
  'catalogo-proprio#excluirGrupo',
  'catalogo-proprio#salvarProdutoCatalogo',
  'compras-proprio#criarProdutoRapido',
  'compras-proprio#estornarCompra',
  'compras-proprio#lancarCompraManual',
  'compras-proprio#mapearPendentes',
  'estoque-proprio#ajusteManual',
  'estoque-proprio#definirMinimo',
  'estoque-proprio#entradaManual',
  'estoque-proprio#estornarMovimento',
  'estoque-proprio#transferirEntreLocais',
  'ficha-tecnica#desativarFichaTecnica',
  'ficha-tecnica#produzirLoteAction',
  'ficha-tecnica#salvarFichaTecnica',
  'inventario#addInventarioItem',
  'inventario#createInventario',
  'inventario#duplicarInventario',
  'inventario-proprio#abrirInventario',
  'inventario-proprio#cancelarInventario',
  'inventario-proprio#contarItem',
  'inventario-proprio#definirMotivoItem',
  'inventario-proprio#fecharInventario',
  'inventario-proprio#salvarLimiteMotivo',
  'loja-selector#setCurrentLoja',
  'meta-faturamento#salvarMetaFaturamento',
  'meta-mensal#salvarMetaMensal',
  'minha-loja#salvarEtiquetaConfig',
  'nota-fiscal#setQuantidadeNFItem',
  'nota-fiscal-proprio#configurarItemNF',
  'nota-fiscal-proprio#confirmarEntradaNF',
  'nota-fiscal-proprio#criarProdutoDoItemNF',
  'nota-fiscal-proprio#criarProdutoParaNF',
  'nota-fiscal-proprio#definirLoteItemNF',
  'nota-fiscal-proprio#desfazerEntradaNF',
  'nota-fiscal-proprio#desvincularCteNF',
  'nota-fiscal-proprio#importarCteNF',
  'nota-fiscal-proprio#informarFreteNF',
  'nota-fiscal-proprio#marcarConferidaNF',
  'nota-fiscal-proprio#salvarObservacaoNF',
  'nota-fiscal-proprio#vincularItemNF',
  'produto-minimo#setEstoqueMinimo',
  'transferencia#addMovimento',
  'transferencia#createTransferencia',
  'transferencia#duplicarTransferencia',
  'transferencia#salvarObservacaoTransferencia',
  'validade-proprio#baixarLoteVencido',
  'validade-proprio#reconciliarLotes',
  'validade-proprio#salvarAlertaValidade',
]

const depende = [
  // "nosso Omie" Fase 4: escrevem no Omie (loja Omie) -> só com internet, sem internet entram na fila como criarAjusteManual.
  // ajusteOmie (o "saldo contado" é comparado com o saldo do Omie NA HORA do envio: reenviado horas depois lançaria a
  // diferença errada), corrigirCustoAjuste, relancarCorrecaoCusto e trocarInsumoNoPrato ficam FORA da política de
  // propósito -> sem internet devolvem "precisa de internet".
  'estoque-omie#entradaOmie',
  'estoque-omie#transferirOmie',
  'ops-lote#acaoOPLote',
  'inventario#editQuantidadeInventarioItem',
  'inventario#enviarInventarioItem',
  'inventario#excluirInventario',
  'inventario#finishInventario',
  'inventario#informarMotivoInventarioItem',
  'inventario#removeInventarioItem',
  'movimentacoes#criarAjusteManual',
  'ordem-producao#criarOrdemProducao',
  'ordem-producao#criarOrdensProducao',
  'ordem-producao#excluirOP',
  'ordem-producao#finishOP',
  'ordem-producao#finishOPsEmLote',
  'ordem-producao#setDataOP',
  'ordem-producao#setQtdPlanejadaOP',
  'ordem-producao#setQuantidadeOP',
  'ordem-producao#setValidadeOP',
  'transferencia#editQuantidadeMovimento',
  'transferencia#enviarMovimento',
  'transferencia#excluirTransferencia',
  'transferencia#finishTransferencia',
  'transferencia#removeMovimento',
  'transferencia#salvarObservacaoItem',
]

export const POLITICA: Readonly<Record<string, ModoOffline>> = Object.freeze({
  ...Object.fromEntries(leitura.map((n) => [n, 'leitura' as const])),
  ...Object.fromEntries(local.map((n) => [n, 'local' as const])),
  ...Object.fromEntries(depende.map((n) => [n, 'depende' as const])),
})

export function politicaDe(nome: string): ModoOffline | null {
  return Object.prototype.hasOwnProperty.call(POLITICA, nome) ? POLITICA[nome] : null
}

/** Resolve 'depende' pelo modo da loja atual. */
export function modoEfetivo(modo: ModoOffline | null, lojaPropria: boolean): ModoOffline | null {
  if (modo === 'depende') return lojaPropria ? 'local' : 'fila'
  return modo
}
