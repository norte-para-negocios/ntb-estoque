// Importar pedidos de compra por planilha (Fase C2, I5; estoque próprio): leitura e validação linha a linha, puras.
// A planilha chega como matriz de células (texto, número, Date ou vazio); a gravação é a pc_importar (migration 242).
// Sem imports: node --test lib/compras/importar-pedidos-puro.test.ts (o leitor de parcelas vem de fora, em cadastro.lerParcelas).

export type Celula = string | number | boolean | Date | null | undefined
export type Campo =
  | 'pedido' | 'fornecedorCnpj' | 'fornecedorNome' | 'previsao' | 'produto' | 'quantidade' | 'preco' | 'unidade' | 'fator'
  | 'local' | 'numeroFornecedor' | 'parcelas' | 'frete' | 'obs'

/** Colunas do modelo, na ordem do arquivo baixado. */
export const COLUNAS_MODELO: { campo: Campo; titulo: string; ajuda: string; exemplo: string | number }[] = [
  { campo: 'pedido', titulo: 'Pedido', ajuda: 'Linhas com o mesmo valor viram um pedido. Vazio: junta por fornecedor e previsão.', exemplo: 'A' },
  { campo: 'fornecedorCnpj', titulo: 'CNPJ do fornecedor', ajuda: 'Se o fornecedor está cadastrado, o CNPJ basta.', exemplo: '11.222.333/0001-81' },
  { campo: 'fornecedorNome', titulo: 'Fornecedor', ajuda: 'Obrigatório quando não há CNPJ cadastrado.', exemplo: 'Hortifruti Exemplo' },
  { campo: 'previsao', titulo: 'Previsão de entrega', ajuda: 'dd/mm/aaaa.', exemplo: '30/10/2026' },
  { campo: 'produto', titulo: 'Código do produto', ajuda: 'O código do cadastro de produtos.', exemplo: 'P001' },
  { campo: 'quantidade', titulo: 'Quantidade', ajuda: 'Na unidade do pedido. Maior que zero.', exemplo: 10 },
  { campo: 'preco', titulo: 'Preço unitário', ajuda: 'Preço combinado por unidade do pedido. Vazio = 0.', exemplo: 4.5 },
  { campo: 'unidade', titulo: 'Unidade', ajuda: 'Vazio = a unidade do produto.', exemplo: '' },
  { campo: 'fator', titulo: 'Fator', ajuda: 'Unidades de estoque em 1 unidade do pedido (caixa com 12 = 12). Vazio = 1.', exemplo: '' },
  { campo: 'local', titulo: 'Código do local', ajuda: 'Local de estoque. Vazio = o padrão da nota.', exemplo: '' },
  { campo: 'numeroFornecedor', titulo: 'Nº do pedido no fornecedor', ajuda: 'Opcional.', exemplo: '' },
  { campo: 'parcelas', titulo: 'Parcelas', ajuda: 'Dias depois da entrega, ex.: 30/60/90. Vazio = à vista.', exemplo: '30/60' },
  { campo: 'frete', titulo: 'Frete', ajuda: 'Do pedido (uma vez por pedido).', exemplo: '' },
  { campo: 'obs', titulo: 'Observação', ajuda: 'Do item.', exemplo: '' },
]

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

const APELIDOS: Record<Campo, string[]> = {
  pedido: ['pedido', 'agrupador', 'grupo'],
  fornecedorCnpj: ['cnpjdofornecedor', 'cnpj', 'cnpjfornecedor', 'cpfcnpj', 'cnpjcpf'],
  fornecedorNome: ['fornecedor', 'nomedofornecedor', 'razaosocial'],
  previsao: ['previsaodeentrega', 'previsao', 'entrega', 'dataentrega', 'datadeentrega'],
  produto: ['codigodoproduto', 'codigo', 'codproduto', 'produto', 'sku'],
  quantidade: ['quantidade', 'qtd', 'qtde', 'quant'],
  preco: ['precounitario', 'preco', 'valorunitario', 'vlunitario', 'precocombinado'],
  unidade: ['unidade', 'un', 'und'],
  fator: ['fator', 'fatordeconversao'],
  local: ['codigodolocal', 'local', 'localdeestoque'],
  numeroFornecedor: ['ndopedidonofornecedor', 'nodopedidonofornecedor', 'numerodopedidonofornecedor', 'pedidonofornecedor', 'numerofornecedor'],
  parcelas: ['parcelas', 'condicao', 'condicaodepagamento'],
  frete: ['frete'],
  obs: ['observacao', 'obs', 'observacoes'],
}

