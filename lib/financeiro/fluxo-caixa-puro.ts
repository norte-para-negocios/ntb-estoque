// Fluxo de caixa realizado + previsto (Fase 4 passo 5). Regras puras (node --test lib/financeiro/fluxo-caixa-puro.test.ts).
//  - Realizado = extrato (fin_lancamentos) por dia/semana/mês. Transferência entre contas da loja aparece à parte e não
//    entra em entradas/saídas da loja (sai de uma conta e entra na outra: o saldo da loja não muda).
//  - Previsto (de hoje até o fim do período) = contas a pagar em aberto (o que falta pagar), contas a receber das vendas
//    em aberto (líquido, na data prevista; migration 380) e recorrentes ainda sem conta gerada (fin_recorrentes sem
//    ocorrência na data). Vencido e não pago cai em HOJE, marcado como atrasado. Conta reprovada fica fora (avisada).
//  - Saldo inicial = saldo atual das contas − tudo que foi lançado do início do período em diante (lançamento com data
//    futura também conta). Saldo projetado por conta = saldo atual + previstos com conta definida; a pagar e
//    recorrentes não têm conta definida: ficam em "sem conta definida" e entram só no total da loja.
// @ts-expect-error: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { datasRecorrencia } from './recorrentes-puro.ts'

export type Agrupar = 'dia' | 'semana' | 'mes'
export type ContaFluxo = { id: number; nome: string; saldo_atual: number }
export type LancamentoFluxo = { id: number; conta_id: number; data: string; tipo: 'entrada' | 'saida'; valor: number; descricao: string | null; origem_tipo: string }
export type PagarFluxo = {
  id: number; numero: number; fornecedor_nome: string; documento: string | null; valor: number; valor_quitado: number
  data_vencimento: string; aprovacao: string; valor_a_confirmar: boolean
}
export type ReceberFluxo = { id: number; data_venda: string; forma: string; valor_liquido: number; data_prevista: string; conta_id: number | null }
export type RecorrenteFluxo = {
  id: number; descricao: string; fornecedor_nome: string; valor: number; valor_estimado: boolean
  periodicidade: 'mensal' | 'semanal'; dia: number; data_inicio: string; data_fim: string | null
}
export type EntradaFluxo = {
  de: string; ate: string; hoje: string; por: Agrupar
  contas: ContaFluxo[]; lancamentos: LancamentoFluxo[]; titulosPagar: PagarFluxo[]; titulosReceber: ReceberFluxo[]
  recorrentes: RecorrenteFluxo[]; ocorrencias: { recorrente_id: number; data_vencimento: string }[]
}
export type OrigemFluxo = {
  tipo: 'realizado' | 'previsto'; ref: string; periodo: string; data: string; dataOriginal: string; descricao: string
  /** entrada positiva, saída negativa */
  valor: number; conta: string | null; atrasado: boolean; estimado: boolean; transferencia: boolean; href: string | null
}
export type PeriodoFluxo = {
  chave: string; rotulo: string; realizadoEntradas: number; realizadoSaidas: number; transferencias: number
  previstoEntradas: number; previstoSaidas: number; saldoFinal: number
}
export type Fluxo = {
  por: Agrupar; saldoInicial: number; saldoFinalProjetado: number; periodos: PeriodoFluxo[]
  contas: { id: number; nome: string; saldoAtual: number; entradasPrevistas: number; saidasPrevistas: number; saldoProjetado: number }[]
  semConta: { entradas: number; saidas: number }; avisos: string[]; origens: OrigemFluxo[]
}

const cent = (v: number) => Math.round((Number(v) || 0) * 100)
const reais = (c: number) => c / 100
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const TRANSF = new Set(['transferencia', 'estorno_transferencia'])
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export function chavePeriodo(data: string, por: Agrupar): string {
  if (por === 'dia') return data
  if (por === 'mes') return data.slice(0, 7)
  const d = utc(data)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return iso(d)
}

export function rotuloPeriodo(chave: string, por: Agrupar): string {
  if (por === 'dia') return `${dataBR(chave)}/${chave.slice(0, 4)}`
  if (por === 'mes') {
    const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
    return `${nomes[Number(chave.slice(5, 7)) - 1]}/${chave.slice(0, 4)}`
  }
  const fim = utc(chave)
  fim.setUTCDate(fim.getUTCDate() + 6)
  return `${dataBR(chave)} a ${dataBR(iso(fim))}`
}

