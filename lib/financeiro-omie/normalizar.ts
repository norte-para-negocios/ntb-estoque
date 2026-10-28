// Financeiro A0 (espelho do financeiro do Omie): normalização PURA dos avisos `Financas.*` (tabela webhooks) e das
// respostas da API (ListarMovimentos, ListarCategorias, ListarCadastroDRE, ListarContasCorrentes, ListarExtrato) para
// as linhas das tabelas omie_fin_* (migration 305). Os nomes de campo são os do Omie (formato do aviso / ListarContasPagar).
// Sem imports: node --test lib/financeiro-omie/normalizar.test.ts.
//
// Formatos provados com dado real (loja 5, 27/10/2026, só leitura):
//  - aviso do título: event = objeto snake_case (codigo_lancamento_omie, valor_documento, situacao "A vencer" | "Atrasado" |
//    "Pago" | "Recebido Parcialmente" | "[SG]A vencer"…, datas "2026-10-27T00:00:00-03:00"); SEM valor pago/aberto;
//  - aviso de baixa: event = ARRAY de baixas (até 243 num aviso), cada uma com conta_a_pagar|conta_a_receber [1 título];
//  - aviso de rateio: event = {nCodTitulo, categorias:[{codigo_categoria, valor, percentual}]};
//  - lançamento/transferência de conta corrente: event = {nCodLanc, cabecalho{nCodCC,dDtLanc,nValorLanc}, detalhes{…}, …};
//  - ListarMovimentos: {detalhes{nCodTitulo, cNatureza, cStatus "A VENCER"…, datas "dd/mm/aaaa", nValorTitulo, …},
//    resumo{cLiquidado, nValPago, nValAberto, nDesconto, nJuros, nMulta}}; baixa (cTpLancamento BX) traz nCodBaixa.
//    Atenção: cStatus "RECEBIDO" pode vir com cLiquidado N e nValAberto > 0 (recebimento parcial): a situação vem do resumo.

export type Natureza = 'P' | 'R'
export type Situacao = 'aberto' | 'parcial' | 'liquidado' | 'cancelado'
export type Rateio = { codigo_categoria: string; valor: number | null; percentual: number | null }

export type LinhaTitulo = {
  codigo_lancamento_omie: number
  natureza: Natureza
  codigo_lancamento_integracao?: string | null
  codigo_cliente_fornecedor?: number | null
  codigo_categoria?: string | null
  id_conta_corrente?: number | null
  data_emissao?: string | null
  data_registro?: string | null
  data_vencimento?: string | null
  data_previsao?: string | null
  data_pagamento?: string | null
  valor_documento?: number | null
  valor_pago?: number | null
  valor_aberto?: number | null
  valor_desconto?: number | null
  valor_juros?: number | null
  valor_multa?: number | null
  liquidado?: boolean | null
  resumo_em?: string | null
  status_titulo?: string | null
  situacao?: Situacao | null
  excluido: boolean
  numero_documento?: string | null
  numero_documento_fiscal?: string | null
  numero_parcela?: string | null
  numero_pedido?: string | null
  codigo_tipo_documento?: string | null
  id_origem?: string | null
  operacao?: string | null
  chave_nfe?: string | null
  nsu?: string | null
  codigo_projeto?: number | null
  codigo_vendedor?: number | null
  codigo_titulo_repeticao?: number | null
  incluido_omie_em?: string | null
  incluido_por?: string | null
  alterado_omie_em?: string | null
  alterado_por?: string | null
  visto_aberto_em?: string | null
  categorias?: Rateio[] | null
  categorias_em?: string | null
  categorias_definidas?: boolean
  so_rateio?: boolean
  origem_dado: 'webhook' | 'api' | 'api-conferencia' | 'rateio'
  fonte_em: string | null
  webhook_id?: number | null
}

export type LinhaBaixa = {
  codigo_baixa: number
  natureza: Natureza
  codigo_lancamento_omie: number | null
  codigo_lancamento_integracao?: string | null
  codigo_baixa_integracao?: string | null
  codigo_conta_corrente?: number | null
  codigo_cliente_fornecedor?: number | null
  codigo_categoria?: string | null
  data: string | null
  data_cred?: string | null
  data_conciliacao?: string | null
  valor: number | null
  juros?: number | null
  multa?: number | null
  desconto?: number | null
  tarifa?: number | null
  codigo_mov_cc?: number | null
  observacao?: string | null
  cancelada: boolean
  origem_dado: 'webhook' | 'api'
  fonte_em: string | null
  webhook_id?: number | null
}

