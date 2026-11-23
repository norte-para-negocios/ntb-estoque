// Roteamento do titulo de cartao para a conta corrente da maquininha (Omie).
// Logica pura (sem rede, sem banco): casar a conta pelo nome e decidir se o
// titulo criado pelo ImportarNFCe pode ser movido. A parte com chamadas fica em
// roteamento-cartao.ts.

export type ContaCorrenteOmie = {
  nCodCC: number
  descricao: string
  tipo_conta_corrente?: string // "AC" = administradora de cartao, "CX" = caixa
  inativo?: string // "S" | "N"
  pdv_dias_venc?: number // prazo padrao de recebimento da conta (dias), configurado no Omie
}

/** Minusculo, sem acento, so letras/numeros separados por espaco. */
export function normalizarNome(s: string): string {
  return ` ${String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `
}

const APELIDOS_MAQUININHA: Record<string, string[]> = {
  getnet: ['getnet', 'get net'],
  rede: ['rede'],
  cielo: ['cielo'],
  stone: ['stone'],
  pagseguro: ['pagseguro', 'pag seguro', 'pagbank'],
  mercadopago: ['mercadopago', 'mercado pago'],
  sumup: ['sumup', 'sum up'],
}

const APELIDOS_BANDEIRA: Record<string, string[]> = {
  visa: ['visa'],
  mastercard: ['mastercard', 'master card', 'master', 'matercard', 'maestro'],
  elo: ['elo'],
  amex: ['amex', 'american express'],
  hipercard: ['hipercard', 'hiper'],
  alelo: ['alelo'],
  sodexo: ['sodexo'],
  ticket: ['ticket'],
  vr: ['vr'],
}

function chave(s: string): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
}

function apelidos(tabela: Record<string, string[]>, valor: string): string[] {
  const k = chave(valor)
  if (tabela[k]) return tabela[k]
  // chave desconhecida: usa o proprio texto como apelido (so se nao vazio)
  const n = normalizarNome(valor).trim()
  return n ? [n] : []
}

function contem(nomeNormalizado: string, apelido: string): boolean {
  const a = normalizarNome(apelido)
  return nomeNormalizado.includes(a)
}

export type TipoCartao = 'credito' | 'debito' | 'vale'

/** tPag SEFAZ: 03 credito, 04 debito, 10/11/12 vale (refeicao, alimentacao, presente). Outro = nao e cartao. */
export function tipoDoTPag(tPag: string): TipoCartao | null {
  const t = String(tPag ?? '').padStart(2, '0')
  if (t === '03') return 'credito'
  if (t === '04') return 'debito'
  if (t === '10' || t === '11' || t === '12') return 'vale'
  return null
}

/** tPag SEFAZ 17 = Pix. */
export function ehPix(tPag: string): boolean {
  return String(tPag ?? '').padStart(2, '0') === '17'
}

/** Regra de recebimento por conta (tabela omie_contas_regras). taxa_percentual fica guardada para uso futuro. */
export type RegraConta = { prazo_dias: number; taxa_percentual?: number | null }

/** Conta Pix configurada da loja: precisa existir na lista e estar ativa (qualquer tipo). */
export function casarContaPix(contas: ContaCorrenteOmie[], contaPix: number | null | undefined): ResultadoCasamento {
  if (!contaPix) return { ok: false, motivo: 'loja sem conta Pix configurada' }
  const c = contas.find((x) => Number(x.nCodCC) === Number(contaPix))
  if (!c) return { ok: false, motivo: `conta Pix ${contaPix} nao esta na lista de contas` }
  if (String(c.inativo ?? 'N').toUpperCase() === 'S') return { ok: false, motivo: `conta Pix "${c.descricao}" esta inativa` }
  return { ok: true, conta: c }
}

/**
 * Prazo em dias corridos da conta de destino: tabela de regras primeiro, depois
 * pdv_dias_venc da propria conta (so se > 0, pois 0 e o padrao de conta sem configuracao),
 * senao null (nao mexe nas datas).
 */
export function escolherPrazoDias(conta: ContaCorrenteOmie, regras: Map<number, RegraConta>): number | null {
  const r = regras.get(Number(conta.nCodCC))
  if (r && Number.isFinite(Number(r.prazo_dias)) && Number(r.prazo_dias) >= 0) return Number(r.prazo_dias)
  const pdv = Number(conta.pdv_dias_venc)
  if (Number.isFinite(pdv) && pdv > 0) return pdv
  return null
}

