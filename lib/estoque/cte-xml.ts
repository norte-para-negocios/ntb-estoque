// CT-e de frete da nota de entrada (estoque próprio, Fase B, B9/R13): leitura do XML (cteProc/CTe), validação e rateio.
// Rateio (HIPÓTESE N8: o Omie mostra "Frete Proporcional" e %, sem fórmula provada): entre as notas pelo valor da nota e,
// dentro da nota, pelo valor líquido do item; centavo de sobra no maior. Puro: node --test lib/estoque/cte-xml.test.ts.
// @ts-ignore: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { parseXml } from './nfe-xml.ts'

export type CteLido = {
  chave: string; numero: string; serie: string; emissao: string | null; modelo: string | null; ambiente: string | null
  protocolo: { cStat: string } | null; emitente: { cnpj: string; nome: string }; tomadorCnpj: string | null
  valorPrestacao: number; icms: number; cfop: string | null; chavesNfe: string[]
}

type No = { nome: string; attrs: Record<string, string>; filhos: No[]; texto: string }
const achar = (no: No | undefined, ...caminho: string[]): No | undefined => {
  let a = no
  for (const n of caminho) { if (!a) return undefined; a = a.filhos.find((f) => f.nome === n) }
  return a
}
function buscar(no: No, nome: string): No | undefined {
  if (no.nome === nome) return no
  for (const f of no.filhos) { const r = buscar(f, nome); if (r) return r }
  return undefined
}
const txt = (no: No | undefined, ...c: string[]) => (achar(no, ...c)?.texto ?? '').trim()
const num = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const doc = (no: No | undefined) => (txt(no, 'CNPJ') || txt(no, 'CPF')).replace(/\D/g, '') || null

export function lerCte(xml: string): CteLido {
  const raiz = parseXml(xml) as No
  const inf = buscar(raiz, 'infCte')
  if (!inf) throw new Error('Não é um XML de CT-e (infCte não encontrado).')
  const ide = achar(inf, 'ide')
  const chave = (inf.attrs.Id ?? '').replace(/^CTe/i, '') || txt(buscar(raiz, 'infProt'), 'chCTe')
  // tomador: toma3 (0 remetente, 1 expedidor, 2 recebedor, 3 destinatário) ou toma4 (outro, com o CNPJ)
  let tomadorCnpj: string | null = null
  const t4 = achar(ide, 'toma4')
  if (t4) tomadorCnpj = doc(t4)
  else {
    const t = txt(ide, 'toma3', 'toma') || txt(ide, 'toma03', 'toma')
    const papel = ({ '0': 'rem', '1': 'exped', '2': 'receb', '3': 'dest' } as Record<string, string>)[t]
    tomadorCnpj = papel ? doc(achar(inf, papel)) : null
  }
  const icmsNo = achar(inf, 'imp', 'ICMS')?.filhos[0]
  const prot = buscar(raiz, 'protCTe')
  const infProt = prot ? achar(prot, 'infProt') : undefined
  const chavesNfe = (achar(inf, 'infCTeNorm', 'infDoc')?.filhos ?? []).filter((f) => f.nome === 'infNFe').map((f) => txt(f, 'chave')).filter((c) => /^\d{44}$/.test(c))
  const dh = txt(ide, 'dhEmi')
  return {
    chave, numero: txt(ide, 'nCT'), serie: txt(ide, 'serie'), emissao: dh ? dh.slice(0, 10) : null, modelo: txt(ide, 'mod') || null, ambiente: txt(ide, 'tpAmb') || null,
    protocolo: infProt ? { cStat: txt(infProt, 'cStat') } : null,
    emitente: { cnpj: doc(achar(inf, 'emit')) ?? '', nome: txt(inf, 'emit', 'xNome') },
    tomadorCnpj, valorPrestacao: num(txt(inf, 'vPrest', 'vTPrest')), icms: num(txt(icmsNo, 'vICMS')), cfop: txt(ide, 'CFOP') || null, chavesNfe,
  }
}

export function validarCteImportado(c: CteLido, cnpjLoja: string | null): string[] {
  const erros: string[] = []
  if (c.modelo !== '57') erros.push(`Não é CT-e (modelo ${c.modelo ?? '?'}).`)
  if (!c.protocolo || (c.protocolo.cStat !== '100' && c.protocolo.cStat !== '150')) erros.push('O CT-e não está autorizado na SEFAZ (sem protocolo de autorização).')
  if (c.ambiente === '2') erros.push('CT-e de homologação (teste): não entra no custo.')
  const loja = (cnpjLoja ?? '').replace(/\D/g, '')
  if (loja && c.tomadorCnpj !== loja) erros.push(`Este CT-e não é pago por esta loja (tomador ${c.tomadorCnpj ?? 'não informado'}).`)
  if (!(c.valorPrestacao > 0)) erros.push('O CT-e não tem valor de frete.')
  return erros
}

const r2 = (n: number) => Math.round(n * 100) / 100
function proporcional(valor: number, bases: number[]): number[] {
  const soma = bases.reduce((a, b) => a + Math.max(0, b), 0)
  const partes = bases.map((b) => (soma > 0 ? r2((valor * Math.max(0, b)) / soma) : r2(valor / bases.length)))
  const sobra = r2(valor - partes.reduce((a, b) => a + b, 0))
  if (sobra !== 0 && partes.length) { const i = bases.indexOf(Math.max(...bases)); partes[i] = r2(partes[i] + sobra) }
  return partes
}

/** Entre as notas, pelo valor da nota. */
export function ratearFreteCte(valor: number, notas: { compraId: number; valorNota: number }[]): { compraId: number; valor: number; percentual: number }[] {
  const partes = proporcional(valor, notas.map((n) => n.valorNota))
  const soma = notas.reduce((a, n) => a + Math.max(0, n.valorNota), 0)
  // percentual = participação da nota no valor das notas (o "%" do Omie), não do valor já arredondado
  const pct = (n: { valorNota: number }) => Math.round((soma > 0 ? Math.max(0, n.valorNota) / soma : 1 / notas.length) * 100 * 1e4) / 1e4
  return notas.map((n, i) => ({ compraId: n.compraId, valor: partes[i], percentual: pct(n) }))
}

/** Dentro da nota, pelo valor líquido do item (só os que movimentam estoque). */
export function ratearFreteItens(valor: number, itens: { linha: number; base: number }[]): { linha: number; valor: number }[] {
  const partes = proporcional(valor, itens.map((i) => i.base))
  return itens.map((i, k) => ({ linha: i.linha, valor: partes[k] }))
}
