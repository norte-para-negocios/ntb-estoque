// Funcoes puras do painel de Notas Fiscais (compras recebidas). Sem I/O, sem alias '@/',
// sem import '.ts' (mesma regra de lib/faturamento-itens.ts, testado com node --test).
// O painel reaproveita rankear/resumir/serieDiaria/matrizMensal do Faturamento: aqui so
// ficam os tipos das notas/itens, a conversao pra "linha" do Faturamento e os filtros
// feitos em memoria (fornecedor, situacao, numero, busca).

import type { TipoValorCompra } from './compras/custo-estoque-item'

export type NotaLeve = {
  id: number
  dia: string // 'YYYY-MM-DD' (emissao)
  numero: string | null
  serie: string | null
  fornecedor: string
  natureza: string | null
  valor: number
  etapa: string | null
  cancelada: boolean
  manifestada: boolean
  sefazSituacao: string | null
  transportadora: string // transporte.cNomeTransp, senão cRazaoTransp, senão SEM_TRANSPORTADORA
}

export type ItemCompra = {
  notaId: number
  dia: string
  idProduto: number | null
  produto: string
  tipoCod: string
  tipo: string
  familia: string
  unidade: string
  quant: number
  valor: number // valor da nota (quantidade × preço)
  valorEstoque?: number // valor que entrou no estoque, regra do Omie (lib/compras/custo-estoque-item.ts); ausente = valor
}

// Mesmo formato de LinhaItem (lib/faturamento-itens.ts), repetido aqui porque modulo
// puro nao importa valor de outro modulo. `cupom` = id da nota.
export type LinhaPainel = {
  dia: string; cupom: number; idProduto: number | null; produto: string
  tipoCod: string; tipo: string; familia: string; quant: number; valor: number
}

export const SEM_FORNECEDOR = 'Sem fornecedor'
export const SEM_FAMILIA = 'Sem família'
export const SEM_TRANSPORTADORA = 'Sem transportadora'

/** Transportadora da nota (bloco transporte do recebimento): nome fantasia, senão razão social. */
export function transportadoraDe(nome: string | null | undefined, razao: string | null | undefined): string {
  return (nome ?? '').trim() || (razao ?? '').trim() || SEM_TRANSPORTADORA
}

/** Mesma regra a partir do full_object da nota (Excel e PDF, que leem o objeto inteiro). */
export function transportadoraDoObjeto(fo: unknown): string {
  const t = fo && typeof fo === 'object' ? (fo as { transporte?: { cNomeTransp?: unknown; cRazaoTransp?: unknown } }).transporte : undefined
  return transportadoraDe(typeof t?.cNomeTransp === 'string' ? t.cNomeTransp : null, typeof t?.cRazaoTransp === 'string' ? t.cRazaoTransp : null)
}

export type Visao = 'notas' | 'fornecedores' | 'transportadoras' | 'produtos' | 'familias' | 'dias' | 'mensal'
export const VISOES: { value: Visao; label: string }[] = [
  { value: 'notas', label: 'Notas' },
  { value: 'fornecedores', label: 'Fornecedores' },
  { value: 'transportadoras', label: 'Transportadoras' },
  { value: 'produtos', label: 'Produtos' },
  { value: 'familias', label: 'Famílias' },
  { value: 'dias', label: 'Por dia' },
  { value: 'mensal', label: 'Evolução mensal' },
]

