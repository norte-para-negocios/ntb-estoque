import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { arvoreCustoFicha, type ArvoreCusto, type NoArvore } from '@/lib/estoque/arvore-custo-puro'
import { arvoreDoPrato, linhasDoCardapio, type BaseCusto, type LinhaPrato } from './carregar'
import { arredondarPreco, cmv as calcCmv, precoReal, precoSugeridoDelivery, precoSugeridoSalao, resumir, sobraPorVenda } from './preco-puro'
import { saldosDaLoja } from './saldos'
import {
  buscar, textoAcima, textoDetalhe, textoOnde, textoPesam, textoResumo, textoSaldo, textoSimular, textoSugerir,
  type AcaoPacioli, type Entrada, type InsumoCurto, type Intencao, type PratoCurto, type RAcima, type RDetalhe, type ROnde,
  type RPesam, type RResumo, type RSaldo, type RSimular, type RSugerir,
} from './pacioli-puro'

// Ferramentas do Pacioli: SÓ LEITURA sobre a BaseCusto (fichas, custo médio, preços, taxas) e o saldo do estoque.
// Nada aqui grava no banco nem chama o Omie. As respostas são JSON curto (listas com teto) para gastar pouco token.

const r2 = (v: number) => Math.round(v * 100) / 100
const r4 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000)
const linkPrato = (codigo: number) => `/cozinha/pratos/${codigo}`

export type Contexto = {
  base: BaseCusto
  linhas: LinhaPrato[]
  porCodigo: Map<number, LinhaPrato>
  arvores: Map<number, ArvoreCusto | null>
  insumos: Set<number>
}

export function criarContexto(base: BaseCusto): Contexto {
  const linhas = linhasDoCardapio(base)
  const insumos = new Set<number>()
  for (const f of base.fichas.values()) for (const i of f.itens) insumos.add(i.codigoInsumo)
  return { base, linhas, porCodigo: new Map(linhas.map((l) => [l.codigo, l])), arvores: new Map(), insumos }
}

const arvore = (c: Contexto, cod: number) => {
  if (!c.arvores.has(cod)) c.arvores.set(cod, arvoreCustoFicha(c.base.fichas, c.base.cmc, cod, 1))
  return c.arvores.get(cod) ?? null
}
const unidadeDe = (c: Contexto, cod: number) => c.base.unidadeNaFicha.get(cod) ?? c.base.produtos.get(cod)?.unidade?.toUpperCase() ?? null
const custoDe = (c: Contexto, cod: number) => { const v = c.base.cmc.get(cod); return v != null && v > 0 ? v : null }
const nomeDe = (c: Contexto, cod: number) => c.base.produtos.get(cod)?.descricao ?? `Produto ${cod}`

const pratoCurto = (l: LinhaPrato): PratoCurto => ({ codigo: l.codigo, nome: l.descricao, link: linkPrato(l.codigo), preco: l.preco, custo: r2(l.custo), cmv: r4(l.cmv) })
const insumoCurto = (c: Contexto, cod: number): InsumoCurto => ({ codigo: cod, nome: nomeDe(c, cod), unidade: unidadeDe(c, cod), custoAtual: r4(custoDe(c, cod)) })

/** Quanto do produto `alvo` entra na árvore (direto ou dentro de preparações). */
function usoNaArvore(nos: NoArvore[], alvo: number): { quantidade: number; custo: number } {
  let quantidade = 0, custo = 0
  for (const n of nos) {
    if (n.codigo === alvo) { quantidade += n.quantidade; custo += n.custo; continue }
    if (n.filhos.length) { const s = usoNaArvore(n.filhos, alvo); quantidade += s.quantidade; custo += s.custo }
  }
  return { quantidade, custo }
}

function folhas(nos: NoArvore[], acc: Map<number, number>) {
  for (const n of nos) {
    if (n.filhos.length) folhas(n.filhos, acc)
    else acc.set(n.codigo, (acc.get(n.codigo) ?? 0) + n.custo)
  }
}

