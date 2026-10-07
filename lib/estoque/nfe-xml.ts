// Leitura de NF-e (procNFe / NFe) para a compra do Estoque próprio. Sem dependências: parser XML mínimo e tolerante
// (ignora namespace, comentários, CDATA e declaração), puro e testável com `node --test`.

export type ItemNfe = {
  linha: number
  cProd: string
  ean: string | null
  descricao: string
  ncm: string | null
  cfop: string | null
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotal: number // vProd, antes do desconto do item
  desconto: number // vDesc do item
  icms: number // vICMS do item (informativo; só entra no custo se a compra marcar ICMS recuperável)
}

export type NfeLida = {
  chave: string
  numero: string
  serie: string
  emissao: string | null // YYYY-MM-DD
  modelo: string | null
  naturezaOperacao: string | null
  fornecedor: { cnpj: string; nome: string; fantasia: string | null; ie: string | null }
  valores: { produtos: number; frete: number; desconto: number; descontoNota: number; total: number; icms: number }
  itens: ItemNfe[]
  avisos: string[]
}

type No = { nome: string; attrs: Record<string, string>; filhos: No[]; texto: string }

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const cod = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(cod) ? String.fromCodePoint(cod) : m
    }
    return ENTIDADES[e] ?? m
  })
}

/** Parser de XML minimalista: devolve a raiz. Nomes sem prefixo de namespace. */
export function parseXml(xml: string): No {
  const raiz: No = { nome: '#raiz', attrs: {}, filhos: [], texto: '' }
  const pilha: No[] = [raiz]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const topo = pilha[pilha.length - 1]
    if (m[1] !== undefined) { topo.texto += m[1]; continue }
    if (m[2] !== undefined) {
      const nome = semPrefixo(m[2])
      if (pilha.length > 1 && topo.nome === nome) pilha.pop()
      else throw new Error(`XML inválido: tag </${m[2]}> sem abertura`)
      continue
    }
    if (m[3] !== undefined) {
      const attrs: Record<string, string> = {}
      const reA = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
      let a: RegExpExecArray | null
      while ((a = reA.exec(m[4] ?? ''))) attrs[semPrefixo(a[1])] = decodificar(a[2] ?? a[3] ?? '')
      const no: No = { nome: semPrefixo(m[3]), attrs, filhos: [], texto: '' }
      topo.filhos.push(no)
      if (m[5] !== '/') pilha.push(no)
      continue
    }
    if (m[6] !== undefined && m[0].trim()) topo.texto += decodificar(m[6])
  }
  if (pilha.length !== 1) throw new Error('XML inválido: tag sem fechamento')
  return raiz
}

function semPrefixo(n: string): string {
  const i = n.indexOf(':')
  return i >= 0 ? n.slice(i + 1) : n
}

function achar(no: No | undefined, ...caminho: string[]): No | undefined {
  let atual = no
  for (const nome of caminho) {
    if (!atual) return undefined
    atual = atual.filhos.find((f) => f.nome === nome)
  }
  return atual
}

function buscar(no: No, nome: string): No | undefined {
  if (no.nome === nome) return no
  for (const f of no.filhos) { const r = buscar(f, nome); if (r) return r }
  return undefined
}

const txt = (no: No | undefined, ...caminho: string[]): string => (achar(no, ...caminho)?.texto ?? '').trim()
const num = (s: string): number => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? n : 0 }

export function validarChave(c: string): boolean {
  return /^\d{44}$/.test(c)
}

/** Dígito verificador da chave de acesso (módulo 11). */
export function dvChave(c43: string): number {
  let peso = 2, soma = 0
  for (let i = c43.length - 1; i >= 0; i--) { soma += Number(c43[i]) * peso; peso = peso === 9 ? 2 : peso + 1 }
  const r = soma % 11
  return r < 2 ? 0 : 11 - r
}

