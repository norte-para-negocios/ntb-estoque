// Regras do item da nota de entrada do estoque próprio (Fase B, R1/R4/R6/R7): as 8 marcações "é custo de estoque"
// sugeridas como o Omie, CFOP de entrada, unidade e fator, avisos do item e a configuração inicial de cada item.
// Puro e testável com `node --test lib/estoque/nf-item-regras.test.ts`. Números de D1 = itens concluídos da loja 5
// (~/Projects/omie-rea/bruto/nf_itens_loja5.csv.gz, 2.987 itens, medido em 18/10/2026).
// @ts-ignore: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { custoEstoqueItemOmie, custoUnitarioEntrada, icmsDoCusto } from '../compras/custo-estoque-item.ts'
// ICMS do custo (inclui o crédito do Simples, CSOSN 101/201): regra única em custo-estoque-item.ts (PROVADA em 20/10/2026).
export { icmsDoCusto }
// @ts-ignore: idem
import { unidadeCanonica } from './nf-conferencia.ts'
import type { FlagsCustoOmie } from '../compras/custo-estoque-item'

// ---------- Marcações (ordem da tela do Omie, cids 339–347) ----------

export type FlagsCusto = { icms: boolean; icmsSt: boolean; ipi: boolean; seguro: boolean; pis: boolean; cofins: boolean; frete: boolean; outras: boolean }
export const ORDEM_FLAGS = ['icms', 'icmsSt', 'ipi', 'seguro', 'pis', 'cofins', 'frete', 'outras'] as const
export type OrigemFlags = 'produto' | 'fornecedor' | 'regra' | 'padrao' | 'manual'

/** `'NSSNNNNN'` (S = é custo; N ou '-' = não é). Texto inválido = null. */
export function flagsDeTexto(s: string | null | undefined): FlagsCusto | null {
  const t = (s ?? '').trim().toUpperCase()
  if (!/^[SN-]{8}$/.test(t)) return null
  const f = {} as FlagsCusto
  ORDEM_FLAGS.forEach((k, i) => { f[k] = t[i] === 'S' })
  return f
}
export function flagsParaTexto(f: FlagsCusto): string {
  return ORDEM_FLAGS.map((k) => (f[k] ? 'S' : 'N')).join('')
}
export function flagsParaOmie(f: FlagsCusto, aliqPis: number, aliqCofins: number): FlagsCustoOmie {
  const sn = (b: boolean) => (b ? 'S' : 'N')
  return {
    cICMSCusto: sn(f.icms), cICMSSTCusto: sn(f.icmsSt), cIPICusto: sn(f.ipi), cSeguroCusto: sn(f.seguro),
    cPISCusto: sn(f.pis), cCOFINSCusto: sn(f.cofins), cFreteCusto: sn(f.frete), cOutrosDespCusto: sn(f.outras),
    nAliqCredPISCusto: aliqPis, nAliqCredCOFINSCusto: aliqCofins,
  }
}

// Moda de D1 por código (itens com aquele código / itens com a moda): CST 60 462/587, 40 576/1035, 00 233/608,
// 20 116/347, 41 52/101, 90 16/33; CSOSN 102 36/87, 400 28/67, 300 47/66. CST 10, CSOSN 103 e 900: um recebimento
// capturado cada (NF 360369, 115, 7433). Sozinha, a regra dá o mesmo valor de estoque do Omie em 83,2 % dos itens.
export const REGRA_FLAGS_CST: Record<string, string> = { '00': 'NNNNNNNN', '10': 'SSSSSSSS', '20': 'SSSSSSSS', '40': 'NSSNNNNN', '41': 'NNNNNNNN', '60': 'NNNNNNNN', '61': 'NNNNNNNN', '90': 'SSSNSSNN' }
export const REGRA_FLAGS_CSOSN: Record<string, string> = { '102': 'SSSNSSNN', '103': 'NNNNNNNN', '300': 'NSSNNNNN', '400': 'NSSNNNNN', '900': 'NNNNNNNN' }
/** Moda global de D1 (35,5 %): usada quando nada mais se aplica, e a nota não entra sozinha com ela (R9). */
export const FLAGS_PADRAO = 'NNNNNNNN'

