// Gabarito do financeiro (ticket 09): lógica PURA, sem banco, sem rede, sem imports do ERP.
// Refaz títulos a pagar, títulos a receber, baixas e saldos de conta a partir dos DOCUMENTOS de origem
// (notas de entrada, vendas, pagamentos, recebimentos, lançamentos), por regra escrita à mão aqui.
// Nada daqui chama função/view/RPC do ERP: se o ERP errar, o gabarito não erra junto.
// Dinheiro sempre em centavos inteiros.

export const cent = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? Math.round(Number((n * 100).toPrecision(15))) : NaN
}

/** 'dd/mm/aaaa' ou 'aaaa-mm-dd...' → 'aaaa-mm-dd'; data impossível (31/02) ou texto qualquer → null. */
export function dataISO(v: unknown): string | null {
  const t = String(v ?? '').trim()
  let iso: string | null = null
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) iso = `${br[3]}-${br[2]}-${br[1]}`
  const is = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (is) iso = `${is[1]}-${is[2]}-${is[3]}`
  if (!iso) return null
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso
}

/** Hoje no fuso da Bahia (o ERP conta atraso por esse dia). */
export function hojeBahia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

// ---------------------------------------------------------------------------------------------- títulos a pagar
export type Duplicata = { dVencimento?: unknown; vParcela?: unknown }
export type ParcelaEsperada = { parcela: number; totalParcelas: number; vencimento: string; valorCent: number; regra: 'duplicatas' | 'sem_duplicata' }

/**
 * Uma parcela por duplicata do XML, na ordem; duplicata sem valor (<= 0 ou ilegível) é ignorada e a numeração conta só as
 * válidas; sem vencimento válido vence na emissão. Sem nenhuma duplicata válida: uma parcela só, no total da nota, vencendo
 * na emissão. Sem valor e sem duplicata: nada.
 */
export function parcelasDaNota(duplicatas: Duplicata[], totalNota: unknown, emissao: unknown, hoje: string): ParcelaEsperada[] {
  const base = dataISO(emissao) ?? hoje
  const validas = duplicatas
    .map((d) => ({ venc: dataISO(d?.dVencimento) ?? base, valorCent: cent(d?.vParcela) }))
    .filter((d) => Number.isFinite(d.valorCent) && d.valorCent > 0)
  if (validas.length) return validas.map((d, i) => ({ parcela: i + 1, totalParcelas: validas.length, vencimento: d.venc, valorCent: d.valorCent, regra: 'duplicatas' as const }))
  const total = cent(totalNota)
  if (Number.isFinite(total) && total > 0) return [{ parcela: 1, totalParcelas: 1, vencimento: base, valorCent: total, regra: 'sem_duplicata' }]
  return []
}

export type CompraDoc = {
  compraId: number
  notaId: number | null
  status: string
  lancadaEm: string | null // ISO com fuso
  emissaoCompra: string | null
  valorTotalCompra: unknown
  // da nota fiscal (notas_fiscais); null se a nota não existe ou foi apagada
  nota: { emissao: string | null; valorNfe: unknown; fullObject: any; apagada: boolean } | null
  temItens: boolean
  algumItemGeraConta: boolean
}
export type RegraLoja = { ligada: boolean; ligadaDesde: string | null } // ligadaDesde: instante ISO a partir do qual o gatilho existia

export type TituloEsperado = ParcelaEsperada & { notaId: number; compraId: number }

