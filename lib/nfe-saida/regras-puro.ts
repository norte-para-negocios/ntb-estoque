// Regras fiscais das NF-e de SAÍDA do estoque próprio (Fase F, F1/F2): CFOP por UF, CST/CSOSN por regime da loja,
// itens proporcionais da devolução e itens da transferência. Puro: node --test lib/nfe-saida/regras-puro.test.ts
//
// HIPÓTESES (conferir com o contador da loja antes de produção; estão no plano 2026-10-20-fase-f-nfe-saida.md):
//  * Devolução repete a tributação da nota de origem na proporção devolvida: ICMS próprio (vBC/pICMS/vICMS) e ST
//    (vBCST/pICMSST/vICMSST) proporcionais; IPI da origem volta como IPI devolvido (impostoDevol/vIPIDevol, pDevol).
//    Simples (CRT 1/2/4): CSOSN 900 com esses valores. Regime normal (CRT 3): CST 00 (só ICMS próprio) ou CST 90.
//  * Transferência (mesma raiz de CNPJ): CFOP 5.152/6.152 (5.151/6.151 para produção própria), sem ICMS (ADC 49 / LC
//    204/2023): CSOSN 400 no Simples, CST 41 no regime normal. Remessa (raiz diferente): CFOP 5.949/6.949, CSOSN 900 /
//    CST 90 sem valores. Os CSTs/CSOSN padrão são configuráveis por loja (nfe_config).
//  * PIS/COFINS: CST 49 (outras operações de saída) com valor zero, configurável.
// @ts-expect-error: import com .ts exigido pelo node --test (o tsc do Next não aceita a extensão)
import { r2, r4 } from './nfe-puro.ts'
import type { IcmsItem, ItemNfeSaida } from './nfe-puro'

export type Crt = 1 | 2 | 3 | 4
export const ehSimples = (crt: Crt) => crt !== 3

/** Troca o 1º dígito do CFOP de saída pelo da operação: 5 dentro do estado, 6 fora. Aceita "5.202" ou "5202". */
export function cfopPorUf(cfop: string, ufEmit: string, ufDest: string): string {
  const d = (cfop ?? '').replace(/\D/g, '')
  if (!/^\d{4}$/.test(d)) throw new Error(`CFOP inválido: ${cfop}`)
  const dentro = ufEmit.trim().toUpperCase() === ufDest.trim().toUpperCase()
  return (dentro ? '5' : '6') + d.slice(1)
}

/** CFOP de devolução a partir do CFOP de ENTRADA da nota (1.102 → x.202 etc.). Só pares com CFOP de devolução válido
 *  (indDevol=1); entrada sem par (bonificação 1.910, outras 1.949, industrialização por encomenda...) = null: a NF-e de
 *  devolução não sai por aqui (5.910/5.949 com finalidade 4 é rejeição 327). Sem CFOP de entrada: 5.202. */
export const DEVOLUCAO_DA_ENTRADA: Record<string, string> = {
  '101': '201', '102': '202', '126': '210', '151': '208', '152': '209', '401': '410', '403': '411', '406': '412', '407': '413',
  '501': '503', '551': '553', '555': '555', '556': '556', '651': '660', '652': '661', '653': '662', '917': '918', '920': '921',
}
export function cfopDevolucaoBase(cfopEntrada: string | null | undefined): string | null {
  const d = (cfopEntrada ?? '').replace(/\D/g, '')
  if (!d) return '5202'
  if (!/^[123]\d{3}$/.test(d)) return null
  const s = DEVOLUCAO_DA_ENTRADA[d.slice(1)]
  return s ? '5' + s : null
}

export type ConfigFiscal = {
  crt: Crt
  cstPisCofins: string
  csosnTransferencia: '102' | '103' | '300' | '400' | '900'
  cstTransferencia: '40' | '41' | '50' | '90'
  csosnRemessa: '102' | '103' | '300' | '400' | '900'
  cstRemessa: '40' | '41' | '50' | '90'
}

// ------------------------------------------------------------------------------------------------ devolução
/** Item da nota de ORIGEM como veio no XML do fornecedor (valores do item inteiro). */
export type ItemOrigem = {
  nItem: number
  cProd: string; cEAN: string | null; xProd: string; ncm: string; cest: string | null; uCom: string; qCom: number; vUnCom: number
  vProd: number; vDesc: number; vFrete: number; vSeg: number; vOutro: number
  orig: number
  icms: { vBC: number; pICMS: number; vICMS: number; modBC: number | null; vBCST: number; pICMSST: number; vICMSST: number; modBCST: number | null; pMVAST: number | null }
  vIPI: number
}

/** Proporção da NOTA que volta: quantidade devolvida (digitada, unidade de estoque) ÷ quantidade FATURADA na nota
 *  (qCom × fator, unidade de estoque), com teto no faturado. Recebido a menos que o faturado não aumenta a proporção:
 *  a NF-e devolve o que foi digitado, nunca mais do que a nota faturou. */
