// Correções automáticas (robô "faxina", 08/10/2026): tipos, validação do payload de ingestão e textos da tela /correcoes.
// Módulo PURO (sem alias `@/`, sem dependências) para rodar em `node --test lib/correcoes.test.ts`.

export const MODULOS = ['faxina', 'lancarPI', 'corrigirAzeite', 'relatorios'] as const
export const STATUS = ['ok', 'falhou', 'parado', 'pendente_decisao', 'desfeito'] as const
export type Modulo = (typeof MODULOS)[number]
export type StatusCorrecao = (typeof STATUS)[number]

export const MAX_LINHAS = 500

export const MODULO_LABEL: Record<Modulo, string> = {
  faxina: 'Faxina',
  lancarPI: 'Lançar PI',
  corrigirAzeite: 'Corrigir azeite',
  relatorios: 'Relatórios',
}

export const STATUS_LABEL: Record<StatusCorrecao, string> = {
  ok: 'Corrigido',
  falhou: 'Falhou',
  parado: 'Parado',
  pendente_decisao: 'Aguardando decisão',
  desfeito: 'Desfeito',
}

/** Orientação mostrada na fila "Precisa de decisão". A tela não executa nada: quem age é a pessoa, no Omie/Norte. */
export const STATUS_ORIENTACAO: Partial<Record<StatusCorrecao, string>> = {
  parado: 'O robô parou de propósito e não mexeu no Omie. Confira o motivo, ajuste o cadastro ou o lançamento e avise quem opera a faxina para rodar de novo.',
  pendente_decisao: 'O robô achou o problema mas não sabe qual é a correta. Decida o valor certo no Omie (ou diga a quem opera a faxina) e confirme que pode corrigir.',
}

export const STATUS_PRECISA_DECISAO: StatusCorrecao[] = ['parado', 'pendente_decisao']

export type LinhaCorrecao = {
  lote: string
  modulo: Modulo
  acao: string
  produto_cod: string
  produto_desc: string | null
  data_ref: string
  quantidade: number | null
  de_valor: number | null
  para_valor: number | null
  status: StatusCorrecao
  motivo: string | null
  omie_ref: string
  origem_ts: string
  dados: Record<string, unknown> | null
}

export type ResultadoValidacao =
  | { ok: true; linhas: LinhaCorrecao[] }
  | { ok: false; erros: string[] }

const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/
const MAX_TEXTO = 2000
const MAX_DADOS_BYTES = 20_000

function textoOpcional(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || v.length > max) return undefined
  return v
}

function numeroOpcional(v: unknown): number | null | undefined {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v
}

