// Montagem do XML da NF-e modelo 55, leiaute 4.00 (sem assinatura), para as NF-e de SAÍDA do estoque próprio
// (devolução ao fornecedor e transferência/remessa entre lojas). Puro e determinístico (data/hora e cNF entram prontos):
// node --test lib/nfe-saida/nfe-puro.test.ts — o teste valida o XML assinado contra o XSD oficial (PL_009_V4).
//
// A ordem dos elementos segue o XSD (leiauteNFe_v4.00.xsd); qualquer campo novo precisa entrar na posição certa,
// senão a SEFAZ devolve 225 "Falha no Schema XML".

export type Endereco = {
  xLgr: string; nro: string; xCpl?: string | null; xBairro: string; cMun: string; xMun: string; uf: string; cep: string; fone?: string | null
}

export type IcmsItem =
  | { grupo: 'SN102'; orig: number; csosn: '102' | '103' | '300' | '400' }
  | { grupo: 'SN900'; orig: number; proprio?: IcmsProprio | null; st?: IcmsSt | null }
  | { grupo: '00'; orig: number; proprio: IcmsProprio }
  | { grupo: '40'; orig: number; cst: '40' | '41' | '50' }
  | { grupo: '90'; orig: number; proprio?: IcmsProprio | null; st?: IcmsSt | null }

export type IcmsProprio = { modBC: number; vBC: number; pICMS: number; vICMS: number }
export type IcmsSt = { modBCST: number; pMVAST?: number | null; vBCST: number; pICMSST: number; vICMSST: number }

export type ItemNfeSaida = {
  cProd: string
  cEAN?: string | null // GTIN válido ou vazio (= "SEM GTIN")
  xProd: string
  ncm: string
  cest?: string | null
  cfop: string // 4 dígitos
  uCom: string
  qCom: number
  vUnCom: number
  vFrete?: number
  vSeg?: number
  vDesc?: number
  vOutro?: number
  icms: IcmsItem
  pisCofinsCst: string // PISOutr/COFINSOutr (49, 99...) com valor zero
  ipiDevol?: { pDevol: number; vIPIDevol: number } | null
  infAdProd?: string | null
}

export type DadosNfeSaida = {
  tpAmb: 1 | 2
  cUF: string // 2 dígitos (IBGE)
  serie: number
  numero: number
  cNF: string // 8 dígitos
  dhEmi: string // AAAA-MM-DDThh:mm:ss-03:00
  natOp: string
  finNFe: 1 | 4 // 1 normal, 4 devolução
  emit: { cnpj: string; xNome: string; xFant?: string | null; ender: Endereco; ie: string; crt: 1 | 2 | 3 | 4 }
  dest: { doc: string; xNome: string; ender: Endereco; ie?: string | null }
  autXml?: string[]
  refNFe?: string[]
  itens: ItemNfeSaida[]
  transp: {
    modFrete: 0 | 1 | 2 | 3 | 4 | 9
    transportadora?: { doc?: string | null; xNome?: string | null; ie?: string | null; xEnder?: string | null; xMun?: string | null; uf?: string | null } | null
    vol?: { qVol?: number | null; esp?: string | null; marca?: string | null; nVol?: string | null; pesoL?: number | null; pesoB?: number | null } | null
  }
  infAdFisco?: string | null
  infCpl?: string | null
  /** Responsável técnico (infRespTec): obrigatório em algumas UFs; só sai com os quatro campos. */
  respTec?: { cnpj: string; contato: string; email: string; fone: string } | null
}

export type TotaisNfe = {
  vBC: number; vICMS: number; vBCST: number; vST: number; vProd: number; vFrete: number; vSeg: number; vDesc: number
  vIPIDevol: number; vOutro: number; vNF: number
}