export function proporcaoDevolvida(qDevolvida: number, qFaturada: number): number {
  if (!(qFaturada > 0) || !(qDevolvida > 0)) throw new Error('Quantidade devolvida/faturada inválida')
  if (qDevolvida > qFaturada + 1e-9) throw new Error('Devolução maior que a quantidade faturada na nota')
  return Math.min(1, qDevolvida / qFaturada)
}

export function itemDevolucao(o: ItemOrigem, p: { proporcao: number; cfop: string; crt: Crt; cstPisCofins: string }): ItemNfeSaida {
  const f = p.proporcao
  const qCom = r4(o.qCom * f)
  const prop = o.icms.vBC > 0 && o.icms.pICMS > 0
    ? (() => { const vBC = r2(o.icms.vBC * f); return { modBC: o.icms.modBC ?? 3, vBC, pICMS: o.icms.pICMS, vICMS: r2(vBC * o.icms.pICMS / 100) } })()
    : null
  const st = o.icms.vICMSST > 0
    ? { modBCST: o.icms.modBCST ?? 4, pMVAST: o.icms.pMVAST, vBCST: r2(o.icms.vBCST * f), pICMSST: o.icms.pICMSST, vICMSST: r2(o.icms.vICMSST * f) }
    : null
  let icms: IcmsItem
  if (ehSimples(p.crt)) icms = { grupo: 'SN900', orig: o.orig, proprio: prop, st }
  else if (prop && !st) icms = { grupo: '00', orig: o.orig, proprio: prop }
  else icms = { grupo: '90', orig: o.orig, proprio: prop, st }
  const vIPIDevol = o.vIPI > 0 ? r2(o.vIPI * f) : 0
  return {
    cProd: o.cProd, cEAN: o.cEAN, xProd: o.xProd, ncm: o.ncm, cest: o.cest, cfop: p.cfop, uCom: o.uCom, qCom, vUnCom: o.vUnCom,
    vFrete: r2(o.vFrete * f), vSeg: r2(o.vSeg * f), vDesc: r2(o.vDesc * f), vOutro: r2(o.vOutro * f),
    icms, pisCofinsCst: p.cstPisCofins,
    ipiDevol: vIPIDevol > 0 ? { pDevol: r2(f * 100), vIPIDevol } : null,
  }
}

export function textoDevolucao(p: {
  numeroOrigem: string | null; serieOrigem: string | null; emissaoOrigem: string | null; chaveOrigem: string; total: boolean; motivo: string
  crt: Crt; extra?: string | null; numeroInterno: number
}): string {
  const data = p.emissaoOrigem ? p.emissaoOrigem.slice(0, 10).split('-').reverse().join('/') : null
  const partes = [
    `Devolucao ${p.total ? 'total' : 'parcial'} da NF-e ${p.numeroOrigem ?? ''}${p.serieOrigem ? ` serie ${p.serieOrigem}` : ''}${data ? ` de ${data}` : ''}, chave ${p.chaveOrigem}.`,
    `Motivo: ${p.motivo}.`,
    `Devolucao no ${p.numeroInterno} do Norte Estoque.`,
  ]
  if (ehSimples(p.crt)) partes.push('Documento emitido por ME ou EPP optante pelo Simples Nacional. Nao gera direito a credito fiscal de IPI.')
  if (p.extra?.trim()) partes.push(p.extra.trim())
  return partes.join(' ')
}

// ------------------------------------------------------------------------------------------------ transferência
export type NaturezaSaida = 'transferencia' | 'remessa'
export const NAT_OP: Record<NaturezaSaida | 'devolucao', string> = {
  devolucao: 'DEVOLUCAO DE COMPRA',
  transferencia: 'TRANSFERENCIA DE MERCADORIA',
  remessa: 'REMESSA DE MERCADORIA',
}

/** Mesma raiz de CNPJ (8 primeiros dígitos) = mesmo contribuinte = transferência; senão, remessa. */
export function naturezaEntreLojas(cnpjOrigem: string, cnpjDestino: string): NaturezaSaida {
  const a = (cnpjOrigem ?? '').replace(/\D/g, '')
  const b = (cnpjDestino ?? '').replace(/\D/g, '')
  return a.length === 14 && b.length === 14 && a.slice(0, 8) === b.slice(0, 8) ? 'transferencia' : 'remessa'
}

/** Produção do próprio estabelecimento (produto acabado/em processo, tipo SPED 03/04) sai com x.151; o resto x.152. */
export function cfopEntreLojas(natureza: NaturezaSaida, tipoItem: string | null | undefined, ufEmit: string, ufDest: string): string {
  const base = natureza === 'remessa' ? '5949' : ['03', '04'].includes((tipoItem ?? '').trim()) ? '5151' : '5152'
  return cfopPorUf(base, ufEmit, ufDest)
}