/** Índice de cada coluna conhecida. Exige produto e quantidade. */
export function mapearCabecalho(linha: Celula[]): Partial<Record<Campo, number>> | { erro: string } {
  const m: Partial<Record<Campo, number>> = {}
  linha.forEach((c, i) => {
    const t = norm(texto(c))
    if (!t) return
    for (const campo of Object.keys(APELIDOS) as Campo[]) {
      if (m[campo] == null && APELIDOS[campo].includes(t)) { m[campo] = i; break }
    }
  })
  if (m.produto == null || m.quantidade == null) return { erro: 'Não achei o cabeçalho: a planilha precisa das colunas "Código do produto" e "Quantidade" (use o modelo).' }
  return m
}

function texto(c: Celula): string {
  if (c == null) return ''
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? '' : c.toISOString().slice(0, 10)
  if (typeof c === 'number') return Number.isFinite(c) ? String(c) : ''
  return String(c).trim()
}

type Lido<T> = { ok: true; valor: T | null } | { ok: false }

/** "1.234,56", "4,5", "4.5", "1.500" (milhar), "R$ 12,90" e número do Excel. Vazio = null. */
export function lerCelulaNumero(c: Celula): Lido<number> {
  if (typeof c === 'number') return Number.isFinite(c) ? { ok: true, valor: c } : { ok: false }
  if (c instanceof Date || typeof c === 'boolean') return { ok: false }
  let t = texto(c).replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (!t) return { ok: true, valor: null }
  if (t.includes(',')) {
    if ((t.match(/,/g) ?? []).length > 1) return { ok: false }
    t = t.replace(/\./g, '').replace(',', '.')
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false }
  return { ok: true, valor: Number(t) }
}

function isoValida(a: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(a, m - 1, d))
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

/** dd/mm/aaaa (ou aa), aaaa-mm-dd, Date (meia-noite UTC, como o exceljs entrega) e número de série do Excel. */
export function lerCelulaData(c: Celula): Lido<string> {
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? { ok: false } : { ok: true, valor: c.toISOString().slice(0, 10) }
  if (typeof c === 'number') {
    if (!Number.isInteger(c) || c < 20000 || c > 80000) return { ok: false }
    return { ok: true, valor: new Date(Date.UTC(1899, 11, 30) + c * 86_400_000).toISOString().slice(0, 10) }
  }
  const t = texto(c)
  if (!t) return { ok: true, valor: null }
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t)
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const v = isoValida(ano, Number(m[2]), Number(m[1]))
    return v ? { ok: true, valor: v } : { ok: false }
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) {
    const v = isoValida(Number(m[1]), Number(m[2]), Number(m[3]))
    return v ? { ok: true, valor: v } : { ok: false }
  }
  return { ok: false }
}

export type Parcela = { dias: number; percentual: number }
export type CadastroImportacao = {
  produtos: { codigoProduto: number; codigo: string | null; descricao: string; unidade: string | null }[]
  fornecedores: { id: number; nome: string; cnpj: string | null }[]
  locais: number[]
  /** parcelasDoTexto de pedido-puro: "30/60" → parcelas; inválido = null */
  lerParcelas: (t: string) => Parcela[] | null
}

export type ItemImportado = { codigoProduto: number; descricao: string; unidade: string | null; fator: number; quantidade: number; precoUnitario: number; codigoLocal: number | null; obs: string | null }
export type LinhaValidada = { linha: number; grupo: string; produto: string; descricao: string | null; fornecedor: string | null; quantidade: number | null; preco: number | null; erros: string[] }
export type PedidoImportado = {
  grupo: string; fornecedorId: number | null; fornecedorNome: string; fornecedorCnpj: string | null; previsao: string | null
  numeroFornecedor: string | null; parcelas: Parcela[]; frete: number; itens: ItemImportado[]; linhas: number[]; total: number
}
export type ResultadoImportacao = { linhas: LinhaValidada[]; pedidos: PedidoImportado[]; erros: number; erroGeral: string | null }

export const LIMITES_IMPORTACAO = { linhas: 2000, pedidos: 100, itensPorPedido: 300 }

const nomeNorm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const semZeros = (s: string) => s.replace(/^0+(?=\d)/, '')

