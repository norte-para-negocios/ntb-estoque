// Central de correções: dados do painel lateral (produto, OP, nota, cupom, ajuste/contagem), carregados sob demanda.
// Só leitura. Reaproveita os loaders das telas (Movimentações, OP, nota, cupom do Contabo).
import { createClient } from '@/lib/supabase/server'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { addDias } from '@/lib/estoque/espelho-lojas'
import { montarVisaoOmie, type PosicaoRow, type ProdutoRow } from '@/lib/estoque/espelho-omie'
import { itensDaOPGravada } from '@/lib/estoque/ops-tela-puro'
import { custoForaDoNormal } from '@/lib/estoque/ajustes-tela-puro'
import { diaDoMovimento } from '@/lib/estoque/quem-mexeu-puro'
import { buscarFatCupomDetalhe } from '@/lib/faturamento-frio'
import { carregarMovimentacoes, movimentosDaNota, movimentosDaOP, type LinhaMov } from '@/lib/movimentacoes/dados'
import { hrefDocumento, type ItemFichaOP, type OPMin } from '@/lib/movimentacoes/movimentacoes-puro'
import { carregarEstoque } from '@/app/(app)/estoque/dados'
import { fmtBRL, fmtBRLCurto, fmtData, fmtDataLonga, fmtQtd, fmtQtdSinal, unidadeCurta } from './central-puro'

export type AlvoPainel = { tipo: 'produto' | 'op' | 'nota' | 'cupom' | 'ajuste'; id: number }
export type MovPainel = { data: string; titulo: string; sub: string; qtd: string; entrada: boolean; saldo: string | null; link: (AlvoPainel & { rotulo: string }) | null; href: string | null }
export type ItemLigado = AlvoPainel & { titulo: string; sub: string; valor: string; erro?: boolean }
export type GrupoLigado = { titulo: string; itens: ItemLigado[] }
export type LinhaFicha = { produto: number; nome: string; qtd: string; custo: string; semCusto: boolean }
export type AjusteCusto = { movimentoId: number; data: string; tipo: 'ENT' | 'SAI'; quantidade: number; custo: number; motivo: string | null; foraDoNormal: boolean }
export type PainelDados = {
  alvo: AlvoPainel; tipoRotulo: string; titulo: string; subtitulo: string | null
  kpis: { rot: string; valor: string; erro?: boolean }[]
  ficha: { titulo: string; linhas: LinhaFicha[]; total: string | null } | null
  blocos: { titulo: string; texto: string }[]
  movimentos: MovPainel[]; movimentosAviso: string | null
  ligado: GrupoLigado[]; hrefPagina: string | null; avisos: string[]
  ajustesCusto: AjusteCusto[]
  /** Saldo por local (produto): para "zerar"/"contagem" no local certo. */
  locais: { local: number; nome: string; saldo: number }[]
}

const vazio = (alvo: AlvoPainel, titulo: string, tipoRotulo: string): PainelDados => ({
  alvo, tipoRotulo, titulo, subtitulo: null, kpis: [], ficha: null, blocos: [], movimentos: [], movimentosAviso: null, ligado: [], hrefPagina: null, avisos: [], ajustesCusto: [], locais: [],
})
const TIPO_ROT: Record<string, string> = { '04': 'Prato (PA)', '03': 'Preparo (PI)', '01': 'Insumo (MP)', '00': 'Revenda', '07': 'Material de consumo', '99': 'Serviço ou taxa' }

type InfoProd = { nome: string; cod: string; un: string; tipo: string | null; saldo: number; cmc: number; locais: { local: number; nome: string; saldo: number }[]; familia: string }

