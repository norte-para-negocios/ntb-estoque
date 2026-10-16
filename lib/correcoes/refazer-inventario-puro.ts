// Refazer um inventário na data dele (Central de correções, pedidos do Ramon de 15/10/2026). Regras puras, sem
// imports: node --test lib/correcoes/refazer-inventario-puro.test.ts. Passo a passo em docs/refazer-inventario.md.
//
// O Omie não tem AlterarAjusteEstoque. Refazer = (a) excluir as correções lançadas depois para o mesmo erro, (b) achar
// o saldo logo antes do inventário no kardex do dia, (c) excluir o inventário e (d) lançar o ajuste certo na MESMA
// data (ENT/SAI, motivo INV). O ajuste novo entra no fim do dia no kardex do Omie: as vendas e a produção do dia que o
// Omie registrou depois do inventário (o inventário é feito com a casa fechada) passam a contar antes dele. Nota de
// compra e ajuste manual lançados depois NÃO entram na conta (podem ter chegado depois da contagem) e continuam
// valendo por cima da contagem.

export type MovKardexDia = {
  idMov: number; idAjuste: number | null; codOrigem: string; qtde: number; saldo: number | null; cmc: number | null; cancelado: boolean
}
export type ModoRefazer = 'contagem' | 'fim_do_dia'
export type EntradaPlano = {
  modo: ModoRefazer
  /** Kardex do dia do produto no local, na ordem em que o Omie devolve (ListarMovimentoEstoque). */
  movs: MovKardexDia[]
  idAjusteInventario: number
  /** Modo contagem: a contagem certa (informada pela pessoa). */
  contagemCerta?: number | null
  /** Contagem gravada no banco: usada quando o inventário não mexeu no saldo e por isso não aparece no kardex. */
  contagemDb?: number | null
  /** Ajustes de correção lançados depois para o mesmo erro (serão excluídos antes do inventário). */
  correcoes?: number[]
  /** Ajustes AJU que são baixa de venda (venda sem nota vai ao Omie como ajuste comum). */
  vendasAju?: Iterable<number>
  /** Ids dos ajustes de inventário do mesmo produto/local/dia (banco): outro depois deste = recusa. */
  inventariosDoDia?: Iterable<number>
}
export type Plano = {
  modo: ModoRefazer; idAjusteInventario: number
  qtdeInventario: number; contagemLancada: number; saldoAntes: number
  vendasDepois: { n: number; soma: number }; outrosDepois: { n: number; soma: number; origens: string[] }
  contagemCerta: number; quan: number; tipo: 'ENT' | 'SAI' | null; quantidade: number; cmc: number
  excluir: number[]; semMovimento: boolean; fimDoDia: number; avisos: string[]
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const ORIGEM_VENDA = new Set(['PDV', 'OPS', 'OPE'])
const NOME_ORIGEM: Record<string, string> = { COM: 'nota de compra', RRE: 'nota de entrada', AJU: 'ajuste manual', TRF: 'transferência', PDV: 'venda', OPS: 'consumo de OP', OPE: 'produção' }
export const fmtQ = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6, useGrouping: false }).format(n)
const fmtSinal = (n: number) => (n > 0 ? `+${fmtQ(n)}` : fmtQ(n))

