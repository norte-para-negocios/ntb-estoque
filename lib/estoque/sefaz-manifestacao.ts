// Manifestação do destinatário (Fase B, B6/R12): Confirmação (210200), Desconhecimento (210220) e Operação não realizada
// (210240). Só as PEÇAS PURAS (montar o evento, decidir se pode enviar, ler a resposta). O envio (sefaz-rede.ts) só sai por
// botão numa nota, com confirmação explícita: nunca em cron, sync ou lançamento automático. Puro: node --test.
// @ts-ignore: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { dataHoraSaoPaulo } from './sefaz-distdfe.ts'
// @ts-ignore: idem
import { parseXml } from './nfe-xml.ts'

// @ts-ignore: idem (tipos e textos num módulo sem dependências, para a tela de cliente)
import { MANIFESTACOES, ehTipoManifestacao, validarJustificativa } from './sefaz-manifestacao-tipos.ts'
import type { TipoManifestacao } from './sefaz-manifestacao-tipos'
export { MANIFESTACOES, ehTipoManifestacao, validarJustificativa }
export type { TipoManifestacao }

/** Texto para o XML: sem acentos e com & < > " ' escapados (a justificativa fica guardada como digitada). */
function textoXml(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Mesmo molde da ciência (montarEventoCiencia): órgão 91 (Ambiente Nacional), nSeqEvento 1, verEvento 1.00. */
export function montarEventoManifestacao(p: { chave: string; cnpj: string; tpAmb: 1 | 2; tipo: TipoManifestacao; justificativa?: string | null; agora?: Date }): { xml: string; id: string } {
  const cnpj = p.cnpj.replace(/\D/g, '')
  if (!/^\d{44}$/.test(p.chave)) throw new Error('Chave de acesso inválida')
  if (cnpj.length !== 14) throw new Error('CNPJ inválido')
  const erroJust = validarJustificativa(p.tipo, p.justificativa)
  if (erroJust) throw new Error(`Justificativa inválida: ${erroJust}`)
  const id = `ID${p.tipo}${p.chave}01`
  const xJust = MANIFESTACOES[p.tipo].exigeJustificativa ? `<xJust>${textoXml((p.justificativa ?? '').trim())}</xJust>` : ''
  const xml =
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${id}"><cOrgao>91</cOrgao><tpAmb>${p.tpAmb}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${p.chave}</chNFe>` +
    `<dhEvento>${dataHoraSaoPaulo(p.agora)}</dhEvento><tpEvento>${p.tipo}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>${MANIFESTACOES[p.tipo].desc}</descEvento>${xJust}</detEvento></infEvento></evento>`
  return { xml, id }
}

export type EstadoManifestacao = { tp_evento: string; status: 'enviando' | 'registrada' | 'recusada' | 'incerta'; criado_em: string }
const EM_ANDAMENTO_MS = 5 * 60 * 1000
const rotulo = (tp: string) => (ehTipoManifestacao(tp) ? MANIFESTACOES[tp].rotulo : tp)

/** No máximo um envio em andamento por nota; reenvio só do envio que ficou sem resposta (a SEFAZ responde 573 se já tinha registrado). */
export function decidirEnvioManifestacao(estados: EstadoManifestacao[], tipo: TipoManifestacao, agora: Date): { acao: 'enviar' } | { acao: 'reenviar' } | { acao: 'bloquear'; motivo: string } {
  const conclusivas = estados.filter((e) => e.tp_evento !== '210210')
  const registrada = conclusivas.find((e) => e.status === 'registrada')
  if (registrada) return { acao: 'bloquear', motivo: `Esta nota já foi manifestada na SEFAZ: ${rotulo(registrada.tp_evento)}.` }
  const recente = conclusivas.find((e) => e.status === 'enviando' && agora.getTime() - new Date(e.criado_em).getTime() < EM_ANDAMENTO_MS)
  if (recente) return { acao: 'bloquear', motivo: 'Já há um envio em andamento para esta nota.' }
  const semResposta = conclusivas.filter((e) => e.status === 'incerta' || e.status === 'enviando')
  if (semResposta.some((e) => e.tp_evento === tipo)) return { acao: 'reenviar' }
  if (semResposta.length) return { acao: 'bloquear', motivo: `Há um envio sem resposta (${rotulo(semResposta[0].tp_evento)}): repita esse primeiro.` }
  return { acao: 'enviar' }
}

/** 135/136 = evento registrado; 573 = duplicidade (já estava registrado). Qualquer outro = recusado. */
export function resultadoManifestacao(cStat: string | null): 'registrada' | 'recusada' {
  return cStat === '135' || cStat === '136' || cStat === '573' ? 'registrada' : 'recusada'
}

type No = { nome: string; filhos: No[]; texto: string }
function buscar(no: No, nome: string): No | undefined {
  if (no.nome === nome) return no
  for (const f of no.filhos) { const r = buscar(f, nome); if (r) return r }
  return undefined
}
const txt = (no: No | undefined, nome: string) => (no?.filhos.find((f) => f.nome === nome)?.texto ?? '').trim() || null

/** Resposta do NFeRecepcaoEvento4: o cStat/xMotivo/nProt do EVENTO (retEvento/infEvento); sem ele, o do lote. */
export function lerRetornoManifestacao(xml: string): { cStat: string | null; xMotivo: string | null; protocolo: string | null } {
  const raiz = parseXml(xml) as No
  const ev = buscar(raiz, 'retEvento')
  const inf = ev ? buscar(ev, 'infEvento') : undefined
  if (inf) return { cStat: txt(inf, 'cStat'), xMotivo: txt(inf, 'xMotivo'), protocolo: txt(inf, 'nProt') }
  const lote = buscar(raiz, 'retEnvEvento')
  return { cStat: txt(lote, 'cStat'), xMotivo: txt(lote, 'xMotivo'), protocolo: null }
}