/** Nome, saldo e custo de vários produtos (foto mais recente do espelho, ou ledger próprio). */
async function infoProdutos(lojaId: number, modo: 'omie' | 'proprio', ids: number[]): Promise<Map<number, InfoProd>> {
  const supabase = await createClient()
  const uniq = [...new Set(ids.filter((x) => Number.isFinite(x) && x > 0))].slice(0, 300)
  const r = new Map<number, InfoProd>()
  if (!uniq.length) return r
  if (modo === 'proprio') {
    const visao = await carregarEstoque(lojaId)
    for (const l of visao.linhas) if (uniq.includes(l.codigoProduto)) r.set(l.codigoProduto, { nome: l.descricao, cod: l.codigo, un: l.unidade, tipo: l.tipoItem, saldo: l.saldo, cmc: l.cmc, familia: l.familia, locais: l.locais.map((x) => ({ local: x.codigoLocal, nome: x.local, saldo: x.saldo })) })
    return r
  }
  const lotes: number[][] = []
  for (let i = 0; i < uniq.length; i += 100) lotes.push(uniq.slice(i, i + 100))
  const [prods, pos, locais, fams] = await Promise.all([
    Promise.all(lotes.map(async (l) => (await supabase.from('produtos').select('codigo_produto, codigo, descricao, unidade, tipo_item, codigo_familia, estoque_minimo').eq('loja_id', lojaId).in('codigo_produto', l).limit(1000)).data ?? [])).then((x) => x.flat() as ProdutoRow[]),
    Promise.all(lotes.map(async (l) => (await supabase.from('posicao_estoques').select('data_posicao, codigo_local_estoque, n_cod_prod, n_saldo, n_cmc, estoque_minimo, updated_at').eq('loja_id', lojaId).in('n_cod_prod', l).order('id').limit(5000)).data ?? [])).then((x) => x.flat() as PosicaoRow[]),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao, inativo').eq('loja_id', lojaId),
    supabase.from('familias').select('codigo_familia, nome').eq('loja_id', lojaId),
  ])
  const v = montarVisaoOmie({ produtos: prods, posicoes: pos, locais: locais.data ?? [], familias: fams.data ?? [] })
  for (const l of v.linhas) r.set(l.codigoProduto, { nome: l.descricao, cod: l.codigo, un: l.unidade, tipo: l.tipoItem, saldo: l.saldo, cmc: l.custoSuspeito ? l.cmc : l.cmc, familia: l.familia, locais: l.locais.map((x) => ({ local: x.codigoLocal, nome: x.local, saldo: x.saldo })) })
  return r
}

function movDeLinha(l: LinhaMov): MovPainel {
  const d = l.doc
  const link: MovPainel['link'] = d?.id != null && (d.tipo === 'op' || d.tipo === 'nf' || d.tipo === 'cupom')
    ? { tipo: d.tipo === 'nf' ? 'nota' : d.tipo, id: d.id, rotulo: d.rotulo } : null
  return {
    data: l.data, titulo: l.contagem ? 'Contagem' : l.origemRotulo, sub: [l.provavel ? 'provável' : '', l.local + (l.localDestino ? ` → ${l.localDestino}` : ''), l.autor ?? ''].filter(Boolean).join(' · '),
    qtd: l.contagem ? `contou ${fmtQtd(Math.abs(l.quantidade), l.unidade)}` : fmtQtdSinal(l.quantidade, l.unidade), entrada: !l.contagem && l.quantidade > 0,
    saldo: l.saldoApos != null ? fmtQtd(l.saldoApos, l.unidade) : null, link, href: d && !link ? hrefDocumento(d) : null,
  }
}

export async function carregarPainelDados(lojaId: number, modo: 'omie' | 'proprio', alvo: AlvoPainel): Promise<PainelDados> {
  switch (alvo.tipo) {
    case 'produto': return painelProduto(lojaId, modo, alvo)
    case 'op': return painelOP(lojaId, modo, alvo)
    case 'nota': return painelNota(lojaId, modo, alvo)
    case 'cupom': return painelCupom(lojaId, modo, alvo)
    case 'ajuste': return painelAjuste(lojaId, modo, alvo)
  }
}

