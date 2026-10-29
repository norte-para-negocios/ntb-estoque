// Carrega as notas de entrada de uma loja de estoque próprio para o relatório da contabilidade (formato do Omie).
// Período pela data de registro (a nota chegou no sistema), como o relatório do Omie que o Ramon usa.
// Só leitura. Montagem das linhas em entradas-contabil-puro.ts.
import { createServiceClient } from '@/lib/supabase/server'
import { buscarTudoPaginado, buscarTodosPorIds } from '@/lib/utils-busca'
import { carregarCmc } from '@/lib/estoque/nf-memoria'
import { montarLinhas, type ItemEntrada, type LinhaEntrada, type NotaEntrada, type CompraEntrada } from './entradas-contabil-puro'

type Obj = Record<string, unknown>
const n = (v: unknown) => Number(v ?? 0) || 0
const s = (v: unknown) => (v == null || v === '' ? null : String(v))

/** Início do dia na Bahia (UTC-3) em ISO. */
const inicioBahia = (dia: string) => `${dia}T03:00:00.000Z`
function diaSeguinte(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export type ResultadoEntradas = { linhas: LinhaEntrada[]; notas: number; semXml: number; semItens: number }

export async function carregarEntradasContabil(lojaId: number, ini: string, fim: string, soConcluidas: boolean): Promise<ResultadoEntradas> {
  const sb = createServiceClient()

  const notas = await buscarTudoPaginado<Obj>((from, to) =>
    sb.from('notas_fiscais')
      .select('id, c_numero_nfe, c_serie_nfe, c_chave_nfe, d_emissao_nfe, c_razao_social, c_nome, c_cnpj_cpf, c_inscricao, origem, created_at, full_object')
      .eq('loja_id', lojaId).is('deleted_at', null)
      .gte('created_at', inicioBahia(ini)).lt('created_at', inicioBahia(diaSeguinte(fim)))
      .order('id').range(from, to))
  if (!notas.length) return { linhas: [], notas: 0, semXml: 0, semItens: 0 }
  const notaIds = notas.map((x) => Number(x.id))
  const chaves = notas.map((x) => s(x.c_chave_nfe)).filter((x): x is string => !!x)

  const [compras, docs, manifs, cancels, nfItens] = await Promise.all([
    buscarTodosPorIds<Obj>(notaIds, (lote, from, to) =>
      sb.from('compras_proprio').select('id, nota_fiscal_id, status, lancada_em, obs').eq('loja_id', lojaId).in('nota_fiscal_id', lote).order('id').range(from, to)),
    buscarTodosPorIds<Obj>(notaIds, (lote, from, to) =>
      sb.from('sefaz_documentos').select('id, nota_fiscal_id, xml, completo, ciencia_cstat').eq('loja_id', lojaId).in('nota_fiscal_id', lote).order('id').range(from, to)),
    buscarTodosPorIds<Obj>(chaves, (lote, from, to) =>
      sb.from('sefaz_manifestacoes').select('id, chave, tp_evento, cstat, criado_em').eq('loja_id', lojaId).in('chave', lote).order('id').range(from, to)),
    buscarTodosPorIds<Obj>(chaves, (lote, from, to) =>
      sb.from('sefaz_chaves_canceladas').select('chave, recebido_em').eq('loja_id', lojaId).in('chave', lote).order('chave').range(from, to)),
    buscarTodosPorIds<Obj>(notaIds, (lote, from, to) =>
      sb.from('nota_fiscal_items').select('id, nota_fiscal_id, n_sequencia, categoria_contabil_id').eq('loja_id', lojaId).in('nota_fiscal_id', lote).order('id').range(from, to)),
  ])

  const compraPorNota = new Map(compras.map((c) => [Number(c.nota_fiscal_id), c]))
  const compraIds = compras.map((c) => Number(c.id))
  const itensCompra = await buscarTodosPorIds<Obj>(compraIds, (lote, from, to) =>
    sb.from('compras_proprio_itens').select('*').in('compra_id', lote).order('id').range(from, to))

  // XML: o mais recente completo por nota (reentrega da SEFAZ é o mesmo documento)
  const xmlPorNota = new Map<number, string>()
  const cienciaPorNota = new Set<number>() // ciência automática (evento 210210) registrada no documento da SEFAZ
  for (const d of docs.sort((a, b) => n(a.id) - n(b.id))) {
    if (d.completo && d.xml) xmlPorNota.set(Number(d.nota_fiscal_id), String(d.xml))
    if (['135', '136', '573'].includes(String(d.ciencia_cstat ?? ''))) cienciaPorNota.add(Number(d.nota_fiscal_id))
  }
  // Manifestação: o último evento aceito pela SEFAZ (135/136) da chave
  const manifPorChave = new Map<string, string>()
  for (const m of manifs.sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em))))
    if (['135', '136'].includes(String(m.cstat ?? ''))) manifPorChave.set(String(m.chave), String(m.tp_evento))
  const cancelPorChave = new Map(cancels.map((c) => [String(c.chave), s(c.recebido_em)]))

  const catIds = [...new Set(nfItens.map((i) => Number(i.categoria_contabil_id)).filter(Boolean))]
  const prodIds = [...new Set(itensCompra.map((i) => Number(i.codigo_produto)).filter(Boolean))]
  const locIds = [...new Set(itensCompra.map((i) => Number(i.codigo_local_estoque)).filter(Boolean))]
  const [cats, prods, locs, saldos, cmc] = await Promise.all([
    buscarTodosPorIds<Obj>(catIds, (lote, from, to) => sb.from('categorias_contabeis').select('id, nome').in('id', lote).order('id').range(from, to)),
    buscarTodosPorIds<Obj>(prodIds, (lote, from, to) =>
      sb.from('produtos').select('id, codigo_produto, codigo, descricao, descricao_familia, tipo_item').eq('loja_id', lojaId).in('codigo_produto', lote).order('id').range(from, to)),
    buscarTodosPorIds<Obj>(locIds, (lote, from, to) =>
      sb.from('local_estoques').select('id, codigo_local_estoque, codigo, descricao').eq('loja_id', lojaId).in('codigo_local_estoque', lote).order('id').range(from, to)),
    buscarTodosPorIds<Obj>(prodIds, (lote, from, to) =>
      sb.from('estoque_saldos').select('codigo_produto, codigo_local_estoque, saldo').eq('loja_id', lojaId).in('codigo_produto', lote).order('codigo_produto').order('codigo_local_estoque').range(from, to)),
    carregarCmc(lojaId, prodIds),
  ])
  const catNome = new Map(cats.map((c) => [Number(c.id), String(c.nome)]))
  const catPorNotaSeq = new Map(nfItens.map((i) => [`${i.nota_fiscal_id}:${i.n_sequencia}`, i.categoria_contabil_id ? catNome.get(Number(i.categoria_contabil_id)) ?? null : null]))
  const prodPor = new Map(prods.map((p) => [Number(p.codigo_produto), p]))
  const locPor = new Map(locs.map((l) => [Number(l.codigo_local_estoque), l]))
  const saldoPor = new Map<number, number>()
  for (const x of saldos) saldoPor.set(Number(x.codigo_produto), (saldoPor.get(Number(x.codigo_produto)) ?? 0) + n(x.saldo))
  const itensPorCompra = new Map<number, Obj[]>()
  for (const i of itensCompra) {
    const k = Number(i.compra_id)
    itensPorCompra.set(k, [...(itensPorCompra.get(k) ?? []), i])
  }

  const linhas: LinhaEntrada[] = []
  let semXml = 0
  let semItens = 0
  for (const nt of notas.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || n(a.id) - n(b.id))) {
    const id = Number(nt.id)
    const c = compraPorNota.get(id)
    if (soConcluidas && c?.status !== 'lancada') continue
    const itens = c ? itensPorCompra.get(Number(c.id)) ?? [] : []
    if (!itens.length) { semItens++; continue } // só o resumo da SEFAZ: sem itens não há linha (igual ao Omie)
    const chave = s(nt.c_chave_nfe)
    const fo = (nt.full_object ?? {}) as Obj
    const situacaoSefaz = ((fo.sefaz ?? {}) as Obj).situacao
    const cnpj = String(nt.c_cnpj_cpf ?? '').replace(/\D/g, '')
    const xml = xmlPorNota.get(id) ?? null
    if (!xml) semXml++
    const nota: NotaEntrada = {
      numero: s(nt.c_numero_nfe), serie: s(nt.c_serie_nfe), chave, emissao: s(nt.d_emissao_nfe),
      fornecedorRazao: s(nt.c_razao_social), fornecedorFantasia: s(nt.c_nome), fornecedorCnpj: cnpj || null,
      fornecedorIe: s(nt.c_inscricao), fornecedorCidade: null, fornecedorUf: chave ? ufDaChave(chave) : null, // cidade e UF saem do XML (enderEmit)
      cancelada: situacaoSefaz === 'cancelada' || (!!chave && cancelPorChave.has(chave)),
      canceladaEm: chave ? cancelPorChave.get(chave) ?? null : null,
      registradaEm: s(nt.created_at), origem: s(nt.origem), manifestacao: (chave ? manifPorChave.get(chave) : null) ?? (cienciaPorNota.has(id) ? '210210' : null), xml,
    }
    const compra: CompraEntrada = c ? { status: String(c.status), lancadaEm: s(c.lancada_em), obs: s(c.obs) } : null
    const its: ItemEntrada[] = itens.map((i) => {
      const cp = i.codigo_produto == null ? null : Number(i.codigo_produto)
      const p = cp ? prodPor.get(cp) : undefined
      const loc = i.codigo_local_estoque == null ? undefined : locPor.get(Number(i.codigo_local_estoque))
      return {
        linha: n(i.linha), cProd: s(i.c_prod), descricao: s(i.descricao), ean: s(i.ean), ncm: s(i.ncm), cfop: s(i.cfop),
        unidadeCompra: s(i.unidade_compra), quantidade: n(i.quantidade), valorUnitario: n(i.valor_unitario), valorTotal: n(i.valor_total),
        desconto: n(i.desconto), fator: n(i.fator) || 1, quantidadeRecebida: i.quantidade_recebida == null ? null : n(i.quantidade_recebida),
        unidadeEstoque: s(i.unidade_estoque), custoUnitarioBase: i.custo_unitario_base == null ? null : n(i.custo_unitario_base),
        cfopEntrada: s(i.cfop_entrada), lancado: !!i.lancado, matchOrigem: s(i.match_origem),
        movimentaEstoque: i.movimenta_estoque !== false, geraContaPagar: i.gera_conta_pagar !== false,
        lote: s(i.lote), validade: s(i.validade),
        flags: i.custo_icms == null ? null : {
          icms: !!i.custo_icms, icmsSt: !!i.custo_icms_st, ipi: !!i.custo_ipi, pis: !!i.custo_pis, cofins: !!i.custo_cofins,
          frete: !!i.custo_frete, seguro: !!i.custo_seguro, outras: !!i.custo_outras,
        },
        aliqCredPis: n(i.aliq_cred_pis), aliqCredCofins: n(i.aliq_cred_cofins),
        produto: p ? { codigo: String(p.codigo ?? cp), descricao: String(p.descricao ?? ''), familia: s(p.descricao_familia), tipoItem: s(p.tipo_item) } : null,
        local: loc ? { codigo: String(loc.codigo || loc.descricao || loc.codigo_local_estoque), descricao: String(loc.descricao ?? '') } : null,
        categoria: catPorNotaSeq.get(`${id}:${n(i.linha)}`) ?? null,
        cmcAtual: cp ? cmc.get(cp) ?? null : null, estoqueDisponivel: cp ? saldoPor.get(cp) ?? 0 : null,
      }
    })
    linhas.push(...montarLinhas(nota, compra, its))
  }
  return { linhas, notas: notas.length, semXml, semItens }
}

const UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN',
  '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC',
  '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
}
const ufDaChave = (chave: string) => UF[chave.slice(0, 2)] ?? null