/** Custo considerado confiável para conta (sem insumo faltando nem custo fora do normal). */
const confiavel = (l: LinhaPrato) => l.situacao === 'ok' || l.situacao === 'atencao' || l.situacao === 'acima'

// ---------------------------------------------------------------- as ferramentas

function buscarPrato(c: Contexto, texto: string) {
  const itens = buscar(c.linhas.map((l) => ({ codigo: l.codigo, nome: l.descricao, codigoTexto: l.codigoTexto, l })), texto, 8)
  return { itens: itens.map(({ l }) => ({ ...pratoCurto(l), tipo: l.tipo })) }
}

function buscarInsumo(c: Contexto, texto: string) {
  const lista = [...c.insumos].map((cod) => ({ codigo: cod, nome: nomeDe(c, cod), codigoTexto: c.base.produtos.get(cod)?.codigoTexto }))
  const itens = buscar(lista, texto, 8)
  return { itens: itens.map((i) => ({ ...insumoCurto(c, i.codigo), preparacao: c.base.fichas.has(i.codigo) })) }
}

function detalhePrato(c: Contexto, codigo: number): RDetalhe | { erro: string } {
  const l = c.porCodigo.get(codigo)
  const a = arvoreDoPrato(c.base, codigo)
  if (!l || !a) return { erro: 'Prato sem ficha técnica ativa (ou código errado). Use buscar_prato.' }
  const itens = [...a.filhos].sort((x, y) => y.custo - x.custo)
  return {
    prato: pratoCurto(l), tipo: l.tipo, meta: c.base.taxas.metaCmv, situacao: l.situacao,
    sugeridoSalao: arredondarPreco(l.sugeridoSalao), sugeridoDelivery: arredondarPreco(l.sugeridoDelivery),
    sobraSalao: l.sobraSalao == null ? null : r2(l.sobraSalao), semCusto: l.semCusto, suspeitos: l.suspeitos,
    itens: itens.slice(0, 15).map((n) => ({
      codigo: n.codigo, nome: n.descricao, quantidade: r4(n.quantidade) ?? 0, unidade: n.unidade, custo: r2(n.custo),
      parte: a.total > 0 ? r4(n.custo / a.total) : null, semCusto: n.semCusto, suspeito: n.suspeito, preparacao: n.temFicha,
    })),
    outrosItens: Math.max(0, itens.length - 15),
  }
}

function pratosAcima(c: Contexto, limite: number | null): RAcima {
  const meta = c.base.taxas.metaCmv
  const lim = limite ?? meta
  const pratos = c.linhas.filter((l) => l.tipo === 'prato' && precoReal(l.preco))
  const acima = pratos.filter((l) => confiavel(l) && (l.cmv ?? 0) > lim + 1e-9).sort((a, b) => (b.cmv ?? 0) - (a.cmv ?? 0))
  return {
    meta, limite: lim, total: acima.length,
    pratos: acima.slice(0, 12).map((l) => ({ ...pratoCurto(l), sugeridoSalao: arredondarPreco(l.sugeridoSalao) })),
    naoConfiaveis: pratos.filter((l) => !confiavel(l) && l.situacao !== 'sem_preco').length,
  }
}

