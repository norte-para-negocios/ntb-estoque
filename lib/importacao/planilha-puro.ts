// Importação por planilha (Fase G [K10/O6], migration 223) e validações fiscais do cadastro (K1). Puro (sem @/):
// node --test lib/importacao/planilha-puro.test.ts
// Uma linha da planilha vira uma "linha de prévia": novo | atualizar | sem_mudanca | erro, com os erros em português.
// Chave do produto: código (se veio) → EAN → descrição (sem acento/caixa). Chave do fornecedor: CNPJ/CPF → razão social.
// Só os campos PREENCHIDOS entram (célula vazia não apaga nada) e só o que mudou vai para "dados".

// ------------------------------------------------------------------------------------------------ validações fiscais
type Valido<T> = { ok: true; valor: T } | { ok: false; erro: string }
const soDigitos = (s: string) => s.replace(/\D/g, '')

export function validarEan(s: string | null | undefined): Valido<string | null> {
  const t = (s ?? '').trim()
  if (!t || /^sem\s*gtin$/i.test(t)) return { ok: true, valor: null }
  const d = soDigitos(t)
  if (![8, 12, 13, 14].includes(d.length)) return { ok: false, erro: 'EAN deve ter 8, 12, 13 ou 14 dígitos' }
  const corpo = d.slice(0, -1)
  let soma = 0
  for (let i = 0; i < corpo.length; i++) soma += Number(corpo[corpo.length - 1 - i]) * (i % 2 === 0 ? 3 : 1)
  const dv = (10 - (soma % 10)) % 10
  if (dv !== Number(d[d.length - 1])) return { ok: false, erro: 'EAN com dígito verificador errado' }
  return { ok: true, valor: d }
}

function dvCnpj(base: string): number {
  const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const s = base.split('').reduce((a, c, i) => a + Number(c) * pesos[i], 0)
  const r = s % 11
  return r < 2 ? 0 : 11 - r
}
function dvCpf(base: string): number {
  const s = base.split('').reduce((a, c, i) => a + Number(c) * (base.length + 1 - i), 0)
  const r = (s * 10) % 11
  return r === 10 ? 0 : r
}

export function validarCnpjCpf(s: string | null | undefined): { ok: true; valor: string | null; pessoaFisica: boolean } | { ok: false; erro: string } {
  const d = soDigitos(s ?? '')
  if (!d) return { ok: true, valor: null, pessoaFisica: false }
  if (/^(\d)\1+$/.test(d)) return { ok: false, erro: 'CNPJ/CPF inválido' }
  if (d.length === 14) {
    const ok = dvCnpj(d.slice(0, 12)) === Number(d[12]) && dvCnpj(d.slice(0, 13)) === Number(d[13])
    return ok ? { ok: true, valor: d, pessoaFisica: false } : { ok: false, erro: 'CNPJ com dígito verificador errado' }
  }
  if (d.length === 11) {
    const ok = dvCpf(d.slice(0, 9)) === Number(d[9]) && dvCpf(d.slice(0, 10)) === Number(d[10])
    return ok ? { ok: true, valor: d, pessoaFisica: true } : { ok: false, erro: 'CPF com dígito verificador errado' }
  }
  return { ok: false, erro: 'CNPJ deve ter 14 dígitos (CPF, 11)' }
}

export function validarNcm(s: string | null | undefined): Valido<string | null> {
  const d = soDigitos(s ?? '')
  if (!d) return { ok: true, valor: null }
  return d.length === 8 ? { ok: true, valor: d } : { ok: false, erro: 'NCM deve ter 8 dígitos' }
}

export function validarCest(s: string | null | undefined): Valido<string | null> {
  const d = soDigitos(s ?? '')
  if (!d) return { ok: true, valor: null }
  return d.length === 7 ? { ok: true, valor: d } : { ok: false, erro: 'CEST deve ter 7 dígitos' }
}