/** R1: (1) memória do produto, (2) do código do fornecedor, (3) regra por CRT + CST/CSOSN, (4) padrão. */
export function sugerirFlagsCusto(e: { memoriaProduto: string | null; memoriaFornecedor: string | null; crt: string | null; cst: string | null; csosn: string | null }): { flags: FlagsCusto; origem: OrigemFlags } {
  const mp = flagsDeTexto(e.memoriaProduto)
  if (mp) return { flags: mp, origem: 'produto' }
  const mf = flagsDeTexto(e.memoriaFornecedor)
  if (mf) return { flags: mf, origem: 'fornecedor' }
  const simples = e.crt === '1' || e.crt === '2' || e.crt === '4'
  const normal = e.crt === '3'
  const regra = simples ? (e.csosn ? REGRA_FLAGS_CSOSN[e.csosn] : undefined)
    : normal ? (e.cst ? REGRA_FLAGS_CST[e.cst] : undefined)
    : (e.csosn ? REGRA_FLAGS_CSOSN[e.csosn] : e.cst ? REGRA_FLAGS_CST[e.cst] : undefined)
  if (regra) return { flags: flagsDeTexto(regra)!, origem: 'regra' }
  return { flags: flagsDeTexto(FLAGS_PADRAO)!, origem: 'padrao' }
}

// ---------- CFOP de entrada (R6) ----------

/** Moda de D1 (sozinha acerta 73,7 %). */
export const CFOP_ENTRADA_TABELA: Record<string, string> = { '5101': '1102', '5102': '1102', '5103': '1102', '5403': '1403', '5405': '1407', '5656': '1653', '5910': '1910', '5929': '1556' }
const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export function cfopValido(s: string): boolean {
  return /^[123]\d{3}$/.test(s)
}
export function formatarCfop(d: string | null): string | null {
  const s = soDigitos(d)
  return s.length === 4 ? `${s[0]}.${s.slice(1)}` : d
}

export function sugerirCfopEntrada(e: { cfopNota: string | null; memoriaProduto: string | null }): { cfop: string | null; origem: 'produto' | 'tabela' | 'regra' | null } {
  const mem = soDigitos(e.memoriaProduto)
  if (cfopValido(mem)) return { cfop: mem, origem: 'produto' }
  const nota = soDigitos(e.cfopNota)
  if (CFOP_ENTRADA_TABELA[nota]) return { cfop: CFOP_ENTRADA_TABELA[nota], origem: 'tabela' }
  const primeiro: Record<string, string> = { '5': '1', '6': '2', '7': '3' }
  if (nota.length !== 4 || !primeiro[nota[0]]) return { cfop: null, origem: null }
  const fim = nota.slice(1)
  const fimEntrada = ['101', '102', '103'].includes(fim) ? '102' : ['401', '403', '405'].includes(fim) ? '403' : fim
  return { cfop: primeiro[nota[0]] + fimEntrada, origem: 'regra' }
}

// ---------- Unidades e fator (R4) ----------

type Grupo = 'contagem' | 'massa' | 'volume' | 'embalagem'
/** Nomes da lista de unidades do Omie (cid 72 do editor do item). */
export const UNIDADES_ESTOQUE: readonly { sigla: string; nome: string; grupo: Grupo }[] = [
  { sigla: 'UN', nome: 'Unidade', grupo: 'contagem' }, { sigla: 'KG', nome: 'Quilograma', grupo: 'massa' },
  { sigla: 'G', nome: 'Grama', grupo: 'massa' }, { sigla: 'L', nome: 'Litro', grupo: 'volume' },
  { sigla: 'ML', nome: 'Mililitro', grupo: 'volume' }, { sigla: 'CX', nome: 'Caixa', grupo: 'embalagem' },
  { sigla: 'FD', nome: 'Fardo', grupo: 'embalagem' }, { sigla: 'PCT', nome: 'Pacote', grupo: 'embalagem' },
  { sigla: 'DZ', nome: 'Dúzia', grupo: 'embalagem' }, { sigla: 'BD', nome: 'Balde', grupo: 'embalagem' },
  { sigla: 'SC', nome: 'Saco', grupo: 'embalagem' }, { sigla: 'GL', nome: 'Galão', grupo: 'embalagem' },
  { sigla: 'LATA', nome: 'Lata', grupo: 'contagem' }, { sigla: 'GF', nome: 'Garrafa', grupo: 'contagem' },
  { sigla: 'PC', nome: 'Peça', grupo: 'contagem' }, { sigla: 'RL', nome: 'Rolo', grupo: 'contagem' },
  { sigla: 'BN', nome: 'Bandeja', grupo: 'embalagem' },
]
const APELIDOS: Record<string, string> = { UND: 'UN', UNID: 'UN', UNIDADE: 'UN', LT: 'L', GR: 'G', GRS: 'G', LA: 'LATA', GFA: 'GF', PAC: 'PCT', PT: 'PCT', 'CX.': 'CX', 'PC.': 'PC', PCA: 'PC' }