async function painelProduto(lojaId: number, modo: 'omie' | 'proprio', alvo: AlvoPainel): Promise<PainelDados> {
  const supabase = await createClient()
  const hoje = hojeBahiaISO()
  const id = alvo.id
  const [fichaRes, usadoRes, opsRes, notasRes, sldRes, entRes, movs] = await Promise.all([
    supabase.from('estrutura_produto_cache').select('codigo_produto_insumo, quantidade, percentual_perda, unidade').eq('loja_id', lojaId).eq('codigo_produto', id).order('id').limit(200),
    supabase.from('estrutura_produto_cache').select('codigo_produto, quantidade').eq('loja_id', lojaId).eq('codigo_produto_insumo', id).order('id').limit(200),
    supabase.from('ordens_producao').select('id, identificacao_c_num_op, num_ordem, identificacao_n_qtde, identificacao_d_dt_previsao, dt_inclusao, dt_conclusao_real, concluida, aberta_omie').eq('loja_id', lojaId).eq('identificacao_n_cod_produto', id).order('id', { ascending: false }).limit(12),
    supabase.from('nota_fiscal_items').select('nota_fiscal_id, n_qtde_nfe, c_unidade_nfe, n_preco_unit').eq('loja_id', lojaId).eq('n_id_produto', id).order('id', { ascending: false }).limit(10),
    supabase.from('movimentos').select('id, data, quan, autor, codigo_local_estoque').eq('loja_id', lojaId).eq('id_prod', id).eq('tipo', 'SLD').order('data', { ascending: false }).limit(10),
    supabase.from('movimentos').select('id, data, tipo, quan, valor, motivo, origem, origem_ajuste, id_ajuste, transferencia_id, cod_int_ajuste').eq('loja_id', lojaId).eq('id_prod', id).in('tipo', ['ENT', 'SAI']).gte('data', `${addDias(hoje, -90)}T00:00:00Z`).order('data', { ascending: false }).limit(60),
    modo === 'omie' ? carregarMovimentacoes(lojaId, { cod: String(id), data_inicio: addDias(hoje, -59), data_final: hoje }, hoje, 200).catch(() => null) : Promise.resolve(null),
  ])
  const insumos = (fichaRes.data ?? []).map((f) => ({ insumo: Number(f.codigo_produto_insumo), qtd: Number(f.quantidade ?? 0) * (1 + Number(f.percentual_perda ?? 0) / 100) }))
  const usados = [...new Set((usadoRes.data ?? []).map((u) => Number(u.codigo_produto)))]
  const info = await infoProdutos(lojaId, modo, [id, ...insumos.map((i) => i.insumo), ...usados])
  const p = info.get(id)
  const d = vazio(alvo, p?.nome ?? `Produto ${id}`, TIPO_ROT[p?.tipo ?? ''] ?? 'Produto')
  if (!p) { d.avisos.push('Produto não encontrado nesta loja (ou inativo).'); return d }
  d.subtitulo = [`cód. ${p.cod}`, p.familia].filter(Boolean).join(' · ')
  d.hrefPagina = `/estoque/produto/${id}`
  d.locais = p.locais
  const cmcOk = p.cmc > 0 && p.cmc < 1e7
  d.kpis = [
    { rot: 'Saldo', valor: fmtQtd(p.saldo, p.un), erro: p.saldo < 0 },
    { rot: 'Custo médio', valor: cmcOk ? `${fmtBRL(p.cmc)}/${unidadeCurta(p.un)}` : '—', erro: p.cmc >= 1000 },
    { rot: 'Valor do saldo', valor: cmcOk ? fmtBRLCurto(p.saldo * p.cmc) : '—' },
  ]
  if (p.locais.length > 1) d.blocos.push({ titulo: 'Saldo por local', texto: p.locais.map((l) => `${l.nome}: ${fmtQtd(l.saldo, p.un)}`).join(' · ') })
  if (insumos.length) {
    let total = 0
    const linhas = insumos.map((i) => {
      const ip = info.get(i.insumo)
      const c = ip && ip.cmc > 0 && ip.cmc < 1e7 ? ip.cmc : 0
      total += i.qtd * c
      return { produto: i.insumo, nome: ip?.nome ?? `Produto ${i.insumo}`, qtd: fmtQtd(i.qtd, ip?.un ?? null), custo: c ? fmtBRL(i.qtd * c) : 'sem custo', semCusto: !c }
    })
    d.ficha = { titulo: 'Ficha técnica', linhas, total: fmtBRL(total) }
  }
  if (movs) {
    d.movimentos = movs.res.linhas.map(movDeLinha)
    d.movimentosAviso = [movs.res.avisos.join(' '), movs.res.total > movs.res.linhas.length ? `Mostrando ${movs.res.linhas.length} de ${movs.res.total} (60 dias). Veja todos em Movimentações.` : ''].filter(Boolean).join(' ') || null
  } else if (modo === 'proprio') d.movimentosAviso = 'No estoque próprio, os movimentos ficam na página do produto.'

  const ops = opsRes.data ?? []
  const notasIds = [...new Set((notasRes.data ?? []).map((n) => Number(n.nota_fiscal_id)))]
  const { data: notas } = notasIds.length ? await supabase.from('notas_fiscais').select('id, c_numero_nfe, c_razao_social, d_emissao_nfe, c_etapa').in('id', notasIds) : { data: [] }
  const notaPor = new Map((notas ?? []).map((n) => [Number(n.id), n]))
  d.ligado = [
    { titulo: 'Ficha (insumos)', itens: insumos.map((i) => ({ tipo: 'produto' as const, id: i.insumo, titulo: info.get(i.insumo)?.nome ?? `Produto ${i.insumo}`, sub: `${fmtQtd(i.qtd, info.get(i.insumo)?.un ?? null)} por ${unidadeCurta(p.un)}`, valor: info.get(i.insumo) ? fmtQtd(info.get(i.insumo)!.saldo, info.get(i.insumo)!.un) : '', erro: (info.get(i.insumo)?.saldo ?? 0) < 0 })) },
    { titulo: 'Usado nos pratos', itens: usados.map((u) => ({ tipo: 'produto' as const, id: u, titulo: info.get(u)?.nome ?? `Produto ${u}`, sub: TIPO_ROT[info.get(u)?.tipo ?? ''] ?? '', valor: info.get(u) ? fmtQtd(info.get(u)!.saldo, info.get(u)!.un) : '', erro: (info.get(u)?.saldo ?? 0) < 0 })) },
    { titulo: 'OPs deste produto', itens: ops.map((o) => ({ tipo: 'op' as const, id: Number(o.id), titulo: `OP ${o.identificacao_c_num_op ?? o.num_ordem ?? o.id}`, sub: o.concluida ? `Concluída ${fmtData(o.dt_conclusao_real)}` : `Aberta${o.dt_inclusao ? ` desde ${fmtData(o.dt_inclusao)}` : ''}`, valor: fmtQtd(Number(o.identificacao_n_qtde ?? 0), p.un) })) },
    { titulo: 'Notas fiscais', itens: (notasRes.data ?? []).map((n) => { const nf = notaPor.get(Number(n.nota_fiscal_id)); return { tipo: 'nota' as const, id: Number(n.nota_fiscal_id), titulo: `Nota ${nf?.c_numero_nfe ?? '?'} · ${nf?.c_razao_social ?? ''}`, sub: `${fmtDataLonga(nf?.d_emissao_nfe ?? null)}${nf?.c_etapa === '40' ? ' · esperando entrada' : ''}`, valor: `${fmtQtd(Number(n.n_qtde_nfe ?? 0), n.c_unidade_nfe)}` } }) },
    { titulo: 'Contagens', itens: (sldRes.data ?? []).map((c) => ({ tipo: 'ajuste' as const, id: Number(c.id), titulo: `Contou ${fmtQtd(Number(c.quan), p.un)}`, sub: `${fmtDataLonga(diaDoMovimento(c.data))}${c.autor ? ` · ${c.autor}` : ''}`, valor: '' })) },
  ].filter((g) => g.itens.length)
  d.ajustesCusto = (entRes.data ?? [])
    .filter((a) => a.id_ajuste != null && a.transferencia_id == null && !/^ITEM/i.test(a.cod_int_ajuste ?? '') && a.origem !== 'PDV' && a.motivo !== 'PDV' && a.origem_ajuste !== 'pdv')
    .map((a) => ({ movimentoId: Number(a.id), data: diaDoMovimento(a.data), tipo: a.tipo as 'ENT' | 'SAI', quantidade: Math.abs(Number(a.quan ?? 0)), custo: Number(a.valor ?? 0), motivo: a.motivo, foraDoNormal: !!custoForaDoNormal(Number(a.valor ?? 0), null) || (p.cmc > 0 && Number(a.valor ?? 0) >= p.cmc * 20) }))
  return d
}