// CFOPs de SAÍDA com indDevol=1 na tabela de CFOP da NF-e (conferido um a um em 20/10/2026 na tabela publicada com os
// indicadores, ex.: buscadorncm.com.br/cfop/5553). finNFe=4 só aceita estes (rejeição 327); finNFe=1 não pode usá-los
// (rejeição 328). 5.910 e 5.949 NÃO são de devolução.
const SUFIXOS_DEVOLUCAO = ['201', '202', '208', '209', '210', '410', '411', '412', '413', '503', '553', '555', '556', '660', '661', '662', '918', '919', '921']
export const CFOP_DEVOLUCAO_SAIDA: ReadonlySet<string> = new Set(SUFIXOS_DEVOLUCAO.flatMap((s) => [`5${s}`, `6${s}`]))
export const ehCfopDevolucao = (cfop: string) => CFOP_DEVOLUCAO_SAIDA.has((cfop ?? '').replace(/\D/g, ''))

export const AVISO_HOMOLOGACAO_XNOME = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
export const VER_PROC = 'norte-estoque-1.0'

const COD_UF: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26',
  AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
}
export function codigoUfIbge(uf: string | null | undefined): string | null {
  return COD_UF[(uf ?? '').trim().toUpperCase()] ?? null
}

// ------------------------------------------------------------------------------------------------ texto e números
/** Texto para o XML: o schema (TString) só aceita caracteres até U+00FF, sem espaço nas pontas nem repetido.
 *  Troca aspas/travessões tipográficos, tira o que sobra fora do Latin-1, colapsa espaços e corta no tamanho. */