/** Origem da mercadoria (tabela A do ICMS): 0 a 8. Aceita "0 - Nacional". */
export function validarOrigem(s: string | null | undefined): Valido<string | null> {
  const t = (s ?? '').trim()
  if (!t) return { ok: true, valor: null }
  const m = t.match(/^(\d)(\s*[-–].*)?$/)
  return m && Number(m[1]) <= 8 ? { ok: true, valor: m[1] } : { ok: false, erro: 'Origem deve ser de 0 a 8' }
}

const TIPOS_ITEM = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '99']
export function validarTipoItem(s: string | null | undefined): Valido<string | null> {
  const t = (s ?? '').trim()
  if (!t) return { ok: true, valor: null }
  const m = t.match(/^(\d{1,2})\b/)
  const v = m ? m[1].padStart(2, '0') : ''
  return TIPOS_ITEM.includes(v) ? { ok: true, valor: v } : { ok: false, erro: 'Tipo do item deve ser um código SPED (00 a 10 ou 99)' }
}

// ------------------------------------------------------------------------------------------------ números e sim/não
export function parseNumeroBR(s: string | null | undefined): number | null {
  let t = (s ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
}

/** true/false; null = vazio; undefined = não entendi. */
export function parseSimNao(s: string | null | undefined): boolean | null | undefined {
  const t = semAcento((s ?? '').trim())
  if (!t) return null
  if (['sim', 's', 'x', 'true', '1', 'verdadeiro'].includes(t)) return true
  if (['nao', 'n', 'false', '0', 'falso'].includes(t)) return false
  return undefined
}

// ------------------------------------------------------------------------------------------------ leitura
export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
const chaveTexto = (s: string) => semAcento(s).replace(/\s+/g, ' ').trim()

/** CSV com ; ou , (o que aparecer primeiro fora de aspas no cabeçalho), aspas e BOM. */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '')
  const primeira = t.split(/\r?\n/, 1)[0] ?? ''
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : ','
  const linhas: string[][] = []
  let linha: string[] = []
  let campo = ''
  let aspas = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') aspas = false
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === sep) { linha.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      linha.push(campo); linhas.push(linha); linha = []; campo = ''
    } else campo += c
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha) }
  return linhas
}

export type TipoImportacao = 'produtos' | 'fornecedores'