async function painelOP(lojaId: number, modo: 'omie' | 'proprio', alvo: AlvoPainel): Promise<PainelDados> {
  const supabase = await createClient()
  const { data: o } = await supabase.from('ordens_producao').select('id, identificacao_n_cod_op, identificacao_c_num_op, identificacao_c_cod_int_op, num_ordem, identificacao_n_cod_produto, identificacao_n_qtde, identificacao_codigo_local_estoque, identificacao_d_dt_previsao, dt_inclusao, dt_conclusao_real, concluida, aberta_omie, obs_omie, origem_op, incluido_por_omie, full_object').eq('loja_id', lojaId).eq('id', alvo.id).maybeSingle()
  const d = vazio(alvo, 'OP', 'Ordem de produção')
  if (!o) { d.avisos.push('OP não encontrada nesta loja.'); return d }
  const num = o.identificacao_c_num_op ?? o.num_ordem ?? String(o.id)
  const itens = itensDaOPGravada(o.full_object)
  const prodId = o.identificacao_n_cod_produto == null ? null : Number(o.identificacao_n_cod_produto)
  const info = await infoProdutos(lojaId, modo, [prodId ?? 0, ...itens.map((i) => i.insumo)])
  const p = prodId ? info.get(prodId) : undefined
  const aberta = o.concluida !== true && o.aberta_omie !== false
  d.titulo = `OP ${num}`
  d.tipoRotulo = `Ordem de produção · ${aberta ? `aberta${o.dt_inclusao ? ` desde ${fmtDataLonga(o.dt_inclusao)}` : ''}` : `concluída em ${fmtDataLonga(o.dt_conclusao_real)}`}`
  d.subtitulo = p?.nome ?? null
  d.hrefPagina = `/ordem-producao/${o.id}`
  let custo = 0
  const linhas = itens.map((i) => {
    const ip = info.get(i.insumo)
    const c = ip && ip.cmc > 0 && ip.cmc < 1e7 ? ip.cmc : 0
    custo += i.quantidade * c
    return { produto: i.insumo, nome: ip?.nome ?? `Produto ${i.insumo}`, qtd: fmtQtd(i.quantidade, ip?.un ?? null), custo: c ? fmtBRL(i.quantidade * c) : 'sem custo', semCusto: !c }
  })
  d.kpis = [
    { rot: 'Produz', valor: fmtQtd(Number(o.identificacao_n_qtde ?? 0), p?.un ?? null) },
    { rot: 'Previsão', valor: fmtDataLonga(o.identificacao_d_dt_previsao) },
    { rot: 'Insumos', valor: itens.length ? fmtBRLCurto(custo) : '—' },
  ]
  if (itens.length) d.ficha = { titulo: 'Insumos (ficha gravada na OP)', linhas, total: fmtBRL(custo) }
  else d.avisos.push('A ficha gravada nesta OP ainda não foi lida do Omie.')
  if (o.obs_omie) d.blocos.push({ titulo: 'Observação no Omie', texto: `${o.obs_omie}${o.origem_op ? ` · origem: ${({ cupom: 'venda no caixa', manual: 'tela do Omie', script: 'script', app: 'este app', vendas: 'Norte Vendas' } as Record<string, string>)[o.origem_op] ?? o.origem_op}` : ''}${o.incluido_por_omie ? ` · por ${o.incluido_por_omie}` : ''}` })
  if (modo === 'omie') {
    const opMin: OPMin = { id: Number(o.id), identificacao_n_cod_op: o.identificacao_n_cod_op, identificacao_c_num_op: o.identificacao_c_num_op, identificacao_c_cod_int_op: o.identificacao_c_cod_int_op, identificacao_n_cod_produto: prodId, identificacao_n_qtde: o.identificacao_n_qtde, identificacao_codigo_local_estoque: o.identificacao_codigo_local_estoque, dt_conclusao_real: o.dt_conclusao_real, concluida: o.concluida }
    const fichaOP: ItemFichaOP[] = itens.map((i) => ({ nIdProdutoMalha: i.insumo, nQtde: i.quantidade, codigo_local_estoque: i.local }))
    const m = await movimentosDaOP(lojaId, opMin, fichaOP).catch(() => null)
    if (m) { d.movimentos = m.linhas.map(movDeLinha); d.movimentosAviso = m.aviso ?? (aberta ? 'A OP ainda não movimentou o estoque: abaixo, o previsto pela ficha.' : null) }
  }
  const cupom = (o.obs_omie ?? '').match(/Cupom\s+(\d+)/i)?.[1]
  d.ligado = [
    { titulo: 'Produto', itens: p && prodId ? [{ tipo: 'produto' as const, id: prodId, titulo: p.nome, sub: TIPO_ROT[p.tipo ?? ''] ?? '', valor: fmtQtd(p.saldo, p.un), erro: p.saldo < 0 }] : [] },
    { titulo: 'Insumos', itens: itens.map((i) => ({ tipo: 'produto' as const, id: i.insumo, titulo: info.get(i.insumo)?.nome ?? `Produto ${i.insumo}`, sub: fmtQtd(i.quantidade, info.get(i.insumo)?.un ?? null), valor: info.get(i.insumo) ? fmtQtd(info.get(i.insumo)!.saldo, info.get(i.insumo)!.un) : '', erro: (info.get(i.insumo)?.saldo ?? 0) < 0 })) },
  ].filter((g) => g.itens.length)
  if (cupom) d.blocos.push({ titulo: 'Venda que gerou a OP', texto: `Cupom ${cupom} (procure pelo número na busca rápida).` })
  return d
}

