// Dados do DANFE (retrato, simplificado) tirados do procNFe, e o código de barras CODE-128C da chave de acesso.
// Puro: node --test lib/nfe-saida/danfe-puro.test.ts. O desenho fica em components/nfe-saida/DanfePDF.tsx (react-pdf).
// @ts-expect-error: import com .ts exigido pelo node --test (o tsc do Next não aceita a extensão)
import { parseXml } from '../estoque/nfe-xml.ts'

// ------------------------------------------------------------------------------------------------ CODE-128
// Larguras (barra, espaço, barra, espaço, barra, espaço) de cada símbolo 0–105; cada um soma 11 módulos.
const P128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132',
  '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212',
  '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311',
  '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113',
  '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232',
]
const STOP = '2331112'
export const _padroes128 = { P128, STOP }

/** Larguras em módulos (alternando barra/espaço, começando por barra) do CODE-128C de uma sequência par de dígitos. */
export function code128C(digitos: string): number[] {
  if (!/^(\d\d)+$/.test(digitos)) throw new Error('CODE-128C precisa de quantidade par de dígitos')
  const valores = [105]
  for (let i = 0; i < digitos.length; i += 2) valores.push(Number(digitos.slice(i, i + 2)))
  let soma = 105
  for (let i = 1; i < valores.length; i++) soma += valores[i] * i
  valores.push(soma % 103)
  const larguras = valores.flatMap((v) => P128[v].split('').map(Number))
  return [...larguras, ...STOP.split('').map(Number)]
}

// ------------------------------------------------------------------------------------------------ dados
type No = { nome: string; attrs: Record<string, string>; filhos: No[]; texto: string }
const f = (no: No | undefined, ...c: string[]): No | undefined => { let a = no; for (const n of c) { if (!a) return undefined; a = a.filhos.find((x) => x.nome === n) } return a }
const b = (no: No, nome: string): No | undefined => { if (no.nome === nome) return no; for (const x of no.filhos) { const r = b(x, nome); if (r) return r } return undefined }
const t = (no: No | undefined, ...c: string[]) => (f(no, ...c)?.texto ?? '').trim()
const n = (s: string) => Number(s) || 0

export type DadosDanfe = {
  chave: string; numero: string; serie: string; tpNF: string; natOp: string; dhEmi: string; tpAmb: string; finNFe: string
  protocolo: string | null; dhRecbto: string | null
  emit: { nome: string; fantasia: string; doc: string; ie: string; endereco: string; municipio: string; uf: string; cep: string; fone: string }
  dest: { nome: string; doc: string; ie: string; endereco: string; bairro: string; municipio: string; uf: string; cep: string }
  totais: Record<'vBC' | 'vICMS' | 'vBCST' | 'vST' | 'vProd' | 'vFrete' | 'vSeg' | 'vDesc' | 'vOutro' | 'vIPI' | 'vIPIDevol' | 'vNF', number>
  transp: { modFrete: string; nome: string; doc: string; uf: string; qVol: string; esp: string; pesoB: string; pesoL: string }
  itens: { cProd: string; xProd: string; ncm: string; cst: string; cfop: string; un: string; q: number; vUn: number; vProd: number; vBC: number; vICMS: number; pICMS: number }[]
  refs: string[]
  infCpl: string; infAdFisco: string
}

const endereco = (e: No | undefined) => [t(e, 'xLgr'), t(e, 'nro'), t(e, 'xCpl')].filter(Boolean).join(', ')