export const COLUNAS: Record<TipoImportacao, { chave: string; titulo: string; obrigatoria?: boolean; exemplo: string; ajuda: string }[]> = {
  produtos: [
    { chave: 'codigo', titulo: 'Código', exemplo: '', ajuda: 'Vazio = o sistema cria (por tipo). Se já existir, o produto é atualizado.' },
    { chave: 'descricao', titulo: 'Descrição', obrigatoria: true, exemplo: 'Tomate italiano', ajuda: 'Obrigatória para produto novo.' },
    { chave: 'unidade', titulo: 'Unidade', obrigatoria: true, exemplo: 'KG', ajuda: 'UN, KG, L, CX...' },
    { chave: 'tipo', titulo: 'Tipo', exemplo: '01', ajuda: 'Código SPED: 00 revenda, 01 matéria-prima, 04 produto acabado... (vazio = 04 no novo)' },
    { chave: 'familia', titulo: 'Família', exemplo: 'Hortifruti', ajuda: 'Nome de uma família já cadastrada.' },
    { chave: 'ncm', titulo: 'NCM', exemplo: '07020000', ajuda: '8 dígitos.' },
    { chave: 'ean', titulo: 'EAN', exemplo: '', ajuda: 'Código de barras (8, 12, 13 ou 14 dígitos) ou vazio.' },
    { chave: 'cest', titulo: 'CEST', exemplo: '', ajuda: '7 dígitos.' },
    { chave: 'origem', titulo: 'Origem', exemplo: '0', ajuda: '0 a 8 (0 = nacional).' },
    { chave: 'preco_venda', titulo: 'Preço de venda', exemplo: '12,90', ajuda: 'Vírgula ou ponto decimal.' },
    { chave: 'estoque_minimo', titulo: 'Estoque mínimo', exemplo: '5', ajuda: 'Na unidade do produto.' },
    { chave: 'pdv', titulo: 'PDV', exemplo: 'não', ajuda: 'sim/não: aparece no cardápio do Norte Vendas.' },
    { chave: 'validade_dias', titulo: 'Validade (dias)', exemplo: '7', ajuda: 'Prazo de validade em dias.' },
    { chave: 'inativo', titulo: 'Inativo', exemplo: 'não', ajuda: 'sim/não.' },
  ],
  fornecedores: [
    { chave: 'razao_social', titulo: 'Razão social', obrigatoria: true, exemplo: 'Hortifruti Bahia Ltda', ajuda: 'Obrigatória para fornecedor novo.' },
    { chave: 'nome_fantasia', titulo: 'Nome fantasia', exemplo: 'Horti Bahia', ajuda: '' },
    { chave: 'cnpj_cpf', titulo: 'CNPJ/CPF', exemplo: '11.222.333/0001-81', ajuda: 'Com ou sem pontuação. Se já existir, o fornecedor é atualizado.' },
    { chave: 'inscricao_estadual', titulo: 'Inscrição estadual', exemplo: '', ajuda: '' },
    { chave: 'email', titulo: 'E-mail', exemplo: 'compras@hortibahia.com.br', ajuda: '' },
    { chave: 'telefone', titulo: 'Telefone', exemplo: '(71) 99999-0000', ajuda: '' },
    { chave: 'cep', titulo: 'CEP', exemplo: '40000-000', ajuda: '' },
    { chave: 'uf', titulo: 'UF', exemplo: 'BA', ajuda: 'Sigla do estado.' },
    { chave: 'cidade', titulo: 'Cidade', exemplo: 'Salvador', ajuda: '' },
    { chave: 'bairro', titulo: 'Bairro', exemplo: '', ajuda: '' },
    { chave: 'logradouro', titulo: 'Endereço', exemplo: 'Rua das Flores', ajuda: '' },
    { chave: 'numero', titulo: 'Número', exemplo: '100', ajuda: '' },
    { chave: 'complemento', titulo: 'Complemento', exemplo: '', ajuda: '' },
  ],
}

const APELIDOS: Record<TipoImportacao, Record<string, string>> = {
  produtos: {
    cod: 'codigo', codigo_do_produto: 'codigo', sku: 'codigo', produto: 'descricao', nome: 'descricao', descricao_do_produto: 'descricao',
    un: 'unidade', und: 'unidade', tipo_do_item: 'tipo', tipo_item: 'tipo', preco: 'preco_venda', preco_de_venda: 'preco_venda', valor: 'preco_venda',
    valor_unitario: 'preco_venda', minimo: 'estoque_minimo', estoque_minimo: 'estoque_minimo', codigo_de_barras: 'ean', gtin: 'ean',
    validade: 'validade_dias', validade_dias: 'validade_dias', origem_da_mercadoria: 'origem', produto_de_pdv: 'pdv',
  },
  fornecedores: {
    razao: 'razao_social', nome: 'razao_social', fantasia: 'nome_fantasia', cnpj: 'cnpj_cpf', cpf: 'cnpj_cpf', cnpj_cpf: 'cnpj_cpf',
    documento: 'cnpj_cpf', ie: 'inscricao_estadual', e_mail: 'email', fone: 'telefone', celular: 'telefone', estado: 'uf',
    municipio: 'cidade', endereco: 'logradouro', rua: 'logradouro', n: 'numero', numero: 'numero',
  },
}

export function normalizarCabecalho(h: string, tipo: TipoImportacao): string | null {
  const k = semAcento(h.trim()).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const validas = COLUNAS[tipo].map((c) => c.chave)
  if (validas.includes(k)) return k
  return APELIDOS[tipo][k] ?? null
}

export type LinhaPlanilha = { n: number; valores: Record<string, string> }

