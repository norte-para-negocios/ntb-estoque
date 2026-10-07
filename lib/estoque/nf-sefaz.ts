import { createServiceClient } from '@/lib/supabase/server'
import { alertasDaNota, cabecalhoDaNota, itensDaNota, type OrigemNota } from './nf-sefaz-mapa'
import { casarItem, montarContexto, podeLancarAutomatico, type Casamento, type Depara, type ProdutoCad } from './nf-conferencia'
import { espelharNotaNoFrio } from './nf-frio'
import type { NfeLida } from './nfe-xml'

// Grava uma NF-e completa em loja de estoque próprio: nota no formato do Omie + conferência com o cadastro + (se tudo casou com
// segurança) entrada no estoque. Reutilizado pela sincronização da SEFAZ e pelo upload manual de XML.

export type ResultadoNota = {
  notaId: number; compraId: number | null; situacao: string | null; lancada: boolean
  itens: number; casados: number; sugestoes: number; pendentes: number; alertas: string[]; criada: boolean
  lancados: number; status: string
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

export async function localPadraoEntrada(lojaId: number): Promise<number | null> {
  const sb = createServiceClient()
  const { data } = await sb.from('local_estoques').select('codigo_local_estoque, padrao, descricao').eq('loja_id', lojaId).is('deleted_at', null).order('padrao', { ascending: false }).order('id').limit(1)
  return data?.[0]?.codigo_local_estoque != null ? Number(data[0].codigo_local_estoque) : null
}

export async function gravarNotaCompleta(lojaId: number, nfe: NfeLida, opts: {
  ambiente: '1' | '2'; origem: OrigemNota; nsu?: string | null; autoLancar: boolean; cnpjLoja?: string | null; userId?: string | null
  mapeamentos?: Map<number, { codigoProduto: number | null; fator: number }>; icmsRecuperavel?: boolean; localEntrada?: number | null
  /** Upload manual de XML: lança já os itens que a pessoa mapeou e deixa os demais pendentes. */
  lancarParcial?: boolean
}): Promise<ResultadoNota> {
  const sb = createServiceClient()
  const alertas = alertasDaNota(nfe, opts.cnpjLoja)
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

  const local = opts.localEntrada ?? (await localPadraoEntrada(lojaId))
  const { data: rc, error: erc } = await sb.rpc('registrar_compra_sefaz', {
    p_compra: {
      loja_id: lojaId, chave_acesso: nfe.chave, nota_fiscal_id: notaId, numero: nfe.numero, serie: nfe.serie, fornecedor_cnpj: nfe.fornecedor.cnpj,
      fornecedor_nome: nfe.fornecedor.nome, emissao: nfe.emissao, valor_frete: nfe.valores.frete, valor_desconto: nfe.valores.descontoNota,
      icms_recuperavel: !!opts.icmsRecuperavel,
      itens: nfe.itens.map((i, idx) => ({
        linha: i.linha, c_prod: i.cProd, ean: i.ean, descricao: i.descricao, ncm: i.ncm, cfop: i.cfop, unidade_compra: i.unidade, quantidade: i.quantidade,
        valor_unitario: i.valorUnitario, valor_total: i.valorTotal, desconto: i.desconto, icms_valor: i.icms, fator: casamentos[idx].fator,
        codigo_produto: casamentos[idx].codigoProduto, match_origem: casamentos[idx].origem, match_score: casamentos[idx].score, sugestao_codigo_produto: casamentos[idx].sugestao,
      })),
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
  const automatico = opts.autoLancar && !alertas.length && podeLancarAutomatico(casamentos)
  const parcial = !!opts.lancarParcial && casados > 0
  if ((automatico || parcial) && (statusCompra === 'pendente' || statusCompra === 'parcial') && local) {
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
    pendentes: casamentos.filter((c) => c.codigoProduto == null).length, alertas, criada, lancados, status: statusCompra,
  }
}
