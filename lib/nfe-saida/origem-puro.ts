// Lê, do XML da NF-e de ENTRADA (procNFe do fornecedor, guardado em sefaz_documentos), o que a NF-e de devolução
// precisa: o emitente (vira o destinatário da devolução, com endereço e IE) e cada item com códigos e impostos.
// Puro: node --test lib/nfe-saida/origem-puro.test.ts
// @ts-expect-error: import com .ts exigido pelo node --test (o tsc do Next não aceita a extensão)
import { parseXml } from '../estoque/nfe-xml.ts'
import type { Endereco } from './nfe-puro'
import type { ItemOrigem } from './regras-puro'

type No = { nome: string; attrs: Record<string, string>; filhos: No[]; texto: string }

const filho = (no: No | undefined, ...cam: string[]): No | undefined => {
  let a = no
  for (const n of cam) { if (!a) return undefined; a = a.filhos.find((f) => f.nome === n) }
  return a
}
const busca = (no: No, nome: string): No | undefined => {
  if (no.nome === nome) return no
  for (const f of no.filhos) { const r = busca(f, nome); if (r) return r }
  return undefined
}
const t = (no: No | undefined, ...cam: string[]) => (filho(no, ...cam)?.texto ?? '').trim()
const n = (s: string) => { const v = Number(s.replace(',', '.')); return Number.isFinite(v) ? v : 0 }

export type NotaOrigem = {
  chave: string; numero: string; serie: string; emissao: string | null; ufEmit: string
  emitente: { doc: string; xNome: string; ie: string | null; ender: Endereco }
  itens: ItemOrigem[]
}

export function lerNotaOrigem(xml: string): NotaOrigem {
  const raiz = parseXml(xml) as No
  const inf = busca(raiz, 'infNFe')
  if (!inf) throw new Error('XML da nota de origem sem infNFe (só o resumo?)')
  const chave = (inf.attrs.Id ?? '').replace(/^NFe/i, '')
  const ide = filho(inf, 'ide')
  const emit = filho(inf, 'emit')
  const ender = filho(emit, 'enderEmit')
  const dh = t(ide, 'dhEmi') || t(ide, 'dEmi')
  const itens: ItemOrigem[] = []
  for (const det of inf.filhos.filter((f) => f.nome === 'det')) {
    const prod = filho(det, 'prod')
    if (!prod) continue
    const icms = filho(det, 'imposto', 'ICMS')?.filhos[0]
    const ipi = filho(det, 'imposto', 'IPI', 'IPITrib')
    const modBC = t(icms, 'modBC')
    const modBCST = t(icms, 'modBCST')
    itens.push({
      nItem: Number(det.attrs.nItem) || itens.length + 1,
      cProd: t(prod, 'cProd'), cEAN: t(prod, 'cEAN') || null, xProd: t(prod, 'xProd'), ncm: t(prod, 'NCM'), cest: t(prod, 'CEST') || null,
      uCom: t(prod, 'uCom') || 'UN', qCom: n(t(prod, 'qCom')), vUnCom: n(t(prod, 'vUnCom')), vProd: n(t(prod, 'vProd')),
      vDesc: n(t(prod, 'vDesc')), vFrete: n(t(prod, 'vFrete')), vSeg: n(t(prod, 'vSeg')), vOutro: n(t(prod, 'vOutro')),
      orig: Math.max(0, Math.min(8, Math.trunc(n(t(icms, 'orig'))))),
      icms: {
        vBC: n(t(icms, 'vBC')), pICMS: n(t(icms, 'pICMS')), vICMS: n(t(icms, 'vICMS')), modBC: modBC ? Number(modBC) : null,
        vBCST: n(t(icms, 'vBCST')), pICMSST: n(t(icms, 'pICMSST')), vICMSST: n(t(icms, 'vICMSST')), modBCST: modBCST ? Number(modBCST) : null,
        pMVAST: t(icms, 'pMVAST') ? n(t(icms, 'pMVAST')) : null,
      },
      vIPI: n(t(ipi, 'vIPI')),
    })
  }
  return {
    chave, numero: t(ide, 'nNF'), serie: t(ide, 'serie'), emissao: dh ? dh.slice(0, 10) : null, ufEmit: t(ender, 'UF'),
    emitente: {
      doc: (t(emit, 'CNPJ') || t(emit, 'CPF')).replace(/\D/g, ''), xNome: t(emit, 'xNome'), ie: t(emit, 'IE') || null,
      ender: {
        xLgr: t(ender, 'xLgr'), nro: t(ender, 'nro') || 'S/N', xCpl: t(ender, 'xCpl') || null, xBairro: t(ender, 'xBairro'),
        cMun: t(ender, 'cMun'), xMun: t(ender, 'xMun'), uf: t(ender, 'UF'), cep: t(ender, 'CEP'), fone: t(ender, 'fone') || null,
      },
    },
    itens,
  }
}
