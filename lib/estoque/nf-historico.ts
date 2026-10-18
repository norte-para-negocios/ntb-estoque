// Histórico de processamento da nota de entrada (estoque próprio, Fase B, R10/F9): junta os documentos da SEFAZ, os
// eventos gravados pelas funções SQL (compras_proprio_eventos), as manifestações e o cancelamento numa linha do tempo.
// Puro: node --test lib/estoque/nf-historico.test.ts.

export type FontesHistorico = {
  documentos: { tipo: string; recebido_em: string; ciencia_em: string | null; ciencia_cstat: string | null; busca_chave_em: string | null; erro: string | null; ignorado: string | null }[]
  eventos: { tipo: string; linha: number | null; detalhe: Record<string, unknown> | null; autor: string | null; criado_em: string }[]
  manifestacoes: { tp_evento: string; status: string; cstat: string | null; protocolo: string | null; autor: string | null; criado_em: string; respondido_em: string | null }[]
  canceladaEm: string | null
  /** Nomes dos locais para o texto de "item alterado" (sem nome, mostra o código). */
  nomesLocais?: Record<number, string>
}
export type EventoHistorico = { ts: string; grupo: 'sefaz' | 'conferencia' | 'estoque' | 'manifestacao'; texto: string; autor: string | null; tom: 'ok' | 'warn' | 'err' | null; detalhe?: string }

