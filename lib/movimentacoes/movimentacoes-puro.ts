// Movimentações completas (13/10/2026): regras puras da tela /movimentacoes, da busca de OP e do casamento
// kardex do Omie x OP. Sem imports (node --test lib/movimentacoes/movimentacoes-puro.test.ts).

export type OrigemMov = 'pdv' | 'op_producao' | 'op_consumo' | 'nf' | 'transferencia' | 'inventario' | 'ajuste' | 'outro'

export const ROTULO_ORIGEM_MOV: Record<OrigemMov, string> = {
  pdv: 'Venda (PDV)',
  op_producao: 'Produção (OP)',
  op_consumo: 'Consumo em OP',
  nf: 'Nota fiscal de entrada',
  transferencia: 'Transferência',
  inventario: 'Inventário (contagem)',
  ajuste: 'Ajuste',
  outro: 'Outro',
}

export const OPCOES_ORIGEM_MOV: { value: OrigemMov; label: string }[] = (
  ['pdv', 'op_producao', 'op_consumo', 'nf', 'transferencia', 'inventario', 'ajuste'] as OrigemMov[]
).map((value) => ({ value, label: ROTULO_ORIGEM_MOV[value] }))

export type DocMov = {
  tipo: 'op' | 'nf' | 'cupom' | 'ajuste' | 'transferencia' | 'inventario'
  id: number | null
  rotulo: string
  dia?: string | null
  produto?: string | null
}

export type FiltrosMov = {
  ini: string; fim: string; q: string; produto: number | null; local: number | null; origem: string; doc: string; autor: string
  page: number; erro: string | null
}

export const PADRAO_DIAS = 7
export const MAX_DIAS_AMPLO = 366
export const MAX_DIAS_RECONSTRUIDO = 92

const ISO = /^\d{4}-\d{2}-\d{2}$/
function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
const inteiro = (v: string | undefined) => (v && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null)
const dataValida = (v: string | undefined) => !!v && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))
const fmtBR = (iso: string) => iso.split('-').reverse().join('/')

/**
 * Filtros da URL. Período padrão = últimos 7 dias; invertido troca. Teto: 366 dias no kardex do Omie ou quando há
 * produto/documento no filtro (poucas linhas); 92 dias na lista reconstruída da loja inteira (consulta pesada).
 */
export function lerFiltrosMovimentacoes(sp: Record<string, string | undefined>, hoje: string, reconstruido: boolean): FiltrosMov {
  const q = (sp.q ?? '').trim()
  const doc = (sp.doc ?? '').trim()
  const produto = inteiro(sp.produto)
  let fim = dataValida(sp.data_final) ? sp.data_final! : hoje
  let ini = dataValida(sp.data_inicio) ? sp.data_inicio! : addDias(fim, -(PADRAO_DIAS - 1))
  if (ini > fim) [ini, fim] = [fim, ini]
  const max = !reconstruido || q || doc || produto != null ? MAX_DIAS_AMPLO : MAX_DIAS_RECONSTRUIDO
  let erro: string | null = null
  if (diasEntre(ini, fim) > max - 1) {
    ini = addDias(fim, -(max - 1))
    erro = `Período limitado a ${max} dias: mostrando a partir de ${fmtBR(ini)}.`
  }
  const page = inteiro(sp.page)
  return {
    ini, fim, q, produto, local: inteiro(sp.local), origem: (sp.origem ?? '').trim(), doc, autor: (sp.autor ?? '').trim(),
    page: page && page > 0 ? page : 1, erro,
  }
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()

/** Categoria do movimento do kardex do Omie a partir do código/descrição de origem (códigos vistos: PDV, OPE, OPS, AJU, SLD, COM, TRF). */
export function origemDoKardex(l: { cod_origem: string | null; des_origem: string | null; quantidade: number; id_cupom: number | null; id_ajuste: number | null }): OrigemMov {
  if (l.id_cupom != null) return 'pdv'
  const cod = semAcento((l.cod_origem ?? '').trim())
  const des = semAcento((l.des_origem ?? '').trim())
  const t = `${cod} ${des}`
  if (/PDV|VEN|CUPOM|NFC/.test(t)) return 'pdv'
  if (/^OP/.test(cod) || /PRODU|ORDEM DE P/.test(des)) return l.quantidade > 0 ? 'op_producao' : 'op_consumo'
  if (/TRF|TRANSF/.test(t)) return 'transferencia'
  if (/SLD|INVENT|CONTAGEM/.test(t)) return 'inventario'
  if (/^COM|NFE|COMPRA|RECEB|NOTA/.test(t)) return 'nf'
  if (/AJU|AJUSTE/.test(t) || l.id_ajuste != null) return 'ajuste'
  return 'outro'
}

/** Link da página do documento de origem (null quando o documento não foi achado no app). */
export function hrefDocumento(d: DocMov): string | null {
  if (d.id == null) return null
  switch (d.tipo) {
    case 'op': return `/ordem-producao/${d.id}`
    case 'nf': return `/nota-fiscal/${d.id}`
    case 'cupom': return `/faturamento/cupom/${d.id}`
    case 'transferencia': return `/transferencia/${d.id}`
    case 'inventario': return `/inventario/${d.id}`
    case 'ajuste': {
      const p = new URLSearchParams()
      if (d.dia) { p.set('data_inicio', d.dia); p.set('data_final', d.dia) }
      if (d.produto) p.set('q', d.produto)
      return `/estoque/ajustes${p.size ? `?${p}` : ''}`
    }
  }
}

/** Formas de comparar um número de documento: como veio, sem o ano/barra e sem zeros à esquerda, e só os dígitos. */
export function numerosCandidatos(...valores: (string | number | null | undefined)[]): string[] {
  const r: string[] = []
  const add = (s: string) => { if (s && !r.includes(s)) r.push(s) }
  for (const v of valores) {
    if (v == null) continue
    const s = String(v).trim()
    if (!s) continue
    add(s)
    const ultimo = s.split('/').pop() ?? ''
    if (/^\d+$/.test(ultimo)) add(ultimo.replace(/^0+(?=\d)/, ''))
    const digitos = s.replace(/\D/g, '')
    if (digitos) add(digitos.replace(/^0+(?=\d)/, ''))
  }
  return r
}

/** Busca da lista de OPs: "dd/mm" ou "dd/mm/aaaa" = data; só dígitos/barra = número da OP; o resto = texto livre. */
export function interpretarBuscaOP(q: string, hoje: string): { texto: string; data: string | null; numero: string | null } {
  const t = q.trim().replace(/\s+/g, ' ')
  const m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/)
  if (m) {
    const ano = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : hoje.slice(0, 4)
    const iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    const d = new Date(`${iso}T12:00:00Z`)
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso) return { texto: '', data: iso, numero: null }
  }
  if (/\d/.test(t) && /^[\d/.\-]+$/.test(t)) return { texto: t, data: null, numero: t }
  return { texto: t, data: null, numero: null }
}