/** Quais títulos a pagar as notas de entrada DEVEM ter gerado, pela regra escrita no plano (sem carga retroativa). */
export function titulosPagarEsperados(compras: CompraDoc[], regra: RegraLoja, hoje: string): { esperados: TituloEsperado[]; semGerar: { compraId: number; motivo: string }[] } {
  const esperados: TituloEsperado[] = []
  const semGerar: { compraId: number; motivo: string }[] = []
  for (const c of [...compras].sort((a, b) => a.compraId - b.compraId)) {
    const nao = (motivo: string) => semGerar.push({ compraId: c.compraId, motivo })
    if (!regra.ligada) { nao('chave da loja desligada'); continue }
    if (!['lancada', 'parcial'].includes(c.status)) { nao(`status ${c.status}`); continue }
    if (c.notaId === null || !c.nota || c.nota.apagada) { nao('sem nota fiscal ativa'); continue }
    if (regra.ligadaDesde && c.lancadaEm && Date.parse(c.lancadaEm) < Date.parse(regra.ligadaDesde)) { nao('lançada antes da chave ligar (sem carga retroativa)'); continue }
    if (String(c.nota.fullObject?.infoCadastro?.cCancelada ?? 'N') === 'S') { nao('nota cancelada na SEFAZ'); continue }
    if (c.temItens && !c.algumItemGeraConta) { nao('nenhum item gera conta a pagar'); continue }
    const lista: Duplicata[] = Array.isArray(c.nota.fullObject?.parcelas?.parcelasLista) ? c.nota.fullObject.parcelas.parcelasLista : []
    const total = c.nota.valorNfe !== null && c.nota.valorNfe !== undefined ? c.nota.valorNfe : c.valorTotalCompra
    const ps = parcelasDaNota(lista, total, c.nota.emissao ?? c.emissaoCompra, hoje)
    if (!ps.length) { nao('nota sem valor e sem duplicata'); continue }
    for (const p of ps) esperados.push({ ...p, notaId: c.notaId, compraId: c.compraId })
  }
  return { esperados, semGerar }
}

export type TituloPagarDoc = {
  id: number; valorCent: number; vencimento: string; cancelado: boolean; origemTipo: string; origemId: number | null; parcela: number
}
export type PagamentoDoc = { tituloId: number; principalCent: number; estornado: boolean }

export type SituacaoPagar = 'aberto' | 'parcial' | 'pago' | 'atrasado' | 'cancelado'
export function situacaoPagar(valorCent: number, quitadoCent: number, cancelado: boolean, vencimento: string, hoje: string): SituacaoPagar {
  if (cancelado) return 'cancelado'
  if (quitadoCent >= valorCent && quitadoCent > 0) return 'pago'
  if (vencimento < hoje) return 'atrasado'
  return quitadoCent > 0 ? 'parcial' : 'aberto'
}

export type TituloPagarCalculado = TituloPagarDoc & { quitadoCent: number; restanteCent: number; situacao: SituacaoPagar }

/** Quitado = soma das baixas NÃO estornadas. Restante = valor − quitado (0 se cancelado). */
export function calcularTitulosPagar(titulos: TituloPagarDoc[], pagamentos: PagamentoDoc[], hoje: string): TituloPagarCalculado[] {
  const quitado = new Map<number, number>()
  for (const p of pagamentos) if (!p.estornado) quitado.set(p.tituloId, (quitado.get(p.tituloId) ?? 0) + p.principalCent)
  return titulos.map((t) => {
    const q = quitado.get(t.id) ?? 0
    return { ...t, quitadoCent: q, restanteCent: t.cancelado ? 0 : t.valorCent - q, situacao: situacaoPagar(t.valorCent, q, t.cancelado, t.vencimento, hoje) }
  })
}

export type TotaisPagar = { quantidade: number; faltaPagarCent: number; atrasadoCent: number; quantidadeAtrasada: number; jaPagoCent: number }
export function totaisPagar(ts: TituloPagarCalculado[]): TotaisPagar {
  const ativos = ts.filter((t) => !t.cancelado)
  const atrasados = ts.filter((t) => t.situacao === 'atrasado')
  return {
    quantidade: ts.length,
    faltaPagarCent: ativos.reduce((a, t) => a + t.restanteCent, 0),
    atrasadoCent: atrasados.reduce((a, t) => a + (t.valorCent - t.quitadoCent), 0),
    quantidadeAtrasada: atrasados.length,
    jaPagoCent: ts.reduce((a, t) => a + t.quitadoCent, 0),
  }
}

export type Divergencia = { chave: string; esperado: string; mostrado: string }