/** Valida a planilha inteira. Só importa se erros = 0 e erroGeral = null; a prévia mostra tudo mesmo com erro. */
export function validarImportacao(matriz: Celula[][], cad: CadastroImportacao): ResultadoImportacao {
  const vazio = (erroGeral: string): ResultadoImportacao => ({ linhas: [], pedidos: [], erros: 0, erroGeral })
  let iCab = -1
  let mapa: Partial<Record<Campo, number>> = {}
  for (let i = 0; i < Math.min(matriz.length, 10); i++) {
    const m = mapearCabecalho(matriz[i] ?? [])
    if (!('erro' in m)) { iCab = i; mapa = m; break }
  }
  if (iCab < 0) return vazio('Não achei o cabeçalho: a planilha precisa das colunas "Código do produto" e "Quantidade" (use o modelo).')
  const dados = matriz.slice(iCab + 1).map((l, k) => ({ l: l ?? [], linha: iCab + 2 + k })).filter(({ l }) => l.some((c) => texto(c) !== ''))
  if (!dados.length) return vazio('A planilha não tem nenhuma linha de item depois do cabeçalho.')
  if (dados.length > LIMITES_IMPORTACAO.linhas) return vazio(`No máximo ${LIMITES_IMPORTACAO.linhas} linhas por planilha (esta tem ${dados.length}).`)

  const porCodigo = new Map<string, CadastroImportacao['produtos']>()
  const porSemZeros = new Map<string, CadastroImportacao['produtos']>()
  const porId = new Map<number, CadastroImportacao['produtos'][number]>()
  for (const p of cad.produtos) {
    const c = (p.codigo ?? '').trim().toUpperCase()
    if (c) { porCodigo.set(c, [...(porCodigo.get(c) ?? []), p]); porSemZeros.set(semZeros(c), [...(porSemZeros.get(semZeros(c)) ?? []), p]) }
    porId.set(p.codigoProduto, p)
  }
  const fornPorCnpj = new Map(cad.fornecedores.filter((f) => f.cnpj).map((f) => [(f.cnpj ?? '').replace(/\D/g, ''), f]))
  const fornPorNome = new Map<string, CadastroImportacao['fornecedores']>()
  for (const f of cad.fornecedores) fornPorNome.set(nomeNorm(f.nome), [...(fornPorNome.get(nomeNorm(f.nome)) ?? []), f])
  const locais = new Set(cad.locais)
  const cel = (l: Celula[], c: Campo) => (mapa[c] == null ? null : l[mapa[c]!])

  type Cab = { fornecedorId: number | null; fornecedorNome: string; fornecedorCnpj: string | null; previsao: string | null; numeroFornecedor: string | null; parcelasTxt: string; parcelas: Parcela[]; frete: number | null }
  const grupos = new Map<string, { cab: Cab; itens: ItemImportado[]; linhas: number[] }>()
  const linhas: LinhaValidada[] = []

  for (const { l, linha } of dados) {
    const erros: string[] = []
    // produto
    const codTxt = texto(cel(l, 'produto')).toUpperCase()
    let prod: CadastroImportacao['produtos'][number] | null = null
    if (!codTxt) erros.push('Código do produto vazio.')
    else {
      const cand = porCodigo.get(codTxt) ?? (/^\d+$/.test(codTxt) ? porSemZeros.get(semZeros(codTxt)) : undefined)
      if (cand && cand.length > 1) erros.push(`O código ${codTxt} aparece em ${cand.length} produtos do cadastro: corrija o cadastro ou use o código interno.`)
      else if (cand?.length === 1) prod = cand[0]
      else if (/^\d+$/.test(codTxt) && porId.has(Number(codTxt))) prod = porId.get(Number(codTxt))!
      else erros.push(`O produto ${codTxt} não existe no cadastro.`)
    }
    // números do item
    const q = lerCelulaNumero(cel(l, 'quantidade'))
    const quantidade = q.ok ? q.valor : null
    if (!q.ok || quantidade == null || !(quantidade > 0)) erros.push('Quantidade precisa ser um número maior que zero.')
    const p = lerCelulaNumero(cel(l, 'preco'))
    const preco = p.ok ? (p.valor ?? 0) : null
    if (!p.ok || preco == null || preco < 0) erros.push('Preço unitário inválido (número, 0 ou mais).')
    const f = lerCelulaNumero(cel(l, 'fator'))
    const fator = f.ok ? (f.valor ?? 1) : null
    if (!f.ok || fator == null || !(fator > 0)) erros.push('Fator precisa ser maior que zero.')
    const lc = lerCelulaNumero(cel(l, 'local'))
    const local = lc.ok ? lc.valor : null
    if (!lc.ok || (local != null && !locais.has(local))) erros.push(`Local de estoque ${texto(cel(l, 'local'))} não existe nesta loja.`)
    // fornecedor
    const cnpjTxt = texto(cel(l, 'fornecedorCnpj')).replace(/\D/g, '')
    const nomeTxt = texto(cel(l, 'fornecedorNome')).replace(/\s+/g, ' ')
    let forn: { id: number | null; nome: string; cnpj: string | null } | null = null
    const agrup = texto(cel(l, 'pedido'))
    const doGrupo = agrup ? grupos.get(`p:${agrup}`)?.cab : undefined
    if (!cnpjTxt && !nomeTxt && doGrupo) forn = { id: doGrupo.fornecedorId, nome: doGrupo.fornecedorNome, cnpj: doGrupo.fornecedorCnpj }   // linha seguinte do mesmo "Pedido" herda
    else if (cnpjTxt && cnpjTxt.length !== 11 && cnpjTxt.length !== 14) erros.push('CNPJ do fornecedor inválido (11 ou 14 dígitos).')
    else if (cnpjTxt && fornPorCnpj.has(cnpjTxt)) { const x = fornPorCnpj.get(cnpjTxt)!; forn = { id: x.id, nome: x.nome, cnpj: cnpjTxt } }
    else if (nomeTxt) {
      const x = fornPorNome.get(nomeNorm(nomeTxt))
      forn = x?.length === 1 && !cnpjTxt ? { id: x[0].id, nome: x[0].nome, cnpj: (x[0].cnpj ?? '').replace(/\D/g, '') || null } : { id: null, nome: nomeTxt, cnpj: cnpjTxt || null }
    } else erros.push(cnpjTxt ? 'Fornecedor não cadastrado com esse CNPJ: informe também o nome.' : 'Informe o fornecedor (CNPJ cadastrado ou nome).')
    // cabeçalho do pedido
    const d = lerCelulaData(cel(l, 'previsao'))
    if (!d.ok) erros.push('Previsão de entrega inválida (use dd/mm/aaaa).')
    const previsao = d.ok ? d.valor : null
    const parcelasTxt = texto(cel(l, 'parcelas'))
    const parcelas = cad.lerParcelas(parcelasTxt)
    if (parcelas == null) erros.push('Parcelas inválidas (dias separados por barra, ex.: 30/60/90).')
    const fr = lerCelulaNumero(cel(l, 'frete'))
    if (!fr.ok || (fr.valor != null && fr.valor < 0)) erros.push('Frete inválido.')
    const numeroFornecedor = texto(cel(l, 'numeroFornecedor')) || null

    const chaveForn = forn ? (forn.id != null ? `id:${forn.id}` : forn.cnpj ? `cnpj:${forn.cnpj}` : `nome:${nomeNorm(forn.nome)}`) : '?'
    const grupo = agrup ? `Pedido ${agrup}` : `${forn?.nome ?? '?'}${previsao ? ` · ${previsao.split('-').reverse().join('/')}` : ''}`
    const chaveGrupo = agrup ? `p:${agrup}` : `f:${chaveForn}|${previsao ?? ''}`

    if (!erros.length && forn && prod && quantidade != null && preco != null && fator != null && parcelas != null) {
      const g = grupos.get(chaveGrupo)
      const cab: Cab = { fornecedorId: forn.id, fornecedorNome: forn.nome, fornecedorCnpj: forn.cnpj, previsao, numeroFornecedor, parcelasTxt, parcelas, frete: fr.ok ? fr.valor : null }
      if (!g) grupos.set(chaveGrupo, { cab, itens: [], linhas: [] })
      else {
        // campos do pedido: a linha vazia herda; preenchida e diferente = erro (não mistura pedidos)
        const c = g.cab
        const chaveC = c.fornecedorId != null ? `id:${c.fornecedorId}` : c.fornecedorCnpj ? `cnpj:${c.fornecedorCnpj}` : `nome:${nomeNorm(c.fornecedorNome)}`
        if (chaveC !== chaveForn) erros.push(`Fornecedor diferente do resto do ${grupo} (${c.fornecedorNome}).`)
        if (previsao && c.previsao && previsao !== c.previsao) erros.push(`Previsão diferente do resto do ${grupo}.`)
        if (numeroFornecedor && c.numeroFornecedor && numeroFornecedor !== c.numeroFornecedor) erros.push(`Nº do pedido no fornecedor diferente do resto do ${grupo}.`)
        if (parcelasTxt && c.parcelasTxt && parcelasTxt !== c.parcelasTxt) erros.push(`Parcelas diferentes do resto do ${grupo}.`)
        if (cab.frete != null && c.frete != null && cab.frete !== c.frete) erros.push(`Frete diferente do resto do ${grupo} (o frete é um só por pedido).`)
        if (!erros.length) {
          c.previsao ??= previsao
          c.numeroFornecedor ??= numeroFornecedor
          if (!c.parcelasTxt && parcelasTxt) { c.parcelasTxt = parcelasTxt; c.parcelas = parcelas }
          c.frete ??= cab.frete
        }
      }
      if (!erros.length) {
        const gg = grupos.get(chaveGrupo)!
        if (gg.itens.length >= LIMITES_IMPORTACAO.itensPorPedido) erros.push(`O ${grupo} passou de ${LIMITES_IMPORTACAO.itensPorPedido} itens: divida em dois.`)
        else {
          gg.itens.push({ codigoProduto: prod.codigoProduto, descricao: prod.descricao, unidade: texto(cel(l, 'unidade')).toUpperCase().slice(0, 6) || prod.unidade,
            fator, quantidade, precoUnitario: preco, codigoLocal: local, obs: texto(cel(l, 'obs')) || null })
          gg.linhas.push(linha)
        }
      }
    }
    linhas.push({ linha, grupo, produto: codTxt, descricao: prod?.descricao ?? null, fornecedor: forn?.nome ?? null, quantidade, preco, erros })
  }

  const pedidos: PedidoImportado[] = [...grupos.entries()].map(([, g]) => ({
    grupo: linhas.find((x) => x.linha === g.linhas[0])?.grupo ?? '', fornecedorId: g.cab.fornecedorId, fornecedorNome: g.cab.fornecedorNome,
    fornecedorCnpj: g.cab.fornecedorCnpj, previsao: g.cab.previsao, numeroFornecedor: g.cab.numeroFornecedor, parcelas: g.cab.parcelas,
    frete: g.cab.frete ?? 0, itens: g.itens, linhas: g.linhas,
    total: Math.round((g.itens.reduce((a, i) => a + i.quantidade * i.precoUnitario, 0) + (g.cab.frete ?? 0)) * 100) / 100,
  })).filter((p) => p.itens.length > 0)
  const erros = linhas.filter((l) => l.erros.length).length
  const erroGeral = pedidos.length > LIMITES_IMPORTACAO.pedidos ? `No máximo ${LIMITES_IMPORTACAO.pedidos} pedidos por planilha (esta tem ${pedidos.length}).` : null
  return { linhas, pedidos, erros, erroGeral }
}