async function painelNota(lojaId: number, modo: 'omie' | 'proprio', alvo: AlvoPainel): Promise<PainelDados> {
  const supabase = await createClient()
  const [{ data: n }, { data: its }] = await Promise.all([
    supabase.from('notas_fiscais').select('id, c_numero_nfe, c_razao_social, d_emissao_nfe, c_etapa, n_valor_nfe').eq('loja_id', lojaId).eq('id', alvo.id).maybeSingle(),
    supabase.from('nota_fiscal_items').select('n_id_produto, c_descricao_produto, n_qtde_nfe, c_unidade_nfe, n_preco_unit').eq('loja_id', lojaId).eq('nota_fiscal_id', alvo.id).order('id').limit(500),
  ])
  const d = vazio(alvo, 'Nota', 'Nota fiscal de entrada')
  if (!n) { d.avisos.push('Nota não encontrada nesta loja.'); return d }
  const itens = its ?? []
  const info = await infoProdutos(lojaId, modo, itens.map((i) => Number(i.n_id_produto ?? 0)))
  d.titulo = `Nota ${n.c_numero_nfe ?? n.id}`
  d.tipoRotulo = `Nota fiscal de entrada · ${n.c_etapa === '40' ? 'esperando entrada no estoque' : 'lançada no estoque'}`
  d.subtitulo = n.c_razao_social
  d.hrefPagina = `/nota-fiscal/${n.id}`
  d.kpis = [{ rot: 'Emissão', valor: fmtDataLonga(n.d_emissao_nfe) }, { rot: 'Valor', valor: fmtBRLCurto(Number(n.n_valor_nfe ?? 0)) }, { rot: 'Itens', valor: String(itens.length) }]
  if (n.c_etapa === '40') d.avisos.push('Esta nota ainda não entrou no estoque. Enquanto isso, os produtos dela podem aparecer negativos.')
  const caro = itens.find((i) => Number(i.n_preco_unit ?? 0) >= 300 && ['UN', 'POR', 'PCT', 'CX'].includes((info.get(Number(i.n_id_produto))?.un ?? '').toUpperCase()))
  if (caro) d.avisos.push(`${caro.c_descricao_produto} veio como 1 ${unidadeCurta(caro.c_unidade_nfe)} por ${fmtBRL(Number(caro.n_preco_unit))}. Se for uma caixa, o custo de cada unidade fica errado.`)
  d.ficha = { titulo: 'Itens', linhas: itens.map((i) => ({ produto: Number(i.n_id_produto ?? 0), nome: i.c_descricao_produto ?? '', qtd: fmtQtd(Number(i.n_qtde_nfe ?? 0), i.c_unidade_nfe), custo: fmtBRL(Number(i.n_qtde_nfe ?? 0) * Number(i.n_preco_unit ?? 0)), semCusto: false })), total: null }
  if (modo === 'omie') {
    const m = await movimentosDaNota(lojaId, { numero: n.c_numero_nfe, emissao: n.d_emissao_nfe }, itens.filter((i) => i.n_id_produto).map((i) => ({ n_id_produto: Number(i.n_id_produto), codigo_local_estoque: null, quantidade: Number(i.n_qtde_nfe ?? 0) }))).catch(() => null)
    if (m) d.movimentos = m.linhas.map(movDeLinha)
  }
  d.ligado = [{ titulo: 'Produtos da nota', itens: itens.filter((i) => i.n_id_produto && info.has(Number(i.n_id_produto))).map((i) => { const p = info.get(Number(i.n_id_produto))!; return { tipo: 'produto' as const, id: Number(i.n_id_produto), titulo: p.nome, sub: `${fmtQtd(Number(i.n_qtde_nfe ?? 0), i.c_unidade_nfe)} a ${fmtBRL(Number(i.n_preco_unit ?? 0))}`, valor: fmtQtd(p.saldo, p.un), erro: p.saldo < 0 } }) }].filter((g) => g.itens.length)
  return d
}

