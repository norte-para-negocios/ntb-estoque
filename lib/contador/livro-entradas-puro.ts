// Fase F: livro de entradas (modelo do Registro de Entradas) do mês, para o contador. Vale para as duas lojas: o
// estoque próprio projeta os itens no formato do Omie em nota_fiscal_items.full_object (Fase B).
// Regra (plano R6): uma linha por nota × CFOP de entrada; nota entra se etapa 60, não cancelada e com data de entrada
// (infoCadastro.dRec; sem ela, a emissão) no mês. Valor contábil = Σ vTotalItem (já vem sem o desconto e com IPI,
// ST e despesas do item, regra N3 da Fase A). Sem imports: node --test lib/contador/livro-entradas-puro.test.ts

type Obj = Record<string, unknown>
export type NotaLivro = {
  id: number; numero: string | null; serie: string | null; modelo: string | null; chave: string | null; emissao: string | null
  dRec: string | null; etapa: string | null; cancelada: boolean; fornecedor: string | null; cnpj: string | null; valorNota?: number | null
}
export type ItemLivro = { notaId: number; cfopNota: string | null; fo: Obj | null; vTotalItem: number | null }
export type Valores = { valorContabil: number; baseIcms: number; icms: number; icmsSt: number; ipi: number; pis: number; cofins: number }
export type LinhaLivro = Valores & {
  notaId: number; dataEntrada: string; emissao: string; especie: string; serie: string; numero: string; fornecedor: string
  cnpj: string; uf: string; cfop: string; chave: string
}
export type TotalCfop = Valores & { cfop: string; notas: number }

const UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN',
  '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC',
  '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
}
const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  return Number.isFinite(n) ? n : 0
}
const sub = (o: Obj | null, k: string): Obj => ((o?.[k] && typeof o[k] === 'object') ? (o[k] as Obj) : {})
const zero = (): Valores => ({ valorContabil: 0, baseIcms: 0, icms: 0, icmsSt: 0, ipi: 0, pis: 0, cofins: 0 })
const CAMPOS: (keyof Valores)[] = ['valorContabil', 'baseIcms', 'icms', 'icmsSt', 'ipi', 'pis', 'cofins']

export function ufDaChave(chave: string | null | undefined): string {
  return chave && /^\d{44}$/.test(chave) ? UF[chave.slice(0, 2)] ?? '' : ''
}

/** CFOP de entrada do item ('1.102'): o gravado no recebimento; sem ele, o do fornecedor com 5→1, 6→2, 7→3. */
export function cfopEntradaDoItem(fo: Obj | null, cfopNota: string | null): string {
  const ent = String(sub(fo, 'itensAjustes').cCFOPEntrada ?? '').replace(/\D/g, '')
  if (/^[123]\d{3}$/.test(ent)) return `${ent[0]}.${ent.slice(1)}`
  const d = String(cfopNota ?? '').replace(/\D/g, '')
  if (!/^[567]\d{3}$/.test(d)) return /^[123]\d{3}$/.test(d) ? `${d[0]}.${d.slice(1)}` : '—'
  return `${Number(d[0]) - 4}.${d.slice(1)}`
}

/** Data de entrada (YYYY-MM-DD): infoCadastro.dRec (DD/MM/AAAA) ou, sem ela, a emissão. */
export function dataEntradaDaNota(dRec: string | null, emissao: string | null): string {
  const m = (dRec ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (emissao ?? '').slice(0, 10)
}

function valoresDoItem(i: ItemLivro): Valores {
  const fo = i.fo
  const vt = sub(fo, 'itensCabec').vTotalItem
  return {
    valorContabil: vt != null && vt !== '' ? num(vt) : num(i.vTotalItem),
    baseIcms: num(sub(fo, 'itensICMS').nBC), icms: num(sub(fo, 'itensICMS').nValor), icmsSt: num(sub(fo, 'itensICMSST').nValorST),
    ipi: num(sub(fo, 'itensIPI').nValIPI), pis: num(sub(fo, 'itensPIS').nValPIS), cofins: num(sub(fo, 'itensCOFINS').nValCOFINS),
  }
}

export function notaEntraNoLivro(n: NotaLivro, mes: string): boolean {
  return n.etapa === '60' && !n.cancelada && dataEntradaDaNota(n.dRec, n.emissao).slice(0, 7) === mes
}

export function montarLivro(notas: NotaLivro[], itens: ItemLivro[], mes: string): { linhas: LinhaLivro[]; totaisCfop: TotalCfop[]; total: TotalCfop } {
  const doMes = notas.filter((n) => notaEntraNoLivro(n, mes))
  const porNota = new Map<number, ItemLivro[]>()
  for (const i of itens) {
    const l = porNota.get(i.notaId)
    if (l) l.push(i); else porNota.set(i.notaId, [i])
  }
  const linhas: LinhaLivro[] = []
  for (const n of doMes) {
    const base = {
      notaId: n.id, dataEntrada: dataEntradaDaNota(n.dRec, n.emissao), emissao: (n.emissao ?? '').slice(0, 10), especie: 'NF-e',
      serie: n.serie ?? '', numero: n.numero ?? '', fornecedor: n.fornecedor ?? '', cnpj: (n.cnpj ?? '').replace(/\D/g, ''),
      uf: ufDaChave(n.chave), chave: n.chave ?? '',
    }
    const its = porNota.get(n.id) ?? []
    if (!its.length) {
      linhas.push({ ...base, cfop: '—', ...zero(), valorContabil: r2(num(n.valorNota)) })
      continue
    }
    const porCfop = new Map<string, Valores>()
    for (const i of its) {
      const cfop = cfopEntradaDoItem(i.fo, i.cfopNota)
      const acc = porCfop.get(cfop) ?? zero()
      const v = valoresDoItem(i)
      for (const k of CAMPOS) acc[k] += v[k]
      porCfop.set(cfop, acc)
    }
    for (const [cfop, v] of [...porCfop.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const arred = Object.fromEntries(CAMPOS.map((k) => [k, r2(v[k])])) as Valores
      linhas.push({ ...base, cfop, ...arred })
    }
  }
  linhas.sort((a, b) => a.dataEntrada.localeCompare(b.dataEntrada) || a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }) || a.cfop.localeCompare(b.cfop))

  const tot = new Map<string, TotalCfop & { ids: Set<number> }>()
  const geral = { cfop: 'Total', notas: 0, ...zero(), ids: new Set<number>() }
  for (const l of linhas) {
    const t = tot.get(l.cfop) ?? { cfop: l.cfop, notas: 0, ...zero(), ids: new Set<number>() }
    for (const k of CAMPOS) { t[k] += l[k]; geral[k] += l[k] }
    t.ids.add(l.notaId); geral.ids.add(l.notaId)
    tot.set(l.cfop, t)
  }
  const fechar = (t: TotalCfop & { ids: Set<number> }): TotalCfop => ({
    cfop: t.cfop, notas: t.ids.size, ...(Object.fromEntries(CAMPOS.map((k) => [k, r2(t[k])])) as Valores),
  })
  return { linhas, totaisCfop: [...tot.values()].sort((a, b) => a.cfop.localeCompare(b.cfop)).map(fechar), total: fechar(geral) }
}
