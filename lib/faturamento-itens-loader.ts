import { createServiceClient } from '@/lib/supabase/server'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { buscarFatCupons, buscarFatCupomItens } from '@/lib/faturamento-frio'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { TIPO_NOME } from '@/lib/omie/faturamento'
import type { LinhaItem } from '@/lib/faturamento-itens'
import type { Situacao } from '@/lib/faturamento-params'

export type FiltrosItens = { tipos: string[]; familias: string[]; situacao: Situacao }
export type Opcao = { value: string; label: string }
export type ItensCarregados = { linhas: LinhaItem[]; aviso: string | null; opcoes: { tipos: Opcao[]; familias: Opcao[] } }

type Meta = { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null; descricao: string | null; codigo: string | null }

// Situacao do cupom: Omie mantem devolvido nas "validas" (igual ao total mensal); loja propria exclui (igual a recalcular_faturamento_proprio).
export const bateSituacaoOmie = (c: { cancelado: boolean; devolvido: boolean }, s: Situacao) =>
  s === 'canceladas' ? c.cancelado : s === 'devolvidas' ? c.devolvido && !c.cancelado : !c.cancelado
export const bateSituacaoProprio = (v: { cancelado: boolean; devolvido: boolean }, s: Situacao) =>
  s === 'canceladas' ? v.cancelado : s === 'devolvidas' ? v.devolvido && !v.cancelado : !v.cancelado && !v.devolvido

const rotuloTipo = (cod: string) => (cod ? (TIPO_NOME[cod] ?? `Tipo ${cod}`) : 'Não classificado')
const SEM_FAMILIA = 'Sem família'

// Leitura de itens vendidos do periodo, ja com tipo/familia/nome do cadastro e filtros aplicados.
export async function carregarItens(lojaId: number, ini: string, fim: string, filtros: FiltrosItens): Promise<ItensCarregados> {
  const supabase = createServiceClient()
  let aviso: string | null = null
  const sinalizar = (msg: string) => { aviso = msg }

  const produtos = await buscarTodasLinhas<Meta>(
    (from, to) => supabase.from('produtos').select('codigo_produto, tipo_item, descricao_familia, descricao, codigo').eq('loja_id', lojaId).order('id').range(from, to),
    undefined,
    (e) => sinalizar(`Falha ao ler o cadastro de produtos (${e.message}). Tipo e família podem estar incompletos.`),
  )
  const meta = new Map<number, Meta>(produtos.map((p) => [Number(p.codigo_produto), p]))

  const tiposVistos = new Set<string>()
  const familiasVistas = new Set<string>()
  for (const p of produtos) {
    tiposVistos.add(p.tipo_item ?? '')
    familiasVistas.add(p.descricao_familia || SEM_FAMILIA)
  }
  const opcoes = {
    tipos: [...tiposVistos].sort().map((c) => ({ value: c || '_', label: rotuloTipo(c) })),
    familias: [...familiasVistas].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((f) => ({ value: f, label: f })),
  }

  const montar = (idProduto: number | null, nomeBruto: string | null, dia: string, cupom: number, quant: number, valor: number): LinhaItem | null => {
    const m = idProduto != null ? meta.get(idProduto) : undefined
    const tipoCod = m?.tipo_item ?? ''
    const familia = m?.descricao_familia || SEM_FAMILIA
    if (filtros.tipos.length && !filtros.tipos.includes(tipoCod || '_')) return null
    if (filtros.familias.length && !filtros.familias.includes(familia)) return null
    return {
      dia: String(dia).slice(0, 10), cupom, idProduto, produto: m?.descricao || m?.codigo || nomeBruto || 'Produto não identificado',
      tipoCod, tipo: rotuloTipo(tipoCod), familia, quant, valor,
    }
  }

  const linhas: LinhaItem[] = []
  const modo = await modoDaLoja(lojaId)

  if (modo === 'proprio') {
    const bate = (v: { cancelado: boolean; devolvido: boolean }) => bateSituacaoProprio(v, filtros.situacao)
    const vendas = (await buscarTodasLinhas<{ id: number; data: string; cancelado: boolean; devolvido: boolean }>(
      (from, to) => supabase.from('vendas_proprio').select('id, data, cancelado, devolvido').eq('loja_id', lojaId).gte('data', ini).lte('data', fim).order('id').range(from, to),
      undefined,
      (e) => sinalizar(`Falha ao ler as vendas (${e.message}). Os valores podem estar incompletos.`),
    )).filter(bate)
    const porVenda = new Map(vendas.map((v) => [v.id, v.data]))
    const ids = [...porVenda.keys()]
    for (let i = 0; i < ids.length; i += 150) {
      const lote = ids.slice(i, i + 150)
      const itens = await buscarTodasLinhas<{ venda_id: number; codigo_produto: number | null; nome: string | null; quantidade: number | string; valor: number | string }>(
        (from, to) => supabase.from('vendas_proprio_itens').select('venda_id, codigo_produto, nome, quantidade, valor').in('venda_id', lote).order('id').range(from, to),
        undefined,
        (e) => sinalizar(`Falha ao ler os itens (${e.message}). Os valores podem estar incompletos.`),
      )
      for (const it of itens) {
        const l = montar(it.codigo_produto != null ? Number(it.codigo_produto) : null, it.nome, porVenda.get(it.venda_id)!, it.venda_id, Number(it.quantidade) || 0, Number(it.valor) || 0)
        if (l) linhas.push(l)
      }
    }
  } else {
    let truncou = false
    const onTruncado = () => { truncou = true }
    const [cupons, itens] = await Promise.all([
      buscarFatCupons({ lojaId, dataInicio: ini, dataFinal: fim, onTruncado }),
      buscarFatCupomItens({ lojaId, dataInicio: ini, dataFinal: fim, onTruncado }),
    ])
    if (truncou) aviso = 'A consulta ao histórico foi cortada antes do fim. Os valores abaixo podem estar incompletos.'
    const bate = (c: { cancelado: boolean; devolvido: boolean }) => bateSituacaoOmie(c, filtros.situacao)
    const porCupom = new Map(cupons.filter(bate).map((c) => [c.n_id_cupom, c.data]))
    for (const it of itens) {
      const dia = porCupom.get(it.n_id_cupom)
      if (dia === undefined) continue
      const valor = it.v_item || it.v_unit * it.quant - it.v_desc || 0
      const l = montar(it.id_produto, it.x_prod, dia, it.n_id_cupom, it.quant, valor)
      if (l) linhas.push(l)
    }
  }

  return { linhas, aviso, opcoes }
}