/** Títulos que as notas deveriam ter gerado × títulos de nota que existem (ativos). Valor, vencimento e existência. */
export function conferirTitulosDasNotas(esperados: TituloEsperado[], atuais: TituloPagarDoc[]): Divergencia[] {
  const out: Divergencia[] = []
  const ativos = atuais.filter((t) => t.origemTipo === 'nota_entrada' && !t.cancelado)
  const chave = (nota: number | null, parcela: number) => `${nota}|${parcela}`
  const porChave = new Map<string, TituloPagarDoc[]>()
  for (const t of ativos) porChave.set(chave(t.origemId, t.parcela), [...(porChave.get(chave(t.origemId, t.parcela)) ?? []), t])
  const usados = new Set<string>()
  for (const e of esperados) {
    const k = chave(e.notaId, e.parcela)
    const achados = porChave.get(k) ?? []
    usados.add(k)
    const rotulo = `conta a pagar da nota ${e.notaId} parcela ${e.parcela}/${e.totalParcelas}`
    if (!achados.length) { out.push({ chave: rotulo, esperado: `título de ${brl(e.valorCent)} vencendo em ${e.vencimento}`, mostrado: 'nenhum título' }); continue }
    if (achados.length > 1) out.push({ chave: rotulo, esperado: 'um título ativo', mostrado: `${achados.length} títulos ativos` })
    const t = achados[0]
    if (t.valorCent !== e.valorCent || t.vencimento !== e.vencimento) {
      out.push({ chave: rotulo, esperado: `${brl(e.valorCent)} vencendo em ${e.vencimento}`, mostrado: `${brl(t.valorCent)} vencendo em ${t.vencimento}` })
    }
  }
  for (const [k, ts] of porChave) if (!usados.has(k)) out.push({ chave: `conta a pagar nº ${ts[0].id} (nota ${ts[0].origemId} parcela ${ts[0].parcela})`, esperado: 'nenhum título (nota não gera conta)', mostrado: `título ativo de ${brl(ts[0].valorCent)}` })
  return out
}