export function dadosDanfe(procNFe: string): DadosDanfe {
  const raiz = parseXml(procNFe) as No
  const inf = b(raiz, 'infNFe')
  if (!inf) throw new Error('XML sem infNFe')
  const ide = f(inf, 'ide'), emit = f(inf, 'emit'), dest = f(inf, 'dest'), tot = f(inf, 'total', 'ICMSTot'), transp = f(inf, 'transp')
  const prot = b(raiz, 'infProt')
  const vol = f(transp, 'vol')
  return {
    chave: (inf.attrs.Id ?? '').replace(/^NFe/, ''), numero: t(ide, 'nNF'), serie: t(ide, 'serie'), tpNF: t(ide, 'tpNF'), natOp: t(ide, 'natOp'),
    dhEmi: t(ide, 'dhEmi'), tpAmb: t(ide, 'tpAmb'), finNFe: t(ide, 'finNFe'),
    protocolo: prot ? t(prot, 'nProt') || null : null, dhRecbto: prot ? t(prot, 'dhRecbto') || null : null,
    emit: {
      nome: t(emit, 'xNome'), fantasia: t(emit, 'xFant'), doc: t(emit, 'CNPJ') || t(emit, 'CPF'), ie: t(emit, 'IE'),
      endereco: [endereco(f(emit, 'enderEmit')), t(emit, 'enderEmit', 'xBairro')].filter(Boolean).join(' - '),
      municipio: t(emit, 'enderEmit', 'xMun'), uf: t(emit, 'enderEmit', 'UF'), cep: t(emit, 'enderEmit', 'CEP'), fone: t(emit, 'enderEmit', 'fone'),
    },
    dest: {
      nome: t(dest, 'xNome'), doc: t(dest, 'CNPJ') || t(dest, 'CPF'), ie: t(dest, 'IE'), endereco: endereco(f(dest, 'enderDest')),
      bairro: t(dest, 'enderDest', 'xBairro'), municipio: t(dest, 'enderDest', 'xMun'), uf: t(dest, 'enderDest', 'UF'), cep: t(dest, 'enderDest', 'CEP'),
    },
    totais: {
      vBC: n(t(tot, 'vBC')), vICMS: n(t(tot, 'vICMS')), vBCST: n(t(tot, 'vBCST')), vST: n(t(tot, 'vST')), vProd: n(t(tot, 'vProd')), vFrete: n(t(tot, 'vFrete')),
      vSeg: n(t(tot, 'vSeg')), vDesc: n(t(tot, 'vDesc')), vOutro: n(t(tot, 'vOutro')), vIPI: n(t(tot, 'vIPI')), vIPIDevol: n(t(tot, 'vIPIDevol')), vNF: n(t(tot, 'vNF')),
    },
    transp: {
      modFrete: t(transp, 'modFrete'), nome: t(transp, 'transporta', 'xNome'), doc: t(transp, 'transporta', 'CNPJ') || t(transp, 'transporta', 'CPF'),
      uf: t(transp, 'transporta', 'UF'), qVol: t(vol, 'qVol'), esp: t(vol, 'esp'), pesoB: t(vol, 'pesoB'), pesoL: t(vol, 'pesoL'),
    },
    itens: inf.filhos.filter((x) => x.nome === 'det').map((det) => {
      const p = f(det, 'prod')
      const ic = f(det, 'imposto', 'ICMS')?.filhos[0]
      return {
        cProd: t(p, 'cProd'), xProd: t(p, 'xProd'), ncm: t(p, 'NCM'), cst: `${t(ic, 'orig')}${t(ic, 'CST') || t(ic, 'CSOSN')}`, cfop: t(p, 'CFOP'),
        un: t(p, 'uCom'), q: n(t(p, 'qCom')), vUn: n(t(p, 'vUnCom')), vProd: n(t(p, 'vProd')), vBC: n(t(ic, 'vBC')), vICMS: n(t(ic, 'vICMS')), pICMS: n(t(ic, 'pICMS')),
      }
    }),
    refs: (f(inf, 'ide')?.filhos ?? []).filter((x) => x.nome === 'NFref').map((r) => t(r, 'refNFe')).filter(Boolean),
    infCpl: t(inf, 'infAdic', 'infCpl'), infAdFisco: t(inf, 'infAdic', 'infAdFisco'),
  }
}

export const chaveEmGrupos = (c: string) => c.replace(/(\d{4})(?=\d)/g, '$1 ')
export function docFormatado(d: string): string {
  const x = (d ?? '').replace(/\D/g, '')
  if (x.length === 14) return `${x.slice(0, 2)}.${x.slice(2, 5)}.${x.slice(5, 8)}/${x.slice(8, 12)}-${x.slice(12)}`
  if (x.length === 11) return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`
  return d
}
export const MOD_FRETE: Record<string, string> = { '0': '0 - Emitente', '1': '1 - Destinatário', '2': '2 - Terceiros', '3': '3 - Próprio (remetente)', '4': '4 - Próprio (destinatário)', '9': '9 - Sem frete' }
