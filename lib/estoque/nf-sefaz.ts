import { createServiceClient } from '@/lib/supabase/server'
import { alertasDaNota, cabecalhoDaNota, itemCompraSefaz, itensComDespesasDoTotal, itensDaNota, type OrigemNota } from './nf-sefaz-mapa'
import { alertasDoItem, configInicialItem, podeLancarSozinho, previaCustoItem, type AlertaItem, type ConfigInicialItem } from './nf-item-regras'
import { carregarCmc, carregarMemoria } from './nf-memoria'
import { casarItem, montarContexto, podeLancarAutomatico, type Casamento, type Depara, type ProdutoCad } from './nf-conferencia'
import { espelharNotaNoFrio } from './nf-frio'
import { decidirLancamentoNaGravacao } from './nf-entrada'
import { categoriaAutomatica } from '@/lib/nota-fiscal/tela-nota'
import type { ItemNfe, NfeLida } from './nfe-xml'

// Grava uma NF-e completa em loja de estoque próprio: nota no formato do Omie + conferência com o cadastro + (se tudo casou com
// segurança) entrada no estoque. Reutilizado pela sincronização da SEFAZ e pelo upload manual de XML.

export type ResultadoNota = {
  notaId: number; compraId: number | null; situacao: string | null; lancada: boolean
  itens: number; casados: number; sugestoes: number; pendentes: number; alertas: string[]; criada: boolean
  lancados: number; status: string
  /** Avisos de cada item (fator, custo, recebido, valor zero, complementar): seguram a entrada automática (R9). */
  alertasItens: { linha: number; alertas: AlertaItem[] }[]
  /** Por que a entrada não foi feita na gravação: aviso de item que precisa de conferência, ou compra reaberta. */
  retida: 'avisos' | 'reaberta' | null
}

async function carregarProdutos(lojaId: number): Promise<ProdutoCad[]> {
  const sb = createServiceClient()
  const todos: ProdutoCad[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('produtos').select('codigo_produto, codigo, descricao, unidade, ean, inativo').eq('loja_id', lojaId).order('id').range(from, from + 999)
    if (error) throw new Error('Falha ao ler o cadastro de produtos: ' + error.message)
    todos.push(...((data ?? []) as ProdutoCad[]))
    if (!data || data.length < 1000) break
  }
  return todos
}

/** Tipo do produto (00 revenda, 01 matéria-prima, 07 uso e consumo...): decide o CFOP de entrada (cfopEntradaPorTipo). */
async function tiposDosProdutos(lojaId: number, codigos: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>()
  const ids = [...new Set(codigos)]
  if (!ids.length) return out
  const { data, error } = await createServiceClient().from('produtos').select('codigo_produto, tipo_item').eq('loja_id', lojaId).in('codigo_produto', ids.slice(0, 300))
  if (error) console.error(`nf-sefaz loja ${lojaId}: tipo dos produtos`, error.message)
  for (const p of data ?? []) out.set(Number(p.codigo_produto), p.tipo_item ?? null)
  return out
}

export async function localPadraoEntrada(lojaId: number): Promise<number | null> {
  const sb = createServiceClient()
  const { data } = await sb.from('local_estoques').select('codigo_local_estoque, padrao, descricao').eq('loja_id', lojaId).is('deleted_at', null).order('padrao', { ascending: false }).order('id').limit(1)
  return data?.[0]?.codigo_local_estoque != null ? Number(data[0].codigo_local_estoque) : null
}

/** Fase B: configuração inicial de cada item (marcações, CFOP de entrada, local, movimenta) pela memória + regra
 *  (R1/R5/R6/R7), com despesas e desconto que vieram só no total rateados nos itens, e os avisos do item pela prévia de
 *  custo (R15, mesma função do lançamento). Usado na gravação da nota e na prévia do upload. */