// Situacao: '' (padrao) = validas (tudo menos cancelada). TODAS = sem filtro.
// CONCLUIDA/PENDENTE/CANCELADA/MANIFESTADA = mesmas regras de lib/nf-status.ts;
// 'C'/'P' (links antigos) e etapa crua ('40', '60') continuam valendo.
export function situacaoBate(n: NotaLeve, status: string): boolean {
  const concluida = !n.cancelada && n.etapa === '60'
  if (!status || status === 'VALIDAS') return !n.cancelada
  if (status === 'TODAS') return true
  if (status === 'C' || status === 'CONCLUIDA') return concluida
  if (status === 'P' || status === 'PENDENTE') return !n.cancelada && n.etapa !== '60'
  if (status === 'CANCELADA') return n.cancelada
  if (status === 'MANIFESTADA') return n.manifestada
  return n.etapa === status
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export type FiltrosMemoria = { fornecedor?: string; status?: string; numero?: string; q?: string; transportadora?: string }

// Filtros que nao precisam ir ao banco. Fornecedor: contem o texto (sem acento/caixa),
// igual ao ilike antigo -- escolher um nome da lista casa com ele mesmo.
export function filtrarNotas(notas: NotaLeve[], f: FiltrosMemoria): NotaLeve[] {
  const forn = semAcento((f.fornecedor ?? '').trim())
  const num = (f.numero ?? '').trim()
  const q = semAcento((f.q ?? '').trim())
  return notas.filter((n) => {
    if (!situacaoBate(n, f.status ?? '')) return false
    if (forn && !semAcento(n.fornecedor).includes(forn)) return false
    if (num && !(n.numero ?? '').includes(num)) return false
    if (f.transportadora && n.transportadora !== f.transportadora) return false
    if (q) {
      const alvo = semAcento(`${n.fornecedor} ${n.numero ?? ''} ${n.natureza ?? ''}`)
      if (!alvo.includes(q)) return false
    }
    return true
  })
}

// Nota vira "linha" do Faturamento: produto = fornecedor (ou transportadora), quant = 1 (conta notas).
export function notaParaLinha(n: NotaLeve, por: 'fornecedor' | 'transportadora' = 'fornecedor'): LinhaPainel {
  return { dia: n.dia, cupom: n.id, idProduto: null, produto: por === 'transportadora' ? n.transportadora : n.fornecedor, tipoCod: '', tipo: '', familia: '', quant: 1, valor: n.valor }
}

export function itemParaLinha(i: ItemCompra, tipo: TipoValorCompra = 'estoque'): LinhaPainel {
  const valor = tipo === 'estoque' ? (i.valorEstoque ?? i.valor) : i.valor
  return { dia: i.dia, cupom: i.notaId, idProduto: i.idProduto, produto: i.produto, tipoCod: i.tipoCod, tipo: i.tipo, familia: i.familia, quant: i.quant, valor }
}

// Itens das notas que sobraram, respeitando os filtros que sao "por item" (tipo/familia):
// numa nota com carne e limpeza, filtrar Familia=Carnes mostra so a carne em Produtos.
export function itensDasNotas(itens: ItemCompra[], notaIds: Set<number>, f: { tipos?: string[]; familias?: string[] }): ItemCompra[] {
  const tipos = new Set(f.tipos ?? [])
  const familias = new Set(f.familias ?? [])
  return itens.filter((i) =>
    notaIds.has(i.notaId) &&
    (!tipos.size || tipos.has(i.tipoCod)) &&
    (!familias.size || familias.has(i.familia)))
}

const CHAVES_ORD = ['dia', 'numero', 'fornecedor', 'valor', 'situacao'] as const
export type OrdNotas = (typeof CHAVES_ORD)[number]
// Colunas antigas (?ord=d_emissao_nfe etc.) continuam funcionando.
const ORD_ANTIGO: Record<string, OrdNotas> = { d_emissao_nfe: 'dia', c_numero_nfe: 'numero', c_razao_social: 'fornecedor', n_valor_nfe: 'valor', c_etapa: 'situacao' }

export function lerOrdem(ord?: string, dir?: string): { ord: OrdNotas; dir: 'asc' | 'desc' } {
  const o = (CHAVES_ORD as readonly string[]).includes(ord ?? '') ? (ord as OrdNotas) : ORD_ANTIGO[ord ?? ''] ?? 'dia'
  return { ord: o, dir: dir === 'asc' ? 'asc' : 'desc' }
}

export function ordenarNotas(notas: NotaLeve[], ord: OrdNotas, dir: 'asc' | 'desc'): NotaLeve[] {
  const k = (n: NotaLeve): string | number => {
    if (ord === 'valor') return n.valor
    if (ord === 'numero') return Number(n.numero) || 0
    if (ord === 'fornecedor') return semAcento(n.fornecedor)
    if (ord === 'situacao') return `${n.cancelada ? 2 : n.etapa === '60' ? 0 : 1}`
    return n.dia
  }
  const s = dir === 'asc' ? 1 : -1
  return [...notas].sort((a, b) => {
    const ka = k(a), kb = k(b)
    const c = ka < kb ? -1 : ka > kb ? 1 : 0
    return s * c || b.id - a.id
  })
}

// Opcoes do filtro de fornecedor: nomes distintos, em ordem alfabetica.
export function fornecedoresDistintos(notas: NotaLeve[]): string[] {
  return [...new Set(notas.map((n) => n.fornecedor))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