export type OPMin = {
  id: number; identificacao_n_cod_op: number | null; identificacao_c_num_op: string | null; identificacao_c_cod_int_op: string | null
  identificacao_n_cod_produto: number | null; identificacao_n_qtde: number | null; identificacao_codigo_local_estoque: number | null
  dt_conclusao_real: string | null; concluida: boolean | null
}
export type ItemFichaOP = { nIdProdutoMalha: number; nQtde: number; codigo_local_estoque?: number | string | null; cUtilizarDoEstoque?: string | null }
export type MovPrevisto = { n_cod_prod: number; local: number | null; quantidade: number; origem: 'op_producao' | 'op_consumo' }

/** O que a OP concluída movimenta pela ficha gravada nela: entrada do produto no local da OP e consumo de cada insumo. */
export function movimentosPrevistosDaOP(op: OPMin, itens: ItemFichaOP[]): MovPrevisto[] {
  if (!op.concluida) return []
  const localOP = op.identificacao_codigo_local_estoque != null ? Number(op.identificacao_codigo_local_estoque) : null
  const r: MovPrevisto[] = []
  if (op.identificacao_n_cod_produto != null) {
    r.push({ n_cod_prod: Number(op.identificacao_n_cod_produto), local: localOP, quantidade: Number(op.identificacao_n_qtde) || 0, origem: 'op_producao' })
  }
  for (const i of itens) {
    if (!i.nIdProdutoMalha || i.cUtilizarDoEstoque === 'N') continue
    const local = i.codigo_local_estoque != null && i.codigo_local_estoque !== '' ? Number(i.codigo_local_estoque) : localOP
    r.push({ n_cod_prod: Number(i.nIdProdutoMalha), local, quantidade: -Math.abs(Number(i.nQtde) || 0), origem: 'op_consumo' })
  }
  return r
}

export type KardexMin = {
  n_cod_prod: number; data_mov: string; cod_origem: string | null; des_origem: string | null; quantidade: number
  num_doc: string | null; num_pedido: string | null; id_cupom: number | null; id_ajuste: number | null
}

/**
 * Movimentos do kardex que a OP gerou. 1º pelo número do documento (num_doc/num_pedido ≈ número, código do Omie ou
 * código de integração da OP); sem nenhum casamento por documento, por data (±1 dia da conclusão) + produto da OP ou
 * insumo + origem de OP, marcado como "provável".
 */
export function casarKardexComOP<T extends KardexMin>(linhas: T[], op: OPMin, produtosDaOP: number[]): { linhas: (T & { provavel: boolean })[]; criterio: 'documento' | 'data' | 'nenhum' } {
  const daOP = (l: T) => {
    const o = origemDoKardex(l)
    return o === 'op_producao' || o === 'op_consumo' || o === 'outro'
  }
  const chaves = new Set(numerosCandidatos(op.identificacao_c_num_op, op.identificacao_n_cod_op, op.identificacao_c_cod_int_op))
  const porDoc = linhas.filter((l) => daOP(l) && numerosCandidatos(l.num_doc, l.num_pedido).some((c) => chaves.has(c)))
  if (porDoc.length) return { linhas: porDoc.map((l) => ({ ...l, provavel: false })), criterio: 'documento' }
  if (!op.dt_conclusao_real) return { linhas: [], criterio: 'nenhum' }
  const dia = op.dt_conclusao_real.slice(0, 10)
  const de = addDias(dia, -1)
  const ate = addDias(dia, 1)
  const prods = new Set(produtosDaOP.map(Number))
  const porData = linhas.filter((l) => {
    const o = origemDoKardex(l)
    return (o === 'op_producao' || o === 'op_consumo') && prods.has(Number(l.n_cod_prod)) && l.data_mov >= de && l.data_mov <= ate
  })
  if (porData.length) return { linhas: porData.map((l) => ({ ...l, provavel: true })), criterio: 'data' }
  return { linhas: [], criterio: 'nenhum' }
}

/** Entradas e saídas (quantidade) de um conjunto de linhas: contagem de inventário e movimento cancelado não somam. */
export function totaisDe(linhas: { quantidade: number; contagem?: boolean; cancelado?: boolean }[]): { entradas: number; saidas: number } {
  let entradas = 0
  let saidas = 0
  for (const l of linhas) {
    if (l.contagem || l.cancelado) continue
    if (l.quantidade > 0) entradas += l.quantidade
    else saidas += -l.quantidade
  }
  return { entradas, saidas }
}
