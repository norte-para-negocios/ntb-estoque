// Norte Cozinha, Eventos: conta do evento e explosão da produção e das compras (PURO, sem banco, sem alias do Next; node --test).
// O prato desce pela ficha (arvoreCustoFicha) para a quantidade do evento inteiro: nó com ficha = preparação a produzir,
// folha = insumo a comprar. Nada aqui grava nada.
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { arvoreCustoFicha, type FichaArvore, type NoArvore } from '../estoque/arvore-custo-puro.ts'
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { arredondarPreco } from './preco-puro.ts'

export const STATUS_EVENTO = ['orcamento', 'confirmado', 'realizado', 'cancelado'] as const
export type StatusEvento = (typeof STATUS_EVENTO)[number]
export const NOME_STATUS: Record<StatusEvento, string> = { orcamento: 'Orçamento', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado' }

/** Porções de um prato no evento: convidados × porções por convidado. */
export const porcoesNoEvento = (convidados: number, porcoesPorConvidado: number) =>
  Math.round(Math.max(convidados, 0) * Math.max(porcoesPorConvidado, 0) * 1000) / 1000

/** Folga de produção: % a mais só no que produzir e comprar (0 a 200). */
export const FOLGA_MAX = 200
export const ATALHOS_FOLGA = [0, 5, 10, 15] as const
export const limitarFolga = (pct: number | null | undefined) => {
  const n = Number(pct)
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), FOLGA_MAX) : 0
}
export const fatorFolga = (pct: number | null | undefined) => 1 + limitarFolga(pct) / 100

/** Pedidos do evento (prato × porções com folga), na mesma conta das reservas (reservas.ts). */
export function pedidosDoEvento(convidados: number, itens: { codigo: number; porcoesPorConvidado: number }[], folgaPct: number): { codigo: number; porcoes: number }[] {
  const f = fatorFolga(folgaPct)
  return itens.map((i) => ({ codigo: i.codigo, porcoes: porcoesNoEvento(convidados, i.porcoesPorConvidado) * f }))
}

export type ResumoEvento = {
  /** Custo da comida com a folga de produção. */
  custoTotal: number
  /** Custo sem a folga (só as porções servidas). */
  custoSemFolga: number
  folgaPct: number
  custoPorPessoa: number
  /** Preço por pessoa que bate a meta de CMV, arredondado para ,90 (0 sem custo). */
  precoSugeridoPorPessoa: number
  receita: number | null
  /** Fração do preço que sobra depois da comida: (preço − custo por pessoa) ÷ preço. */
  margem: number | null
  cmv: number | null
  /** Lucro ou prejuízo: receita − custo total (antes de mão de obra, impostos e custo fixo). */
  sobra: number | null
  /** Sem preço definido: o que o preço sugerido daria. */
  receitaComSugerido: number | null
  sobraComSugerido: number | null
  margemComSugerido: number | null
}

/** Conta do evento a partir do custo de 1 porção de cada prato; a folga entra no custo (a comida a mais é paga). */
export function resumoEvento(
  convidados: number,
  itens: { porcoesPorConvidado: number; custoPorPorcao: number }[],
  metaCmv: number,
  precoPorPessoa: number | null,
  folgaPct = 0,
): ResumoEvento {
  const conv = Math.max(convidados, 0)
  const custoSemFolga = itens.reduce((a, i) => a + porcoesNoEvento(conv, i.porcoesPorConvidado) * Math.max(i.custoPorPorcao, 0), 0)
  const custoTotal = custoSemFolga * fatorFolga(folgaPct)
  const custoPorPessoa = conv > 0 ? custoTotal / conv : 0
  const preco = precoPorPessoa != null && precoPorPessoa > 0 ? precoPorPessoa : null
  const receita = preco != null && conv > 0 ? preco * conv : null
  const sugerido = metaCmv > 0 && custoPorPessoa > 0 ? arredondarPreco(custoPorPessoa / metaCmv) : 0
  const receitaSug = preco == null && sugerido > 0 && conv > 0 ? sugerido * conv : null
  return {
    custoTotal,
    custoSemFolga,
    folgaPct: limitarFolga(folgaPct),
    custoPorPessoa,
    precoSugeridoPorPessoa: sugerido,
    receita,
    margem: preco != null ? (preco - custoPorPessoa) / preco : null,
    cmv: preco != null ? custoPorPessoa / preco : null,
    sobra: receita != null ? receita - custoTotal : null,
    receitaComSugerido: receitaSug,
    sobraComSugerido: receitaSug != null ? receitaSug - custoTotal : null,
    margemComSugerido: receitaSug != null ? (sugerido - custoPorPessoa) / sugerido : null,
  }
}