/** CSV do Excel brasileiro (";") ou ",": o separador é o que aparece mais na 1ª linha fora de aspas. */
export function lerCsv(t: string): string[][] {
  const s = t.replace(/^﻿/, '')
  const primeira = s.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '')
  const sep = (primeira.match(/;/g) ?? []).length >= (primeira.match(/,/g) ?? []).length ? ';' : ','
  const linhas: string[][] = []
  let linha: string[] = []
  let campo = ''
  let aspas = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (aspas) {
      if (ch === '"' && s[i + 1] === '"') { campo += '"'; i++ }
      else if (ch === '"') aspas = false
      else campo += ch
    } else if (ch === '"') aspas = true
    else if (ch === sep) { linha.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      linha.push(campo); linhas.push(linha); linha = []; campo = ''
    } else campo += ch
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha) }
  return linhas
}

/** Formato de p_pedidos da pc_importar (o mesmo jsonb do pc_salvar). */
export function pedidosParaSql(p: PedidoImportado[]) {
  return p.map((x) => ({
    fornecedor_id: x.fornecedorId, fornecedor_nome: x.fornecedorNome, fornecedor_cnpj: x.fornecedorCnpj, previsao_entrega: x.previsao,
    numero_fornecedor: x.numeroFornecedor, parcelas: x.parcelas, frete: x.frete, obs_interna: `Importado da planilha (${x.grupo}, linhas ${x.linhas.join(', ')})`,
    itens: x.itens.map((i) => ({ codigo_produto: i.codigoProduto, descricao: i.descricao, unidade: i.unidade, fator: i.fator, quantidade: i.quantidade,
      preco_unitario: i.precoUnitario, codigo_local_estoque: i.codigoLocal, obs: i.obs })),
  }))
}