export function textoNfe(s: string | null | undefined, max = 60): string {
  const t = (s ?? '')
    .normalize('NFC')
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, '...')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[^ -ÿ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? t.slice(0, max).trim() : t
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

const tx = (s: string | null | undefined, max = 60) => escapeXml(textoNfe(s, max))
const dig = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000
/** Número no formato do XML (ponto decimal, sem "-0"). */
export function dec(n: number, casas: number): string {
  const v = Number.isFinite(n) ? n : 0
  const s = v.toFixed(casas)
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s
}

/** GTIN com dígito verificador certo (8, 12, 13 ou 14 dígitos); senão null. */
export function gtinValido(g: string | null | undefined): string | null {
  const d = dig(g)
  if (![8, 12, 13, 14].includes(d.length)) return null
  const nums = d.split('').map(Number)
  const dv = nums.pop()!
  let soma = 0
  nums.reverse().forEach((n, i) => { soma += n * (i % 2 === 0 ? 3 : 1) })
  return (10 - (soma % 10)) % 10 === dv ? d : null
}

// ------------------------------------------------------------------------------------------------ chave de acesso
export function dvModulo11(chave43: string): number {
  let soma = 0
  let peso = 2
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

export function montarChave(p: { cUF: string; dhEmi: string; cnpj: string; serie: number; numero: number; tpEmis?: number; cNF: string }): string {
  const aamm = p.dhEmi.slice(2, 4) + p.dhEmi.slice(5, 7)
  const sem = `${p.cUF.padStart(2, '0')}${aamm}${dig(p.cnpj).padStart(14, '0')}55${String(p.serie).padStart(3, '0')}${String(p.numero).padStart(9, '0')}${p.tpEmis ?? 1}${p.cNF}`
  if (sem.length !== 43) throw new Error('Chave de acesso com tamanho errado')
  return sem + dvModulo11(sem)
}

/** cNF aleatório de 8 dígitos, diferente do número da nota (regra da SEFAZ). `aleatorio` entra para o teste. */
export function gerarCnf(numero: number, aleatorio: () => number = Math.random): string {
  for (let i = 0; i < 50; i++) {
    const c = String(Math.floor(aleatorio() * 1e8) % 1e8).padStart(8, '0')
    if (Number(c) !== numero && c !== '00000000') return c
  }
  return numero === 13579246 ? '24681357' : '13579246'
}

/** Data e hora de São Paulo com o fuso fixo -03:00 (o Brasil não tem horário de verão desde 2019). */
export function dataHoraSaoPaulo(agora: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}-03:00`
}

// ------------------------------------------------------------------------------------------------ validação
export function validarDadosNfe(d: DadosNfeSaida): string[] {
  const e: string[] = []
  const end = (quem: string, x: Endereco) => {
    if (textoNfe(x.xLgr).length < 2) e.push(`${quem}: logradouro do endereço`)
    if (!textoNfe(x.nro)) e.push(`${quem}: número do endereço (use S/N se não houver)`)
    if (textoNfe(x.xBairro).length < 2) e.push(`${quem}: bairro`)
    if (!/^\d{7}$/.test(x.cMun)) e.push(`${quem}: código IBGE do município (7 dígitos)`)
    if (textoNfe(x.xMun).length < 2) e.push(`${quem}: município`)
    if (!codigoUfIbge(x.uf)) e.push(`${quem}: UF`)
    if (!/^\d{8}$/.test(dig(x.cep))) e.push(`${quem}: CEP (8 dígitos)`)
  }
  if (!/^\d{2}$/.test(d.cUF)) e.push('Emitente: UF')
  if (!/^\d{8}$/.test(d.cNF)) e.push('cNF inválido')
  if (!(d.numero >= 1 && d.numero <= 999999999)) e.push('Número da NF-e inválido')
  if (!(d.serie >= 0 && d.serie <= 999)) e.push('Série inválida')
  if (dig(d.emit.cnpj).length !== 14) e.push('Emitente: CNPJ')
  if (textoNfe(d.emit.xNome).length < 2) e.push('Emitente: razão social')
  if (!/^(\d{2,14}|ISENTO)$/.test((d.emit.ie ?? '').replace(/[.\-/\s]/g, '').toUpperCase())) e.push('Emitente: inscrição estadual')
  end('Emitente', d.emit.ender)
  const doc = dig(d.dest.doc)
  if (doc.length !== 14 && doc.length !== 11) e.push('Destinatário: CNPJ/CPF')
  if (textoNfe(d.dest.xNome).length < 2) e.push('Destinatário: nome')
  end('Destinatário', d.dest.ender)
  if (!d.itens.length) e.push('A nota não tem itens')
  if (d.itens.length > 990) e.push('No máximo 990 itens por NF-e')
  if (d.finNFe === 4 && !(d.refNFe ?? []).length) e.push('Devolução precisa da chave da NF-e de origem')
  for (const [i, it] of d.itens.entries()) {
    const n = `Item ${i + 1}`
    if (!textoNfe(it.cProd)) e.push(`${n}: código do produto`)
    if (!textoNfe(it.xProd, 120)) e.push(`${n}: descrição`)
    if (!/^\d{8}$/.test(dig(it.ncm))) e.push(`${n} (${textoNfe(it.xProd, 40)}): NCM com 8 dígitos`)
    if (it.cest && !/^\d{7}$/.test(dig(it.cest))) e.push(`${n}: CEST com 7 dígitos`)
    if (!/^[1235-7]\d{3}$/.test(it.cfop)) e.push(`${n}: CFOP`)
    else if (d.finNFe === 4 && !ehCfopDevolucao(it.cfop)) e.push(`${n} (${textoNfe(it.xProd, 40)}): CFOP ${it.cfop} não é de devolução (a SEFAZ recusa com 327)`)
    else if (d.finNFe !== 4 && ehCfopDevolucao(it.cfop)) e.push(`${n}: CFOP ${it.cfop} é de devolução e a nota não é de devolução (328)`)
    if (!textoNfe(it.uCom, 6)) e.push(`${n}: unidade`)
    if (!(it.qCom > 0)) e.push(`${n}: quantidade`)
    if (!(it.vUnCom >= 0)) e.push(`${n}: valor unitário`)
  }
  const rt = d.respTec
  if (rt && (rt.cnpj || rt.contato || rt.email || rt.fone)) {
    if (dig(rt.cnpj).length !== 14 || textoNfe(rt.contato).length < 2 || textoNfe(rt.email).length < 6 || !/^\d{6,14}$/.test(dig(rt.fone))) {
      e.push('Responsável técnico: preencha CNPJ, contato, e-mail e telefone (ou deixe os quatro vazios)')
    }
  }
  return e
}

/** Destinatário sem IE válida e sem "ISENTO" = não contribuinte (indIEDest 9): a SEFAZ exige operação com consumidor
 *  final (indFinal 1; senão rejeição 696). */
export function indicadorIEDest(ie: string | null | undefined): 1 | 2 | 9 {
  const x = (ie ?? '').toUpperCase().replace(/[.\-/\s]/g, '')
  return /^\d{2,14}$/.test(x) ? 1 : x === 'ISENTO' ? 2 : 9
}

// ------------------------------------------------------------------------------------------------ totais
export function vProdItem(it: ItemNfeSaida): number { return r2(r4(it.qCom) * it.vUnCom) }

export function calcularTotais(itens: ItemNfeSaida[]): TotaisNfe {
  const t: TotaisNfe = { vBC: 0, vICMS: 0, vBCST: 0, vST: 0, vProd: 0, vFrete: 0, vSeg: 0, vDesc: 0, vIPIDevol: 0, vOutro: 0, vNF: 0 }
  for (const it of itens) {
    t.vProd += vProdItem(it)
    t.vFrete += r2(it.vFrete ?? 0); t.vSeg += r2(it.vSeg ?? 0); t.vDesc += r2(it.vDesc ?? 0); t.vOutro += r2(it.vOutro ?? 0)
    const ic = it.icms
    if ((ic.grupo === '00' || ic.grupo === '90' || ic.grupo === 'SN900') && ic.proprio) { t.vBC += r2(ic.proprio.vBC); t.vICMS += r2(ic.proprio.vICMS) }
    if ((ic.grupo === '90' || ic.grupo === 'SN900') && ic.st) { t.vBCST += r2(ic.st.vBCST); t.vST += r2(ic.st.vICMSST) }
    if (it.ipiDevol) t.vIPIDevol += r2(it.ipiDevol.vIPIDevol)
  }
  for (const k of Object.keys(t) as (keyof TotaisNfe)[]) t[k] = r2(t[k])
  // vNF = vProd − vDesc − vICMSDeson + vST + vFCPST + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol + vServ (regra 610)
  t.vNF = r2(t.vProd - t.vDesc + t.vST + t.vFrete + t.vSeg + t.vOutro + t.vIPIDevol)
  return t
}

// ------------------------------------------------------------------------------------------------ XML
function enderecoXml(tag: 'enderEmit' | 'enderDest', x: Endereco): string {
  const fone = dig(x.fone)
  return `<${tag}><xLgr>${tx(x.xLgr)}</xLgr><nro>${tx(x.nro)}</nro>${textoNfe(x.xCpl) ? `<xCpl>${tx(x.xCpl)}</xCpl>` : ''}` +
    `<xBairro>${tx(x.xBairro)}</xBairro><cMun>${x.cMun}</cMun><xMun>${tx(x.xMun)}</xMun><UF>${x.uf.toUpperCase()}</UF>` +
    `<CEP>${dig(x.cep)}</CEP><cPais>1058</cPais><xPais>BRASIL</xPais>${fone.length >= 6 && fone.length <= 14 ? `<fone>${fone}</fone>` : ''}</${tag}>`
}

function icmsXml(ic: IcmsItem): string {
  const prop = (p: IcmsProprio) => `<modBC>${p.modBC}</modBC><vBC>${dec(p.vBC, 2)}</vBC><pICMS>${dec(p.pICMS, 4)}</pICMS><vICMS>${dec(p.vICMS, 2)}</vICMS>`
  const st = (s: IcmsSt) => `<modBCST>${s.modBCST}</modBCST>${s.pMVAST != null && s.modBCST === 4 ? `<pMVAST>${dec(s.pMVAST, 4)}</pMVAST>` : ''}` +
    `<vBCST>${dec(s.vBCST, 2)}</vBCST><pICMSST>${dec(s.pICMSST, 4)}</pICMSST><vICMSST>${dec(s.vICMSST, 2)}</vICMSST>`
  switch (ic.grupo) {
    case 'SN102': return `<ICMSSN102><orig>${ic.orig}</orig><CSOSN>${ic.csosn}</CSOSN></ICMSSN102>`
    case 'SN900': return `<ICMSSN900><orig>${ic.orig}</orig><CSOSN>900</CSOSN>${ic.proprio ? prop(ic.proprio) : ''}${ic.st ? st(ic.st) : ''}</ICMSSN900>`
    case '00': return `<ICMS00><orig>${ic.orig}</orig><CST>00</CST>${prop(ic.proprio)}</ICMS00>`
    case '40': return `<ICMS40><orig>${ic.orig}</orig><CST>${ic.cst}</CST></ICMS40>`
    case '90': return `<ICMS90><orig>${ic.orig}</orig><CST>90</CST>${ic.proprio ? prop(ic.proprio) : ''}${ic.st ? st(ic.st) : ''}</ICMS90>`
  }
}

function itemXml(it: ItemNfeSaida, n: number): string {
  const ean = gtinValido(it.cEAN) ?? 'SEM GTIN'
  const q = dec(r4(it.qCom), 4)
  const vu = dec(it.vUnCom, 10)
  const u = tx(it.uCom, 6)
  const opc = (tag: string, v?: number) => (v && r2(v) > 0 ? `<${tag}>${dec(v, 2)}</${tag}>` : '')
  const prod =
    `<prod><cProd>${tx(it.cProd)}</cProd><cEAN>${ean}</cEAN><xProd>${tx(it.xProd, 120)}</xProd><NCM>${dig(it.ncm)}</NCM>` +
    (it.cest && /^\d{7}$/.test(dig(it.cest)) ? `<CEST>${dig(it.cest)}</CEST>` : '') +
    `<CFOP>${it.cfop}</CFOP><uCom>${u}</uCom><qCom>${q}</qCom><vUnCom>${vu}</vUnCom><vProd>${dec(vProdItem(it), 2)}</vProd>` +
    `<cEANTrib>${ean}</cEANTrib><uTrib>${u}</uTrib><qTrib>${q}</qTrib><vUnTrib>${vu}</vUnTrib>` +
    opc('vFrete', it.vFrete) + opc('vSeg', it.vSeg) + opc('vDesc', it.vDesc) + opc('vOutro', it.vOutro) +
    `<indTot>1</indTot></prod>`
  const cst = it.pisCofinsCst
  const imposto =
    `<imposto><ICMS>${icmsXml(it.icms)}</ICMS>` +
    `<PIS><PISOutr><CST>${cst}</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>` +
    `<COFINS><COFINSOutr><CST>${cst}</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS></imposto>`
  const devol = it.ipiDevol && r2(it.ipiDevol.vIPIDevol) > 0
    ? `<impostoDevol><pDevol>${dec(Math.min(100, it.ipiDevol.pDevol), 2)}</pDevol><IPI><vIPIDevol>${dec(it.ipiDevol.vIPIDevol, 2)}</vIPIDevol></IPI></impostoDevol>`
    : ''
  const inf = textoNfe(it.infAdProd, 500) ? `<infAdProd>${tx(it.infAdProd, 500)}</infAdProd>` : ''
  return `<det nItem="${n}">${prod}${imposto}${devol}${inf}</det>`
}

function transpXml(t: DadosNfeSaida['transp']): string {
  let x = `<transp><modFrete>${t.modFrete}</modFrete>`
  const tr = t.transportadora
  if (tr && (dig(tr.doc) || textoNfe(tr.xNome))) {
    const doc = dig(tr.doc)
    const ie = (tr.ie ?? '').replace(/\D/g, '')
    x += '<transporta>' +
      (doc.length === 14 ? `<CNPJ>${doc}</CNPJ>` : doc.length === 11 ? `<CPF>${doc}</CPF>` : '') +
      (textoNfe(tr.xNome) ? `<xNome>${tx(tr.xNome)}</xNome>` : '') +
      (ie.length >= 2 ? `<IE>${ie}</IE>` : '') +
      (textoNfe(tr.xEnder) ? `<xEnder>${tx(tr.xEnder)}</xEnder>` : '') +
      (textoNfe(tr.xMun) ? `<xMun>${tx(tr.xMun)}</xMun>` : '') +
      (codigoUfIbge(tr.uf) ? `<UF>${(tr.uf ?? '').toUpperCase()}</UF>` : '') +
      '</transporta>'
  }
  const v = t.vol
  if (v && (v.qVol || textoNfe(v.esp) || v.pesoL || v.pesoB)) {
    x += '<vol>' +
      (v.qVol && v.qVol > 0 ? `<qVol>${Math.round(v.qVol)}</qVol>` : '') +
      (textoNfe(v.esp) ? `<esp>${tx(v.esp)}</esp>` : '') +
      (textoNfe(v.marca) ? `<marca>${tx(v.marca)}</marca>` : '') +
      (textoNfe(v.nVol) ? `<nVol>${tx(v.nVol)}</nVol>` : '') +
      (v.pesoL && v.pesoL > 0 ? `<pesoL>${dec(v.pesoL, 3)}</pesoL>` : '') +
      (v.pesoB && v.pesoB > 0 ? `<pesoB>${dec(v.pesoB, 3)}</pesoB>` : '') +
      '</vol>'
  }
  return x + '</transp>'
}

export function montarNfe(d: DadosNfeSaida): { xml: string; chave: string; id: string; totais: TotaisNfe } {
  const erros = validarDadosNfe(d)
  if (erros.length) throw new Error(`Dados incompletos para a NF-e: ${erros.join('; ')}`)
  const chave = montarChave({ cUF: d.cUF, dhEmi: d.dhEmi, cnpj: d.emit.cnpj, serie: d.serie, numero: d.numero, cNF: d.cNF })
  const id = `NFe${chave}`
  const totais = calcularTotais(d.itens)
  const idDest = d.emit.ender.uf.toUpperCase() === d.dest.ender.uf.toUpperCase() ? 1 : 2
  const refs = [...new Set((d.refNFe ?? []).filter((c) => /^\d{44}$/.test(c)))]

  const docDest = dig(d.dest.doc)
  const ieDest = (d.dest.ie ?? '').toUpperCase().replace(/[.\-/\s]/g, '')
  const indIEDest = indicadorIEDest(ieDest)
  const indFinal = indIEDest === 9 ? 1 : 0

  const ide =
    `<ide><cUF>${d.cUF}</cUF><cNF>${d.cNF}</cNF><natOp>${tx(d.natOp)}</natOp><mod>55</mod><serie>${d.serie}</serie>` +
    `<nNF>${d.numero}</nNF><dhEmi>${d.dhEmi}</dhEmi><tpNF>1</tpNF><idDest>${idDest}</idDest><cMunFG>${d.emit.ender.cMun}</cMunFG>` +
    `<tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>${d.tpAmb}</tpAmb><finNFe>${d.finNFe}</finNFe>` +
    `<indFinal>${indFinal}</indFinal><indPres>9</indPres><indIntermed>0</indIntermed><procEmi>0</procEmi><verProc>${VER_PROC}</verProc>` +
    refs.map((c) => `<NFref><refNFe>${c}</refNFe></NFref>`).join('') +
    `</ide>`

  const ieEmit = (d.emit.ie ?? '').replace(/[.\-/\s]/g, '').toUpperCase()
  const emit =
    `<emit><CNPJ>${dig(d.emit.cnpj)}</CNPJ><xNome>${tx(d.emit.xNome)}</xNome>${textoNfe(d.emit.xFant) ? `<xFant>${tx(d.emit.xFant)}</xFant>` : ''}` +
    `${enderecoXml('enderEmit', d.emit.ender)}<IE>${ieEmit}</IE><CRT>${d.emit.crt}</CRT></emit>`

  const xNomeDest = d.tpAmb === 2 ? AVISO_HOMOLOGACAO_XNOME : textoNfe(d.dest.xNome)
  const dest =
    `<dest>${docDest.length === 14 ? `<CNPJ>${docDest}</CNPJ>` : `<CPF>${docDest}</CPF>`}<xNome>${escapeXml(xNomeDest)}</xNome>` +
    `${enderecoXml('enderDest', d.dest.ender)}<indIEDest>${indIEDest}</indIEDest>${indIEDest === 1 ? `<IE>${ieDest}</IE>` : ''}</dest>`

  const aut = [...new Set((d.autXml ?? []).map(dig).filter((c) => c.length === 14 && c !== dig(d.emit.cnpj) && c !== docDest))].slice(0, 10)
  const autXml = aut.map((c) => `<autXML><CNPJ>${c}</CNPJ></autXML>`).join('')

  const total =
    `<total><ICMSTot><vBC>${dec(totais.vBC, 2)}</vBC><vICMS>${dec(totais.vICMS, 2)}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP>` +
    `<vBCST>${dec(totais.vBCST, 2)}</vBCST><vST>${dec(totais.vST, 2)}</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${dec(totais.vProd, 2)}</vProd><vFrete>${dec(totais.vFrete, 2)}</vFrete><vSeg>${dec(totais.vSeg, 2)}</vSeg><vDesc>${dec(totais.vDesc, 2)}</vDesc>` +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>${dec(totais.vIPIDevol, 2)}</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS>` +
    `<vOutro>${dec(totais.vOutro, 2)}</vOutro><vNF>${dec(totais.vNF, 2)}</vNF></ICMSTot></total>`

  // Devolução, transferência e remessa não têm pagamento: tPag 90 "Sem pagamento" (obrigatório para finNFe 3/4).
  const pag = `<pag><detPag><tPag>90</tPag><vPag>0.00</vPag></detPag></pag>`

  const fisco = textoNfe(d.infAdFisco, 2000)
  const cpl = textoNfe(d.infCpl, 5000)
  const infAdic = fisco || cpl ? `<infAdic>${fisco ? `<infAdFisco>${tx(fisco, 2000)}</infAdFisco>` : ''}${cpl ? `<infCpl>${tx(cpl, 5000)}</infCpl>` : ''}</infAdic>` : ''

  const rt = d.respTec
  const respTec = rt && dig(rt.cnpj).length === 14 && textoNfe(rt.contato).length >= 2 && textoNfe(rt.email).length >= 6 && /^\d{6,14}$/.test(dig(rt.fone))
    ? `<infRespTec><CNPJ>${dig(rt.cnpj)}</CNPJ><xContato>${tx(rt.contato)}</xContato><email>${tx(rt.email)}</email><fone>${dig(rt.fone)}</fone></infRespTec>`
    : ''

  // ordem do infNFe no XSD: ... pag, infIntermed, infAdic, exporta, compra, cana, infRespTec
  const xml =
    `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="${id}">` +
    ide + emit + dest + autXml + d.itens.map((it, i) => itemXml(it, i + 1)).join('') + total + transpXml(d.transp) + pag + infAdic + respTec +
    `</infNFe></NFe>`
  return { xml, chave, id, totais }
}