function dataValida(s: string): boolean {
  if (!ISO_DATA.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Data (YYYY-MM-DD) em America/Sao_Paulo de um instante ISO. */
export function dataBR(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  return p
}

/**
 * Valida o corpo `{ linhas: [...] }`. Qualquer campo `loja_id` enviado é ignorado de propósito:
 * a loja SEMPRE vem da chave de integração. Retorna todos os erros (até 20) por índice da linha.
 */
export function validarLinhas(body: unknown): ResultadoValidacao {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { linhas?: unknown }).linhas)) {
    return { ok: false, erros: ['Corpo deve ser { "linhas": [...] }'] }
  }
  const brutas = (body as { linhas: unknown[] }).linhas
  if (brutas.length === 0) return { ok: false, erros: ['linhas vazio'] }
  if (brutas.length > MAX_LINHAS) return { ok: false, erros: [`No máximo ${MAX_LINHAS} linhas por requisição (recebido ${brutas.length})`] }

  const erros: string[] = []
  const linhas: LinhaCorrecao[] = []
  brutas.forEach((raw, i) => {
    const e = (msg: string) => { if (erros.length < 20) erros.push(`linhas[${i}]: ${msg}`) }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return e('objeto esperado')
    const r = raw as Record<string, unknown>
    let bad = false
    const falha = (msg: string) => { bad = true; e(msg) }

    const lote = typeof r.lote === 'string' ? r.lote.trim() : ''
    if (!lote || lote.length > 200) falha('lote obrigatório (até 200 caracteres)')
    if (typeof r.modulo !== 'string' || !(MODULOS as readonly string[]).includes(r.modulo)) falha(`modulo deve ser um de ${MODULOS.join('|')}`)
    const acao = typeof r.acao === 'string' ? r.acao.trim() : ''
    if (!acao || acao.length > 200) falha('acao obrigatória (até 200 caracteres)')
    if (typeof r.status !== 'string' || !(STATUS as readonly string[]).includes(r.status)) falha(`status deve ser um de ${STATUS.join('|')}`)

    const produtoCod = textoOpcional(r.produto_cod, 200)
    const produtoDesc = textoOpcional(r.produto_desc, 500)
    const motivo = textoOpcional(r.motivo, MAX_TEXTO)
    const omieRef = textoOpcional(r.omie_ref, 200)
    if (produtoCod === undefined) falha('produto_cod inválido')
    if (produtoDesc === undefined) falha('produto_desc inválido')
    if (motivo === undefined) falha('motivo inválido')
    if (omieRef === undefined) falha('omie_ref inválido')

    const quantidade = numeroOpcional(r.quantidade)
    const de = numeroOpcional(r.de_valor)
    const para = numeroOpcional(r.para_valor)
    if (quantidade === undefined) falha('quantidade deve ser número')
    if (de === undefined) falha('de_valor deve ser número')
    if (para === undefined) falha('para_valor deve ser número')

    const origem = typeof r.origem_ts === 'string' ? new Date(r.origem_ts) : null
    if (!origem || Number.isNaN(origem.getTime())) falha('origem_ts deve ser data/hora ISO 8601')
    const origemIso = origem && !Number.isNaN(origem.getTime()) ? origem.toISOString() : ''

    let dataRef: string | null = null
    if (r.data_ref === undefined || r.data_ref === null || r.data_ref === '') {
      dataRef = origemIso ? dataBR(origemIso) : null
    } else if (typeof r.data_ref === 'string' && dataValida(r.data_ref)) {
      dataRef = r.data_ref
    } else {
      falha('data_ref deve ser YYYY-MM-DD válido')
    }

    let dados: Record<string, unknown> | null = null
    if (r.dados !== undefined && r.dados !== null) {
      if (typeof r.dados !== 'object' || Array.isArray(r.dados)) falha('dados deve ser objeto')
      else if (JSON.stringify(r.dados).length > MAX_DADOS_BYTES) falha(`dados excede ${MAX_DADOS_BYTES} caracteres`)
      else dados = r.dados as Record<string, unknown>
    }

    if (bad || !dataRef) return
    linhas.push({
      lote,
      modulo: r.modulo as Modulo,
      acao,
      produto_cod: (produtoCod as string | null) ?? '',
      produto_desc: produtoDesc as string | null,
      data_ref: dataRef,
      quantidade: quantidade as number | null,
      de_valor: de as number | null,
      para_valor: para as number | null,
      status: r.status as StatusCorrecao,
      motivo: motivo as string | null,
      omie_ref: (omieRef as string | null) ?? '',
      origem_ts: origemIso,
      dados,
    })
  })

  if (erros.length) return { ok: false, erros }

  // Duas linhas com a mesma chave no MESMO lote de envio fariam o upsert falhar ("cannot affect row a second time"):
  // fica a última (reenvio mais novo vence).
  const mapa = new Map<string, LinhaCorrecao>()
  for (const l of linhas) mapa.set(JSON.stringify([l.lote, l.acao, l.produto_cod, l.data_ref, l.omie_ref]), l)
  return { ok: true, linhas: [...mapa.values()] }
}

/** Id numérico de OP guardado em dados.op_id (só então a tela linka a OP). */
export function opIdDe(dados: unknown): number | null {
  if (!dados || typeof dados !== 'object') return null
  const v = (dados as Record<string, unknown>).op_id
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

/** Linhas do robô por produto (`produto_cod` = código do cadastro ou codigo_produto do Omie) → índices em `linhas`. */
export function ligarRoboAosProdutos(linhas: { produto_cod: string }[], codPorCodigo: Map<string, number>): Map<number, number[]> {
  const m = new Map<number, number[]>()
  linhas.forEach((l, i) => {
    const cod = codPorCodigo.get((l.produto_cod ?? '').trim())
    if (cod == null) return
    m.set(cod, [...(m.get(cod) ?? []), i])
  })
  return m
}