export function brl(c: number): string {
  const s = (Math.abs(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${c < 0 ? '-' : ''}R$ ${s}`
}

// ------------------------------------------------------------------------------------------- títulos a receber
export type PagamentoVenda = { vendaId: number; data: string; metodo: string | null; bandeira: string | null; valorCent: number; cancelada: boolean; devolvida: boolean }
export const FORMAS = ['dinheiro', 'pix', 'debito', 'credito', 'voucher', 'app_entrega', 'outros'] as const
export type Forma = (typeof FORMAS)[number]

export function formaDoPagamento(metodo: string | null, bandeira: string | null): Forma {
  const m = (metodo ?? '').trim().toUpperCase()
  const b = (bandeira ?? '').trim().toLowerCase()
  if ((m === 'CREDIT' || m === 'DEBIT') && ['alelo', 'sodexo', 'ticket', 'vr'].includes(b)) return 'voucher'
  if (m === 'CREDIT') return 'credito'
  if (m === 'DEBIT') return 'debito'
  if (m === 'PIX') return 'pix'
  if (m === 'CASH') return 'dinheiro'
  if (['VOUCHER', 'MEAL_VOUCHER', 'FOOD_VOUCHER', 'VALE', 'VR', 'VA'].includes(m)) return 'voucher'
  if (['APP', 'APP_ENTREGA', 'DELIVERY_APP', 'IFOOD', 'RAPPI', 'AIQFOME', '99FOOD', 'KEETA'].includes(m)) return 'app_entrega'
  return 'outros'
}

export type ReceberEsperado = { dataVenda: string; forma: Forma; quantidade: number; brutoCent: number }
/** Um título por dia × forma. Vendas canceladas/devolvidas e pagamentos <= 0 não entram. */
export function titulosReceberEsperados(pagamentos: PagamentoVenda[], ligada: boolean): ReceberEsperado[] {
  if (!ligada) return []
  const m = new Map<string, ReceberEsperado>()
  for (const p of pagamentos) {
    if (p.cancelada || p.devolvida || !(p.valorCent > 0)) continue
    const forma = formaDoPagamento(p.metodo, p.bandeira)
    const k = `${p.data}|${forma}`
    const e = m.get(k) ?? { dataVenda: p.data, forma, quantidade: 0, brutoCent: 0 }
    e.quantidade += 1
    e.brutoCent += p.valorCent
    m.set(k, e)
  }
  return [...m.values()].sort((a, b) => (a.dataVenda < b.dataVenda ? -1 : a.dataVenda > b.dataVenda ? 1 : a.forma < b.forma ? -1 : 1))
}

export type ReceberDoc = { dataVenda: string; forma: string; quantidade: number; brutoCent: number; cancelado: boolean }
export function conferirReceber(esperados: ReceberEsperado[], atuais: ReceberDoc[]): Divergencia[] {
  const out: Divergencia[] = []
  const ativos = atuais.filter((t) => !t.cancelado)
  const k = (d: string, f: string) => `${d}|${f}`
  const mapa = new Map(ativos.map((t) => [k(t.dataVenda, t.forma), t]))
  const vistos = new Set<string>()
  for (const e of esperados) {
    const t = mapa.get(k(e.dataVenda, e.forma))
    vistos.add(k(e.dataVenda, e.forma))
    const rot = `conta a receber de ${e.dataVenda} (${e.forma})`
    if (!t) out.push({ chave: rot, esperado: `${brl(e.brutoCent)} em ${e.quantidade} pagamento(s)`, mostrado: 'nenhum título' })
    else if (t.brutoCent !== e.brutoCent || t.quantidade !== e.quantidade) out.push({ chave: rot, esperado: `${brl(e.brutoCent)} em ${e.quantidade} pagamento(s)`, mostrado: `${brl(t.brutoCent)} em ${t.quantidade} pagamento(s)` })
  }
  for (const t of ativos) if (!vistos.has(k(t.dataVenda, t.forma))) out.push({ chave: `conta a receber de ${t.dataVenda} (${t.forma})`, esperado: 'nenhum título (sem venda no dia)', mostrado: brl(t.brutoCent) })
  return out
}

export type TotaisReceber = { quantidade: number; brutoCent: number }
export const totaisReceber = (ts: ReceberDoc[]): TotaisReceber => {
  const a = ts.filter((t) => !t.cancelado)
  return { quantidade: a.length, brutoCent: a.reduce((s, t) => s + t.brutoCent, 0) }
}

// ----------------------------------------------------------------------------------------------- saldos de conta
export type ContaDoc = { id: number; nome: string; saldoInicialCent: number; ativa: boolean }
export type MovimentoDoc =
  | { tipo: 'pagamento'; contaId: number; valorCent: number; estornado: boolean }
  | { tipo: 'recebimento'; contaId: number; valorCent: number; estornado: boolean }
  | { tipo: 'avulso'; contaId: number; sentido: 'entrada' | 'saida'; valorCent: number; estornado: boolean }
  | { tipo: 'transferencia'; origemId: number; destinoId: number; valorCent: number; estornada: boolean }

/** Saldo = inicial − pagamentos + recebimentos ± avulsos ± transferências; o que foi estornado não conta (some junto do estorno). */
export function saldosDasContas(contas: ContaDoc[], movs: MovimentoDoc[]): Map<number, number> {
  const s = new Map(contas.map((c) => [c.id, c.saldoInicialCent]))
  const soma = (id: number, v: number) => s.set(id, (s.get(id) ?? 0) + v)
  for (const m of movs) {
    if (m.tipo === 'transferencia') { if (!m.estornada) { soma(m.origemId, -m.valorCent); soma(m.destinoId, m.valorCent) } continue }
    if (m.estornado) continue
    if (m.tipo === 'pagamento') soma(m.contaId, -m.valorCent)
    else if (m.tipo === 'recebimento') soma(m.contaId, m.valorCent)
    else soma(m.contaId, m.sentido === 'entrada' ? m.valorCent : -m.valorCent)
  }
  return s
}

// ------------------------------------------------------------------- espelho do Omie (Sertão): coerência interna
export type TituloOmie = { id: number; codigo: number; status: string; vencimento: string | null; valorCent: number; syncDia: string }
/** AVENCER/VENCEHOJE/ATRASADO têm de combinar com a data de vencimento no dia da cópia. PAGTO_PARCIAL vale em qualquer data. */
export function conferirStatusOmie(ts: TituloOmie[], rotulo: string): Divergencia[] {
  const out: Divergencia[] = []
  for (const t of ts) {
    if (t.status === 'PAGTO_PARCIAL' || !t.vencimento) continue
    const esperado = t.vencimento < t.syncDia ? 'ATRASADO' : t.vencimento === t.syncDia ? 'VENCEHOJE' : 'AVENCER'
    if (esperado !== t.status) out.push({ chave: `${rotulo} ${t.codigo}`, esperado: `${esperado} (vence ${t.vencimento}, cópia de ${t.syncDia})`, mostrado: t.status })
  }
  const vistos = new Set<number>()
  for (const t of ts) { if (vistos.has(t.codigo)) out.push({ chave: `${rotulo} ${t.codigo}`, esperado: 'um registro por título', mostrado: 'repetido' }); vistos.add(t.codigo) }
  return out
}