export async function sugestoesDosItens(lojaId: number, nfe: NfeLida, casamentos: { codigoProduto: number | null; fator: number }[],
  unidadeDe: (codigoProduto: number) => string | null, local: number | null,
  opts: { icmsRecuperavel?: boolean; locaisManuais?: Map<number, number | null> } = {},
): Promise<{ itensFiscais: ItemNfe[]; configs: ConfigInicialItem[]; alertasItens: { linha: number; alertas: AlertaItem[] }[]; aviso: string | null }> {
  const { itens: itensFiscais, aviso } = itensComDespesasDoTotal(nfe)
  const codigos = casamentos.map((c) => c.codigoProduto).filter((c): c is number => c != null)
  const [memoria, cmc, tipos] = await Promise.all([
    carregarMemoria(lojaId, nfe.fornecedor.cnpj || null, codigos, nfe.itens.map((i) => i.cProd)),
    carregarCmc(lojaId, codigos),
    tiposDosProdutos(lojaId, codigos),
  ])
  const configs: ConfigInicialItem[] = itensFiscais.map((i, idx) => {
    const cod = casamentos[idx].codigoProduto
    const cfg = configInicialItem({
      item: { cfop: i.cfop, valorTotalItem: i.valorTotalItem, fiscal: { cst: i.fiscal.cst, csosn: i.fiscal.csosn } }, crt: nfe.crt, finalidade: nfe.finalidade,
      memoriaProduto: cod != null ? memoria.porProduto.get(cod) ?? null : null, memoriaFornecedor: memoria.porCodigoFornecedor.get(i.cProd) ?? null,
      unidadeProduto: cod != null ? unidadeDe(cod) : null, localNota: local, tipoProduto: cod != null ? tipos.get(cod) ?? null : null,
    })
    const manualLocal = opts.locaisManuais?.get(i.linha)
    if (manualLocal) cfg.codigoLocal = manualLocal
    // "Tirar o ICMS do custo em todos os itens" (upload): preenche a marcação de cada item
    if (opts.icmsRecuperavel && cfg.flags.icms) { cfg.flags = { ...cfg.flags, icms: false }; cfg.origemFlags = 'manual' }
    return cfg
  })
  const alertasItens = itensFiscais.map((i, idx) => {
    const c = casamentos[idx], cfg = configs[idx]
    const qtdRecebida = i.quantidade * c.fator
    const previa = previaCustoItem({
      quantidadeNota: i.quantidade, precoUnit: i.valorUnitario, valorTotalItem: i.valorTotalItem, desconto: i.desconto, ipi: i.fiscal.ipi,
      st: i.fiscal.st + i.fiscal.fcpSt, icms: i.icms, frete: i.fiscal.frete, seguro: i.fiscal.seguro, freteCte: 0, flags: cfg.flags,
      aliqCredPis: cfg.aliqCredPis, aliqCredCofins: cfg.aliqCredCofins, quantidadeRecebida: qtdRecebida, csosn: i.fiscal.csosn, credIcmsSn: i.fiscal.credIcmsSn,
    })
    return {
      linha: i.linha,
      alertas: alertasDoItem({
        unidadeNota: i.unidade, unidadeEstoque: c.codigoProduto != null ? cfg.unidadeEstoque : null, fator: c.fator, quantidadeNota: i.quantidade,
        quantidadeRecebida: qtdRecebida, custoUnitario: c.codigoProduto != null ? previa.custoUnitario : null,
        cmcAtual: c.codigoProduto != null ? cmc.get(c.codigoProduto) ?? null : null, valorTotalItem: i.valorTotalItem, finalidade: nfe.finalidade,
      }),
    }
  }).filter((a) => a.alertas.length)
  return { itensFiscais, configs, alertasItens, aviso }
}

