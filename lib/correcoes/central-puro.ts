// Central de correções: regras puras (formatos, causa em uma frase, classificação, estado, prévias, busca).
// Um arquivo só de propósito: módulos puros não podem importar valores uns dos outros com '.ts' (o tsc recusa sem
// allowImportingTsExtensions) e sem a extensão o node --test não acha. Sem imports de valor: node --test.
import type { CupomSemOP } from './cupons-sem-op-puro.ts'

const CONTAVEL = new Set(['UN', 'POR', 'PCT', 'CE', 'CX', 'PC', 'DZ'])
const nf = (max: number, min = 0) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: max, minimumFractionDigits: min })

export function unidadeCurta(un: string | null | undefined): string {
  const u = (un ?? '').trim().toLowerCase()
  if (u === 'lt' || u === 'l') return 'L'
  return u || 'un'
}

/** Quantidade com unidade: '−11 un', '64,89 kg', '1,5 g'. */
export function fmtQtd(q: number | null | undefined, un: string | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return '—'
  const U = (un ?? '').toUpperCase()
  const casas = CONTAVEL.has(U) ? (Number.isInteger(q) ? 0 : 2) : ['G', 'ML'].includes(U) ? 1 : 3
  return (q < 0 ? '−' : '') + nf(casas).format(Math.abs(q)) + ' ' + unidadeCurta(un)
}

/** Com sinal explícito: '+15 un', '−2 kg'. */
export function fmtQtdSinal(q: number, un: string | null | undefined): string {
  return (q > 0 ? '+' : '') + fmtQtd(q, un)
}

export function fmtBRL(v: number): string {
  return (v < 0 ? '−R$ ' : 'R$ ') + nf(2, 2).format(Math.abs(v))
}

/** Valor curto para cartões: 'R$ 139,2 mil', 'R$ 1,3 mi', 'R$ 851', 'R$ 58,08'. */
export function fmtBRLCurto(v: number): string {
  if (v < 0) return '−' + fmtBRLCurto(-v)
  if (v >= 1e6) return 'R$ ' + nf(1).format(v / 1e6) + ' mi'
  if (v >= 1e4) return 'R$ ' + nf(1).format(v / 1e3) + ' mil'
  if (v >= 100) return 'R$ ' + nf(0).format(v)
  return fmtBRL(v)
}

export function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