export type LinhaLancamentoCC = {
  n_cod_lanc: number
  c_cod_int_lanc?: string | null
  tipo: 'lancamento' | 'transferencia'
  n_cod_cc?: number | null
  n_cod_cc_destino?: number | null
  d_dt_lanc?: string | null
  n_valor_lanc?: number | null
  c_cod_categ?: string | null
  c_natureza?: string | null
  c_origem?: string | null
  c_tipo?: string | null
  c_num_doc?: string | null
  n_cod_cliente?: number | null
  c_obs?: string | null
  d_dt_conc?: string | null
  situacao?: string | null
  excluido: boolean
  origem_dado: 'webhook'
  fonte_em: string | null
  webhook_id?: number | null
}

// ------------------------------------------------------------------------------------------------- campos básicos
type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})

/** Texto aparado; vazio vira null (o Omie manda "" e campos cheios de espaço). */
export function txt(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s : null
}

/** Dinheiro/número: finito, arredondado a 2 casas; senão null. Aceita "1.234,56" e "1234.56". */
export function num(v: unknown): number | null {
  if (v == null || v === '') return null
  let n: number
  if (typeof v === 'number') n = v
  else {
    const s = String(v).trim()
    n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s)
  }
  // Fora de numeric(14,2) (lixo do Omie) vira null: um valor absurdo não pode travar o lote inteiro no banco.
  if (!Number.isFinite(n) || Math.abs(n) >= 1e12) return null
  return Math.round(n * 100) / 100
}