function sugerirPreco(c: Contexto, codigo: number, canal: 'salao' | 'delivery'): RSugerir | { erro: string } {
  const l = c.porCodigo.get(codigo)
  if (!l) return { erro: 'Prato sem ficha técnica ativa (ou código errado). Use buscar_prato.' }
  const t = c.base.taxas
  const sugerido = canal === 'delivery' ? precoSugeridoDelivery(l.custo, t) : precoSugeridoSalao(l.custo, t)
  const arred = arredondarPreco(sugerido)
  const avisos: string[] = []
  if (l.semCusto) avisos.push(`${l.semCusto} insumo${l.semCusto > 1 ? 's' : ''} sem custo: o custo real é maior e o preço sugerido também.`)
  if (l.suspeitos) avisos.push(`${l.suspeitos} insumo${l.suspeitos > 1 ? 's' : ''} com custo a conferir: confira antes de mudar o preço.`)
  if (l.custo <= 0) avisos.push('O prato está sem custo: não dá para sugerir preço.')
  return {
    prato: pratoCurto(l), canal, sugerido: r2(sugerido), sugeridoArredondado: arred, cmvNoSugerido: r4(calcCmv(l.custo, arred)),
    sobraNoSugerido: r2(sobraPorVenda(arred, l.custo, t, canal)), cmvAtual: r4(l.cmv),
    sobraAtual: l.preco != null ? r2(sobraPorVenda(l.preco, l.custo, t, canal)) : null, meta: t.metaCmv, avisos,
  }
}

function simularInsumo(c: Contexto, codigo: number, novoPreco: number | null, variacao: number | null): RSimular | { erro: string } {
  if (!c.insumos.has(codigo)) return { erro: 'Esse código não é insumo de nenhuma ficha. Use buscar_insumo.' }
  const atual = custoDe(c, codigo)
  const avisos: string[] = []
  if (c.base.fichas.has(codigo)) return { erro: 'É uma preparação: o custo dela vem da ficha. Simule o preço de um insumo da ficha dela.' }
  let novo: number
  if (novoPreco != null) novo = novoPreco
  else if (atual != null && variacao != null) novo = atual * (1 + variacao)
  else return { erro: 'O insumo está sem custo hoje: informe novo_preco em R$.' }
  if (atual == null) avisos.push('O insumo está sem custo hoje: a comparação parte de custo zero.')
  const cmcNovo = new Map(c.base.cmc)
  cmcNovo.set(codigo, novo)
  const meta = c.base.taxas.metaCmv
  const pratos: RSimular['pratos'] = []
  let passam = 0, somaDelta = 0, comPreco = 0
  for (const l of c.linhas) {
    if (l.tipo !== 'prato') continue
    const antes = arvore(c, l.codigo)
    if (!antes || usoNaArvore(antes.filhos, codigo).quantidade <= 0) continue
    const depois = arvoreCustoFicha(c.base.fichas, cmcNovo, l.codigo, 1)
    if (!depois) continue
    const cmvA = calcCmv(antes.total, l.preco), cmvD = calcCmv(depois.total, l.preco)
    if (cmvA != null && cmvD != null) { comPreco++; somaDelta += cmvD - cmvA; if (cmvA <= meta + 1e-9 && cmvD > meta + 1e-9) passam++ }
    pratos.push({ codigo: l.codigo, nome: l.descricao, link: linkPrato(l.codigo), custoAntes: r2(antes.total), custoDepois: r2(depois.total), cmvAntes: r4(cmvA), cmvDepois: r4(cmvD) })
  }
  pratos.sort((a, b) => (b.custoDepois - b.custoAntes) - (a.custoDepois - a.custoAntes))
  const var_ = atual ? r4(novo / atual - 1) : null
  return {
    insumo: { ...insumoCurto(c, codigo), novoCusto: r4(novo) ?? 0, variacao: var_ }, afetados: pratos.length, passamDaMeta: passam,
    impactoMedioCmv: comPreco ? r4(somaDelta / comPreco) : null, pratos: pratos.slice(0, 12), avisos,
  }
}