export function fmtDataLonga(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

export const b36 = (n: number) => Math.trunc(Math.abs(n)).toString(36)

/** Hash determinístico curto (2 × FNV-1a 32 bits, base36, 13 caracteres). */
export function hashCurto(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return (h1.toString(36).padStart(7, '0') + h2.toString(36).padStart(7, '0')).slice(0, 13)
}

/** Sem acento, minúsculas (busca). */
export const normalizar = (s: string | null | undefined) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ================================================================================================================
// Tipos
// ================================================================================================================

export type Grupo = 'pa' | 'pi' | 'mp' | 'custo' | 'op' | 'contagem' | 'semcusto' | 'cupom' | 'taxa'
export type EstadoProblema = 'aberto' | 'resolvido' | 'ramon' | 'ignorado'
export type AcaoId =
  | 'zerar' | 'contagem' | 'op_preparo' | 'op_prato' | 'ramon' | 'corrigir_custo' | 'concluir' | 'mudar_data' | 'excluir'
  | 'corrigir_contagem' | 'nao_controla' | 'criar_ops_cupom'
export type Alvo = { tipo: 'produto' | 'op' | 'cupom' | 'nota' | 'ajuste'; id: number }
export type Dependencia = { texto: string; chave?: string; alvo?: Alvo }
export type ProdutoC = {
  codigo: number; cod: string; nome: string; unidade: string; tipo: string | null; saldo: number; cmc: number
  custoSuspeito?: boolean; locais: { local: number; saldo: number }[]
}
export type OPAbertaC = {
  id: number; nCodOP: number | null; numero: string; produto: number | null; qtd: number; local: number | null; origem: string | null
  previsao: string | null; inclusao: string | null; cupom: string | null; insumos: { produto: number; qtd: number }[]
}
export type ItemFichaC = { insumo: number; qtd: number; perda: number; local: number | null }
export type DadosProblema = {
  produto?: number; unidade?: string; tipo?: string | null; saldo?: number; cmc?: number; ref?: number; fichaCusto?: number
  locaisNeg?: { local: number; nome: string; saldo: number }[]; local?: number; sugerida?: number; op?: OPAbertaC
  sentido?: 'sobrando' | 'faltando' | 'velha'; saldoLocal?: number
  contagem?: { de: number; para: number; data: string; sugerida: number | null; movId?: number }; pratos?: number[]; cupom?: CupomSemOP
  desde?: string | null; notaPendente?: { id: number; numero: string }; cuponsSemOP?: number
}
export type Problema = {
  chave: string; grupo: Grupo; alvo: Alvo; titulo: string; tag: string; causa: string; valor: number; valorRotulo: string
  /** Texto curto à direita da linha (saldo, custo ou quantidade da OP). */
  lado: string; ladoErro: boolean
  acoes: AcaoId[]; assinatura: string; depende: Dependencia[]; busca: string; d: DadosProblema
}
export type EntradaCentral = {
  hoje: string; modo: 'omie' | 'proprio'; produtos: ProdutoC[]; nomesLocais: Map<number, string>
  /** `${produto}:${local}` → data ISO do início do trecho negativo atual. */
  desde: Map<string, string>
  custoHist: Map<number, { atual: number; anterior: number | null }>
  fichas: Map<number, ItemFichaC[]>
  /** `${insumo}:${local}` → CMC na foto mais recente. */
  cmcLocal: Map<string, number>
  semCusto: { insumo: number; local: number; pratos: number[] }[]
  insumosInativos: Set<number>
  opsAbertas: OPAbertaC[]
  contagens: { produto: number; local: number; data: string; de: number; para: number; movId?: number }[]
  /** Ids (movimentos SLD) de contagens já corrigidas pela Central: não voltam (corrigir de novo duplicaria). */
  contagensCorrigidas?: Set<number>
  cuponsSemOP: CupomSemOP[]
  notasPendentes: Map<number, { id: number; numero: string }>
  naoControla: Set<number>
}

export const GRUPOS: Record<Grupo, { nome: string; sub: string }> = {
  pa: { nome: 'Pratos negativos (PA)', sub: 'Vendidos com saldo abaixo de zero' },
  pi: { nome: 'Preparos negativos (PI)', sub: 'Usados nos pratos sem OP de preparo lançada' },
  mp: { nome: 'Insumos e revenda negativos', sub: 'Saiu mais do que entrou por nota' },
  custo: { nome: 'Custo fora do normal', sub: 'Custo médio que não bate com a ficha ou com o anterior' },
  op: { nome: 'OPs abertas sobrando ou faltando', sub: 'Ordens de produção que ficaram abertas no Omie' },
  contagem: { nome: 'Contagens estranhas', sub: 'Contagem que pulou muito de uma vez' },
  semcusto: { nome: 'Insumo sem custo ou inativo na ficha', sub: 'Pratos que usam insumo sem custo no local ou inativo' },
  cupom: { nome: 'Cupons sem OP', sub: 'Vendas do caixa de pratos com ficha que não geraram OP' },
  taxa: { nome: 'Taxas que não são estoque', sub: 'Serviços que baixam saldo à toa' },
}
export const TAG_TIPO: Record<string, string> = { '04': 'PA', '03': 'PI', '01': 'MP', '00': 'Revenda', '07': 'MC', '99': 'Taxa' }

// ================================================================================================================
// Custo
// ================================================================================================================
export const CUSTO_ABSURDO_MIN = 1000
const CUSTO_ABSURDO_VEZES = 20
const VALOR_MAX = 1e7
const DIAS_OP_VELHA = 7
const arred2 = (n: number) => Math.round(n * 100) / 100

/** Mesma regra de lib/estoque/saude-puro.ts (custoAbsurdo). */
function custoAbsurdoLocal(cmc: number, anterior: number | null): boolean {
  if (!(cmc > 0)) return false
  if (cmc >= CUSTO_ABSURDO_MIN) return true
  return anterior != null && anterior > 0 && cmc >= anterior * CUSTO_ABSURDO_VEZES
}

/** Custo de 1 unidade do prato pela ficha: Σ qtd × (1 + perda%) × custo do insumo. */
export function custoPelaFicha(itens: ItemFichaC[] | undefined, cmc: (p: number) => number): number {
  if (!itens?.length) return 0
  return Math.round(itens.reduce((s, i) => s + i.qtd * (1 + (i.perda || 0) / 100) * cmc(i.insumo), 0) * 1e6) / 1e6
}

/** Custo de referência (Ruling R5): CMC plausível, senão o custo pela ficha, senão 0. */
export function custoRef(p: ProdutoC, fichaCusto: number): number {
  if (p.cmc > 0 && p.cmc < CUSTO_ABSURDO_MIN && !p.custoSuspeito) return p.cmc
  return fichaCusto > 0 ? fichaCusto : 0
}

/** Contagem que parece ter a vírgula no lugar errado (4,658 digitado como 4.658). */
export function sugestaoContagem(de: number, para: number): number | null {
  if (de > 0 && para >= 1000 && para / de >= 500) return Math.round((para / 1000) * 1e6) / 1e6
  return null
}

// ================================================================================================================
// Causa em uma frase
// ================================================================================================================
const lista = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`)

export function causaNegativo(i: { grupo: 'pa' | 'pi' | 'mp'; saldo: string; locais: string; desde: string | null; cuponsSemOP: number; opAberta: string | null; notaPendente: string | null }): string {
  const inicio = `Saldo ${i.saldo} no local ${i.locais}${i.desde ? `, negativo desde ${i.desde}` : ''}.`
  if (i.grupo !== 'mp' && i.cuponsSemOP > 0) {
    return `${inicio} ${i.cuponsSemOP === 1 ? '1 cupom deste prato ficou sem OP' : `${i.cuponsSemOP} cupons deste prato ficaram sem OP`}: a venda baixou o prato e não os insumos.`
  }
  if (i.opAberta) return `${inicio} A ${i.opAberta} está aberta: concluir repõe o saldo.`
  if (i.grupo === 'pa') return `${inicio} Vendido com saldo abaixo de zero e sem OP aberta para repor.`
  if (i.grupo === 'pi') return `${inicio} Foi usado nos pratos sem OP de preparo lançada.`
  if (i.notaPendente) return `${inicio} Tem a nota ${i.notaPendente} esperando entrada no estoque.`
  return `${inicio} Saiu mais do que entrou por nota (consumo nas OPs ou vendas).`
}

export function causaCusto(i: { cmc: string; ficha: string | null; vezes: number | null; anterior: string | null }): string {
  const fim = 'Costuma ser entrada com custo ou unidade errada.'
  if (i.ficha && i.vezes != null) {
    return i.vezes >= 1
      ? `Custo médio de ${i.cmc}, ${i.vezes} vezes o custo pela ficha (${i.ficha}). ${fim}`
      : `Custo médio de ${i.cmc}, muito abaixo do custo pela ficha (${i.ficha}). ${fim}`
  }
  if (i.anterior) return `Custo médio de ${i.cmc}; antes era ${i.anterior}. ${fim}`
  return `Custo médio de ${i.cmc}, alto demais para uma unidade. ${fim}`
}

export function causaOP(i: { sentido: 'sobrando' | 'faltando' | 'velha'; desde: string | null; cupom: string | null; saldoLocal: string; qtd: string; insumos: string | null }): string {
  const desde = i.desde ? ` desde ${i.desde}` : ''
  if (i.sentido === 'sobrando') {
    return `OP do caixa${i.cupom ? ` (cupom ${i.cupom})` : ''} aberta${desde}, e o prato já tem saldo ${i.saldoLocal} no local. Concluir agora deixaria sobra; excluir evita entrada em dobro.`
  }
  if (i.sentido === 'faltando') {
    return `Aberta${desde}. Concluir põe ${i.qtd} no saldo (hoje ${i.saldoLocal})${i.insumos ? ` e baixa os insumos (${i.insumos})` : ''}.`
  }
  return `Aberta${desde} e ainda sem conclusão. Conclua com a data certa ou exclua se a produção não aconteceu.`
}

export function causaContagem(i: { de: string; para: string; data: string; sugerida: string | null; subiu: boolean }): string {
  const ini = `Contagem ${i.subiu ? 'saltou' : 'caiu'} de ${i.de} para ${i.para} em ${i.data}.`
  return i.sugerida ? `${ini} Parece ${i.sugerida} digitado como ${i.para}.` : `${ini} Vale conferir se a unidade foi digitada certa.`
}

export function causaSemCusto(i: { insumo: string; local: string; pratos: string[]; inativo: boolean }): string {
  const pr = i.pratos.length > 3 ? [...i.pratos.slice(0, 3), `mais ${i.pratos.length - 3}`] : i.pratos
  if (i.inativo) return `${i.insumo} está inativo, mas continua na ficha de ${lista(pr)}. Troque o insumo na ficha.`
  return `${i.insumo} está sem custo no local ${i.local}. ${lista(pr)} não ${i.pratos.length === 1 ? 'conclui' : 'concluem'} OP no Omie (erro Client-193) e ${i.pratos.length === 1 ? 'sai mais barato' : 'saem mais baratos'} do que ${i.pratos.length === 1 ? 'é' : 'são'}.`
}

export function causaTaxa(i: { saldo: string }): string {
  return `Não é mercadoria: cada venda baixa o "estoque" e o saldo só desce (${i.saldo}). Marcar como "não controla estoque" tira o item daqui.`
}

export function causaCupom(i: { num: string | null; data: string; hora: string | null; itens: string[] }): string {
  const its = i.itens.length > 4 ? [...i.itens.slice(0, 4), `mais ${i.itens.length - 4}`] : i.itens
  return `Cupom ${i.num ?? 's/ nº'} de ${i.data}${i.hora ? ` às ${i.hora}` : ''}: ${its.join(', ')} sem OP. A venda baixou os pratos, mas os insumos não saíram.`
}

// ================================================================================================================
// Classificação
// ================================================================================================================
function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}
const numeroOP = (n: string) => (n.includes('/') ? n.split('/')[1].replace(/^0+/, '') : n.replace(/^0+/, '')) || n

export function classificarProblemas(e: EntradaCentral): Problema[] {
  const prod = new Map(e.produtos.map((p) => [p.codigo, p]))
  const nome = (c: number) => prod.get(c)?.nome ?? `Produto ${c}`
  const nomeLocal = (l: number) => e.nomesLocais.get(l) ?? `${l}`
  const cmcPlaus = (c: number) => {
    const p = prod.get(c)
    return p && p.cmc > 0 && p.cmc < CUSTO_ABSURDO_MIN && !p.custoSuspeito ? p.cmc : 0
  }
  const fichaCusto = new Map<number, number>()
  for (const [prato, itens] of e.fichas) fichaCusto.set(prato, custoPelaFicha(itens, cmcPlaus))
  // Custo de referência: produto com custo fora do normal não usa o próprio CMC (usa a ficha, senão o custo anterior).
  const comCustoRuim = new Set<number>()
  const ref = (c: number) => {
    const p = prod.get(c)
    if (!p) return 0
    if (comCustoRuim.has(c)) return (fichaCusto.get(c) ?? 0) > 0 ? fichaCusto.get(c)! : (e.custoHist.get(c)?.anterior ?? 0)
    return custoRef(p, fichaCusto.get(c) ?? 0)
  }
  const ignora = (c: number) => e.naoControla.has(c)
  const out: Problema[] = []
  const vistas = new Set<string>()
  // Chave repetida (dado de entrada duplicado) fica só a primeira: a chave identifica o estado guardado no banco.
  const push = (p: Omit<Problema, 'busca'>, extra = '') => {
    if (vistas.has(p.chave)) return
    vistas.add(p.chave)
    out.push({ ...p, valor: arred2(p.valor), busca: normalizar(`${p.titulo} ${p.causa} ${extra}`) })
  }

  const cuponsPorPrato = new Map<number, number>()
  for (const c of e.cuponsSemOP) for (const i of new Set(c.itens.map((x) => x.produto))) cuponsPorPrato.set(i, (cuponsPorPrato.get(i) ?? 0) + 1)
  const opsPorProduto = new Map<number, OPAbertaC[]>()
  for (const o of e.opsAbertas) if (o.produto != null) opsPorProduto.set(o.produto, [...(opsPorProduto.get(o.produto) ?? []), o])

  // Custo fora do normal (antes: as OPs e o custo de referência dependem dele).
  for (const p of e.produtos) {
    if (ignora(p.codigo) || p.tipo === '99' || !(p.cmc > 0)) continue
    const h = e.custoHist.get(p.codigo)
    const fc = fichaCusto.get(p.codigo) ?? 0
    const anterior = h?.anterior ?? null
    let ruim = !!p.custoSuspeito || custoAbsurdoLocal(p.cmc, anterior)
    const ehProducao = p.tipo === '03' || p.tipo === '04'
    if (!ruim && ehProducao && fc > 0 && (p.cmc >= fc * CUSTO_ABSURDO_VEZES || p.cmc <= fc / CUSTO_ABSURDO_VEZES)) ruim = true
    if (!ruim) continue
    comCustoRuim.add(p.codigo)
    const r = ehProducao && fc > 0 ? fc : (anterior ?? 0)
    const valor = Math.min(VALOR_MAX, Math.abs(p.saldo) * Math.abs(p.cmc - r))
    const un = unidadeCurta(p.unidade)
    push({
      chave: `custo:produto:${p.codigo}`, grupo: 'custo', alvo: { tipo: 'produto', id: p.codigo }, titulo: p.nome, tag: TAG_TIPO[p.tipo ?? ''] ?? 'Outro',
      causa: causaCusto({
        cmc: `${fmtBRL(p.cmc)}/${un}`, ficha: ehProducao && fc > 0 ? fmtBRL(fc) : null,
        vezes: ehProducao && fc > 0 ? Math.round(p.cmc / fc) : null, anterior: anterior ? fmtBRL(anterior) : null,
      }),
      valor, valorRotulo: valor > 0 ? 'de custo suspeito' : 'afeta o custo dos pratos', lado: `${fmtBRL(p.cmc)}/${un}`, ladoErro: true,
      acoes: ['corrigir_custo', 'ramon'], assinatura: String(arred2(p.cmc)), depende: [],
      d: { produto: p.codigo, unidade: p.unidade, tipo: p.tipo, saldo: p.saldo, cmc: p.cmc, ref: r, fichaCusto: fc },
    }, p.cod)
  }

  // Negativos e taxas.
  for (const p of e.produtos) {
    if (ignora(p.codigo)) continue
    const neg = p.locais.filter((l) => l.saldo < 0)
    if (!neg.length) continue
    const somaNeg = neg.reduce((s, l) => s + l.saldo, 0)
    const saldoTxt = fmtQtd(Math.round(somaNeg * 1e6) / 1e6, p.unidade)
    if (p.tipo === '99') {
      push({
        chave: `taxa:produto:${p.codigo}`, grupo: 'taxa', alvo: { tipo: 'produto', id: p.codigo }, titulo: p.nome, tag: 'Taxa',
        causa: causaTaxa({ saldo: saldoTxt }), valor: 0, valorRotulo: 'sem valor', lado: saldoTxt, ladoErro: true,
        acoes: ['nao_controla', 'ramon'], assinatura: 'taxa', depende: [], d: { produto: p.codigo, unidade: p.unidade, tipo: p.tipo, saldo: p.saldo },
      }, p.cod)
      continue
    }
    const grupo: 'pa' | 'pi' | 'mp' = p.tipo === '04' ? 'pa' : p.tipo === '03' ? 'pi' : 'mp'
    const datas = neg.map((l) => e.desde.get(`${p.codigo}:${l.local}`)).filter((x): x is string => !!x).sort()
    const cupons = cuponsPorPrato.get(p.codigo) ?? 0
    const opA = (opsPorProduto.get(p.codigo) ?? [])[0]
    const nota = e.notasPendentes.get(p.codigo)
    const r = ref(p.codigo)
    const depende: Dependencia[] = []
    if (grupo !== 'mp' && cupons > 0) depende.push({ texto: `${cupons === 1 ? '1 cupom deste prato está' : `${cupons} cupons deste prato estão`} sem OP: crie as OPs dos cupons antes de zerar ou lançar outra OP.`, chave: 'grupo:cupom' })
    if (comCustoRuim.has(p.codigo)) depende.push({ texto: 'O custo médio deste produto está fora do normal: corrija o custo antes de lançar OP ou ajuste.', chave: `custo:produto:${p.codigo}` })
    if (nota) depende.push({ texto: `A nota ${nota.numero} ainda não entrou no estoque.`, alvo: { tipo: 'nota', id: nota.id } })
    push({
      chave: `${grupo}:produto:${p.codigo}`, grupo, alvo: { tipo: 'produto', id: p.codigo }, titulo: p.nome, tag: TAG_TIPO[p.tipo ?? ''] ?? 'Outro',
      causa: causaNegativo({
        grupo, saldo: saldoTxt, locais: lista(neg.map((l) => nomeLocal(l.local))), desde: datas[0] ? fmtData(datas[0]) : null,
        cuponsSemOP: cupons, opAberta: opA ? `OP ${numeroOP(opA.numero)}` : null, notaPendente: nota?.numero ?? null,
      }),
      valor: Math.abs(somaNeg) * r, valorRotulo: 'no saldo', lado: saldoTxt, ladoErro: true,
      acoes: grupo === 'pa' ? ['zerar', 'op_prato', 'contagem', 'ramon'] : grupo === 'pi' ? ['op_preparo', 'contagem', 'ramon'] : ['contagem', 'ramon'],
      assinatura: String(Math.round(somaNeg * 1000) / 1000), depende,
      d: {
        produto: p.codigo, unidade: p.unidade, tipo: p.tipo, saldo: p.saldo, cmc: p.cmc, ref: r, fichaCusto: fichaCusto.get(p.codigo) ?? 0,
        locaisNeg: neg.map((l) => ({ local: l.local, nome: nomeLocal(l.local), saldo: l.saldo })), sugerida: Math.round(Math.abs(somaNeg) * 1e6) / 1e6,
        desde: datas[0] ?? null, notaPendente: nota, cuponsSemOP: cupons,
      },
    }, p.cod)
  }

  // OPs abertas.
  for (const o of e.opsAbertas) {
    if (o.produto == null || ignora(o.produto)) continue
    const p = prod.get(o.produto)
    const saldoLocal = o.local ? (p?.locais.find((l) => l.local === o.local)?.saldo ?? 0) : (p?.saldo ?? 0)
    const inicio = o.inclusao ?? o.previsao
    const idade = inicio ? diasEntre(inicio, e.hoje) : 0
    const sentido = o.origem === 'cupom' && saldoLocal >= 0 ? 'sobrando' : saldoLocal < 0 ? 'faltando' : idade > DIAS_OP_VELHA ? 'velha' : null
    if (!sentido) continue
    const valorIns = o.insumos.reduce((s, i) => s + i.qtd * cmcPlaus(i.produto), 0)
    const valor = valorIns > 0 ? valorIns : o.qtd * ref(o.produto)
    const depende: Dependencia[] = []
    for (const i of o.insumos) {
      if (comCustoRuim.has(i.produto)) depende.push({ texto: `Corrija antes o custo de ${nome(i.produto)}: concluir agora levaria o custo errado para ${nome(o.produto)}.`, chave: `custo:produto:${i.produto}`, alvo: { tipo: 'produto', id: i.produto } })
      const localIns = e.fichas.get(o.produto)?.find((f) => f.insumo === i.produto)?.local ?? o.local
      if (localIns != null && e.cmcLocal.size && !((e.cmcLocal.get(`${i.produto}:${localIns}`) ?? 0) > 0)) {
        depende.push({ texto: `${nome(i.produto)} está sem custo no local ${nomeLocal(localIns)}: o Omie recusa concluir (Client-193).`, chave: `semcusto:produto:${i.produto}:${localIns}`, alvo: { tipo: 'produto', id: i.produto } })
      }
    }
    const risco = depende.some((d) => d.chave?.startsWith('custo:'))
    const un = p?.unidade ?? 'UN'
    push({
      chave: `op:op:${o.nCodOP ?? `id${o.id}`}`, grupo: 'op', alvo: { tipo: 'op', id: o.id }, titulo: `OP ${numeroOP(o.numero)} · ${nome(o.produto)}`,
      tag: risco ? 'Risco' : sentido === 'sobrando' ? 'Sobrando' : sentido === 'faltando' ? 'Faltando' : 'Velha',
      causa: causaOP({
        sentido, desde: inicio ? fmtData(inicio) : null, cupom: o.cupom, saldoLocal: fmtQtd(saldoLocal, un),
        qtd: fmtQtdSinal(o.qtd, un), insumos: valorIns > 0 ? fmtBRLCurto(valorIns) : null,
      }),
      valor, valorRotulo: 'em insumos', lado: fmtQtd(o.qtd, un), ladoErro: false,
      acoes: sentido === 'sobrando' ? ['excluir', 'concluir', 'ramon'] : ['concluir', 'mudar_data', 'excluir', 'ramon'],
      assinatura: sentido, depende,
      d: { produto: o.produto, unidade: un, tipo: p?.tipo ?? null, saldo: p?.saldo, op: o, sentido, saldoLocal, local: o.local ?? undefined },
    }, `${o.numero} ${numeroOP(o.numero)} ${o.cupom ?? ''}`)
  }

  // Contagens estranhas: só a mais recente de cada produto/local.
  const ultimaContagem = new Map<string, EntradaCentral['contagens'][number]>()
  for (const c of e.contagens) {
    if (c.movId != null && e.contagensCorrigidas?.has(c.movId)) continue
    const k = `${c.produto}:${c.local}`
    const a = ultimaContagem.get(k)
    if (!a || c.data >= a.data) ultimaContagem.set(k, c)
  }
  for (const c of ultimaContagem.values()) {
    if (ignora(c.produto)) continue
    const p = prod.get(c.produto)
    const un = p?.unidade ?? 'UN'
    const sug = sugestaoContagem(c.de, c.para)
    push({
      chave: `contagem:produto:${c.produto}:${c.local}`, grupo: 'contagem', alvo: { tipo: 'produto', id: c.produto }, titulo: nome(c.produto),
      tag: TAG_TIPO[p?.tipo ?? ''] ?? 'Outro',
      causa: causaContagem({ de: fmtQtd(c.de, un), para: fmtQtd(c.para, un), data: fmtData(c.data), sugerida: sug != null ? fmtQtd(sug, un) : null, subiu: c.para > c.de }),
      valor: Math.abs(c.para - c.de) * ref(c.produto), valorRotulo: 'de saldo em dúvida', lado: p ? fmtQtd(p.saldo, un) : '', ladoErro: !!p && p.saldo < 0,
      acoes: ['corrigir_contagem', 'contagem', 'ramon'], assinatura: `${c.data}:${c.para}`, depende: [],
      d: { produto: c.produto, unidade: un, tipo: p?.tipo ?? null, saldo: p?.saldo, cmc: p?.cmc, ref: ref(c.produto), local: c.local, contagem: { de: c.de, para: c.para, data: c.data, sugerida: sug, movId: c.movId } },
    }, p?.cod ?? '')
  }

  // Insumo sem custo no local / inativo na ficha.
  for (const s of e.semCusto) {
    if (ignora(s.insumo)) continue
    const p = prod.get(s.insumo)
    push({
      chave: `semcusto:produto:${s.insumo}:${s.local}`, grupo: 'semcusto', alvo: { tipo: 'produto', id: s.insumo }, titulo: nome(s.insumo),
      tag: TAG_TIPO[p?.tipo ?? ''] ?? 'Outro',
      causa: causaSemCusto({ insumo: nome(s.insumo), local: nomeLocal(s.local), pratos: s.pratos.map(nome), inativo: false }),
      valor: 0, valorRotulo: `afeta ${s.pratos.length} prato${s.pratos.length === 1 ? '' : 's'}`, lado: 'sem custo', ladoErro: true,
      acoes: p?.tipo === '03' ? ['op_preparo', 'ramon'] : ['ramon'], assinatura: String(s.pratos.length), depende: [],
      d: { produto: s.insumo, unidade: p?.unidade, tipo: p?.tipo ?? null, saldo: p?.saldo, local: s.local, pratos: s.pratos, sugerida: 1 },
    }, p?.cod ?? '')
  }
  const pratosDoInsumo = new Map<number, number[]>()
  for (const [prato, itens] of e.fichas) for (const i of itens) if (e.insumosInativos.has(i.insumo)) pratosDoInsumo.set(i.insumo, [...(pratosDoInsumo.get(i.insumo) ?? []), prato])
  for (const [insumo, pratos] of pratosDoInsumo) {
    const p = prod.get(insumo)
    push({
      chave: `semcusto:produto:${insumo}:inativo`, grupo: 'semcusto', alvo: { tipo: 'produto', id: insumo }, titulo: nome(insumo), tag: 'Inativo',
      causa: causaSemCusto({ insumo: nome(insumo), local: '', pratos: pratos.map(nome), inativo: true }),
      valor: 0, valorRotulo: `afeta ${pratos.length} prato${pratos.length === 1 ? '' : 's'}`, lado: 'inativo', ladoErro: true,
      acoes: ['ramon'], assinatura: String(pratos.length), depende: [{ texto: 'Troque o insumo nas fichas pela tela de Fichas.', chave: `fichas:troca:${insumo}` }],
      d: { produto: insumo, unidade: p?.unidade, tipo: p?.tipo ?? null, pratos },
    }, p?.cod ?? '')
  }

  // Cupons sem OP.
  for (const c of e.cuponsSemOP) {
    const itens = c.itens.filter((i) => !ignora(i.produto))
    if (!itens.length) continue
    const valor = itens.reduce((s, i) => s + i.quantidade * ref(i.produto), 0)
    const q = itens.reduce((s, i) => s + i.quantidade, 0)
    push({
      chave: `cupom:cupom:${c.nIdCupom}`, grupo: 'cupom', alvo: { tipo: 'cupom', id: c.nIdCupom }, titulo: `Cupom ${c.num ?? c.nIdCupom} · ${fmtData(c.data)}`, tag: 'Cupom',
      causa: causaCupom({ num: c.num, data: fmtData(c.data), hora: c.hora ? c.hora.slice(0, 5) : null, itens: itens.map((i) => `${i.nome} ×${fmtNum(i.quantidade)}`) }),
      valor, valorRotulo: 'em pratos sem OP', lado: `${fmtNum(q)} ${q === 1 ? 'item' : 'itens'}`, ladoErro: false,
      acoes: ['criar_ops_cupom', 'ramon'], assinatura: String(q), depende: [],
      d: { cupom: { ...c, itens } },
    }, `${c.num ?? ''} ${itens.map((i) => i.nome).join(' ')}`)
  }
  return out
}

const fmtNum = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(n)

// ================================================================================================================
// Estado, resumo, grupos e filtros
// ================================================================================================================
export type RegistroEstado = {
  chave: string; estado: EstadoProblema; motivo: string | null; mensagem: string | null; acao: string | null; ate: string | null
  assinatura: string | null; user_nome: string | null; atualizado_em: string
}
export type EstadoEfetivo = { estado: EstadoProblema; reaberto: string | null; reg: RegistroEstado | null }
export type ProblemaComEstado = { p: Problema; e: EstadoEfetivo }

/** Ruling R12 do plano: o que o problema mostra hoje, dado o último registro de estado. `diaReg` = dia (Bahia) do registro. */
export function estadoEfetivo(reg: RegistroEstado | undefined, p: Problema, hoje: string, diaReg: (iso: string) => string): EstadoEfetivo {
  if (!reg || reg.estado === 'aberto') return { estado: 'aberto', reaberto: null, reg: reg ?? null }
  const dia = diaReg(reg.atualizado_em)
  if (reg.estado === 'ramon') return { estado: 'ramon', reaberto: null, reg }
  if (reg.estado === 'ignorado') {
    if (reg.ate) return hoje > reg.ate ? { estado: 'aberto', reaberto: dia, reg } : { estado: 'ignorado', reaberto: null, reg }
    if (reg.assinatura != null && reg.assinatura !== p.assinatura) return { estado: 'aberto', reaberto: dia, reg }
    return { estado: 'ignorado', reaberto: null, reg }
  }
  // Contagem corrigida: a contagem errada continua no histórico (o ajuste é de diferença); com a mesma assinatura não
  // reabre nunca (reoferecer a correção duplicaria o ajuste). Revisão final, achado C2.
  if (p.grupo === 'contagem') return reg.assinatura != null && reg.assinatura !== p.assinatura ? { estado: 'aberto', reaberto: dia, reg } : { estado: 'resolvido', reaberto: null, reg }
  // resolvido: vale até o fim do dia seguinte (o Omie pode demorar a ser relido).
  return diasEntre(dia, hoje) <= 1 ? { estado: 'resolvido', reaberto: null, reg } : { estado: 'aberto', reaberto: dia, reg }
}

export function resumoDoDia(ps: ProblemaComEstado[], resolvidosHojeSumidos: number) {
  const porGrupo = {} as Record<Grupo, number>
  let resolvidos = resolvidosHojeSumidos, ramon = 0, ignorados = 0, abertos = 0, emAberto = 0
  for (const { p, e } of ps) {
    if (e.estado === 'resolvido') resolvidos++
    else if (e.estado === 'ramon') ramon++
    else if (e.estado === 'ignorado') ignorados++
    else { abertos++; emAberto += p.valor; porGrupo[p.grupo] = (porGrupo[p.grupo] ?? 0) + 1 }
  }
  return { total: resolvidos + ramon + ignorados + abertos, resolvidos, ramon, ignorados, abertos, emAberto: arred2(emAberto), porGrupo }
}

export function comecePorAqui(ps: ProblemaComEstado[], n = 3): Problema[] {
  return ps.filter((x) => x.e.estado === 'aberto' && x.p.valor > 0).sort((a, b) => b.p.valor - a.p.valor).slice(0, n).map((x) => x.p)
}

export function ordenarGrupos(ps: ProblemaComEstado[]): Grupo[] {
  const ab = new Map<Grupo, number>(), tot = new Map<Grupo, number>()
  for (const { p, e } of ps) {
    tot.set(p.grupo, (tot.get(p.grupo) ?? 0) + p.valor)
    if (e.estado === 'aberto') ab.set(p.grupo, (ab.get(p.grupo) ?? 0) + p.valor)
  }
  return [...tot.keys()].sort((a, b) => {
    if (a === 'taxa') return 1
    if (b === 'taxa') return -1
    return (ab.get(b) ?? 0) - (ab.get(a) ?? 0) || (tot.get(b) ?? 0) - (tot.get(a) ?? 0)
  })
}

export type UIGrupo = { q: string; ordem: 'valor' | 'saldo' | 'nome'; filtro: 'aberto' | 'ramon' | 'feito' | 'todos' }

export function filtrarGrupo(ps: ProblemaComEstado[], g: Grupo, u: UIGrupo): { lista: ProblemaComEstado[]; contagem: Record<UIGrupo['filtro'], number> } {
  const termos = normalizar(u.q).split(/\s+/).filter(Boolean)
  let l = ps.filter((x) => x.p.grupo === g && termos.every((t) => x.p.busca.includes(t)))
  const contagem = { aberto: 0, ramon: 0, feito: 0, todos: l.length }
  for (const x of l) {
    if (x.e.estado === 'aberto') contagem.aberto++
    else if (x.e.estado === 'ramon') contagem.ramon++
    else contagem.feito++
  }
  l = l.filter((x) => u.filtro === 'todos' || (u.filtro === 'feito' ? x.e.estado === 'resolvido' || x.e.estado === 'ignorado' : x.e.estado === u.filtro))
  const chaveSaldo = (p: Problema) =>
    g === 'custo' ? -(p.d.cmc ?? 0) : g === 'op' ? Date.parse(`${p.d.op?.inclusao ?? p.d.op?.previsao ?? '2100-01-01'}T00:00:00Z`) : g === 'cupom' ? Date.parse(`${p.d.cupom?.data ?? '2100-01-01'}T00:00:00Z`) : (p.d.saldo ?? 0)
  l.sort((a, b) => u.ordem === 'nome' ? a.p.titulo.localeCompare(b.p.titulo, 'pt-BR') : u.ordem === 'saldo' ? chaveSaldo(a.p) - chaveSaldo(b.p) : b.p.valor - a.p.valor)
  return { lista: l, contagem }
}

const EM_ANDAMENTO_MS = 10 * 60_000

/** Registro de OP lançada pela Central (central_op_lancada) → o que fazer num novo pedido igual. */
export function decidirRetomadaOP(r: { status: string; atualizadoEm: string } | null, agoraMs: number): 'novo' | 'feito' | 'em_andamento' | 'retomar' {
  if (!r) return 'novo'
  if (r.status === 'concluida') return 'feito'
  const t = Date.parse(r.atualizadoEm)
  if ((r.status === 'incluindo' || r.status === 'incluida') && Number.isFinite(t) && agoraMs - t < EM_ANDAMENTO_MS) return 'em_andamento'
  return 'retomar'
}

// ================================================================================================================
// Opções de correção e prévia do efeito
// ================================================================================================================
export type CampoDef = { id: string; rotulo: string; tipo: 'numero' | 'data' | 'texto'; sufixo?: string; inicial: string }
export type OpcaoDef = { acao: AcaoId; titulo: string; descricao: string; botao: string; feito: string; campos: CampoDef[] }
export type Previa = { vazio: string } | { linhas: { rot: string; de: string; para: string }[]; omie: string; aviso?: string }

/** '4,658' → 4.658; '1.234,5' → 1234.5; '' → null. */
export function lerNumeroBR(s: string | null | undefined): number | null {
  const t = String(s ?? '').trim().replace(/\s/g, '')
  if (!t) return null
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  if (!/^-?\d+(\.\d+)?$/.test(norm)) return null
  const n = Number(norm)
  return Number.isFinite(n) ? n : null
}
const numBR = (n: number | null | undefined) => (n == null ? '' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6, useGrouping: false }).format(n))

/** Local em que a ação de saldo age: o 1º local negativo, senão o local do problema. */
export function localDaAcao(p: Problema): { local: number | null; nome: string; saldo: number } {
  const n = p.d.locaisNeg?.[0]
  if (n) return { local: n.local, nome: n.nome, saldo: n.saldo }
  return { local: p.d.local ?? null, nome: '', saldo: p.d.saldo ?? 0 }
}

export function opcoesDoProblema(p: Problema, hoje: string): OpcaoDef[] {
  const un = unidadeCurta(p.d.unidade)
  const loc = localDaAcao(p)
  const nomeAlvo = p.grupo === 'op' ? `a ${p.titulo.split(' · ')[0]}` : p.titulo
  const defs: Record<AcaoId, () => OpcaoDef> = {
    zerar: () => ({ acao: 'zerar', titulo: 'Zerar o saldo', descricao: 'Prato é feito na hora e não fica guardado. O saldo certo é zero.', botao: 'Zerar saldo', feito: 'Saldo zerado', campos: [] }),
    contagem: () => ({ acao: 'contagem', titulo: 'Ajustar para o que foi contado', descricao: 'Use se alguém contou agora. O sistema lança só a diferença.', botao: 'Lançar ajuste', feito: 'Ajuste pelo saldo contado', campos: [{ id: 'contado', rotulo: loc.nome ? `Quanto tem em ${loc.nome}?` : 'Quanto tem agora?', tipo: 'numero', sufixo: un, inicial: '' }] }),
    op_prato: () => ({ acao: 'op_prato', titulo: 'Lançar OP do prato', descricao: 'Registra a produção que não foi lançada. Baixa os insumos da ficha.', botao: 'Lançar OP', feito: 'OP do prato lançada', campos: [{ id: 'qtd', rotulo: 'Quantidade', tipo: 'numero', sufixo: un, inicial: numBR(p.d.sugerida) }, { id: 'data', rotulo: 'Data da produção', tipo: 'data', inicial: hoje }] }),
    op_preparo: () => ({ acao: 'op_preparo', titulo: 'Lançar OP de preparo', descricao: 'Registra a produção que não foi lançada. Baixa os insumos da ficha.', botao: 'Lançar OP', feito: 'OP de preparo lançada', campos: [{ id: 'qtd', rotulo: 'Quantidade', tipo: 'numero', sufixo: un, inicial: numBR(p.d.sugerida) }, { id: 'data', rotulo: 'Data da produção', tipo: 'data', inicial: hoje }] }),
    corrigir_custo: () => ({ acao: 'corrigir_custo', titulo: 'Corrigir o custo do lançamento errado', descricao: 'Escolha o ajuste de entrada que trouxe o custo errado e informe o custo certo. O ajuste é excluído e relançado no Omie.', botao: 'Corrigir custo', feito: 'Custo corrigido', campos: [{ id: 'custo', rotulo: `Custo certo por ${un}`, tipo: 'numero', sufixo: 'R$', inicial: p.d.ref ? numBR(Math.round(p.d.ref * 10000) / 10000) : '' }] }),
    concluir: () => ({ acao: 'concluir', titulo: 'Concluir a OP', descricao: 'O produto entra no saldo e os insumos saem.', botao: 'Concluir OP', feito: 'OP concluída', campos: [{ id: 'data', rotulo: 'Data da conclusão', tipo: 'data', inicial: hoje }] }),
    mudar_data: () => ({ acao: 'mudar_data', titulo: 'Mudar a data prevista', descricao: 'Para concluir na data certa depois. O saldo não muda.', botao: 'Mudar data', feito: 'Data da OP alterada', campos: [{ id: 'data', rotulo: 'Nova data', tipo: 'data', inicial: hoje }] }),
    excluir: () => ({ acao: 'excluir', titulo: 'Excluir a OP', descricao: p.d.sentido === 'sobrando' ? 'O saldo já está positivo. Excluir evita entrada em dobro.' : 'Use se a produção nunca aconteceu.', botao: 'Excluir OP', feito: 'OP excluída', campos: [] }),
    corrigir_contagem: () => ({ acao: 'corrigir_contagem', titulo: 'Corrigir a contagem', descricao: 'Lança a diferença entre a contagem digitada e a certa. O saldo acompanha.', botao: 'Corrigir contagem', feito: 'Contagem corrigida', campos: [{ id: 'para', rotulo: 'Contagem certa', tipo: 'numero', sufixo: un, inicial: numBR(p.d.contagem?.sugerida) }] }),
    nao_controla: () => ({ acao: 'nao_controla', titulo: 'Marcar como "não controla estoque"', descricao: 'É serviço, não mercadoria. Sai da Central e das próximas leituras daqui (o cadastro no Omie não muda).', botao: 'Marcar', feito: 'Marcado como "não controla estoque"', campos: [] }),
    criar_ops_cupom: () => ({ acao: 'criar_ops_cupom', titulo: 'Criar as OPs que faltam', descricao: 'Uma OP por prato, concluída com a data do cupom. Confira antes se a integração do PDV não reprocessou.', botao: 'Criar OPs', feito: 'OPs do cupom criadas', campos: [] }),
    ramon: () => {
      const neg = p.grupo === 'pa' || p.grupo === 'pi' || p.grupo === 'mp'
      const msg = neg || p.grupo === 'contagem' ? `Ramon, pode contar ${p.titulo}${loc.nome ? ` em ${loc.nome}` : ''} hoje?` : `Ramon, pode olhar ${nomeAlvo}? ${p.causa}`
      return { acao: 'ramon', titulo: p.grupo === 'contagem' ? 'Pedir recontagem ao Ramon' : neg ? 'Pedir contagem ao Ramon' : 'Perguntar ao Ramon', descricao: 'Fica como "Esperando Ramon" até ele responder. Nada é enviado: a mensagem fica guardada aqui.', botao: 'Guardar pedido', feito: 'Pedido ao Ramon', campos: [{ id: 'msg', rotulo: 'Mensagem', tipo: 'texto', inicial: msg }] }
    },
  }
  return p.acoes.map((a) => defs[a]())
}

export function previaAcao(acao: AcaoId, p: Problema, v: Record<string, string>, ctx: { nome: (cod: number) => string; cmc: (cod: number) => number; hoje: string }): Previa {
  const un = p.d.unidade ?? 'UN'
  const ref = p.d.ref ?? 0
  const loc = localDaAcao(p)
  const r = (n: number) => Math.round(n * 1e6) / 1e6
  const emLocal = loc.nome ? ` em ${loc.nome}` : ''
  switch (acao) {
    case 'zerar':
      return {
        linhas: [{ rot: `Saldo${emLocal}`, de: fmtQtd(loc.saldo, un), para: fmtQtd(0, un) }, { rot: 'Valor do saldo', de: fmtBRL(r(loc.saldo * ref)), para: fmtBRL(0) }],
        omie: `Lança no Omie um ajuste de ${loc.saldo < 0 ? 'entrada' : 'saída'} de ${fmtQtd(Math.abs(loc.saldo), un)}${emLocal}, pelo custo médio atual.`,
      }
    case 'contagem': {
      const n = lerNumeroBR(v.contado)
      if (n == null || n < 0) return { vazio: 'Digite o que foi contado para ver o efeito no saldo.' }
      const dif = r(n - loc.saldo)
      if (dif === 0) return { vazio: 'A contagem é igual ao saldo: nada a ajustar.' }
      return {
        linhas: [{ rot: `Saldo${emLocal}`, de: fmtQtd(loc.saldo, un), para: fmtQtd(n, un) }, { rot: 'Diferença', de: '', para: fmtQtdSinal(dif, un) }, { rot: 'Valor do saldo', de: fmtBRL(r(loc.saldo * ref)), para: fmtBRL(r(n * ref)) }],
        omie: `Lança no Omie um ajuste de ${dif > 0 ? 'entrada' : 'saída'} de ${fmtQtd(Math.abs(dif), un)}${emLocal}. O saldo do Omie é relido na hora de lançar.`,
      }
    }
    case 'op_prato':
    case 'op_preparo': {
      const q = lerNumeroBR(v.qtd)
      if (q == null || q <= 0) return { vazio: 'Informe a quantidade produzida.' }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.data ?? '')) return { vazio: 'Escolha a data da produção.' }
      if (v.data > ctx.hoje) return { vazio: 'A data da produção não pode ser no futuro.' }
      const s0 = p.d.saldo ?? 0
      const linhas = [{ rot: 'Saldo', de: fmtQtd(s0, un), para: fmtQtd(r(s0 + q), un) }]
      if (p.d.fichaCusto) linhas.push({ rot: 'Custo dos insumos (ficha)', de: '', para: fmtBRL(r(p.d.fichaCusto * q)) })
      return { linhas, omie: `Cria e conclui no Omie a OP de ${fmtQtd(q, un)} de ${p.titulo}, com data ${fmtDataLonga(v.data)}.`, aviso: p.depende.find((d) => d.chave?.startsWith('custo:') || d.chave === 'grupo:cupom')?.texto }
    }
    case 'corrigir_custo': {
      const c = lerNumeroBR(v.custo)
      if (c == null || c <= 0) return { vazio: 'Digite o custo certo para ver o efeito.' }
      const s = p.d.saldo ?? 0
      return {
        linhas: [{ rot: 'Custo médio', de: `${fmtBRL(p.d.cmc ?? 0)}/${unidadeCurta(un)}`, para: `${fmtBRL(c)}/${unidadeCurta(un)} (aprox.)` }, { rot: 'Valor do saldo', de: fmtBRLCurto(r(s * (p.d.cmc ?? 0))), para: fmtBRLCurto(r(s * c)) }],
        omie: 'Exclui no Omie o ajuste escolhido e relança igual, com o custo certo. O saldo não muda; o custo médio é recalculado pelo Omie.',
      }
    }
    case 'concluir': {
      const o = p.d.op
      if (!o) return { vazio: 'OP não encontrada.' }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.data ?? '')) return { vazio: 'Escolha a data da conclusão.' }
      if (v.data > ctx.hoje) return { vazio: 'A data da conclusão não pode ser no futuro.' }
      const pu = p.d.unidade ?? 'UN'
      const s0 = p.d.saldoLocal ?? p.d.saldo ?? 0
      const linhas = [{ rot: `Saldo de ${o.produto != null ? ctx.nome(o.produto) : 'produto'}`, de: fmtQtd(s0, pu), para: fmtQtd(r(s0 + o.qtd), pu) }]
      for (const i of [...o.insumos].sort((a, b) => b.qtd * ctx.cmc(b.produto) - a.qtd * ctx.cmc(a.produto)).slice(0, 3)) {
        linhas.push({ rot: `Baixa ${ctx.nome(i.produto)}`, de: '', para: `−${fmtNum(i.qtd)}${ctx.cmc(i.produto) ? ` · ${fmtBRLCurto(i.qtd * ctx.cmc(i.produto))}` : ''}` })
      }
      const risco = p.depende.find((d) => d.chave?.startsWith('custo:') || d.chave?.startsWith('semcusto:'))
      return { linhas, omie: `Conclui no Omie a OP ${o.numero} com data ${fmtDataLonga(v.data)}.`, aviso: risco ? `Cuidado: ${risco.texto}` : undefined }
    }
    case 'mudar_data': {
      const o = p.d.op
      if (!o || !/^\d{4}-\d{2}-\d{2}$/.test(v.data ?? '')) return { vazio: 'Escolha a nova data.' }
      return { linhas: [{ rot: 'Previsão', de: fmtDataLonga(o.previsao), para: fmtDataLonga(v.data) }], omie: `Altera a previsão da OP ${o.numero} no Omie. O saldo não muda.` }
    }
    case 'excluir': {
      const o = p.d.op
      if (!o) return { vazio: 'OP não encontrada.' }
      return { linhas: [{ rot: 'Saldo', de: '', para: 'não muda' }, { rot: 'OPs abertas', de: '', para: '−1' }], omie: `Exclui a OP ${o.numero} no Omie.` }
    }
    case 'corrigir_contagem': {
      const c = p.d.contagem
      const para = lerNumeroBR(v.para)
      if (!c || para == null || para < 0) return { vazio: 'Digite a contagem certa.' }
      const dif = r(para - c.para)
      if (dif === 0) return { vazio: 'É a mesma contagem: nada a corrigir.' }
      const s0 = p.d.saldo ?? 0
      return {
        linhas: [{ rot: 'Contagem', de: fmtQtd(c.para, un), para: fmtQtd(para, un) }, { rot: 'Diferença', de: '', para: fmtQtdSinal(dif, un) }, { rot: 'Saldo', de: fmtQtd(s0, un), para: fmtQtd(r(s0 + dif), un) }],
        omie: `Lança no Omie um ajuste de ${dif > 0 ? 'entrada' : 'saída'} de ${fmtQtd(Math.abs(dif), un)} para corrigir a contagem.`,
      }
    }
    case 'nao_controla':
      return { linhas: [{ rot: 'Na Central', de: 'aparece', para: 'não aparece mais' }], omie: 'Nada muda no Omie: a marcação fica só aqui (dá para desfazer).' }
    case 'criar_ops_cupom': {
      const c = p.d.cupom
      if (!c) return { vazio: 'Cupom não encontrado.' }
      return {
        linhas: c.itens.map((i) => ({ rot: i.nome, de: '', para: `OP de ${fmtNum(i.quantidade)}` })),
        omie: `Cria e conclui no Omie ${c.itens.length === 1 ? '1 OP' : `${c.itens.length} OPs`} com data ${fmtDataLonga(c.data)}, uma por vez (para no primeiro bloqueio do Omie).`,
        aviso: 'A integração do PDV pode reprocessar sozinha; confira antes. Se ela já criou a OP, esta não é lançada.',
      }
    }
    case 'ramon':
      if (!(v.msg ?? '').trim()) return { vazio: 'Escreva a mensagem para o Ramon.' }
      return { linhas: [{ rot: 'Situação', de: 'Aberto', para: 'Esperando Ramon' }], omie: 'Nada muda no Omie e nada é enviado: o pedido fica guardado aqui até ele responder.' }
  }
}

// ================================================================================================================
// Busca rápida
// ================================================================================================================
export function interpretarBuscaRapida(q: string): { texto: string; numerosOP: string[]; cupomNum: string | null; nIdCupom: number | null } {
  const texto = q.trim()
  const numerosOP: string[] = []
  if (/^\d{1,4}\/\d+$|^\d+$/.test(texto)) {
    const add = (s: string) => { if (s && !numerosOP.includes(s)) numerosOP.push(s) }
    add(texto)
    const depois = texto.includes('/') ? texto.split('/')[1] : texto
    add(depois.replace(/^0+/, ''))
    add(texto.replace(/\D/g, '').replace(/^0+/, ''))
  }
  return {
    texto, numerosOP,
    cupomNum: /^\d{4,7}$/.test(texto) ? texto : null,
    nIdCupom: /^\d{9,12}$/.test(texto) ? Number(texto) : null,
  }
}