/** Código do Omie (inteiro positivo); 0, vazio e lixo viram null. */
export function codigo(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function dataValida(a: number, m: number, d: number): boolean {
  if (a < 1990 || a > 2100 || m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(a, m, 0)).getUTCDate()
}

/** Data do Omie → YYYY-MM-DD. Aceita "dd/mm/aaaa" (API) e "aaaa-mm-dd…" (aviso, "2026-10-27T00:00:00-03:00"). */
export function dataOmie(v: unknown): string | null {
  const s = txt(v)
  if (!s) return null
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  if (m) return dataValida(+m[3], +m[2], +m[1]) ? `${m[3]}-${m[2]}-${m[1]}` : null
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return dataValida(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null
  return null
}

/** Data + hora do Omie (hora da Bahia) → "YYYY-MM-DD HH:MM:SS" (coluna timestamp sem fuso). */
export function dataHoraOmie(d: unknown, h: unknown): string | null {
  const dia = dataOmie(d)
  if (!dia) return null
  const hm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(txt(h) ?? '')
  return hm && +hm[1] < 24 && +hm[2] < 60 ? `${dia} ${hm[1]}:${hm[2]}:${hm[3] ?? '00'}` : `${dia} 00:00:00`
}

/** Status como o Omie escreve, normalizado: sem prefixo "[SG]", maiúsculas, sem acento. */
export function statusTitulo(v: unknown): string | null {
  const s = txt(v)
  if (!s) return null
  const limpo = s.replace(/^\[[^\]]*\]\s*/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
  return limpo || null
}

/** Situação canônica pelo status do aviso (que não traz o resumo). Desconhecido = null (não muda o gravado). */
export function situacaoPorStatus(status: string | null): Situacao | null {
  if (!status) return null
  if (/CANCELAD/.test(status)) return 'cancelado'
  if (/PARCIAL/.test(status)) return 'parcial'
  if (/^(PAGO|RECEBIDO|LIQUIDADO)\b/.test(status)) return 'liquidado'
  if (/^(A VENCER|ATRASADO|VENCE HOJE|EM ?ABERTO|AVENCER|VENCEHOJE)\b/.test(status)) return 'aberto'
  return null
}

/** Situação pela API: o resumo (cLiquidado, nValAberto, nValPago) manda; o status só decide "cancelado". */
export function situacaoPorResumo(status: string | null, resumo: Obj): Situacao | null {
  if (status && /CANCELAD/.test(status)) return 'cancelado'
  const aberto = num(resumo.nValAberto)
  const pago = num(resumo.nValPago)
  if (txt(resumo.cLiquidado) === 'S') return 'liquidado'
  if (aberto != null && aberto <= 0.005 && (pago ?? 0) > 0) return 'liquidado'
  if (aberto == null && pago == null) return situacaoPorStatus(status)
  if ((pago ?? 0) > 0.005) return 'parcial'
  return 'aberto'
}

export function rateio(lista: unknown): Rateio[] | null {
  if (!Array.isArray(lista)) return null
  const out: Rateio[] = []
  for (const c of lista) {
    const o = obj(c)
    const cod = txt(o.codigo_categoria ?? o.cCodCateg)
    if (!cod) continue
    out.push({ codigo_categoria: cod, valor: num(o.valor ?? o.nDistrValor), percentual: num(o.percentual ?? o.nDistrPercentual) })
  }
  return out.length ? out : null
}

// ------------------------------------------------------------------------------------------------------- avisos
export type TipoAviso = 'titulo' | 'baixa' | 'rateio' | 'lancamento' | 'transferencia'

export function naturezaDoTopico(topic: string): Natureza | null {
  if (topic.startsWith('Financas.ContaPagar.')) return 'P'
  if (topic.startsWith('Financas.ContaReceber.')) return 'R'
  return null
}

/** O que o aviso é (null = tópico financeiro que não usamos: Rateio.Departamento, Boleto*, desconhecidos). */
export function tipoDoAviso(topic: string): TipoAviso | null {
  if (/^Financas\.Conta(Pagar|Receber)\.(Incluido|Alterado|Excluido)$/.test(topic)) return 'titulo'
  if (/^Financas\.Conta(Pagar|Receber)\.Baixa(Realizada|Cancelada)$/.test(topic)) return 'baixa'
  if (/^Financas\.Conta(Pagar|Receber)\.Rateio\.Categoria$/.test(topic)) return 'rateio'
  if (/^Financas\.ContaCorrente\.Lancamento\.(Incluido|Alterado|Excluido)$/.test(topic)) return 'lancamento'
  if (/^Financas\.ContaCorrente\.Transferencia\.(Incluido|Alterado|Excluido)$/.test(topic)) return 'transferencia'
  return null
}

export type AvisoGravado = { id: number; loja_id: number; created_at: string; message: unknown }
export type LinhasDoAviso = { titulos: LinhaTitulo[]; baixas: LinhaBaixa[]; lancamentos: LinhaLancamentoCC[]; ignorado: string | null }

/** Título a partir do event do aviso (Incluido/Alterado/Excluido). */
export function tituloDoAviso(ev: Obj, natureza: Natureza, excluido: boolean, fonteEm: string, webhookId: number | null): LinhaTitulo | null {
  const cod = codigo(ev.codigo_lancamento_omie)
  if (!cod) return null
  const status = statusTitulo(ev.situacao)
  return {
    codigo_lancamento_omie: cod,
    natureza,
    codigo_lancamento_integracao: txt(ev.codigo_lancamento_integracao),
    codigo_cliente_fornecedor: codigo(ev.codigo_cliente_fornecedor),
    codigo_categoria: txt(ev.codigo_categoria),
    id_conta_corrente: codigo(ev.id_conta_corrente),
    data_emissao: dataOmie(ev.data_emissao),
    data_registro: dataOmie(ev.data_registro ?? ev.data_entrada),
    data_vencimento: dataOmie(ev.data_vencimento),
    data_previsao: dataOmie(ev.data_previsao),
    valor_documento: num(ev.valor_documento),
    status_titulo: status,
    situacao: situacaoPorStatus(status),
    excluido,
    numero_documento: txt(ev.numero_documento),
    numero_documento_fiscal: txt(ev.numero_documento_fiscal),
    numero_parcela: txt(ev.numero_parcela),
    numero_pedido: txt(ev.numero_pedido),
    codigo_tipo_documento: txt(ev.codigo_tipo_documento),
    id_origem: txt(ev.id_origem),
    operacao: txt(ev.operacao),
    chave_nfe: txt(ev.chave_nfe),
    nsu: txt(ev.nsu),
    codigo_projeto: codigo(ev.codigo_projeto),
    codigo_vendedor: codigo(ev.codigo_vendedor),
    origem_dado: 'webhook',
    fonte_em: fonteEm,
    webhook_id: webhookId,
  }
}

/** Baixas de um aviso BaixaRealizada/BaixaCancelada (event é um array). */
export function baixasDoAviso(ev: unknown, natureza: Natureza, cancelada: boolean, fonteEm: string, webhookId: number | null): LinhaBaixa[] {
  if (!Array.isArray(ev)) return []
  const out: LinhaBaixa[] = []
  for (const b0 of ev) {
    const b = obj(b0)
    const cod = codigo(b.codigo_baixa)
    if (!cod) continue
    const titulos = (natureza === 'P' ? b.conta_a_pagar : b.conta_a_receber) as unknown
    const t = obj(Array.isArray(titulos) ? titulos[0] : titulos)
    out.push({
      codigo_baixa: cod,
      natureza,
      codigo_lancamento_omie: codigo(t.codigo_lancamento_omie),
      codigo_lancamento_integracao: txt(t.codigo_lancamento_integracao),
      codigo_baixa_integracao: txt(b.codigo_baixa_integracao),
      codigo_conta_corrente: codigo(b.codigo_conta_corrente),
      codigo_cliente_fornecedor: codigo(b.codigo_cliente_fornecedor),
      data: dataOmie(b.data),
      data_cred: dataOmie(b.data_cred),
      valor: num(b.valor),
      juros: num(b.juros),
      multa: num(b.multa),
      desconto: num(b.desconto),
      tarifa: num(b.tarifa),
      observacao: txt(b.observacao),
      cancelada,
      origem_dado: 'webhook',
      fonte_em: fonteEm,
      webhook_id: webhookId,
    })
  }
  return out
}

export function lancamentoDoAviso(ev: Obj, tipo: 'lancamento' | 'transferencia', excluido: boolean, fonteEm: string, webhookId: number | null): LinhaLancamentoCC | null {
  const cod = codigo(ev.nCodLanc)
  if (!cod) return null
  const cab = obj(ev.cabecalho), det = obj(ev.detalhes), div = obj(ev.diversos), tr = obj(ev.transferencia)
  return {
    n_cod_lanc: cod,
    c_cod_int_lanc: txt(ev.cCodIntLanc),
    tipo,
    n_cod_cc: codigo(cab.nCodCC),
    n_cod_cc_destino: codigo(tr.nCodCCDestino),
    d_dt_lanc: dataOmie(cab.dDtLanc),
    n_valor_lanc: num(cab.nValorLanc),
    c_cod_categ: txt(det.cCodCateg),
    c_natureza: txt(div.cNatureza),
    c_origem: txt(div.cOrigem),
    c_tipo: txt(det.cTipo),
    c_num_doc: txt(det.cNumDoc),
    n_cod_cliente: codigo(det.nCodCliente),
    c_obs: txt(det.cObs),
    d_dt_conc: dataOmie(div.dDtConc),
    situacao: txt(ev.situacao),
    excluido,
    origem_dado: 'webhook',
    fonte_em: fonteEm,
    webhook_id: webhookId,
  }
}

/** Um aviso gravado em `webhooks` → linhas para as tabelas do espelho. Nunca lança (aviso estranho = ignorado). */
export function linhasDoAviso(w: AvisoGravado): LinhasDoAviso {
  const vazio: LinhasDoAviso = { titulos: [], baixas: [], lancamentos: [], ignorado: null }
  const msg = obj(w.message)
  const topic = txt(msg.topic) ?? ''
  const tipo = tipoDoAviso(topic)
  if (!tipo) return { ...vazio, ignorado: `tópico não usado: ${topic || '(vazio)'}` }
  const fonte = new Date(w.created_at)
  if (Number.isNaN(fonte.getTime())) return { ...vazio, ignorado: 'created_at inválido' }
  const fonteEm = fonte.toISOString()
  const id = Number.isSafeInteger(w.id) ? w.id : null
  const nat = naturezaDoTopico(topic)
  const ev = msg.event
  if (tipo === 'titulo' && nat) {
    const t = tituloDoAviso(obj(ev), nat, topic.endsWith('.Excluido'), fonteEm, id)
    return t ? { ...vazio, titulos: [t] } : { ...vazio, ignorado: 'título sem codigo_lancamento_omie' }
  }
  if (tipo === 'baixa' && nat) {
    const b = baixasDoAviso(ev, nat, topic.endsWith('.BaixaCancelada'), fonteEm, id)
    return b.length ? { ...vazio, baixas: b } : { ...vazio, ignorado: 'baixa sem codigo_baixa' }
  }
  if (tipo === 'rateio' && nat) {
    const e = obj(ev)
    const cod = codigo(e.nCodTitulo)
    if (!cod) return { ...vazio, ignorado: 'rateio sem nCodTitulo' }
    return {
      ...vazio,
      titulos: [{
        codigo_lancamento_omie: cod, natureza: nat, excluido: false, so_rateio: true, categorias: rateio(e.categorias),
        categorias_em: fonteEm, origem_dado: 'rateio', fonte_em: fonteEm, webhook_id: id,
      }],
    }
  }
  if (tipo === 'lancamento' || tipo === 'transferencia') {
    const l = lancamentoDoAviso(obj(ev), tipo, topic.endsWith('.Excluido'), fonteEm, id)
    return l ? { ...vazio, lancamentos: [l] } : { ...vazio, ignorado: 'lançamento sem nCodLanc' }
  }
  return { ...vazio, ignorado: `tópico não usado: ${topic}` }
}

/**
 * Num lote, a mesma chave pode vir várias vezes (Incluido → Alterado → Excluido): fica só a mais nova (fonte_em,
 * depois webhook_id). O banco recusa chave repetida no mesmo lote (ON CONFLICT não atualiza a mesma linha 2×).
 */
export function ultimaPorChave<T extends { fonte_em: string | null; webhook_id?: number | null }>(linhas: T[], chave: (l: T) => string): T[] {
  const m = new Map<string, T>()
  for (const l of linhas) {
    const k = chave(l)
    const atual = m.get(k)
    if (!atual || maisNova(l, atual)) m.set(k, l)
  }
  return [...m.values()]
}
function maisNova(a: { fonte_em: string | null; webhook_id?: number | null }, b: { fonte_em: string | null; webhook_id?: number | null }): boolean {
  const fa = a.fonte_em ? Date.parse(a.fonte_em) : -Infinity, fb = b.fonte_em ? Date.parse(b.fonte_em) : -Infinity
  if (fa !== fb) return fa > fb
  return (a.webhook_id ?? -1) >= (b.webhook_id ?? -1)
}

export const chaveTitulo = (l: LinhaTitulo) => `${l.codigo_lancamento_omie}:${l.so_rateio ? 'r' : 't'}`
export const chaveBaixa = (l: LinhaBaixa) => String(l.codigo_baixa)
export const chaveLancamento = (l: LinhaLancamentoCC) => String(l.n_cod_lanc)

/** Junta as linhas de vários avisos (por loja) já sem chave repetida. */
export function juntarAvisos(lista: LinhasDoAviso[]): { titulos: LinhaTitulo[]; baixas: LinhaBaixa[]; lancamentos: LinhaLancamentoCC[]; ignorados: number } {
  const t: LinhaTitulo[] = [], b: LinhaBaixa[] = [], l: LinhaLancamentoCC[] = []
  let ignorados = 0
  for (const x of lista) {
    t.push(...x.titulos); b.push(...x.baixas); l.push(...x.lancamentos)
    if (x.ignorado) ignorados++
  }
  return { titulos: ultimaPorChave(t, chaveTitulo), baixas: ultimaPorChave(b, chaveBaixa), lancamentos: ultimaPorChave(l, chaveLancamento), ignorados }
}

// ---------------------------------------------------------------------------------------------------------- API
/** Título de um item de ListarMovimentos (cTpLancamento CPCR). `vistoAberto` = veio da varredura de abertos. */
export function tituloDoMovimento(m: unknown, lidoEm: string, opcoes: { vistoAberto?: boolean; origem?: 'api' | 'api-conferencia' } = {}): LinhaTitulo | null {
  const mov = obj(m), d = obj(mov.detalhes), r = obj(mov.resumo)
  const cod = codigo(d.nCodTitulo)
  const nat = txt(d.cNatureza)
  if (!cod || (nat !== 'P' && nat !== 'R')) return null
  const status = statusTitulo(d.cStatus)
  const cats = rateio(mov.categorias)
  const temResumo = Object.keys(r).length > 0
  return {
    codigo_lancamento_omie: cod,
    natureza: nat,
    codigo_lancamento_integracao: txt(d.cCodIntTitulo),
    codigo_cliente_fornecedor: codigo(d.nCodCliente),
    codigo_categoria: txt(d.cCodCateg),
    id_conta_corrente: codigo(d.nCodCC),
    data_emissao: dataOmie(d.dDtEmissao),
    data_registro: dataOmie(d.dDtRegistro),
    data_vencimento: dataOmie(d.dDtVenc),
    data_previsao: dataOmie(d.dDtPrevisao),
    data_pagamento: dataOmie(d.dDtPagamento),
    valor_documento: num(d.nValorTitulo),
    valor_pago: temResumo ? num(r.nValPago) ?? 0 : null,
    valor_aberto: temResumo ? num(r.nValAberto) ?? 0 : null,
    valor_desconto: temResumo ? num(r.nDesconto) ?? 0 : null,
    valor_juros: temResumo ? num(r.nJuros) ?? 0 : null,
    valor_multa: temResumo ? num(r.nMulta) ?? 0 : null,
    liquidado: temResumo ? txt(r.cLiquidado) === 'S' : null,
    resumo_em: temResumo ? lidoEm : null,
    status_titulo: status,
    situacao: temResumo ? situacaoPorResumo(status, r) : situacaoPorStatus(status),
    excluido: false,
    numero_documento: txt(d.cNumTitulo),
    numero_documento_fiscal: txt(d.cNumDocFiscal),
    numero_parcela: txt(d.cNumParcela),
    numero_pedido: txt(d.cNumOS),
    codigo_tipo_documento: txt(d.cTipo),
    id_origem: txt(d.cOrigem),
    operacao: txt(d.cOperacao),
    chave_nfe: txt(d.cChaveNFe),
    nsu: txt(d.cNSU),
    codigo_projeto: codigo(d.cCodProjeto),
    codigo_vendedor: codigo(d.cCodVendedor),
    codigo_titulo_repeticao: codigo(d.nCodTitRepet),
    incluido_omie_em: dataHoraOmie(d.dDtInc, d.cHrInc),
    incluido_por: txt(d.cUsInc),
    alterado_omie_em: dataHoraOmie(d.dDtAlt, d.cHrAlt),
    alterado_por: txt(d.cUsAlt),
    visto_aberto_em: opcoes.vistoAberto ? lidoEm : null,
    // Só com rateio na resposta: lista vazia não diz "sem rateio" (o aviso Rateio.Categoria continua valendo).
    ...(cats ? { categorias: cats, categorias_definidas: true, categorias_em: lidoEm } : {}),
    origem_dado: opcoes.origem ?? 'api',
    fonte_em: lidoEm,
  }
}

/** Baixa de um item de ListarMovimentos (cTpLancamento BX). A API não traz a tarifa (fica a do aviso). */
export function baixaDoMovimento(m: unknown, lidoEm: string): LinhaBaixa | null {
  const mov = obj(m), d = obj(mov.detalhes), r = obj(mov.resumo)
  const cod = codigo(d.nCodBaixa)
  const nat = txt(d.cNatureza)
  if (!cod || (nat !== 'P' && nat !== 'R')) return null
  return {
    codigo_baixa: cod,
    natureza: nat,
    codigo_lancamento_omie: codigo(d.nCodTitulo),
    codigo_lancamento_integracao: txt(d.cCodIntTitulo),
    codigo_conta_corrente: codigo(d.nCodCC),
    codigo_cliente_fornecedor: codigo(d.nCodCliente),
    codigo_categoria: txt(d.cCodCateg),
    data: dataOmie(d.dDtPagamento),
    data_cred: dataOmie(d.dDtCredito),
    data_conciliacao: dataOmie(d.dDtConcilia),
    valor: num(r.nValPago) ?? num(d.nValorMovCC),
    juros: num(d.nJuros) ?? 0,
    multa: num(d.nMulta) ?? 0,
    desconto: num(d.nDesconto) ?? 0,
    codigo_mov_cc: codigo(d.nCodMovCC),
    cancelada: false,
    origem_dado: 'api',
    fonte_em: lidoEm,
  }
}

const sn = (v: unknown): boolean | null => (txt(v) === 'S' ? true : txt(v) === 'N' ? false : null)

export type LinhaCategoria = Record<string, unknown> & { codigo: string }
export function categoriaDoOmie(c: unknown, lidoEm: string): LinhaCategoria | null {
  const o = obj(c), dre = obj(o.dadosDRE)
  const cod = txt(o.codigo)
  if (!cod) return null
  const nivel = Number(dre.nivelDRE)
  return {
    codigo: cod,
    descricao: txt(o.descricao),
    descricao_padrao: txt(o.descricao_padrao),
    categoria_superior: txt(o.categoria_superior),
    tipo_categoria: txt(o.tipo_categoria),
    conta_receita: sn(o.conta_receita),
    conta_despesa: sn(o.conta_despesa),
    conta_inativa: sn(o.conta_inativa),
    totalizadora: sn(o.totalizadora),
    transferencia: sn(o.transferencia),
    nao_exibir: sn(o.nao_exibir),
    definida_pelo_usuario: sn(o.definida_pelo_usuario),
    id_conta_contabil: txt(o.id_conta_contabil),
    tag_conta_contabil: txt(o.tag_conta_contabil),
    codigo_dre: txt(dre.codigoDRE) ?? txt(o.codigo_dre),
    descricao_dre: txt(dre.descricaoDRE),
    nivel_dre: Number.isInteger(nivel) && nivel > 0 ? nivel : null,
    sinal_dre: txt(dre.sinalDRE),
    totaliza_dre: sn(dre.totalizaDRE),
    nao_exibir_dre: sn(dre.naoExibirDRE),
    lido_em: lidoEm,
  }
}

export function dreDoOmie(d: unknown, lidoEm: string): Record<string, unknown> | null {
  const o = obj(d)
  const cod = txt(o.codigoDRE)
  if (!cod) return null
  const nivel = Number(o.nivelDRE)
  return {
    codigo_dre: cod, descricao_dre: txt(o.descricaoDRE), nivel_dre: Number.isInteger(nivel) && nivel > 0 ? nivel : null,
    sinal_dre: txt(o.sinalDRE), totaliza_dre: sn(o.totalizaDRE), nao_exibir_dre: sn(o.naoExibirDRE), lido_em: lidoEm,
  }
}

export function contaDoOmie(c: unknown, lidoEm: string): Record<string, unknown> | null {
  const o = obj(c)
  const cod = codigo(o.nCodCC)
  if (!cod) return null
  return {
    id_conta_corrente: cod,
    descricao: txt(o.descricao),
    tipo_conta_corrente: txt(o.tipo_conta_corrente ?? o.tipo),
    codigo_banco: txt(o.codigo_banco),
    codigo_agencia: txt(o.codigo_agencia),
    numero_conta_corrente: txt(o.numero_conta_corrente),
    inativo: sn(o.inativo),
    bloqueado: sn(o.bloqueado),
    nao_fluxo: sn(o.nao_fluxo),
    nao_resumo: sn(o.nao_resumo),
    pdv_categoria: txt(o.pdv_categoria),
    saldo_inicial: num(o.saldo_inicial),
    saldo_data: dataOmie(o.saldo_data),
    lido_em: lidoEm,
  }
}

/** Saldo de uma conta pelo ListarExtrato (cExibirApenasSaldo = S). null = resposta sem saldo. */
export function saldoDoExtrato(r: unknown, lidoEm: string): { id_conta_corrente: number; saldo_atual: number | null; saldo_conciliado: number | null; saldo_atual_previsto: number | null; saldo_em: string } | null {
  const o = obj(r)
  const cod = codigo(o.nCodCC)
  if (!cod || num(o.nSaldoAtual) == null) return null
  return { id_conta_corrente: cod, saldo_atual: num(o.nSaldoAtual), saldo_conciliado: num(o.nSaldoConciliado), saldo_atual_previsto: num(o.nSaldoAtualPrevisto), saldo_em: lidoEm }
}