export type Necessidade = { codigo: number; quantidade: number; custo: number; semCusto: boolean; custoUnitario: number | null }
export type Explosao = {
  /** Preparações (nós com ficha), somadas entre os pratos, na unidade do produto. */
  preparacoes: Map<number, Necessidade>
  /** Insumos (folhas), quantidade bruta (com perda), somados entre os pratos. */
  insumos: Map<number, Necessidade>
  /** Pratos sem ficha (não entram na conta). */
  semFicha: number[]
  ciclo: boolean
}

const arred6 = (n: number) => Math.round(n * 1e6) / 1e6

function somar(m: Map<number, Necessidade>, n: NoArvore) {
  const a = m.get(n.codigo) ?? { codigo: n.codigo, quantidade: 0, custo: 0, semCusto: false, custoUnitario: n.custoUnitarioCmc }
  a.quantidade = arred6(a.quantidade + n.quantidade)
  a.custo = arred6(a.custo + n.custo)
  a.semCusto = a.semCusto || n.semCusto
  m.set(n.codigo, a)
}

/** Explode os pedidos do evento (prato × porções) até os insumos, somando o que se repete entre pratos. */
export function explodirEvento(fichas: Map<number, FichaArvore>, cmc: Map<number, number | null>, pedidos: { codigo: number; porcoes: number }[]): Explosao {
  const preparacoes = new Map<number, Necessidade>()
  const insumos = new Map<number, Necessidade>()
  const semFicha: number[] = []
  let ciclo = false
  const descer = (nos: NoArvore[]) => {
    for (const n of nos) {
      if (n.ciclo) { ciclo = true; continue }
      if (n.temFicha) { somar(preparacoes, n); descer(n.filhos) } else somar(insumos, n)
    }
  }
  for (const p of pedidos) {
    if (!(p.porcoes > 0)) continue
    const a = arvoreCustoFicha(fichas, cmc, p.codigo, p.porcoes)
    if (!a) { semFicha.push(p.codigo); continue }
    if (a.ciclo) ciclo = true
    descer(a.filhos)
  }
  return { preparacoes, insumos, semFicha, ciclo }
}

export type InfoProduto = { descricao: string; unidade: string | null; familia: string | null }

export type EventoConcorrente = { eventoId: number; nome: string; data: string | null; quantidade: number }
/** O que OUTROS eventos confirmados já reservaram do insumo. */
export type ReservaOutros = { total: number; eventos: EventoConcorrente[] }

/** coberto = o disponível atende; comprar = falta e ninguém mais disputa; conflito = outros eventos levam o estoque; conferir = saldo não comparável. */
export type SituacaoCompra = 'coberto' | 'comprar' | 'conflito' | 'conferir'

export type LinhaCompra = {
  codigo: number
  descricao: string
  unidade: string | null
  familia: string
  /** Quantidade bruta que o evento consome (com perda e folga). */
  bruta: number
  /** Saldo em estoque (null = não dá para comparar, ex.: unidade da ficha diferente da do estoque). */
  emEstoque: number | null
  /** Reservado por outros eventos confirmados. */
  reservadoOutros: number
  /** Estoque − reservas dos outros eventos (pode ser negativo); null quando o saldo não é comparável. */
  disponivel: number | null
  faltaComprar: number
  situacao: SituacaoCompra
  /** Outros eventos que reservam este insumo. */
  concorrentes: EventoConcorrente[]
  custoUnitario: number | null
  /** Custo estimado do que falta comprar (custo médio × falta). */
  custoCompra: number
  semCusto: boolean
}

export const SEM_FAMILIA = 'Sem família'

/**
 * Lista de compras: o que o evento consome, menos o disponível (saldo negativo vale zero, menos o que outros eventos reservaram).
 * `saldo` devolve undefined quando o saldo não é comparável; aí compra tudo e marca emEstoque = null.
 */