function chavesDoIntervalo(de: string, ate: string, por: Agrupar): string[] {
  const out: string[] = []
  const d = utc(de)
  for (; iso(d) <= ate; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = chavePeriodo(iso(d), por)
    if (out[out.length - 1] !== k) out.push(k)
  }
  return out
}

export function montarFluxo(e: EntradaFluxo): Fluxo {
  const nomeConta = new Map(e.contas.map((c) => [c.id, c.nome]))
  const origens: OrigemFluxo[] = []
  const avisos: string[] = []
  const ateRealizado = e.ate < e.hoje ? e.ate : e.hoje
  const dePrevisto = e.de > e.hoje ? e.de : e.hoje

  // saldo antes do período: atual − tudo lançado de `de` em diante
  let depoisDoInicio = 0
  for (const l of e.lancamentos) if (l.data >= e.de) depoisDoInicio += l.tipo === 'entrada' ? cent(l.valor) : -cent(l.valor)
  const saldoAtualC = e.contas.reduce((s, c) => s + cent(c.saldo_atual), 0)
  const saldoInicialC = saldoAtualC - depoisDoInicio

  for (const l of e.lancamentos) {
    if (l.data < e.de || l.data > ateRealizado) continue
    origens.push({ tipo: 'realizado', ref: `lancamento:${l.id}`, periodo: chavePeriodo(l.data, e.por), data: l.data, dataOriginal: l.data,
      descricao: l.descricao ?? l.origem_tipo, valor: l.tipo === 'entrada' ? Number(l.valor) : -Number(l.valor),
      conta: nomeConta.get(l.conta_id) ?? null, atrasado: false, estimado: false, transferencia: TRANSF.has(l.origem_tipo),
      href: `/financeiro/extrato?conta=${l.conta_id}&de=${l.data}&ate=${l.data}` })
  }

  const previstoConta = new Map<number | null, { ent: number; sai: number }>()
  const somaConta = (conta: number | null, c: number) => {
    const x = previstoConta.get(conta) ?? { ent: 0, sai: 0 }
    if (c >= 0) x.ent += c; else x.sai -= c
    previstoConta.set(conta, x)
  }
  if (dePrevisto <= e.ate) {
    let reprovadas = 0
    let estimadas = 0
    for (const t of e.titulosPagar) {
      if (t.aprovacao === 'reprovado') { reprovadas++; continue }
      if (t.data_vencimento > e.ate) continue
      const resta = cent(t.valor) - cent(t.valor_quitado)
      if (resta <= 0) continue
      const atrasado = t.data_vencimento < e.hoje
      if (atrasado && e.hoje > e.ate) continue
      const data = atrasado ? e.hoje : t.data_vencimento
      if (data < dePrevisto) continue
      if (t.valor_a_confirmar) estimadas++
      origens.push({ tipo: 'previsto', ref: `titulo:${t.id}`, periodo: chavePeriodo(data, e.por), data, dataOriginal: t.data_vencimento,
        descricao: `Conta nº ${t.numero} · ${t.fornecedor_nome}${t.documento ? ` · ${t.documento}` : ''}`, valor: -reais(resta), conta: null,
        atrasado, estimado: t.valor_a_confirmar, transferencia: false, href: `/financeiro/contas-pagar/${t.id}` })
      somaConta(null, -resta)
    }
    for (const r of e.titulosReceber) {
      if (r.data_prevista > e.ate) continue
      const atrasado = r.data_prevista < e.hoje
      const data = atrasado ? e.hoje : r.data_prevista
      if (data < dePrevisto) continue
      origens.push({ tipo: 'previsto', ref: `receber:${r.id}`, periodo: chavePeriodo(data, e.por), data, dataOriginal: r.data_prevista,
        descricao: `Vendas de ${dataBR(r.data_venda)} · ${r.forma}`, valor: Number(r.valor_liquido), conta: r.conta_id != null ? nomeConta.get(r.conta_id) ?? null : null,
        atrasado, estimado: false, transferencia: false, href: `/financeiro/contas-receber?venda_de=${r.data_venda}&venda_ate=${r.data_venda}` })
      somaConta(r.conta_id, cent(r.valor_liquido))
    }
    const geradas = new Set(e.ocorrencias.map((o) => `${o.recorrente_id}|${o.data_vencimento}`))
    for (const r of e.recorrentes) {
      const datas: string[] = datasRecorrencia({ periodicidade: r.periodicidade, dia: r.dia, inicio: r.data_inicio, fim: r.data_fim }, dePrevisto, e.ate)
      for (const d of datas) {
        if (geradas.has(`${r.id}|${d}`)) continue
        if (r.valor_estimado) estimadas++
        origens.push({ tipo: 'previsto', ref: `recorrente:${r.id}:${d}`, periodo: chavePeriodo(d, e.por), data: d, dataOriginal: d,
          descricao: `${r.descricao} · ${r.fornecedor_nome} (recorrente, conta ainda não gerada)`, valor: -Number(r.valor), conta: null,
          atrasado: false, estimado: r.valor_estimado, transferencia: false, href: '/financeiro/recorrentes' })
        somaConta(null, -cent(r.valor))
      }
    }
    if (reprovadas) avisos.push(`${reprovadas} conta(s) reprovada(s) ficaram fora da previsão.`)
    if (estimadas) avisos.push(`${estimadas} previsão(ões) com valor estimado (conta de valor a confirmar ou recorrente estimada).`)
    if (!e.titulosReceber.length) avisos.push('Nenhuma conta a receber das vendas em aberto: a previsão de entradas fica vazia até a loja gerar as contas a receber das vendas.')
  }

  let saldo = saldoInicialC
  const periodos: PeriodoFluxo[] = chavesDoIntervalo(e.de, e.ate, e.por).map((chave) => {
    let re = 0, rs = 0, tr = 0, pe = 0, ps = 0
    for (const o of origens) {
      if (o.periodo !== chave) continue
      const c = cent(o.valor)
      if (o.tipo === 'realizado') {
        if (o.transferencia) { if (c > 0) tr += c } else if (c >= 0) re += c; else rs -= c
      } else if (c >= 0) pe += c; else ps -= c
    }
    saldo += re - rs + pe - ps
    return { chave, rotulo: rotuloPeriodo(chave, e.por), realizadoEntradas: reais(re), realizadoSaidas: reais(rs), transferencias: reais(tr),
      previstoEntradas: reais(pe), previstoSaidas: reais(ps), saldoFinal: reais(saldo) }
  })

  const contas = e.contas.map((c) => {
    const p = previstoConta.get(c.id) ?? { ent: 0, sai: 0 }
    return { id: c.id, nome: c.nome, saldoAtual: Number(c.saldo_atual), entradasPrevistas: reais(p.ent), saidasPrevistas: reais(p.sai),
      saldoProjetado: reais(cent(c.saldo_atual) + p.ent - p.sai) }
  })
  const semContaPrev = previstoConta.get(null) ?? { ent: 0, sai: 0 }
  // recebível com conta que não está mais na lista (inativa) também fica "sem conta"
  for (const [id, p] of previstoConta) if (id !== null && !nomeConta.has(id)) { semContaPrev.ent += p.ent; semContaPrev.sai += p.sai }
  if (!e.contas.length) avisos.unshift('Nenhuma conta corrente cadastrada: o saldo parte de zero.')
  return {
    por: e.por, saldoInicial: reais(saldoInicialC), saldoFinalProjetado: reais(saldo), periodos, contas,
    semConta: { entradas: reais(semContaPrev.ent), saidas: reais(semContaPrev.sai) }, avisos, origens,
  }
}

/** Linhas de origem de uma célula do fluxo (período × realizado/previsto). A soma bate com a célula. */
export function origensDoPeriodo(f: Fluxo, periodo: string, tipo: 'realizado' | 'previsto'): OrigemFluxo[] {
  return f.origens.filter((o) => o.periodo === periodo && o.tipo === tipo).sort((a, b) => a.data.localeCompare(b.data) || a.ref.localeCompare(b.ref))
}