export function lerNfe(xml: string): NfeLida {
  const raiz = parseXml(xml)
  if (buscar(raiz, 'resNFe')) throw new Error('Este XML é só o resumo da nota (resNFe), sem itens. Baixe o XML completo (procNFe).')
  const inf = buscar(raiz, 'infNFe')
  if (!inf) throw new Error('Não é um XML de NF-e (infNFe não encontrado).')
  const avisos: string[] = []

  const chave = (inf.attrs.Id ?? '').replace(/^NFe/i, '') || txt(buscar(raiz, 'infProt'), 'chNFe')
  if (!validarChave(chave)) throw new Error('Chave de acesso inválida ou ausente no XML.')
  if (dvChave(chave.slice(0, 43)) !== Number(chave[43])) avisos.push('O dígito verificador da chave de acesso não confere.')

  const ide = achar(inf, 'ide')
  const dh = txt(ide, 'dhEmi') || txt(ide, 'dEmi')
  const emit = achar(inf, 'emit')
  const cnpj = (txt(emit, 'CNPJ') || txt(emit, 'CPF')).replace(/\D/g, '')
  if (!cnpj) avisos.push('Fornecedor sem CNPJ/CPF no XML.')

  const itens: ItemNfe[] = []
  let somaDescItens = 0
  for (const det of inf.filhos.filter((f) => f.nome === 'det')) {
    const prod = achar(det, 'prod')
    if (!prod) continue
    const ean = txt(prod, 'cEAN')
    const desconto = num(txt(prod, 'vDesc'))
    somaDescItens += desconto
    const icmsNo = achar(det, 'imposto', 'ICMS')?.filhos[0]
    itens.push({
      linha: Number(det.attrs.nItem) || itens.length + 1,
      cProd: txt(prod, 'cProd'),
      ean: ean && !/sem\s*gtin/i.test(ean) ? ean : null,
      descricao: txt(prod, 'xProd'),
      ncm: txt(prod, 'NCM') || null,
      cfop: txt(prod, 'CFOP') || null, // informativo: o tipo do produto nunca depende dele
      unidade: txt(prod, 'uCom') || 'UN',
      quantidade: num(txt(prod, 'qCom')),
      valorUnitario: num(txt(prod, 'vUnCom')),
      valorTotal: num(txt(prod, 'vProd')),
      desconto,
      icms: num(txt(icmsNo, 'vICMS')),
    })
  }
  if (!itens.length) throw new Error('A nota não tem itens.')

  const tot = achar(inf, 'total', 'ICMSTot')
  const vProdItens = itens.reduce((a, i) => a + i.valorTotal, 0)
  // Frete, seguro e outras despesas acessórias entram no custo, rateados por valor.
  const frete = num(txt(tot, 'vFrete')) + num(txt(tot, 'vSeg')) + num(txt(tot, 'vOutro'))
  const descTotal = num(txt(tot, 'vDesc'))
  const descontoNota = Math.max(0, Math.round((descTotal - somaDescItens) * 100) / 100)
  const valores = {
    produtos: tot ? num(txt(tot, 'vProd')) : vProdItens,
    frete,
    desconto: descTotal,
    descontoNota,
    total: num(txt(tot, 'vNF')) || vProdItens + frete - descTotal,
    icms: num(txt(tot, 'vICMS')),
  }
  if (tot && Math.abs(valores.produtos - vProdItens) > 0.05) avisos.push('A soma dos itens não bate com o total de produtos da nota.')

  return {
    chave,
    numero: txt(ide, 'nNF'),
    serie: txt(ide, 'serie'),
    emissao: dh ? dh.slice(0, 10) : null,
    modelo: txt(ide, 'mod') || null,
    naturezaOperacao: txt(ide, 'natOp') || null,
    fornecedor: { cnpj, nome: txt(emit, 'xNome'), fantasia: txt(emit, 'xFant') || null, ie: txt(emit, 'IE') || null },
    valores,
    itens,
    avisos,
  }
}