export function planejarRefazer(e: EntradaPlano): Plano | { erro: string } {
  const movs = e.movs.filter((x) => !x.cancelado)
  const correcoes = [...new Set((e.correcoes ?? []).map(Number))].filter((id) => id !== e.idAjusteInventario)
  const vendasAju = new Set([...(e.vendasAju ?? [])].map(Number))
  let idx = movs.findIndex((x) => x.idAjuste === e.idAjusteInventario)
  let saldoAntes: number, qtdeInv: number, contagemLancada: number, cmc: number | null, depoisDe: number
  let semMovimento = false
  if (idx >= 0) {
    const inv = movs[idx]
    if (inv.codOrigem !== 'AJU') return { erro: `O lançamento ${e.idAjusteInventario} não é um ajuste de estoque (${NOME_ORIGEM[inv.codOrigem] ?? inv.codOrigem}): não é refeito por aqui.` }
    if (inv.saldo == null) return { erro: 'O Omie não devolveu o saldo depois do inventário: não dá para calcular.' }
    qtdeInv = Number(inv.qtde)
    contagemLancada = Number(inv.saldo)
    saldoAntes = r6(contagemLancada - qtdeInv)
    const ant = idx > 0 ? movs[idx - 1] : null
    if (ant?.saldo != null && Math.abs(Number(ant.saldo) - saldoAntes) > 1e-6) {
      return { erro: `O kardex do Omie deste dia não fecha antes do inventário (saldo ${fmtQ(Number(ant.saldo))} e depois ${fmtQ(saldoAntes)}): movimentos lançados fora de ordem. Corrija à mão no Omie.` }
    }
    cmc = inv.cmc ?? ant?.cmc ?? null
    depoisDe = idx + 1
  } else {
    // Contagem igual ao saldo: o Omie não gera movimento. Posição pelo id (ids crescem na ordem em que entram).
    if (e.contagemDb == null) return { erro: `O inventário (ajuste ${e.idAjusteInventario}) não está no kardex do Omie nesse dia: já foi excluído ou mudou de data.` }
    idx = movs.findIndex((x) => x.idMov > e.idAjusteInventario)
    if (idx < 0) idx = movs.length
    const ant = idx > 0 ? movs[idx - 1] : null
    if (!ant || ant.saldo == null || Math.abs(Number(ant.saldo) - Number(e.contagemDb)) > 1e-6) {
      return { erro: `O inventário (ajuste ${e.idAjusteInventario}) não aparece no kardex do Omie e o saldo antes dele não bate com a contagem: confira no Omie.` }
    }
    qtdeInv = 0
    contagemLancada = Number(e.contagemDb)
    saldoAntes = contagemLancada
    cmc = ant.cmc
    depoisDe = idx
    semMovimento = true
  }

  const outrosInv = new Set([...(e.inventariosDoDia ?? [])].map(Number))
  const invDepois = movs.slice(depoisDe).find((x) => x.idAjuste != null && x.idAjuste !== e.idAjusteInventario && outrosInv.has(x.idAjuste))
  if (invDepois) return { erro: `Há outro inventário deste produto no mesmo local depois deste, no mesmo dia (ajuste ${invDepois.idAjuste}): refaça o último.` }

  const vendas = { n: 0, soma: 0 }
  const outros = { n: 0, soma: 0, origens: [] as string[] }
  for (const x of movs.slice(depoisDe)) {
    if (x.idAjuste != null && correcoes.includes(x.idAjuste)) continue
    const venda = ORIGEM_VENDA.has(x.codOrigem) || (x.codOrigem === 'AJU' && x.idAjuste != null && vendasAju.has(x.idAjuste))
    const alvo = venda ? vendas : outros
    alvo.n++
    alvo.soma = r6(alvo.soma + Number(x.qtde))
    if (!venda) {
      const nome = NOME_ORIGEM[x.codOrigem] ?? x.codOrigem
      if (!outros.origens.includes(nome)) outros.origens.push(nome)
    }
  }

  let contagemCerta: number
  if (e.modo === 'fim_do_dia') {
    if (vendas.n === 0) return { erro: 'Nada a corrigir: no Omie este inventário já é o último movimento de venda e produção do dia.' }
    contagemCerta = contagemLancada
  } else {
    const c = e.contagemCerta == null ? NaN : Number(e.contagemCerta)
    if (!Number.isFinite(c) || c < 0) return { erro: 'Informe a contagem certa (zero ou mais).' }
    contagemCerta = r6(c)
    if (contagemCerta === r6(contagemLancada) && vendas.n === 0 && correcoes.length === 0) return { erro: 'É a mesma contagem: nada a corrigir.' }
  }
  const quan = r6(saldoAntes + vendas.soma - contagemCerta)
  const tipo = quan > 0 ? 'SAI' : quan < 0 ? 'ENT' : null
  if (tipo && !(Number(cmc) > 0)) return { erro: 'O custo médio do movimento do inventário está zerado no Omie: corrija o custo antes de refazer.' }
  const avisos: string[] = []
  if (outros.n > 0) {
    avisos.push(`${outros.n === 1 ? '1 lançamento do dia entrou' : `${outros.n} lançamentos do dia entraram`} depois do inventário e não ${outros.n === 1 ? 'é' : 'são'} venda nem produção (${outros.origens.join(', ')}, ${fmtSinal(outros.soma)}): continua${outros.n === 1 ? '' : 'm'} valendo depois da contagem.`)
  }
  return {
    modo: e.modo, idAjusteInventario: e.idAjusteInventario, qtdeInventario: qtdeInv, contagemLancada, saldoAntes,
    vendasDepois: vendas, outrosDepois: outros, contagemCerta, quan, tipo, quantidade: Math.abs(quan), cmc: Number(cmc ?? 0),
    excluir: [...correcoes, e.idAjusteInventario], semMovimento, fimDoDia: r6(contagemCerta + outros.soma), avisos,
  }
}

export type CorrecaoAExcluir = { idAjuste: number; data: string; tipo: string; quantidade: number }