async function painelCupom(lojaId: number, modo: 'omie' | 'proprio', alvo: AlvoPainel): Promise<PainelDados> {
  const supabase = await createClient()
  const det = await buscarFatCupomDetalhe(lojaId, alvo.id)
  const d = vazio(alvo, `Cupom`, 'Cupom fiscal do caixa')
  if (!det.cupom) { d.avisos.push('Cupom não encontrado no histórico de vendas (Contabo).'); return d }
  const c = det.cupom
  const num = c.num ?? String(c.n_id_cupom)
  const info = await infoProdutos(lojaId, modo, det.itens.map((i) => Number(i.id_produto ?? 0)))
  const [{ data: ops }, { data: lanc }] = await Promise.all([
    supabase.from('ordens_producao').select('id, identificacao_c_num_op, num_ordem, identificacao_n_cod_produto, identificacao_n_qtde, concluida, aberta_omie, dt_inclusao').eq('loja_id', lojaId).or(`obs_omie.ilike."Cupom ${num}",obs_omie.ilike."Cupom ${num} *",identificacao_c_cod_int_op.like.CP-${c.n_id_cupom.toString(36)}-*`).limit(50),
    supabase.from('central_op_lancada').select('cod_int_op, codigo_produto, quantidade, status, simulado, user_nome, atualizado_em').eq('loja_id', lojaId).eq('n_id_cupom', c.n_id_cupom).limit(50),
  ])
  d.titulo = `Cupom ${num}`
  d.subtitulo = `${fmtDataLonga(String(c.data).slice(0, 10))}${c.hora ? ` às ${c.hora.slice(0, 5)}` : ''}${c.cancelado ? ' · CANCELADO' : ''}`
  d.hrefPagina = `/faturamento/cupom/${c.n_id_cupom}`
  d.kpis = [{ rot: 'Valor', valor: fmtBRL(c.valor) }, { rot: 'Itens', valor: String(det.itens.length) }, { rot: 'OPs', valor: String((ops ?? []).length || '—') }]
  d.movimentos = det.itens.map((i) => ({ data: String(c.data).slice(0, 10), titulo: 'Venda no caixa', sub: info.get(Number(i.id_produto))?.nome ?? i.x_prod ?? '', qtd: fmtQtdSinal(-Number(i.quant), info.get(Number(i.id_produto))?.un ?? 'UN'), entrada: false, saldo: null, link: i.id_produto ? { tipo: 'produto', id: Number(i.id_produto), rotulo: 'Abrir' } : null, href: null }))
  d.ligado = [
    { titulo: 'Produtos vendidos', itens: det.itens.filter((i) => i.id_produto).map((i) => { const p = info.get(Number(i.id_produto)); return { tipo: 'produto' as const, id: Number(i.id_produto), titulo: p?.nome ?? i.x_prod ?? '', sub: `×${Number(i.quant).toLocaleString('pt-BR')}`, valor: p ? fmtQtd(p.saldo, p.un) : '', erro: (p?.saldo ?? 0) < 0 } }) },
    { titulo: 'OPs desta venda', itens: (ops ?? []).map((o) => ({ tipo: 'op' as const, id: Number(o.id), titulo: `OP ${o.identificacao_c_num_op ?? o.num_ordem ?? o.id}`, sub: `${info.get(Number(o.identificacao_n_cod_produto))?.nome ?? ''} · ${o.concluida ? 'concluída' : 'aberta'}`, valor: '' })) },
  ].filter((g) => g.itens.length)
  if (lanc?.length) d.blocos.push({ titulo: 'OPs lançadas pela Central', texto: lanc.map((l) => `${info.get(Number(l.codigo_produto))?.nome ?? l.codigo_produto} ×${Number(l.quantidade)}: ${l.status}${l.simulado ? ' (simulada)' : ''}${l.user_nome ? ` · ${l.user_nome}` : ''}`).join(' · ') })
  if (!(ops ?? []).length) d.avisos.push('Nenhuma OP encontrada com este cupom. Para OP concluída, o Omie não guarda o número do cupom: a Central compara as vendas do dia com as OPs do caixa do dia.')
  return d
}