/** Sigla da lista acima, sem os dígitos do fim que o Omie põe (UND9, KG9, GFA8). Desconhecida = null. */
function siglaUnidade(u: string | null | undefined): string | null {
  const s = (u ?? '').trim().toUpperCase().replace(/\d+$/, '')
  if (!s) return null
  const sigla = APELIDOS[s] ?? s
  if (UNIDADES_ESTOQUE.some((x) => x.sigla === sigla)) return sigla
  const c = unidadeCanonica(s).toUpperCase()
  const viaCanonica = APELIDOS[c] ?? c
  return UNIDADES_ESTOQUE.some((x) => x.sigla === viaCanonica) ? viaCanonica : null
}
export function grupoUnidade(u: string | null): string | null {
  const s = siglaUnidade(u)
  return s ? UNIDADES_ESTOQUE.find((x) => x.sigla === s)!.grupo : null
}
const FATORES: Record<string, number> = { 'KG>G': 1000, 'G>KG': 0.001, 'L>ML': 1000, 'ML>L': 0.001, 'DZ>UN': 12 }
export function fatorConhecido(de: string, para: string): number | null {
  const a = siglaUnidade(de), b = siglaUnidade(para)
  if (!a || !b) return null
  if (a === b) return 1
  return FATORES[`${a}>${b}`] ?? null
}

// ---------- Avisos do item ----------

export type AlertaItem = { tipo: 'fator_suspeito' | 'custo_fora' | 'recebido_menor' | 'recebido_maior' | 'valor_zero' | 'complementar'; texto: string }

const br = (n: number, casas = 6) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas })

export function alertasDoItem(e: { unidadeNota: string; unidadeEstoque: string | null; fator: number; quantidadeNota: number; quantidadeRecebida: number; custoUnitario: number | null; cmcAtual: number | null; valorTotalItem: number; finalidade: string | null }): AlertaItem[] {
  const out: AlertaItem[] = []
  const und = e.unidadeEstoque ?? e.unidadeNota
  if (e.unidadeEstoque) {
    const gn = grupoUnidade(e.unidadeNota), ge = grupoUnidade(e.unidadeEstoque)
    const conhecido = fatorConhecido(e.unidadeNota, e.unidadeEstoque)
    if ((e.fator === 1 && gn && ge && gn !== ge) || (conhecido !== null && Math.abs(e.fator - conhecido) > 1e-9)) {
      out.push({ tipo: 'fator_suspeito', texto: `Fator suspeito: 1 ${e.unidadeNota} = ${br(e.fator)} ${e.unidadeEstoque}. Confira quantas ${e.unidadeEstoque} vêm em cada ${e.unidadeNota}.` })
    }
  }
  const c = e.custoUnitario
  if (c !== null && c > 0) {
    const cmc = e.cmcAtual ?? 0
    if (cmc > 0 && (c >= cmc * 20 || c <= cmc / 20)) {
      const vezes = c >= cmc ? `${br(Math.round(c / cmc), 0)}×` : `1/${br(Math.round(cmc / c), 0)}`
      out.push({ tipo: 'custo_fora', texto: `Custo fora do normal: custo por ${und} ${vezes} o custo médio (R$ ${br(c)} contra R$ ${br(cmc)}).` })
    } else if (c >= 1000) {
      out.push({ tipo: 'custo_fora', texto: `Custo fora do normal: R$ ${br(c)} por ${und}.` })
    }
  }
  const esperado = e.quantidadeNota * e.fator
  if (Math.abs(e.quantidadeRecebida - esperado) > 1e-6) {
    out.push(e.quantidadeRecebida < esperado
      ? { tipo: 'recebido_menor', texto: `Recebeu ${br(e.quantidadeRecebida)} de ${br(esperado)} ${und} da nota.` }
      : { tipo: 'recebido_maior', texto: `Recebeu ${br(e.quantidadeRecebida)} ${und}, mais que os ${br(esperado)} da nota.` })
  }
  if (e.valorTotalItem <= 0) out.push({ tipo: 'valor_zero', texto: 'Item sem valor: não deve entrar no estoque (diluiria o custo médio).' })
  if (e.finalidade === '2' || e.finalidade === '3') out.push({ tipo: 'complementar', texto: 'Nota complementar/de ajuste: os itens não entram no estoque.' })
  return out
}