/** O passo a passo que a tela mostra antes de confirmar (e que fica gravado na linha do refazer). */
export function passosRefazer(p: Plano, c: { dataBR: string; un: string; correcoes: CorrecaoAExcluir[]; mesFechado: boolean }): string[] {
  const un = c.un ? ` ${c.un}` : ''
  const q = (n: number) => `${fmtQ(n)}${un}`
  const passos: string[] = []
  for (const x of c.correcoes) {
    passos.push(`Excluir o ajuste de correção ${x.idAjuste} lançado em ${x.data} (${x.tipo === 'ENT' ? 'entrada' : 'saída'} de ${q(Math.abs(x.quantidade))}).`)
  }
  passos.push(p.semMovimento
    ? `Excluir o inventário de ${c.dataBR} (ajuste ${p.idAjusteInventario}): a contagem de ${q(p.contagemLancada)} bateu com o saldo e não mexeu nele.`
    : `Excluir o inventário de ${c.dataBR} (ajuste ${p.idAjusteInventario}): ele deixou o saldo em ${q(p.contagemLancada)} (${p.qtdeInventario >= 0 ? 'entrada' : 'saída'} de ${q(Math.abs(p.qtdeInventario))}).`)
  if (p.vendasDepois.n > 0) {
    passos.push(`Contar antes do inventário ${p.vendasDepois.n === 1 ? 'a venda/produção' : `as ${p.vendasDepois.n} vendas/produções`} do dia que o Omie registrou depois dele (${fmtSinal(p.vendasDepois.soma)}).`)
  }
  const conta = `saldo antes ${fmtQ(p.saldoAntes)}${p.vendasDepois.n ? ` ${p.vendasDepois.soma < 0 ? '−' : '+'} ${fmtQ(Math.abs(p.vendasDepois.soma))} das vendas` : ''} − contagem ${fmtQ(p.contagemCerta)}`
  passos.push(p.tipo
    ? `Lançar o inventário refeito em ${c.dataBR}, no fim do dia: ${p.tipo === 'SAI' ? 'saída' : 'entrada'} de ${q(p.quantidade)} (${conta}), motivo Inventário, custo de R$ ${fmtQ(p.cmc)} por unidade.`
    : `Não lançar nada: o saldo antes do inventário (${conta.replace(/ − contagem.*/, '')}) já é a contagem certa, ${q(p.contagemCerta)}.`)
  passos.push(`Resultado: o dia ${c.dataBR} termina com ${q(p.fimDoDia)}${p.outrosDepois.n ? ` (a contagem ${fmtQ(p.contagemCerta)} ${p.outrosDepois.soma < 0 ? '−' : '+'} ${fmtQ(Math.abs(p.outrosDepois.soma))} lançados depois dela)` : ''}. Os dias seguintes acompanham a diferença.`)
  if (c.mesFechado) passos.push(`O mês ${c.dataBR.slice(3)} já foi enviado à contabilidade: o saldo daquele mês muda (correção pedida pelo dono). Notas fiscais não são mexidas.`)
  return passos
}

export function obsRefazer(p: Plano, dataBR: string): string {
  const base = p.modo === 'fim_do_dia'
    ? `Inventário de ${dataBR} refeito no fim do dia: contagem ${fmtQ(p.contagemCerta)} (${p.vendasDepois.n === 1 ? '1 venda do dia tinha entrado' : `${p.vendasDepois.n} vendas do dia tinham entrado`} depois dele)`
    : `Inventário de ${dataBR} refeito: contagem ${fmtQ(p.contagemCerta)} (tinha sido lançada como ${fmtQ(p.contagemLancada)})`
  return `${base} · Central de correções`.slice(0, 400)
}

export type EstadoEscrita = {
  excluir: number[]; excluidos: number[]; tipo: 'ENT' | 'SAI' | null; idNovo: number | null
  pendente: { acao: 'excluir' | 'incluir'; id?: number } | null
}
export type ProximaEscrita = { acao: 'excluir'; id: number } | { acao: 'conferir_inclusao' } | { acao: 'incluir' } | { acao: 'fim' }

/**
 * Próxima escrita no Omie, uma por vez. Exclusão repetida é segura (ajuste que não existe mais = ok). Inclusão que
 * ficou sem resposta NUNCA é repetida às cegas: primeiro confere no Omie pelo código INVR-<id>.
 */
export function proximaEscrita(s: EstadoEscrita): ProximaEscrita {
  const falta = s.excluir.find((id) => !s.excluidos.includes(id))
  if (falta != null) return { acao: 'excluir', id: falta }
  if (!s.tipo || s.idNovo != null) return { acao: 'fim' }
  return s.pendente?.acao === 'incluir' ? { acao: 'conferir_inclusao' } : { acao: 'incluir' }
}

/** O que a pessoa viu e confirmou: se mudar até a hora de executar, a tela mostra o passo a passo novo. */
export const assinaturaPlano = (p: Plano) => `${p.modo}|${p.excluir.join(',')}|${p.quan}|${p.contagemCerta}`
export const codIntRefazer = (id: number) => `INVR-${id}`