function insumosQueMaisPesam(c: Contexto, limite: number): RPesam {
  const acc = new Map<number, number>()
  const pratos = new Map<number, number>()
  for (const l of c.linhas) {
    if (l.tipo !== 'prato' || !precoReal(l.preco) || l.situacao === 'suspeito' || !(l.custo > 0)) continue
    const a = arvore(c, l.codigo)
    if (!a) continue
    const doPrato = new Map<number, number>()
    folhas(a.filhos, doPrato)
    for (const [cod, v] of doPrato) { acc.set(cod, (acc.get(cod) ?? 0) + v); pratos.set(cod, (pratos.get(cod) ?? 0) + 1) }
  }
  const total = [...acc.values()].reduce((s, v) => s + v, 0)
  const itens = [...acc.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, limite)
  return {
    base: 'uma porção de cada prato com preço, sem considerar quanto cada prato vende',
    itens: itens.map(([cod, v]) => ({ ...insumoCurto(c, cod), custoTotal: r2(v), parte: total > 0 ? r4(v / total) ?? 0 : 0, pratos: pratos.get(cod) ?? 0 })),
  }
}

function resolverInsumo(c: Contexto, insumo: string): number | null {
  const n = Number(insumo)
  if (Number.isInteger(n) && c.insumos.has(n)) return n
  const achou = buscarInsumo(c, insumo).itens[0]
  return achou?.codigo ?? null
}

function ondeEUsado(c: Contexto, insumo: string): ROnde | { erro: string } {
  const cod = resolverInsumo(c, insumo)
  if (cod == null) return { erro: `Não achei insumo com "${insumo}" nas fichas.` }
  const pratos: ROnde['pratos'] = []
  for (const l of c.linhas) {
    if (l.codigo === cod) continue
    const a = arvore(c, l.codigo)
    if (!a) continue
    const u = usoNaArvore(a.filhos, cod)
    if (u.quantidade <= 0) continue
    pratos.push({ codigo: l.codigo, nome: l.descricao, link: linkPrato(l.codigo), quantidade: r4(u.quantidade) ?? 0, custoNoPrato: r2(u.custo), parte: a.total > 0 ? r4(u.custo / a.total) : null })
  }
  pratos.sort((a, b) => b.custoNoPrato - a.custoNoPrato)
  return { insumo: insumoCurto(c, cod), total: pratos.length, pratos: pratos.slice(0, 15) }
}

async function saldoInsumo(c: Contexto, codigo: number): Promise<RSaldo | { erro: string }> {
  if (!c.base.produtos.has(codigo)) return { erro: 'Código de produto desconhecido. Use buscar_insumo.' }
  const s = await saldosDaLoja(c.base.lojaId, c.base.modo)
  const p = s.porProduto.get(codigo)
  return { insumo: insumoCurto(c, codigo), saldo: p ? r4(p.saldo) : null, minimo: p ? r4(p.minimo) ?? 0 : 0, abaixoDoMinimo: !!p && p.minimo > 0 && p.saldo < p.minimo, data: s.data }
}

function resumoCardapio(c: Contexto): RResumo {
  const pratos = c.linhas.filter((l) => l.tipo === 'prato')
  const r = resumir(pratos)
  const piores = pratos.filter((l) => confiavel(l) && l.situacao === 'acima').sort((a, b) => (b.cmv ?? 0) - (a.cmv ?? 0)).slice(0, 3)
  return {
    meta: c.base.taxas.metaCmv, taxas: c.base.taxas, pratos: r.pratos, comPreco: r.comPreco, cmvMediano: r4(r.cmvMedio),
    acima: r.acima, atencao: r.atencao, semPreco: r.semPreco, semCusto: r.semCusto, incompletos: r.incompletos, suspeitos: r.suspeitos,
    piores: piores.map(pratoCurto),
  }
}