export function listaDeCompras(
  insumos: Map<number, Necessidade>,
  info: (codigo: number) => InfoProduto,
  saldo: (codigo: number) => number | undefined,
  reservado: (codigo: number) => ReservaOutros | undefined = () => undefined,
): LinhaCompra[] {
  const out: LinhaCompra[] = []
  for (const n of insumos.values()) {
    const p = info(n.codigo)
    const s = saldo(n.codigo)
    const r = reservado(n.codigo)
    const emEstoque = s == null ? null : Math.max(s, 0)
    const reservadoOutros = arred6(Math.max(r?.total ?? 0, 0))
    const disponivel = emEstoque == null ? null : arred6(emEstoque - reservadoOutros)
    const faltaComprar = arred6(Math.max(n.quantidade - Math.max(disponivel ?? 0, 0), 0))
    const situacao: SituacaoCompra = disponivel == null ? 'conferir'
      : faltaComprar <= 0 ? 'coberto'
        : reservadoOutros > 0 && (emEstoque ?? 0) > 0 ? 'conflito' : 'comprar'
    out.push({
      codigo: n.codigo, descricao: p.descricao, unidade: p.unidade, familia: p.familia?.trim() || SEM_FAMILIA,
      bruta: n.quantidade, emEstoque, reservadoOutros, disponivel, faltaComprar, situacao, concorrentes: r?.eventos ?? [],
      custoUnitario: n.custoUnitario, custoCompra: arred6(faltaComprar * (n.custoUnitario ?? 0)), semCusto: n.semCusto,
    })
  }
  return out.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
}

export type Cobertura = { insumos: number; faltam: number; conflitos: number; conferir: number; custoCompra: number }

/** Resumo da lista de compras: quantos insumos faltam, quantos disputam estoque com outros eventos. */
export function coberturaCompras(linhas: LinhaCompra[]): Cobertura {
  return {
    insumos: linhas.length,
    faltam: linhas.filter((l) => l.faltaComprar > 0).length,
    conflitos: linhas.filter((l) => l.situacao === 'conflito').length,
    conferir: linhas.filter((l) => l.situacao === 'conferir').length,
    custoCompra: linhas.reduce((a, l) => a + l.custoCompra, 0),
  }
}

/** Agrupa por família (famílias em ordem alfabética, "Sem família" no fim). */
export function porFamilia<T extends { familia: string }>(linhas: T[]): { familia: string; linhas: T[] }[] {
  const m = new Map<string, T[]>()
  for (const l of linhas) m.set(l.familia, [...(m.get(l.familia) ?? []), l])
  return [...m.entries()]
    .sort(([a], [b]) => (a === SEM_FAMILIA ? 1 : b === SEM_FAMILIA ? -1 : a.localeCompare(b, 'pt-BR')))
    .map(([familia, linhas]) => ({ familia, linhas }))
}

export type LinhaProducao = { codigo: number; descricao: string; unidade: string | null; quantidade: number; emEstoque: number | null; custo: number }

export function listaDeProducao(preparacoes: Map<number, Necessidade>, info: (codigo: number) => InfoProduto, saldo: (codigo: number) => number | undefined): LinhaProducao[] {
  return [...preparacoes.values()].map((n) => {
    const p = info(n.codigo)
    const s = saldo(n.codigo)
    return { codigo: n.codigo, descricao: p.descricao, unidade: p.unidade, quantidade: n.quantidade, emEstoque: s == null ? null : Math.max(s, 0), custo: n.custo }
  }).sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
}

/** 'YYYY-MM-DD' → '12/11/2026' (sem fuso). */
export function formatarData(d: string | null | undefined): string {
  if (!d) return 'Sem data'
  const [a, m, dia] = d.slice(0, 10).split('-')
  return a && m && dia ? `${dia}/${m}/${a}` : 'Sem data'
}

/** Dias até a data (negativo = já passou). */
export function diasAte(d: string | null, hoje = new Date()): number | null {
  if (!d) return null
  const [a, m, dia] = d.slice(0, 10).split('-').map(Number)
  if (!a || !m || !dia) return null
  return Math.round((Date.UTC(a, m - 1, dia) - Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) / 864e5)
}