const NOME_MANIFESTACAO: Record<string, { nome: string; feminino: boolean }> = {
  '210200': { nome: 'Confirmação da operação', feminino: true }, '210210': { nome: 'Ciência da operação', feminino: true },
  '210220': { nome: 'Desconhecimento da operação', feminino: false }, '210240': { nome: 'Operação não realizada', feminino: true },
}
const CAMPOS: Record<string, string> = {
  codigo_local_estoque: 'local', cfop_entrada: 'CFOP de entrada', quantidade_recebida: 'quantidade recebida', unidade_estoque: 'unidade',
  custo_flags: 'marcações de custo', aliq_cred_pis: 'crédito do PIS', aliq_cred_cofins: 'crédito do COFINS', movimenta_estoque: 'movimenta estoque',
  gera_conta_pagar: 'gera conta a pagar',
}
const itens = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`
const n = (v: unknown) => Number(v ?? 0) || 0

function valorCampo(campo: string, v: unknown, nomes?: Record<number, string>): string {
  if (v == null || v === '') return '—'
  if (campo === 'codigo_local_estoque') return nomes?.[Number(v)] ?? String(v)
  if (campo === 'cfop_entrada' && /^\d{4}$/.test(String(v))) return `${String(v)[0]}.${String(v).slice(1)}`
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  return String(v)
}

function detalheConfigurado(d: Record<string, unknown> | null, nomes?: Record<number, string>): string | undefined {
  const de = (d?.de ?? {}) as Record<string, unknown>, para = (d?.para ?? {}) as Record<string, unknown>
  const partes = Object.keys(para).map((k) => `${CAMPOS[k] ?? k}: ${valorCampo(k, de[k], nomes)} → ${valorCampo(k, para[k], nomes)}`)
  return partes.length ? partes.join('; ') : undefined
}

export function montarHistoricoNF(f: FontesHistorico): EventoHistorico[] {
  const out: (EventoHistorico & { ordem: number })[] = []
  let ordem = 0
  const add = (e: EventoHistorico) => out.push({ ...e, ordem: ordem++ })

  for (const d of f.documentos) {
    const texto = d.tipo === 'resNFe' ? 'Resumo da nota recebido da SEFAZ' : d.tipo === 'procNFe' ? 'XML completo recebido da SEFAZ'
      : d.tipo === 'procEventoNFe' || d.tipo === 'resEvento' ? 'Evento da nota recebido da SEFAZ' : 'Documento recebido da SEFAZ'
    if (d.ignorado) add({ ts: d.recebido_em, grupo: 'sefaz', texto: `Documento ignorado: ${d.ignorado}`, autor: null, tom: 'warn' })
    else add({ ts: d.recebido_em, grupo: 'sefaz', texto, autor: null, tom: null })
    if (d.ciencia_em && d.ciencia_cstat !== 'xml-completo') add({ ts: d.ciencia_em, grupo: 'sefaz', texto: `Ciência da operação registrada na SEFAZ (${d.ciencia_cstat ?? '?'})`, autor: null, tom: 'ok' })
    if (!d.ciencia_em && d.ciencia_cstat) add({ ts: d.recebido_em, grupo: 'sefaz', texto: `Ciência da operação recusada pela SEFAZ (${d.ciencia_cstat})`, autor: null, tom: 'err' })
    if (d.busca_chave_em) add({ ts: d.busca_chave_em, grupo: 'sefaz', texto: 'XML completo pedido à SEFAZ pela chave', autor: null, tom: null })
    if (d.erro) add({ ts: d.recebido_em, grupo: 'sefaz', texto: `Erro ao processar: ${d.erro}`, autor: null, tom: 'err' })
  }

  for (const e of f.eventos) {
    const d = e.detalhe ?? {}
    const base = { ts: e.criado_em, autor: e.autor }
    switch (e.tipo) {
      case 'criada': add({ ...base, grupo: 'conferencia', texto: 'Nota registrada para conferência', tom: null }); break
      case 'item_configurado': add({ ...base, grupo: 'conferencia', texto: `Item ${e.linha ?? '?'} alterado`, tom: null, detalhe: detalheConfigurado(d, f.nomesLocais) }); break
      case 'item_vinculado': add({ ...base, grupo: 'conferencia', texto: `Item ${e.linha ?? '?'} ligado a um produto`, tom: null }); break
      case 'conferida': add({ ...base, grupo: 'conferencia', texto: 'Conferida', tom: 'ok' }); break
      case 'lancada': add({ ...base, grupo: 'estoque', texto: `Entrada no estoque: ${itens(n(d.lancados))}`, tom: 'ok', detalhe: n(d.pendentes) || n(d.ignorados) ? `${n(d.pendentes)} pendente(s), ${n(d.ignorados)} fora do estoque` : undefined }); break
      case 'estornada': add({ ...base, grupo: 'estoque', texto: `Entrada desfeita: ${itens(n(d.estornados))}`, tom: 'warn' }); break
      case 'cte_vinculado': add({ ...base, grupo: 'conferencia', texto: 'Frete (CT-e) ligado à nota', tom: null }); break
      case 'cte_desvinculado': add({ ...base, grupo: 'conferencia', texto: 'Frete (CT-e) desligado da nota', tom: null }); break
      case 'cancelada': add({ ...base, grupo: 'sefaz', texto: 'Nota cancelada', tom: 'err' }); break
      case 'recusada': add({ ...base, grupo: 'manifestacao', texto: 'Operação recusada', tom: 'err' }); break
      case 'observacao': add({ ...base, grupo: 'conferencia', texto: 'Observação alterada', tom: null }); break
      default: add({ ...base, grupo: 'conferencia', texto: e.tipo, tom: null })
    }
  }

  for (const m of f.manifestacoes) {
    const nm = NOME_MANIFESTACAO[m.tp_evento] ?? { nome: `Evento ${m.tp_evento}`, feminino: false }
    const ts = m.respondido_em ?? m.criado_em
    const base = { ts, grupo: 'manifestacao' as const, autor: m.autor }
    if (m.status === 'registrada') add({ ...base, texto: `${nm.nome} ${nm.feminino ? 'registrada' : 'registrado'} na SEFAZ (${m.cstat ?? '?'}${m.protocolo ? `, protocolo ${m.protocolo}` : ''})`, tom: 'ok' })
    else if (m.status === 'recusada') add({ ...base, texto: `${nm.nome} ${nm.feminino ? 'recusada' : 'recusado'} pela SEFAZ (${m.cstat ?? '?'})`, tom: 'err' })
    else if (m.status === 'incerta') add({ ...base, texto: `${nm.nome} sem resposta da SEFAZ (repita o envio)`, tom: 'warn' })
    else add({ ...base, texto: `${nm.nome} ${nm.feminino ? 'enviada' : 'enviado'} à SEFAZ, aguardando resposta`, tom: 'warn' })
  }

  if (f.canceladaEm) add({ ts: f.canceladaEm, grupo: 'sefaz', texto: 'Nota cancelada na SEFAZ', autor: null, tom: 'err' })

  return out
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.ordem - b.ordem))
    .map(({ ordem: _o, ...e }) => e)
}