/** dd/mm/aaaa + dias corridos -> dd/mm/aaaa. Data invalida -> null. */
export function somarDiasBR(data: string | undefined, dias: number): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(data ?? '').trim())
  if (!m) return null
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const base = new Date(Date.UTC(a, mes - 1, d))
  if (base.getUTCFullYear() !== a || base.getUTCMonth() !== mes - 1 || base.getUTCDate() !== d) return null
  base.setUTCDate(base.getUTCDate() + dias)
  const dd = String(base.getUTCDate()).padStart(2, '0')
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${base.getUTCFullYear()}`
}

export type ResultadoCasamento =
  | { ok: true; conta: ContaCorrenteOmie }
  | { ok: false; motivo: string }

export function contasDeCartaoAtivas(contas: ContaCorrenteOmie[]): ContaCorrenteOmie[] {
  return contas.filter((c) => String(c.tipo_conta_corrente ?? '').toUpperCase() === 'AC' && String(c.inativo ?? 'N').toUpperCase() !== 'S')
}

/** Acha a unica conta AC ativa cujo nome tem maquininha + bandeira (+ credito/debito). */
export function casarContaDoCartao(
  contas: ContaCorrenteOmie[],
  p: { acquirer: string; brand?: string | null; tPag: string }
): ResultadoCasamento {
  const tipo = tipoDoTPag(p.tPag)
  if (!tipo) return { ok: false, motivo: `tPag ${p.tPag} nao e cartao` }
  const acq = apelidos(APELIDOS_MAQUININHA, p.acquirer)
  if (!acq.length) return { ok: false, motivo: 'maquininha vazia' }
  if (!p.brand || !String(p.brand).trim()) return { ok: false, motivo: 'bandeira nao informada' }
  const bandeira = apelidos(APELIDOS_BANDEIRA, p.brand)

  const candidatas = contasDeCartaoAtivas(contas).filter((c) => {
    const n = normalizarNome(c.descricao)
    if (!acq.some((a) => contem(n, a))) return false
    if (!bandeira.some((b) => contem(n, b))) return false
    if (tipo === 'credito') return contem(n, 'credito') && !contem(n, 'debito')
    if (tipo === 'debito') return contem(n, 'debito') && !contem(n, 'credito')
    return true // vale: nao exige credito/debito
  })
  if (candidatas.length === 1) return { ok: true, conta: candidatas[0] }
  const alvo = `${p.acquirer}/${p.brand}/${tipo}`
  if (candidatas.length === 0) return { ok: false, motivo: `nenhuma conta AC ativa casa com ${alvo}` }
  return { ok: false, motivo: `${candidatas.length} contas casam com ${alvo} (ambiguo): ${candidatas.map((c) => c.descricao).join(' | ')}` }
}

export type TituloConsultado = {
  codigo_lancamento_omie?: number
  chave_nfe?: string
  valor_documento?: number
  id_conta_corrente?: number
  codigo_cliente_fornecedor?: number
  data_vencimento?: string
  data_previsao?: string
  data_emissao?: string
  codigo_categoria?: string
}

/** O Omie as vezes aninha o titulo em `cabecalho`; aceita os dois formatos. */
export function titulo(r: unknown): TituloConsultado {
  const o = (r ?? {}) as Record<string, unknown>
  const base = (o.cabecalho && typeof o.cabecalho === 'object' ? { ...o, ...(o.cabecalho as object) } : o) as TituloConsultado
  return base
}

export type DecisaoAlteracao =
  | { alterar: true; payload: Record<string, unknown>; vencimentoNovo: string | null }
  | { alterar: false; motivo: string }

/**
 * Decide se o titulo pode ser movido para a conta da maquininha.
 * So mexe se: a chave da nota e o valor batem, e a conta atual ainda e a da
 * importacao (conta de caixa CX). Se alguem ja mexeu, nao toca.
 */
export function decidirAlteracaoDoTitulo(p: {
  titulo: TituloConsultado
  chNFe: string
  vPag: number
  contaDestino: ContaCorrenteOmie
  contasPorId: Map<number, ContaCorrenteOmie>
  /** Dias corridos apos a emissao para vencimento/previsao; null/ausente = nao mexe nas datas. */
  prazoDias?: number | null
}): DecisaoAlteracao {
  const t = p.titulo
  if (!t.codigo_lancamento_omie) return { alterar: false, motivo: 'titulo sem codigo_lancamento_omie' }
  if (String(t.chave_nfe ?? '') !== p.chNFe) return { alterar: false, motivo: `chave_nfe do titulo (${t.chave_nfe ?? 'vazia'}) difere da nota` }
  if (Math.abs(Number(t.valor_documento) - p.vPag) > 0.01) return { alterar: false, motivo: `valor do titulo (${t.valor_documento}) difere do pagamento (${p.vPag})` }
  const atual = Number(t.id_conta_corrente)
  if (atual === p.contaDestino.nCodCC) return { alterar: false, motivo: 'titulo ja esta na conta da maquininha' }
  const contaAtual = p.contasPorId.get(atual)
  if (!contaAtual) return { alterar: false, motivo: `conta atual ${atual} nao esta na lista de contas; nao toca` }
  if (String(contaAtual.tipo_conta_corrente ?? '').toUpperCase() !== 'CX') {
    return { alterar: false, motivo: `conta atual "${contaAtual.descricao}" nao e caixa (CX); alguem ja mexeu` }
  }
  if (!t.codigo_cliente_fornecedor || !t.data_vencimento || !t.codigo_categoria) {
    return { alterar: false, motivo: 'consulta sem campos obrigatorios (cliente, vencimento ou categoria)' }
  }
  const novoVenc = p.prazoDias == null ? null : somarDiasBR(t.data_emissao, p.prazoDias)
  const payload: Record<string, unknown> = {
    codigo_lancamento_omie: t.codigo_lancamento_omie,
    id_conta_corrente: p.contaDestino.nCodCC,
    codigo_cliente_fornecedor: t.codigo_cliente_fornecedor,
    data_vencimento: novoVenc ?? t.data_vencimento,
    valor_documento: t.valor_documento,
    codigo_categoria: t.codigo_categoria,
  }
  // Taxa da maquininha nao e gravada: conta_receber_cadastro do Omie nao tem campo de taxa.
  if (novoVenc) payload.data_previsao = novoVenc
  return { alterar: true, payload, vencimentoNovo: novoVenc }
}
