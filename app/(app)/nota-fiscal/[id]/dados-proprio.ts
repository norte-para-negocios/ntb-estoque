import { createClient } from '@/lib/supabase/server'
import type { ItemConferencia } from '@/components/nota-fiscal/ConferenciaNF'
import { carregarCmc } from '@/lib/estoque/nf-memoria'
import { avaliarItemCompra, type ItemCompraGravado } from '@/lib/estoque/nf-item-regras'

const COLUNAS_FLAGS = ['custo_icms', 'custo_icms_st', 'custo_ipi', 'custo_seguro', 'custo_pis', 'custo_cofins', 'custo_frete', 'custo_outras'] as const
const num = (v: unknown) => Number(v ?? 0) || 0

// Dados da conferência de uma nota em loja de estoque próprio (leitura pela sessão: RLS por loja).

export type ConferenciaCarregada = {
  compra: { id: number; status: string; codigoLocal: number | null; numero: string | null; conferidaEm: string | null; obs: string | null; estornos: number } | null
  itens: ItemConferencia[]
  locais: { codigo: number; descricao: string }[]
  sefaz: { origem: string | null; recebidoEm: string | null; nsu: string | null; completo: boolean; alertas: string[] }
  documento: { cienciaEm: string | null; cienciaCstat: string | null; tipo: string | null } | null
  /** Fase B: manifestações do destinatário registradas/enviadas para esta chave (mais antiga primeiro). */
  manifestacoes: { tpEvento: string; status: string; cstat: string | null; xmotivo: string | null; protocolo: string | null; criadoEm: string; respondidoEm: string | null }[]
  /** Fase B: CT-e de frete ligados a esta nota e a parte que coube a ela. */
  ctes: { id: number; chave: string | null; numero: string | null; transportadora: string | null; valorCte: number; valorNesta: number; percentual: number; origem: string }[]
}