/** Roda uma ferramenta já validada (validarEntrada). Nunca lança: erro vira { erro }. */
export async function executar(c: Contexto, e: Entrada): Promise<unknown> {
  try {
    switch (e.ferramenta) {
      case 'buscar_prato': return buscarPrato(c, e.texto)
      case 'buscar_insumo': return buscarInsumo(c, e.texto)
      case 'detalhe_prato': return detalhePrato(c, e.codigo)
      case 'pratos_acima_da_meta': return pratosAcima(c, e.limite)
      case 'sugerir_preco': return sugerirPreco(c, e.codigo, e.canal)
      case 'simular_preco_insumo': return simularInsumo(c, e.codigo, e.novoPreco, e.variacao)
      case 'insumos_que_mais_pesam': return insumosQueMaisPesam(c, e.limite)
      case 'onde_e_usado': return ondeEUsado(c, e.insumo)
      case 'saldo_insumo': return await saldoInsumo(c, e.codigo)
      case 'resumo_cardapio': return resumoCardapio(c)
    }
  } catch (err) {
    console.error('pacioli: ferramenta', e.ferramenta, err instanceof Error ? err.message : err)
    return { erro: 'Não consegui ler esses dados agora.' }
  }
}

// ---------------------------------------------------------------- modo rápido (sem modelo)

export type RespostaRapida = { texto: string; acao: AcaoPacioli }

const ehErro = (r: unknown): r is { erro: string } => !!r && typeof r === 'object' && 'erro' in r

function acharPrato(c: Contexto, termo: string) {
  const achados = buscar(c.linhas.map((l) => ({ codigo: l.codigo, nome: l.descricao, codigoTexto: l.codigoTexto, l })), termo, 4)
  const pratos = achados.filter((a) => a.l.tipo === 'prato')
  const lista = pratos.length ? pratos : achados
  return { escolhido: lista[0]?.l ?? null, outros: lista.slice(1, 3).map((a) => a.l.descricao) }
}
const outrosTexto = (outros: string[]) => (outros.length ? `\n\nUsei o mais parecido. Também achei: ${outros.join(', ')}.` : '')

export async function responderRapido(c: Contexto, i: Intencao): Promise<RespostaRapida> {
  switch (i.ferramenta) {
    case 'pratos_acima_da_meta': {
      const r = textoAcima(pratosAcima(c, null))
      return { texto: r.texto, acao: r.tudoCerto ? '40-comemorando' : '03-tudo-certo' }
    }
    case 'resumo_cardapio': return { texto: textoResumo(resumoCardapio(c)), acao: '03-tudo-certo' }
    case 'insumos_que_mais_pesam': return { texto: textoPesam(insumosQueMaisPesam(c, 10)), acao: '03-tudo-certo' }
    case 'sugerir_preco':
    case 'detalhe_prato': {
      const { escolhido, outros } = acharPrato(c, i.prato)
      if (!escolhido) {
        // Pode ser um insumo ("camarão"): mostra onde ele entra.
        const o = ondeEUsado(c, i.prato)
        if (!ehErro(o)) return { texto: textoOnde(o), acao: '03-tudo-certo' }
        return { texto: `Não achei prato nem insumo com "${i.prato}".`, acao: '42-erro' }
      }
      const r = i.ferramenta === 'sugerir_preco' ? sugerirPreco(c, escolhido.codigo, i.canal) : detalhePrato(c, escolhido.codigo)
      if (ehErro(r)) return { texto: r.erro, acao: '42-erro' }
      return { texto: ('canal' in r ? textoSugerir(r) : textoDetalhe(r)) + outrosTexto(outros), acao: '03-tudo-certo' }
    }
    case 'simular_preco_insumo': {
      const cod = resolverInsumo(c, i.insumo)
      if (cod == null) return { texto: `Não achei insumo com "${i.insumo}" nas fichas.`, acao: '42-erro' }
      const r = simularInsumo(c, cod, null, i.variacao)
      if (ehErro(r)) return { texto: r.erro, acao: '42-erro' }
      return { texto: textoSimular(r), acao: '03-tudo-certo' }
    }
    case 'onde_e_usado': {
      const r = ondeEUsado(c, i.insumo)
      return ehErro(r) ? { texto: r.erro, acao: '42-erro' } : { texto: textoOnde(r), acao: '03-tudo-certo' }
    }
    case 'saldo_insumo': {
      const cod = resolverInsumo(c, i.insumo)
      if (cod == null) return { texto: `Não achei insumo com "${i.insumo}" nas fichas.`, acao: '42-erro' }
      const r = await saldoInsumo(c, cod)
      return ehErro(r) ? { texto: r.erro, acao: '42-erro' } : { texto: textoSaldo(r), acao: '03-tudo-certo' }
    }
  }
}