const num = (v: number, casas = 3) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas })
/** Quantidade legível: kg/l abaixo de 1 vira g/ml. */
export function quantidadeTexto(v: number, unidade: string | null): string {
  const u = (unidade ?? '').toUpperCase()
  if (u === 'KG' && v < 1) return `${num(v * 1000, 0)} g`
  if ((u === 'L' || u === 'LT') && v < 1) return `${num(v * 1000, 0)} ml`
  return `${num(v)}${u ? ` ${u.toLowerCase()}` : ''}`
}

/** Texto de produção e compras pronto para colar no WhatsApp (*negrito* do WhatsApp). */
export function textoWhatsApp(
  e: { nome: string; data: string | null; convidados: number },
  pratos: { descricao: string; porcoes: number }[],
  producao: LinhaProducao[],
  compras: LinhaCompra[],
): string {
  const t = [`*${e.nome}*`, `${formatarData(e.data)} · ${e.convidados} convidado${e.convidados === 1 ? '' : 's'}`]
  if (pratos.length) {
    t.push('', '*Pratos*')
    for (const p of pratos) t.push(`- ${p.descricao}: ${num(p.porcoes, 1)} porç${p.porcoes === 1 ? 'ão' : 'ões'}`)
  }
  if (producao.length) {
    t.push('', '*Produzir*')
    for (const p of producao) t.push(`- ${p.descricao}: ${quantidadeTexto(p.quantidade, p.unidade)}`)
  }
  const comprar = compras.filter((c) => c.faltaComprar > 0)
  if (comprar.length) {
    t.push('', '*Comprar*')
    for (const g of porFamilia(comprar)) {
      t.push(`_${g.familia}_`)
      for (const c of g.linhas) t.push(`- ${c.descricao}: ${quantidadeTexto(c.faltaComprar, c.unidade)}`)
    }
    const total = comprar.reduce((a, c) => a + c.custoCompra, 0)
    if (total > 0) t.push('', `Estimativa da compra: ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`)
  } else if (compras.length) {
    t.push('', 'Todos os insumos já estão em estoque.')
  }
  return t.join('\n')
}

// ---------------------------------------------------------------- etapas e próximo passo

export const ETAPAS_EVENTO = ['Orçamento', 'Confirmado', 'Produção e compras', 'Finalizado'] as const

export type AcaoPasso =
  | 'pratos' | 'preco' | 'confirmar' | 'conflito' | 'comprar' | 'produzir' | 'finalizar' | 'baixa' | 'lancar_erp' | 'pronto' | 'cancelado'

export type EstadoEvento = {
  status: StatusEvento
  finalizado: boolean
  baixaFeita: boolean
  pratos: number
  temPreco: boolean
  /** Dias até a data (negativo = passou; null = sem data). */
  dias: number | null
  faltam: number
  conflitos: number
  modo: 'omie' | 'proprio'
}