export function lerTabela(linhas: string[][], tipo: TipoImportacao): { linhas: LinhaPlanilha[]; desconhecidas: string[]; colunas: string[] } {
  const cab = linhas[0] ?? []
  const mapa: (string | null)[] = cab.map((h) => normalizarCabecalho(String(h ?? ''), tipo))
  const desconhecidas = cab.filter((h, i) => String(h ?? '').trim() && !mapa[i]).map((h) => String(h).trim())
  const out: LinhaPlanilha[] = []
  linhas.slice(1).forEach((l, i) => {
    const valores: Record<string, string> = {}
    mapa.forEach((col, j) => {
      const v = String(l[j] ?? '').trim()
      if (col && v && valores[col] === undefined) valores[col] = v
    })
    if (Object.keys(valores).length) out.push({ n: i + 2, valores })
  })
  return { linhas: out, desconhecidas, colunas: [...new Set(mapa.filter((c): c is string => !!c))] }
}

// ------------------------------------------------------------------------------------------------ prévia
export type AcaoLinha = 'novo' | 'atualizar' | 'sem_mudanca' | 'erro'
export type LinhaPrevia = { n: number; acao: AcaoLinha; chave: string; alvo: number | null; dados: Record<string, string | number | boolean | null>; erros: string[] }

export type ProdutoExistente = {
  codigoProduto: number; codigo: string | null; descricao: string | null; unidade: string | null; ean: string | null; ncm: string | null
  tipoItem: string | null; valorUnitario: number | null; estoqueMinimo: number | null; pdv: boolean; inativo: boolean
  codigoFamilia: number | null; validadeDias: number | null; cest: string | null; origem: string | null
}

const igual = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9)