/** R9: a nota só entra sozinha com casamento seguro, sem alerta da nota, sem marcação no padrão e sem aviso de item. */
export function podeLancarSozinho(e: { casamentosSeguros: boolean; alertasNota: number; origensFlags: OrigemFlags[]; alertasItens: AlertaItem[]; autoLancar: boolean }): boolean {
  return e.autoLancar && e.casamentosSeguros && e.alertasNota === 0 && !e.origensFlags.includes('padrao') && e.alertasItens.length === 0
}

/** Conferência: avisos de custo/quantidade só passam com "Conferi os avisos"; recebido menor/maior e complementar só informam. */
export function decidirConferencia(alertas: { linha: number; alertas: AlertaItem[] }[], aceitarAvisos: boolean): { ok: true; aceitos: { linha: number; tipo: AlertaItem['tipo'] }[] } | { error: string } {
  const bloqueiam = new Set<AlertaItem['tipo']>(['fator_suspeito', 'custo_fora', 'valor_zero'])
  const aceitos = alertas.flatMap((a) => a.alertas.filter((x) => bloqueiam.has(x.tipo)).map((x) => ({ linha: a.linha, tipo: x.tipo })))
  if (aceitos.length && !aceitarAvisos) return { error: 'Há avisos de custo ou quantidade: confira e marque "Conferi os avisos".' }
  return { ok: true, aceitos }
}

// ---------- Configuração inicial e validação ----------

export type MemoriaItem = { flags: string | null; cfopEntrada: string | null; codigoLocal: number | null }
export type ConfigInicialItem = {
  flags: FlagsCusto; origemFlags: OrigemFlags; cfopEntrada: string | null; origemCfop: 'produto' | 'tabela' | 'regra' | null
  movimentaEstoque: boolean; geraContaPagar: boolean; unidadeEstoque: string | null; codigoLocal: number | null; aliqCredPis: 0; aliqCredCofins: 0
}

export function configInicialItem(e: {
  item: { cfop: string | null; valorTotalItem: number; fiscal: { cst: string | null; csosn: string | null } }
  crt: string | null; finalidade: string | null; memoriaProduto: MemoriaItem | null; memoriaFornecedor: MemoriaItem | null
  unidadeProduto: string | null; localNota: number | null
}): ConfigInicialItem {
  const f = sugerirFlagsCusto({ memoriaProduto: e.memoriaProduto?.flags ?? null, memoriaFornecedor: e.memoriaFornecedor?.flags ?? null, crt: e.crt, cst: e.item.fiscal.cst, csosn: e.item.fiscal.csosn })
  const c = sugerirCfopEntrada({ cfopNota: e.item.cfop, memoriaProduto: e.memoriaProduto?.cfopEntrada ?? null })
  // R7: NF complementar/ajuste e item sem valor nascem fora do estoque (não criam entrada a custo zero).
  const movimenta = !(e.finalidade === '2' || e.finalidade === '3') && e.item.valorTotalItem > 0
  return {
    flags: f.flags, origemFlags: f.origem, cfopEntrada: c.cfop, origemCfop: c.origem,
    movimentaEstoque: movimenta, geraContaPagar: true, unidadeEstoque: e.unidadeProduto,
    codigoLocal: e.memoriaProduto?.codigoLocal ?? e.localNota, aliqCredPis: 0, aliqCredCofins: 0,
  }
}

export type ConfigItemNF = {
  codigoLocal?: number | null; cfopEntrada?: string | null; quantidadeRecebida?: number | null; unidadeEstoque?: string | null
  flags?: FlagsCusto; aliqCredPis?: number; aliqCredCofins?: number; movimentaEstoque?: boolean; geraContaPagar?: boolean
}

export function validarConfigItem(c: ConfigItemNF): string | null {
  if (c.codigoLocal !== undefined && c.codigoLocal !== null && !(Number.isInteger(c.codigoLocal) && c.codigoLocal > 0)) return 'Escolha um local de estoque válido.'
  if (c.cfopEntrada !== undefined && c.cfopEntrada !== null && !cfopValido(soDigitos(c.cfopEntrada))) return 'CFOP de entrada inválido: use um CFOP de entrada (começa com 1, 2 ou 3, ex.: 1.102).'
  if (c.quantidadeRecebida !== undefined && c.quantidadeRecebida !== null && !(Number.isFinite(c.quantidadeRecebida) && c.quantidadeRecebida > 0)) return 'A quantidade recebida precisa ser maior que zero.'
  if (c.unidadeEstoque !== undefined && c.unidadeEstoque !== null && !c.unidadeEstoque.trim()) return 'Escolha a unidade de estoque.'
  for (const [k, nome] of [['aliqCredPis', 'PIS'], ['aliqCredCofins', 'COFINS']] as const) {
    const v = c[k]
    if (v !== undefined && !(Number.isFinite(v) && v >= 0 && v <= 100)) return `A alíquota de crédito do ${nome} precisa estar entre 0 e 100 %.`
  }
  return null
}