export type ProximoPasso = {
  /** Etapa atual (0 a 3); -1 = cancelado (sem etapa). */
  etapa: number
  /** Todas as etapas feitas. */
  concluido: boolean
  acao: AcaoPasso
  titulo: string
  texto: string
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** Uma única coisa que importa agora, na ordem em que o evento anda. */
export function proximoPasso(e: EstadoEvento): ProximoPasso {
  if (e.status === 'cancelado') {
    return { etapa: -1, concluido: false, acao: 'cancelado', titulo: 'Evento cancelado', texto: 'Não reserva estoque. Para retomar, mude a situação para Orçamento.' }
  }
  if (e.finalizado) {
    if (e.baixaFeita) return { etapa: 3, concluido: true, acao: 'pronto', titulo: 'Evento fechado', texto: 'Consumo real salvo e lançado no estoque.' }
    return e.modo === 'proprio'
      ? { etapa: 3, concluido: false, acao: 'baixa', titulo: 'Dar baixa no estoque', texto: 'O consumo real está salvo. Falta tirar do estoque o que foi usado.' }
      : { etapa: 3, concluido: false, acao: 'lancar_erp', titulo: 'Lançar o consumo no estoque', texto: 'Esta loja usa o estoque do Omie: lance o consumo pela tela de ajustes e marque como lançado.' }
  }
  if (e.pratos === 0) return { etapa: 0, concluido: false, acao: 'pratos', titulo: 'Escolher os pratos', texto: 'Sem pratos não dá para ver custo, produção nem compras.' }
  const passou = e.dias != null && e.dias < 0
  if (e.status === 'realizado' || (e.status === 'confirmado' && passou)) {
    return { etapa: 3, concluido: false, acao: 'finalizar', titulo: 'Finalizar com o consumo real', texto: passou ? 'A data já passou. Informe quanto foi usado de verdade.' : 'Informe quanto foi usado de verdade para fechar a conta.' }
  }
  if (!e.temPreco) return { etapa: e.status === 'confirmado' ? 2 : 0, concluido: false, acao: 'preco', titulo: 'Definir o preço por pessoa', texto: 'Com o preço aparecem o lucro e a margem. Use o sugerido pela meta se quiser.' }
  if (e.status === 'orcamento') {
    return { etapa: 0, concluido: false, acao: 'confirmar', titulo: 'Confirmar o evento', texto: passou ? 'A data já passou e o evento ainda é orçamento. Confirme ou cancele.' : 'Quando o cliente fechar, confirme: o evento passa a reservar os insumos do estoque.' }
  }
  if (e.conflitos > 0) {
    return { etapa: 2, concluido: false, acao: 'conflito', titulo: `Resolver ${plural(e.conflitos, 'insumo disputado', 'insumos disputados')}`, texto: 'Outros eventos já reservaram parte do estoque. Compre a diferença ou converse sobre as datas.' }
  }
  if (e.faltam > 0) return { etapa: 2, concluido: false, acao: 'comprar', titulo: `Comprar o que falta (${plural(e.faltam, 'item', 'itens')})`, texto: 'O resto já está em estoque e fica reservado para este evento.' }
  if (e.dias === 0) return { etapa: 2, concluido: false, acao: 'finalizar', titulo: 'É hoje', texto: 'Depois do evento, finalize com o consumo real.' }
  return { etapa: 2, concluido: false, acao: 'produzir', titulo: 'Produzir', texto: 'Tudo em estoque e reservado. Siga a lista de produção.' }
}

// ---------------------------------------------------------------- consumo real

export const MAX_QTD_CONSUMO = 10_000_000

/** Lê o consumo_real gravado ({"codigo": quantidade}); qualquer coisa estranha vira null. */
export function lerConsumoReal(v: unknown): Map<number, number> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const m = new Map<number, number>()
  for (const [k, q] of Object.entries(v as Record<string, unknown>)) {
    const cod = Number(k)
    const n = Number(q)
    if (Number.isSafeInteger(cod) && cod > 0 && Number.isFinite(n) && n >= 0) m.set(cod, n)
  }
  return m
}

/** Confere o consumo informado contra os insumos do evento: todos e só eles, quantidade de 0 a 10 milhões. */
export function validarConsumo(informado: unknown, esperados: Set<number>): { consumo: Record<string, number> } | { error: string } {
  if (!Array.isArray(informado) || informado.length > 5000) return { error: 'Lista de consumo inválida.' }
  const consumo: Record<string, number> = {}
  for (const l of informado as { codigo?: unknown; quantidade?: unknown }[]) {
    const cod = Number(l?.codigo)
    const q = Number(l?.quantidade)
    if (!Number.isSafeInteger(cod) || !esperados.has(cod)) return { error: 'O evento mudou desde que a lista foi aberta. Abra de novo.' }
    if (String(cod) in consumo) return { error: 'Insumo repetido na lista.' }
    if (!Number.isFinite(q) || q < 0 || q > MAX_QTD_CONSUMO) return { error: 'Quantidade usada inválida.' }
    consumo[String(cod)] = arred6(q)
  }
  if (Object.keys(consumo).length !== esperados.size) return { error: 'O evento mudou desde que a lista foi aberta. Abra de novo.' }
  return { consumo }
}

export type LinhaConsumo = { codigo: number; codigoTexto: string; descricao: string; unidade: string | null; previsto: number; usado: number }

/** Lista para lançar à mão no ERP (loja Omie). */
export function textoConsumo(e: { nome: string; data: string | null }, linhas: LinhaConsumo[]): string {
  const t = [`Consumo do evento ${e.nome} (${formatarData(e.data)})`]
  for (const l of linhas) if (l.usado > 0) t.push(`${l.codigoTexto}\t${l.descricao}\t${num(l.usado, 6)}\t${(l.unidade ?? '').toLowerCase()}`)
  return t.join('\n')
}