export function icmsEntreLojas(natureza: NaturezaSaida, cfg: ConfigFiscal, orig: number): IcmsItem {
  if (ehSimples(cfg.crt)) {
    const csosn = natureza === 'remessa' ? cfg.csosnRemessa : cfg.csosnTransferencia
    return csosn === '900' ? { grupo: 'SN900', orig } : { grupo: 'SN102', orig, csosn }
  }
  const cst = natureza === 'remessa' ? cfg.cstRemessa : cfg.cstTransferencia
  return cst === '90' ? { grupo: '90', orig } : { grupo: '40', orig, cst }
}

export type ItemTransferencia = {
  codigo: string; descricao: string; ncm: string | null; cest: string | null; ean: string | null; unidade: string; origem: number
  tipoItem: string | null; quantidade: number; custoUnitario: number
}

export function itemTransferencia(it: ItemTransferencia, p: { natureza: NaturezaSaida; cfg: ConfigFiscal; ufEmit: string; ufDest: string }): ItemNfeSaida {
  return {
    cProd: it.codigo, cEAN: it.ean, xProd: it.descricao, ncm: it.ncm ?? '', cest: it.cest, cfop: cfopEntreLojas(p.natureza, it.tipoItem, p.ufEmit, p.ufDest),
    uCom: it.unidade || 'UN', qCom: r4(it.quantidade), vUnCom: Math.round(it.custoUnitario * 1e10) / 1e10,
    icms: icmsEntreLojas(p.natureza, p.cfg, it.origem), pisCofinsCst: p.cfg.cstPisCofins,
  }
}

export function textoTransferencia(p: { natureza: NaturezaSaida; numeroInterno: number; obs?: string | null; crt: Crt; extra?: string | null }): string {
  const partes = [
    p.natureza === 'transferencia'
      ? `Transferencia de mercadoria entre estabelecimentos do mesmo titular, sem incidencia de ICMS (STF ADC 49; LC 204/2023).`
      : `Remessa de mercadoria.`,
    `Transferencia no ${p.numeroInterno} do Norte Estoque. Valor pelo custo medio.`,
  ]
  if (p.obs?.trim()) partes.push(p.obs.trim())
  if (ehSimples(p.crt)) partes.push('Documento emitido por ME ou EPP optante pelo Simples Nacional.')
  if (p.extra?.trim()) partes.push(p.extra.trim())
  return partes.join(' ')
}

// ------------------------------------------------------------------------------------------------ situação da NF-e
export type StatusNfe = 'rascunho' | 'enviando' | 'incerta' | 'autorizada' | 'rejeitada' | 'denegada' | 'inutilizada' | 'cancelada' | 'descartada'

export function rotuloStatusNfe(s: StatusNfe | string, enviandoDesde?: string | null, agora = Date.now()): string {
  if (s === 'enviando' && enviandoDesde && agora - new Date(enviandoDesde).getTime() > 2 * 60 * 1000) return 'Sem resposta da SEFAZ'
  return ({
    rascunho: 'Pronta para enviar', enviando: 'Enviando à SEFAZ', incerta: 'Sem resposta da SEFAZ', autorizada: 'Autorizada',
    rejeitada: 'Rejeitada', denegada: 'Denegada', inutilizada: 'Número inutilizado', cancelada: 'Cancelada', descartada: 'Descartada',
  } as Record<string, string>)[s] ?? s
}

/** O que a tela pode oferecer em cada situação. `podeRegerar` = false: a SEFAZ pode ter a chave atual, então reenviar é
 *  o MESMO XML e descartar não aparece (nfe_saida.pode_regerar). */
export function acoesNfe(s: StatusNfe | string, enviandoDesde?: string | null, agora = Date.now(), podeRegerar = true): { enviar: boolean; mesmoXml: boolean; consultar: boolean; descartar: boolean; cancelar: boolean; cce: boolean; baixar: boolean } {
  const parado = s === 'enviando' && !!enviandoDesde && agora - new Date(enviandoDesde).getTime() > 2 * 60 * 1000
  return {
    enviar: s === 'rascunho' || s === 'rejeitada',
    mesmoXml: (s === 'rascunho' || s === 'rejeitada') && !podeRegerar,
    consultar: s === 'incerta' || parado || s === 'rejeitada',
    descartar: (s === 'rascunho' || s === 'rejeitada') && podeRegerar,
    cancelar: s === 'autorizada',
    cce: s === 'autorizada',
    baixar: s === 'autorizada' || s === 'cancelada' || s === 'denegada',
  }
}

/** Cancelamento: a SEFAZ aceita até 24 h depois da autorização (prazo geral; fora dele o pedido é rejeitado). */
export function dentroDoPrazoCancelamento(dhRecbto: string | null | undefined, agora = Date.now()): boolean {
  if (!dhRecbto) return false
  return agora - new Date(dhRecbto).getTime() <= 24 * 3600 * 1000
}