async function painelAjuste(lojaId: number, modo: 'omie' | 'proprio', alvo: AlvoPainel): Promise<PainelDados> {
  const supabase = await createClient()
  const { data: m } = await supabase.from('movimentos').select('id, data, tipo, quan, valor, motivo, autor, id_prod, codigo_local_estoque, origem_ajuste').eq('loja_id', lojaId).eq('id', alvo.id).maybeSingle()
  const d = vazio(alvo, 'Ajuste', 'Ajuste de estoque')
  if (!m) { d.avisos.push('Lançamento não encontrado nesta loja.'); return d }
  const prodId = Number(m.id_prod)
  const info = await infoProdutos(lojaId, modo, [prodId])
  const p = info.get(prodId)
  const contagem = m.tipo === 'SLD'
  d.tipoRotulo = contagem ? `Contagem de inventário${m.autor ? ` · ${m.autor}` : ''}` : `Ajuste ${m.tipo === 'ENT' ? 'de entrada' : 'de saída'}${m.autor ? ` · ${m.autor}` : ''}`
  d.titulo = p?.nome ?? `Produto ${prodId}`
  d.hrefPagina = `/estoque/ajustes?q=${encodeURIComponent(p?.cod ?? String(prodId))}`
  const { data: outras } = await supabase.from('movimentos').select('id, data, quan, autor').eq('loja_id', lojaId).eq('id_prod', prodId).eq('tipo', 'SLD').eq('codigo_local_estoque', m.codigo_local_estoque).order('data', { ascending: false }).limit(20)
  const lista = (outras ?? [])
  const idx = lista.findIndex((x) => Number(x.id) === Number(m.id))
  const ant = idx >= 0 ? lista[idx + 1] : undefined
  d.kpis = contagem
    ? [{ rot: 'Contou', valor: fmtQtd(Number(m.quan), p?.un ?? null) }, { rot: 'Contagem anterior', valor: ant ? fmtQtd(Number(ant.quan), p?.un ?? null) : '—' }, { rot: 'Data', valor: fmtDataLonga(diaDoMovimento(m.data)) }]
    : [{ rot: 'Quantidade', valor: fmtQtd(Math.abs(Number(m.quan)), p?.un ?? null) }, { rot: 'Custo unit.', valor: fmtBRL(Number(m.valor ?? 0)) }, { rot: 'Data', valor: fmtDataLonga(diaDoMovimento(m.data)) }]
  if (contagem) d.blocos.push({ titulo: 'Como conta', texto: 'Contagem não soma no saldo: ela substitui o saldo daquele dia.' })
  if (m.motivo) d.blocos.push({ titulo: 'Motivo', texto: m.motivo })
  if (contagem) d.movimentos = lista.map((x) => ({ data: diaDoMovimento(x.data), titulo: 'Contagem', sub: x.autor ?? '', qtd: `contou ${fmtQtd(Number(x.quan), p?.un ?? null)}`, entrada: false, saldo: null, link: Number(x.id) === Number(m.id) ? null : { tipo: 'ajuste', id: Number(x.id), rotulo: 'Ver' }, href: null }))
  d.ligado = p ? [{ titulo: 'Produto', itens: [{ tipo: 'produto', id: prodId, titulo: p.nome, sub: TIPO_ROT[p.tipo ?? ''] ?? '', valor: fmtQtd(p.saldo, p.un), erro: p.saldo < 0 }] }] : []
  return d
}