export async function gravarNotaCompleta(lojaId: number, nfe: NfeLida, opts: {
  ambiente: '1' | '2'; origem: OrigemNota; nsu?: string | null; autoLancar: boolean; cnpjLoja?: string | null; userId?: string | null
  mapeamentos?: Map<number, { codigoProduto: number | null; fator: number; codigoLocal?: number | null }>; icmsRecuperavel?: boolean; localEntrada?: number | null
  /** Upload manual de XML: lança já os itens que a pessoa mapeou e deixa os demais pendentes. */
  lancarParcial?: boolean
  /** Avisos da validação do XML (assinatura que não confere, destinatário): entram nos alertas da nota. */
  avisosExtras?: string[]
}): Promise<ResultadoNota> {
  const sb = createServiceClient()
  const alertas = [...new Set([...alertasDaNota(nfe, opts.cnpjLoja), ...(opts.avisosExtras ?? [])])]
  const [produtos, deparaRes] = await Promise.all([
    carregarProdutos(lojaId),
    nfe.fornecedor.cnpj ? sb.from('fornecedor_produto_depara').select('c_prod, codigo_produto, fator').eq('loja_id', lojaId).eq('fornecedor_cnpj', nfe.fornecedor.cnpj) : Promise.resolve({ data: [] as Depara[] }),
  ])
  const ctx = montarContexto(produtos, (deparaRes.data ?? []) as Depara[])
  const casamentos: Casamento[] = nfe.itens.map((i) => {
    const manual = opts.mapeamentos?.get(i.linha)
    if (manual?.codigoProduto) return { codigoProduto: manual.codigoProduto, fator: manual.fator > 0 ? manual.fator : 1, origem: 'depara', score: 1, sugestao: null, automatico: true }
    return casarItem({ cProd: i.cProd, ean: i.ean, descricao: i.descricao, unidade: i.unidade }, ctx)
  })

  const cab = cabecalhoDaNota(nfe, { ambiente: opts.ambiente, origem: opts.origem, alertas, nsu: opts.nsu })
  const itensNota = itensDaNota(nfe).map((it, idx) => ({ ...it, n_id_produto: casamentos[idx].codigoProduto ? String(casamentos[idx].codigoProduto) : null }))
  const { data: g, error: eg } = await sb.rpc('gravar_nota_sefaz', { p_loja: lojaId, p_cab: cab, p_itens: itensNota })
  if (eg) throw new Error('Falha ao gravar a nota: ' + eg.message)
  const notaId = Number((g as { nota_id: number }).nota_id)
  const criada = !!(g as { criada: boolean }).criada

  // Nota nova de fornecedor que sempre vem na mesma categoria: já chega classificada (a pessoa pode trocar na tela).
  if (criada && nfe.fornecedor.cnpj) await classificarPeloFornecedor(lojaId, notaId, nfe.fornecedor.cnpj).catch((e) => console.error(`nf-sefaz loja ${lojaId}: categoria automática da nota ${notaId}:`, e))

  const local = opts.localEntrada ?? (await localPadraoEntrada(lojaId))

  const { itensFiscais, configs, alertasItens, aviso: avisoRateio } = await sugestoesDosItens(lojaId, nfe, casamentos, (cod) => ctx.produtosPorCodigo.get(cod)?.unidade ?? null, local, {
    icmsRecuperavel: opts.icmsRecuperavel, locaisManuais: new Map([...(opts.mapeamentos ?? new Map()).entries()].map(([l, m]) => [l, m.codigoLocal ?? null])),
  })
  if (avisoRateio) console.info(`nf-sefaz loja ${lojaId}: nota ${nfe.chave}: ${avisoRateio}`)

  const { data: rc, error: erc } = await sb.rpc('registrar_compra_sefaz', {
    p_compra: {
      loja_id: lojaId, chave_acesso: nfe.chave, nota_fiscal_id: notaId, numero: nfe.numero, serie: nfe.serie, fornecedor_cnpj: nfe.fornecedor.cnpj,
      fornecedor_nome: nfe.fornecedor.nome, emissao: nfe.emissao, valor_frete: nfe.valores.frete,
      // o desconto que veio só no total já está rateado no desconto de cada item (itensComDespesasDoTotal)
      valor_desconto: 0,
      icms_recuperavel: !!opts.icmsRecuperavel, user_id: opts.userId ?? null,
      itens: itensFiscais.map((i, idx) => itemCompraSefaz(i, casamentos[idx], configs[idx])),
    },
    p_local: local,
  })
  if (erc) throw new Error('Falha ao registrar a conferência da compra: ' + erc.message)
  const compraId = Number((rc as { compra_id: number }).compra_id)
  let statusCompra = String((rc as { status: string }).status)

  // Lote e validade do XML (grupo rastro) vão para o item ANTES da entrada: o gatilho de lotes (migration 145) os lê
  // na hora do movimento. Só preenche o que estiver vazio e ainda não lançado (não sobrescreve o que o gerente digitou).
  for (const i of nfe.itens) {
    if (!i.lote && !i.validade) continue
    await sb.from('compras_proprio_itens').update({ lote: i.lote ?? null, validade: i.validade ?? null })
      .eq('compra_id', compraId).eq('linha', i.linha).eq('lancado', false).is('lote', null).is('validade', null)
  }

  // Entrada automática só quando tudo casou com segurança, a nota não tem alerta e há um local de destino.
  const casados = casamentos.filter((c) => c.codigoProduto != null).length
  let lancados = 0
  // R9: além das regras de sempre, nenhuma marcação no padrão e nenhum aviso de item (fator, custo, valor zero)
  const automatico = podeLancarSozinho({
    casamentosSeguros: podeLancarAutomatico(casamentos), alertasNota: alertas.length, autoLancar: opts.autoLancar,
    origensFlags: configs.filter((c) => c.movimentaEstoque).map((c) => c.origemFlags), alertasItens: alertasItens.flatMap((a) => a.alertas),
  })
  // upload do XML (lancarParcial) também não lança item com aviso de custo/fator/valor zero sem "Conferi os avisos", e
  // compra com a entrada desfeita (reaberta) só volta pelo "Confirmar entrada"
  const decisao = decidirLancamentoNaGravacao({
    automatico, lancarParcial: !!opts.lancarParcial, casados, alertasItens, statusCompra, temLocal: !!local,
    reaberta: !!(rc as { reaberta?: boolean }).reaberta,
  })
  if (decisao.lancar && local) {
    const { data: rl, error: erl } = await sb.rpc('lancar_compra', { p_compra: { loja_id: lojaId, id: compraId, itens: [] }, p_local: local, p_user: opts.userId ?? null })
    if (erl) throw new Error('Falha ao lançar a entrada no estoque: ' + erl.message)
    statusCompra = String((rl as { status: string }).status)
    lancados = Number((rl as { lancados: number }).lancados) || 0
  }

  const { data: situacao } = await sb.rpc('sincronizar_situacao_nota', { p_loja: lojaId, p_nota: notaId })
  void espelharNotaNoFrio(lojaId, notaId)
  return {
    notaId, compraId, situacao: (situacao as string | null) ?? null, lancada: statusCompra === 'lancada', itens: nfe.itens.length, casados,
    sugestoes: casamentos.filter((c) => c.codigoProduto == null && c.sugestao != null).length,
    pendentes: casamentos.filter((c) => c.codigoProduto == null).length, alertas, criada, lancados, status: statusCompra, alertasItens,
    retida: decisao.retida,
  }
}

async function classificarPeloFornecedor(lojaId: number, notaId: number, cnpj: string) {
  const sb = createServiceClient()
  const { data: notas } = await sb.from('notas_fiscais').select('id').eq('loja_id', lojaId).eq('c_cnpj_cpf', cnpj).neq('id', notaId).is('deleted_at', null).order('id', { ascending: false }).limit(5)
  const ids = (notas ?? []).map((n) => Number(n.id))
  if (ids.length < 2) return
  const { data: itens } = await sb.from('nota_fiscal_items').select('categoria_contabil_id').eq('loja_id', lojaId).in('nota_fiscal_id', ids).not('categoria_contabil_id', 'is', null).limit(1000)
  const conta = new Map<number, number>()
  for (const i of itens ?? []) conta.set(Number(i.categoria_contabil_id), (conta.get(Number(i.categoria_contabil_id)) ?? 0) + 1)
  const categoria = categoriaAutomatica(conta, ids.length)
  if (categoria == null) return
  await sb.from('nota_fiscal_items').update({ categoria_contabil_id: categoria, updated_at: new Date().toISOString() })
    .eq('loja_id', lojaId).eq('nota_fiscal_id', notaId).is('categoria_contabil_id', null)
}