export function prepararProdutos(linhas: LinhaPlanilha[], ctx: { familias: { codigo: number; descricao: string }[]; existentes: ProdutoExistente[] }): LinhaPrevia[] {
  const porCodigo = new Map(ctx.existentes.filter((p) => p.codigo).map((p) => [chaveTexto(p.codigo as string), p]))
  const porEan = new Map(ctx.existentes.filter((p) => p.ean).map((p) => [p.ean as string, p]))
  const porDescricao = new Map<string, ProdutoExistente>()
  for (const p of ctx.existentes) if (p.descricao && !porDescricao.has(chaveTexto(p.descricao))) porDescricao.set(chaveTexto(p.descricao), p)
  const familia = new Map(ctx.familias.map((f) => [chaveTexto(f.descricao), f]))
  const vistas = new Map<string, number>()

  return linhas.map(({ n, valores: v }) => {
    const erros: string[] = []
    const dados: LinhaPrevia['dados'] = {}
    const ean = validarEan(v.ean); if (!ean.ok) erros.push(ean.erro)
    const ncm = validarNcm(v.ncm); if (!ncm.ok) erros.push(ncm.erro)
    const cest = validarCest(v.cest); if (!cest.ok) erros.push(cest.erro)
    const origem = validarOrigem(v.origem); if (!origem.ok) erros.push(origem.erro)
    const tipo = validarTipoItem(v.tipo); if (!tipo.ok) erros.push(tipo.erro)
    const num = (col: string, rotulo: string, inteiro = false) => {
      const x = parseNumeroBR(v[col])
      if (x == null) return null
      if (Number.isNaN(x) || x < 0 || (inteiro && !Number.isInteger(x))) { erros.push(`${rotulo} inválido`); return null }
      return x
    }
    const sn = (col: string, rotulo: string) => {
      const x = parseSimNao(v[col])
      if (x === undefined) { erros.push(`${rotulo}: use sim ou não`); return null }
      return x
    }
    const preco = num('preco_venda', 'Preço de venda')
    const minimo = num('estoque_minimo', 'Estoque mínimo')
    const validade = num('validade_dias', 'Validade (dias)', true)
    if (validade != null && (validade < 1 || validade > 3650)) erros.push('Validade (dias) deve ser de 1 a 3650')
    const pdv = sn('pdv', 'PDV')
    const inativo = sn('inativo', 'Inativo')
    let fam: { codigo: number; descricao: string } | null = null
    if (v.familia) {
      fam = familia.get(chaveTexto(v.familia)) ?? null
      if (!fam) erros.push(`Família "${v.familia}" não cadastrada`)
    }
    if (v.codigo && v.codigo.length > 60) erros.push('Código com mais de 60 caracteres')
    if (v.descricao && v.descricao.length > 120) erros.push('Descrição com mais de 120 caracteres')
    if (v.unidade && v.unidade.length > 6) erros.push('Unidade com mais de 6 caracteres')

    // chave e alvo
    const eanValor = ean.ok ? ean.valor : null
    let alvo: ProdutoExistente | undefined
    let porDesc = false
    if (v.codigo) alvo = porCodigo.get(chaveTexto(v.codigo))
    else if (eanValor) alvo = porEan.get(eanValor)
    else if (v.descricao) { alvo = porDescricao.get(chaveTexto(v.descricao)); porDesc = !!alvo }
    const chave = v.codigo ? `código ${v.codigo}` : eanValor ? `EAN ${eanValor}` : v.descricao ? `descrição "${v.descricao}"` : ''
    if (!chave) erros.push('Informe código, EAN ou descrição')
    const ck = JSON.stringify([v.codigo ? 'c' : eanValor ? 'e' : 'd', chaveTexto(v.codigo || eanValor || v.descricao || '')])
    if (chave && vistas.has(ck)) erros.unshift(`Produto repetido na linha ${vistas.get(ck)} da planilha`)
    else if (chave) vistas.set(ck, n)
    if (eanValor) {
      const dono = porEan.get(eanValor)
      if (dono && dono !== alvo) erros.push(`EAN já é do produto ${dono.codigo ?? dono.codigoProduto}`)
    }

    const campos: [string, unknown, unknown][] = [
      ['codigo', alvo ? undefined : v.codigo || undefined, undefined],
      ['descricao', porDesc ? undefined : v.descricao || undefined, alvo?.descricao],
      ['unidade', v.unidade ? v.unidade.toUpperCase() : undefined, alvo?.unidade],
      ['tipo_item', tipo.ok ? tipo.valor ?? undefined : undefined, alvo?.tipoItem],
      ['codigo_familia', fam?.codigo, alvo?.codigoFamilia],
      ['descricao_familia', fam?.descricao, undefined],
      ['ncm', ncm.ok ? ncm.valor ?? undefined : undefined, alvo?.ncm],
      ['ean', eanValor ?? undefined, alvo?.ean],
      ['cest', cest.ok ? cest.valor ?? undefined : undefined, alvo?.cest],
      ['origem', origem.ok ? origem.valor ?? undefined : undefined, alvo?.origem],
      ['valor_unitario', preco ?? undefined, alvo?.valorUnitario],
      ['estoque_minimo', minimo ?? undefined, alvo?.estoqueMinimo],
      ['pdv', pdv ?? undefined, alvo?.pdv],
      ['validade_dias', validade ?? undefined, alvo?.validadeDias],
      ['inativo', inativo ?? undefined, alvo?.inativo],
    ]
    for (const [col, novo, atual] of campos) {
      if (novo === undefined) continue
      if (alvo && col !== 'descricao_familia' && igual(novo, atual)) continue
      if (alvo && col === 'descricao_familia' && igual(fam?.codigo, alvo.codigoFamilia)) continue
      dados[col] = novo as string | number | boolean
    }
    if (!alvo) {
      if (!v.descricao) erros.push('Produto novo precisa de descrição')
      if (!v.unidade) erros.push('Produto novo precisa de unidade')
    }
    const acao: AcaoLinha = erros.length ? 'erro' : !alvo ? 'novo' : Object.keys(dados).length ? 'atualizar' : 'sem_mudanca'
    return { n, acao, chave, alvo: alvo?.codigoProduto ?? null, dados: acao === 'erro' ? {} : dados, erros }
  })
}