// ---------------------------------------------------------------- definição das ferramentas para o modelo

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required, additionalProperties: false })

/** Ordem fixa (o prefixo do pedido fica igual e entra em cache). */
export const FERRAMENTAS: Anthropic.Beta.BetaTool[] = [
  { name: 'buscar_prato', description: 'Procura pratos e preparações com ficha técnica pelo nome (aceita erro de digitação e falta de acento). Devolve código, link, preço, custo e CMV dos mais parecidos.', input_schema: obj({ texto: { type: 'string', description: 'Nome ou parte do nome do prato.' } }, ['texto']) },
  { name: 'buscar_insumo', description: 'Procura insumos que aparecem em alguma ficha pelo nome. Devolve código, unidade e custo atual por unidade.', input_schema: obj({ texto: { type: 'string', description: 'Nome ou parte do nome do insumo.' } }, ['texto']) },
  { name: 'detalhe_prato', description: 'Ficha do prato com o custo de cada item (maiores primeiro), preço, CMV, situação contra a meta e preços sugeridos para salão e delivery.', input_schema: obj({ codigo: { type: 'integer', description: 'Código do prato (de buscar_prato).' } }, ['codigo']) },
  { name: 'pratos_acima_da_meta', description: 'Pratos com preço cujo CMV passa do limite (padrão: a meta da loja), do pior para o melhor, com o preço de salão que bate a meta. Pratos com custo não confiável ficam de fora e são contados.', input_schema: obj({ limite: { type: 'number', description: 'CMV limite em fração (0.35 = 35%). Opcional.' } }) },
  { name: 'sugerir_preco', description: 'Preço que bate a meta de CMV para um prato, no salão ou no delivery (delivery considera app, cartão, imposto e embalagem). Devolve o valor exato e arredondado para ,90, o CMV e a sobra por venda.', input_schema: obj({ codigo: { type: 'integer' }, canal: { type: 'string', enum: ['salao', 'delivery'] } }, ['codigo', 'canal']) },
  { name: 'simular_preco_insumo', description: 'Simula o custo de um insumo mudando (sem gravar nada) e mostra o impacto no custo e no CMV dos pratos que o usam e quantos passam da meta.', input_schema: obj({ codigo_insumo: { type: 'integer' }, novo_preco: { type: 'number', description: 'Novo custo em R$ por unidade do insumo.' }, variacao_pct: { type: 'number', description: 'Alternativa ao novo_preco: variação em fração (0.2 = +20%, -0.1 = -10%).' } }, ['codigo_insumo']) },
  { name: 'insumos_que_mais_pesam', description: 'Insumos que mais pesam no custo somado de uma porção de cada prato com preço (não considera quanto cada prato vende).', input_schema: obj({ limite: { type: 'integer', description: 'Quantos (padrão 10, até 15).' } }) },
  { name: 'onde_e_usado', description: 'Em quais pratos e preparações um insumo entra, com a quantidade, o custo dele no prato e quanto pesa no custo do prato.', input_schema: obj({ insumo: { type: 'string', description: 'Nome ou código do insumo.' } }, ['insumo']) },
  { name: 'saldo_insumo', description: 'Saldo atual em estoque de um produto (soma dos locais) e o estoque mínimo.', input_schema: obj({ codigo: { type: 'integer' } }, ['codigo']) },
  { name: 'resumo_cardapio', description: 'Resumo do cardápio: quantos pratos, CMV mediano, quantos acima da meta, sem preço, sem custo e com custo a conferir, e os piores CMV.', input_schema: obj({}) },
].map((t) => ({ ...t, eager_input_streaming: true }))