/** Prévia do custo na tela, pela MESMA função do lançamento/relatórios (R15). `st` = ST + FCP-ST do item. Ponto de entrada
 *  único de TODAS as prévias (editor do item, conferência, upload do XML, SEFAZ): mesma regra do ICMS da projeção SQL. */
export function previaCustoItem(e: { quantidadeNota: number; precoUnit: number; valorTotalItem: number; desconto: number; ipi: number; st: number; icms: number; frete: number; seguro: number; freteCte: number; flags: FlagsCusto; aliqCredPis: number; aliqCredCofins: number; quantidadeRecebida: number; csosn?: string | null; credIcmsSn?: number | null }): { valorEstoque: number; custoUnitario: number | null } {
  const r = custoEstoqueItemOmie({
    qtde: e.quantidadeNota, precoUnit: e.precoUnit, vTotalItem: e.valorTotalItem, vDesconto: e.desconto, vIPI: e.ipi, vST: e.st, vICMS: icmsDoCusto(e.icms, e.csosn, e.credIcmsSn),
    flags: flagsParaOmie(e.flags, e.aliqCredPis, e.aliqCredCofins), vFrete: e.frete, vSeguro: e.seguro, freteExterno: e.freteCte,
  })
  return { valorEstoque: r.valorEstoque, custoUnitario: custoUnitarioEntrada(r.valorEstoque, e.quantidadeRecebida) }
}

/** Item já gravado em compras_proprio_itens (colunas da 184/185) → quantidade recebida, prévia do custo (R15) e avisos.
 *  Tela da nota e servidor (marcarConferidaNF) usam esta mesma conta. Compra antiga (sem valor_total_item): sem prévia N3. */
export type ItemCompraGravado = {
  quantidade: number; valor_unitario: number; valor_total_item: number | null; desconto: number; ipi_valor: number; st_valor: number; fcp_st_valor: number
  icms_valor: number; frete_valor: number; seguro_valor: number; outras_valor: number; frete_cte: number; flags: string | null
  aliq_cred_pis: number; aliq_cred_cofins: number; quantidade_recebida: number | null; fator: number; unidade_compra: string | null
  unidade_estoque: string | null; codigo_produto: number | null; movimenta_estoque: boolean
  /** do `fiscal` jsonb (CSOSN e crédito do Simples): entram na prévia como na projeção SQL */
  csosn?: string | null; cred_icms_sn?: number | null
}
export function avaliarItemCompra(i: ItemCompraGravado, ctx: { cmc: number | null; finalidade: string | null }): { quantidadeRecebida: number; previa: { valorEstoque: number; custoUnitario: number | null } | null; alertas: AlertaItem[] } {
  const fator = Number(i.fator) || 1
  const quantidadeRecebida = i.quantidade_recebida != null ? Number(i.quantidade_recebida) : Number(i.quantidade) * fator
  const flags = flagsDeTexto(i.flags) ?? flagsDeTexto(FLAGS_PADRAO)!
  const previa = i.valor_total_item == null ? null : previaCustoItem({
    quantidadeNota: Number(i.quantidade), precoUnit: Number(i.valor_unitario), valorTotalItem: Number(i.valor_total_item), desconto: Number(i.desconto),
    ipi: Number(i.ipi_valor), st: Number(i.st_valor) + Number(i.fcp_st_valor), icms: Number(i.icms_valor), frete: Number(i.frete_valor),
    seguro: Number(i.seguro_valor), freteCte: Number(i.frete_cte), flags, aliqCredPis: Number(i.aliq_cred_pis), aliqCredCofins: Number(i.aliq_cred_cofins),
    quantidadeRecebida, csosn: i.csosn ?? null, credIcmsSn: i.cred_icms_sn ?? null,
  })
  const alertas = i.codigo_produto == null ? [] : alertasDoItem({
    unidadeNota: i.unidade_compra ?? 'UN', unidadeEstoque: i.unidade_estoque, fator, quantidadeNota: Number(i.quantidade), quantidadeRecebida,
    custoUnitario: previa?.custoUnitario ?? null, cmcAtual: ctx.cmc, valorTotalItem: i.valor_total_item == null ? 1 : Number(i.valor_total_item), finalidade: ctx.finalidade,
  })
  return { quantidadeRecebida, previa, alertas }
}