export type FornecedorExistente = {
  id: number; razaoSocial: string; nomeFantasia: string | null; cnpjCpf: string | null; inscricaoEstadual: string | null; email: string | null
  telefone: string | null; cep: string | null; uf: string | null; cidade: string | null; bairro: string | null; logradouro: string | null
  numero: string | null; complemento: string | null
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']

export function prepararFornecedores(linhas: LinhaPlanilha[], ctx: { existentes: FornecedorExistente[] }): LinhaPrevia[] {
  const porDoc = new Map(ctx.existentes.filter((f) => f.cnpjCpf).map((f) => [soDigitos(f.cnpjCpf as string), f]))
  const porNome = new Map<string, FornecedorExistente>()
  for (const f of ctx.existentes) if (!porNome.has(chaveTexto(f.razaoSocial))) porNome.set(chaveTexto(f.razaoSocial), f)
  const vistas = new Map<string, number>()
  return linhas.map(({ n, valores: v }) => {
    const erros: string[] = []
    const dados: LinhaPrevia['dados'] = {}
    const doc = validarCnpjCpf(v.cnpj_cpf)
    if (!doc.ok) erros.push(doc.erro)
    const docValor = doc.ok ? doc.valor : null
    const uf = v.uf ? v.uf.toUpperCase() : undefined
    if (uf && !UFS.includes(uf)) erros.push(`UF "${v.uf}" inválida`)
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) erros.push('E-mail inválido')
    const cep = v.cep ? soDigitos(v.cep) : undefined
    if (cep !== undefined && cep.length !== 8) erros.push('CEP deve ter 8 dígitos')
    if (v.razao_social && v.razao_social.length > 150) erros.push('Razão social com mais de 150 caracteres')

    let alvo: FornecedorExistente | undefined
    let porNomeChave = false
    if (docValor) alvo = porDoc.get(docValor)
    else if (v.razao_social) { alvo = porNome.get(chaveTexto(v.razao_social)); porNomeChave = !!alvo }
    const chave = docValor ? `CNPJ/CPF ${docValor}` : v.razao_social ? `razão social "${v.razao_social}"` : ''
    if (!chave) erros.push('Informe CNPJ/CPF ou razão social')
    const ck = docValor ?? chaveTexto(v.razao_social ?? '')
    if (chave && vistas.has(ck)) erros.unshift(`Fornecedor repetido na linha ${vistas.get(ck)} da planilha`)
    else if (chave) vistas.set(ck, n)

    const campos: [string, string | boolean | undefined, unknown][] = [
      ['razao_social', porNomeChave ? undefined : v.razao_social, alvo?.razaoSocial],
      ['nome_fantasia', v.nome_fantasia, alvo?.nomeFantasia],
      ['cnpj_cpf', alvo ? undefined : docValor ?? undefined, undefined],
      ['pessoa_fisica', alvo || !docValor ? undefined : doc.ok && doc.pessoaFisica, undefined],
      ['inscricao_estadual', v.inscricao_estadual, alvo?.inscricaoEstadual],
      ['email', v.email, alvo?.email],
      ['telefone', v.telefone, alvo?.telefone],
      ['cep', cep, alvo?.cep ? soDigitos(alvo.cep) : null],
      ['uf', uf, alvo?.uf],
      ['cidade', v.cidade, alvo?.cidade],
      ['bairro', v.bairro, alvo?.bairro],
      ['logradouro', v.logradouro, alvo?.logradouro],
      ['numero', v.numero, alvo?.numero],
      ['complemento', v.complemento, alvo?.complemento],
    ]
    for (const [col, novo, atual] of campos) {
      if (novo === undefined || novo === '') continue
      if (alvo && igual(novo, atual)) continue
      dados[col] = novo
    }
    if (!alvo && !v.razao_social) erros.push('Fornecedor novo precisa de razão social')
    const acao: AcaoLinha = erros.length ? 'erro' : !alvo ? 'novo' : Object.keys(dados).length ? 'atualizar' : 'sem_mudanca'
    return { n, acao, chave, alvo: alvo?.id ?? null, dados: acao === 'erro' ? {} : dados, erros }
  })
}

export function resumoPrevia(linhas: LinhaPrevia[]): Record<AcaoLinha, number> {
  const r: Record<AcaoLinha, number> = { novo: 0, atualizar: 0, sem_mudanca: 0, erro: 0 }
  for (const l of linhas) r[l.acao]++
  return r
}