export async function carregarConferencia(lojaId: number, notaId: number, fullObject: unknown, chave: string | null): Promise<ConferenciaCarregada> {
  const sb = await createClient()
  const { data: c } = await sb.from('compras_proprio').select('id, status, codigo_local_estoque, numero, conferida_em, obs, estornos').eq('loja_id', lojaId).eq('nota_fiscal_id', notaId).maybeSingle()
  const itens: ItemConferencia[] = []
  const finalidade = ((fullObject ?? {}) as { sefaz?: { finalidade?: string } }).sefaz?.finalidade ?? null
  if (c) {
    const { data: raw } = await sb.from('compras_proprio_itens').select('*').eq('compra_id', c.id).order('linha')
    const linhas = (raw ?? []) as Record<string, unknown>[]
    const codigos = [...new Set(linhas.flatMap((i) => [i.codigo_produto, i.sugestao_codigo_produto]).filter((x): x is number => typeof x === 'number'))]
    const prods = new Map<number, { codigoProduto: number; codigo: string; descricao: string; unidade: string }>()
    if (codigos.length) {
      const { data } = await sb.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', codigos)
      for (const p of data ?? []) prods.set(Number(p.codigo_produto), { codigoProduto: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao, unidade: p.unidade ?? '' })
    }
    // Fase B: custo médio (aviso "custo fora") e saldo do produto em cada local (editor do item, D2)
    const comProduto = linhas.map((i) => i.codigo_produto).filter((x): x is number => typeof x === 'number')
    const [cmc, { data: saldosRaw }] = await Promise.all([
      carregarCmc(lojaId, comProduto),
      comProduto.length
        ? sb.from('estoque_saldos').select('codigo_produto, codigo_local_estoque, saldo').eq('loja_id', lojaId).in('codigo_produto', [...new Set(comProduto)])
        : Promise.resolve({ data: [] as { codigo_produto: number; codigo_local_estoque: number; saldo: number }[] }),
    ])
    const saldos = new Map<number, Record<number, number>>()
    for (const sd of saldosRaw ?? []) {
      const m = saldos.get(Number(sd.codigo_produto)) ?? {}
      m[Number(sd.codigo_local_estoque)] = Number(sd.saldo) || 0
      saldos.set(Number(sd.codigo_produto), m)
    }
    for (const i of linhas) {
      const cp = typeof i.codigo_produto === 'number' ? i.codigo_produto : null
      const sg = typeof i.sugestao_codigo_produto === 'number' ? i.sugestao_codigo_produto : null
      const flags = i.custo_icms == null ? null : COLUNAS_FLAGS.map((k) => (i[k] ? 'S' : 'N')).join('')
      const gravado: ItemCompraGravado = {
        quantidade: num(i.quantidade), valor_unitario: num(i.valor_unitario), valor_total_item: i.valor_total_item == null ? null : num(i.valor_total_item), desconto: num(i.desconto),
        ipi_valor: num(i.ipi_valor), st_valor: num(i.st_valor), fcp_st_valor: num(i.fcp_st_valor), icms_valor: num(i.icms_valor), frete_valor: num(i.frete_valor),
        seguro_valor: num(i.seguro_valor), outras_valor: num(i.outras_valor), frete_cte: num(i.frete_cte), flags, aliq_cred_pis: num(i.aliq_cred_pis), aliq_cred_cofins: num(i.aliq_cred_cofins),
        quantidade_recebida: i.quantidade_recebida == null ? null : num(i.quantidade_recebida), fator: num(i.fator) || 1, unidade_compra: (i.unidade_compra as string) ?? null,
        unidade_estoque: (i.unidade_estoque as string) ?? null, codigo_produto: cp, movimenta_estoque: i.movimenta_estoque !== false,
        csosn: (((i.fiscal ?? {}) as Record<string, unknown>).csosn as string) ?? null, cred_icms_sn: num(((i.fiscal ?? {}) as Record<string, unknown>).credIcmsSn),
      }
      const av = avaliarItemCompra(gravado, { cmc: cp != null ? cmc.get(cp) ?? null : null, finalidade })
      const localItem = i.codigo_local_estoque != null ? Number(i.codigo_local_estoque) : null
      const localEfetivo = localItem ?? (c.codigo_local_estoque != null ? Number(c.codigo_local_estoque) : null)
      const fiscal = (i.fiscal ?? {}) as Record<string, unknown>
      itens.push({
        id: Number(i.id), linha: Number(i.linha), descricao: (i.descricao as string) ?? `Item ${i.linha}`, cProd: (i.c_prod as string) ?? null, unidade: (i.unidade_compra as string) ?? null,
        quantidade: Number(i.quantidade), valorLiquido: Number(i.valor_total) - Number(i.desconto), lancado: !!i.lancado, fator: Number(i.fator) || 1,
        custoUnitarioBase: i.custo_unitario_base == null ? null : Number(i.custo_unitario_base),
        matchOrigem: (i.match_origem as ItemConferencia['matchOrigem']) ?? null, score: i.match_score == null ? null : Number(i.match_score),
        produto: cp != null ? prods.get(cp) ?? null : null, sugestao: cp == null && sg != null ? prods.get(sg) ?? null : null,
        lote: (i.lote as string) ?? null, validade: (i.validade as string) ?? null,
        config: {
          codigoLocal: localItem, cfopEntrada: (i.cfop_entrada as string) ?? null, origemCfop: (i.origem_cfop as string) ?? null, quantidadeRecebida: av.quantidadeRecebida,
          unidadeEstoque: (i.unidade_estoque as string) ?? null, flags, origemFlags: (i.origem_flags as string) ?? null, aliqCredPis: num(i.aliq_cred_pis),
          aliqCredCofins: num(i.aliq_cred_cofins), movimentaEstoque: i.movimenta_estoque !== false, geraContaPagar: i.gera_conta_pagar !== false,
        },
        fiscal: {
          cst: (fiscal.cst as string) ?? null, csosn: (fiscal.csosn as string) ?? null, credIcmsSn: num(fiscal.credIcmsSn), icms: num(i.icms_valor), st: num(i.st_valor) + num(i.fcp_st_valor), ipi: num(i.ipi_valor),
          pis: num(fiscal.pis), cofins: num(fiscal.cofins), frete: num(i.frete_valor), seguro: num(i.seguro_valor), outras: num(i.outras_valor), freteCte: num(i.frete_cte),
          valorTotalItem: i.valor_total_item == null ? null : num(i.valor_total_item), desconto: num(i.desconto), valorProdutos: num(i.valor_total), precoUnit: num(i.valor_unitario),
        },
        previa: av.previa, alertas: av.alertas,
        saldoAtual: cp != null && localEfetivo != null ? saldos.get(cp)?.[localEfetivo] ?? 0 : null,
        saldosPorLocal: cp != null ? saldos.get(cp) ?? {} : {},
      })
    }
  }
  const { data: locaisRaw } = await sb.from('local_estoques').select('codigo_local_estoque, descricao, padrao, inativo').eq('loja_id', lojaId).is('deleted_at', null).order('padrao', { ascending: false }).order('descricao')
  const locais = (locaisRaw ?? []).filter((l) => l.inativo !== 'S' && l.inativo !== true).map((l) => ({ codigo: Number(l.codigo_local_estoque), descricao: l.descricao as string }))
  const fo = (fullObject ?? {}) as { sefaz?: { origem?: string; recebidoEm?: string; nsu?: string; completo?: boolean; alertas?: string[] } }
  let documento: ConferenciaCarregada['documento'] = null
  let manifestacoes: ConferenciaCarregada['manifestacoes'] = []
  let ctes: ConferenciaCarregada['ctes'] = []
  if (c) {
    const { data: ligs } = await sb.from('compras_proprio_cte_compra').select('cte_id, valor, percentual').eq('loja_id', lojaId).eq('compra_id', c.id)
    const idsCte = (ligs ?? []).map((l) => Number(l.cte_id))
    if (idsCte.length) {
      const { data: cts } = await sb.from('compras_proprio_cte').select('id, chave, numero, transportadora_nome, valor, origem').eq('loja_id', lojaId).in('id', idsCte)
      const porId = new Map((cts ?? []).map((t) => [Number(t.id), t]))
      ctes = (ligs ?? []).map((l) => {
        const t = porId.get(Number(l.cte_id))
        return { id: Number(l.cte_id), chave: t?.chave ?? null, numero: t?.numero ?? null, transportadora: t?.transportadora_nome ?? null, valorCte: Number(t?.valor ?? 0), valorNesta: Number(l.valor), percentual: Number(l.percentual), origem: t?.origem ?? 'manual' }
      })
    }
  }
  if (chave) {
    const { data: ms } = await sb.from('sefaz_manifestacoes').select('tp_evento, status, cstat, xmotivo, protocolo, criado_em, respondido_em').eq('loja_id', lojaId).eq('chave', chave).order('id')
    manifestacoes = (ms ?? []).map((m) => ({ tpEvento: m.tp_evento, status: m.status, cstat: m.cstat, xmotivo: m.xmotivo, protocolo: m.protocolo, criadoEm: m.criado_em, respondidoEm: m.respondido_em }))
    const { data: d } = await sb.from('sefaz_documentos').select('ciencia_em, ciencia_cstat, tipo').eq('loja_id', lojaId).eq('chave', chave).order('id', { ascending: false }).limit(1).maybeSingle()
    if (d) documento = { cienciaEm: d.ciencia_em, cienciaCstat: d.ciencia_cstat, tipo: d.tipo }
  }
  return {
    compra: c ? { id: Number(c.id), status: c.status, codigoLocal: c.codigo_local_estoque != null ? Number(c.codigo_local_estoque) : null, numero: c.numero, conferidaEm: c.conferida_em ?? null, obs: c.obs ?? null, estornos: Number(c.estornos ?? 0) || 0 } : null,
    itens, locais,
    sefaz: { origem: fo.sefaz?.origem ?? null, recebidoEm: fo.sefaz?.recebidoEm ?? null, nsu: fo.sefaz?.nsu ?? null, completo: fo.sefaz?.completo !== false, alertas: fo.sefaz?.alertas ?? [] },
    documento, manifestacoes, ctes,
  }
}
