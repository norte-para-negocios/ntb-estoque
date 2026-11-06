// Conta a pagar gerada pela nota de entrada (Fase 4, passo 1). Regras puras, sem banco e sem imports: espelham
// fin_parcelas_da_nota e fin_titulos_da_nota_* (migration 340) e as decisões do dono de 05/11 (migration 360:
// fin_categoria_da_nota, fin_competencia_da_nota). O banco é a fonte da verdade; isto serve para mostrar
// a prévia na tela da nota, o aviso de parcela paga em nota desfeita e para testar a regra com o XML real.
// Dinheiro em centavos inteiros.

export type RegraParcelas = 'duplicatas' | 'sem_duplicata' | 'sem_valor'
export type ParcelaPlano = { parcela: number; totalParcelas: number; vencimento: string; valorCent: number }
export type PlanoParcelas = { regra: RegraParcelas; parcelas: ParcelaPlano[]; diferencaCent: number }

const centavos = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  return Number.isFinite(n) ? Math.round(Number((n * 100).toPrecision(15))) : NaN
}

/** Vencimento da duplicata: 'dd/mm/aaaa' (como a nota guarda em full_object.parcelas) ou 'aaaa-mm-dd'. Data inválida = null. */
export function dataDaDuplicata(v: unknown): string | null {
  const t = String(v ?? '').trim()
  let iso: string | null = null
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) iso = `${br[3]}-${br[2]}-${br[1]}`
  const is = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (is) iso = `${is[1]}-${is[2]}-${is[3]}`
  if (!iso) return null
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso
}

/**
 * Uma parcela por duplicata do XML (cobr/dup), na ordem do XML; duplicata sem valor é ignorada e a numeração conta só as
 * válidas; sem vencimento vence na emissão. Sem nenhuma duplicata válida: à vista, uma conta só no total da nota vencendo
 * na emissão (ou hoje, sem emissão) — decidido pelo dono em 05/11/2026. Nota sem valor e sem duplicata não gera nada.
 * `diferencaCent` = soma das duplicatas − total da nota (vale a duplicata; a diferença só é registrada).
 */
export function planoParcelasDaNota(fullObject: unknown, valorTotal: number | null | undefined, emissao: string | null | undefined, hoje: string): PlanoParcelas {
  const fo = (fullObject ?? {}) as { parcelas?: { parcelasLista?: unknown } }
  const lista = Array.isArray(fo.parcelas?.parcelasLista) ? (fo.parcelas!.parcelasLista as Record<string, unknown>[]) : []
  const base = dataDaDuplicata(emissao) ?? hoje
  const validas = lista
    .map((p) => ({ venc: dataDaDuplicata(p?.dVencimento) ?? base, cent: centavos(p?.vParcela) }))
    .filter((p) => Number.isFinite(p.cent) && p.cent > 0)
  const totalCent = centavos(valorTotal ?? 0)
  if (validas.length) {
    const soma = validas.reduce((a, p) => a + p.cent, 0)
    return {
      regra: 'duplicatas',
      parcelas: validas.map((p, i) => ({ parcela: i + 1, totalParcelas: validas.length, vencimento: p.venc, valorCent: p.cent })),
      diferencaCent: Number.isFinite(totalCent) ? soma - totalCent : 0,
    }
  }
  if (Number.isFinite(totalCent) && totalCent > 0) {
    return { regra: 'sem_duplicata', parcelas: [{ parcela: 1, totalParcelas: 1, vencimento: base, valorCent: totalCent }], diferencaCent: 0 }
  }
  return { regra: 'sem_valor', parcelas: [], diferencaCent: 0 }
}

export type TituloDaNota = {
  id: number; numero: number; parcela: number; total_parcelas: number; valor: number; valor_quitado: number
  data_vencimento: string; status: 'aberto' | 'parcial' | 'pago' | 'cancelado'
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * Resumo para a tela da nota. Nota desfeita/cancelada (compra 'pendente' ou 'cancelada') com parcela já paga: nada foi
 * apagado, a decisão é humana. Nota que entrou no estoque sem nenhuma conta ativa: mostra o motivo da falha, se houver.
 */
export function resumoTitulosDaNota<T extends TituloDaNota>(titulos: T[], statusCompra: string | null, falha: string | null):
  { ativos: T[]; cancelados: T[]; totalAtivoCent: number; aviso: string | null } {
  const ativos = titulos.filter((t) => t.status !== 'cancelado')
  const cancelados = titulos.filter((t) => t.status === 'cancelado')
  const totalAtivoCent = ativos.reduce((a, t) => a + centavos(t.valor), 0)
  let aviso: string | null = null
  const entrou = statusCompra === 'lancada' || statusCompra === 'parcial'
  const pagas = ativos.filter((t) => Number(t.valor_quitado) > 0)
  if (!entrou && pagas.length) {
    aviso = `A entrada desta nota foi desfeita, mas ${plural(pagas.length, 'parcela já paga continua', 'parcelas já pagas continuam')} no contas a pagar. Nada foi apagado: o gerente decide em Financeiro › Notas desfeitas com conta paga se estorna o pagamento ou mantém a conta.`
  } else if (entrou && !ativos.length) {
    aviso = `A nota entrou no estoque, mas não tem conta a pagar.${falha ? ` Motivo: ${falha}` : ''}`
  }
  return { ativos, cancelados, totalAtivoCent, aviso }
}

/** Aviso devolvido por "Desfazer entrada" quando sobrou parcela paga (retorno de fin_titulos_da_nota_estornar). */
export function avisoAoDesfazer(r: { cancelados?: number; com_pagamento?: number } | null | undefined): string | null {
  const n = Number(r?.com_pagamento ?? 0)
  if (!n) return null
  return `${plural(n, 'parcela já paga continua', 'parcelas já pagas continuam')} no contas a pagar desta nota. Nada foi apagado: o gerente decide em Financeiro › Notas desfeitas com conta paga.`
}

/** Rótulo e link da origem do título nas telas do contas a pagar (vínculo com a nota de entrada). */
export function origemDoTitulo(origemTipo: string | null | undefined, origemId: number | null | undefined, documento?: string | null):
  { rotulo: string; href: string | null } {
  if (origemTipo === 'nota_entrada' && origemId) return { rotulo: `Nota de entrada${documento ? ` ${documento}` : ''}`, href: `/nota-fiscal/${origemId}` }
  if (origemTipo === 'pedido_compra' && origemId) return { rotulo: 'Pedido de compra', href: `/pedido-compra/${origemId}` }
  if (!origemTipo || origemTipo === 'manual') return { rotulo: 'Lançado à mão', href: null }
  if (origemTipo === 'importacao') return { rotulo: 'Importado', href: null }
  return { rotulo: origemTipo, href: null }
}

// ------------------------------------------------------------------------- decisões do dono de 05/11 (migration 360)

export type ItemCategoria = { codigoFamilia: number | null; valor: number; geraContaPagar?: boolean }
export type CategoriaDaNota = {
  categoriaId: number | null; codigoFamilia: number | null
  motivo: 'mapeada' | 'familia_sem_categoria' | 'sem_familia' | 'sem_itens'
}

/**
 * Categoria financeira da conta da nota (espelho de fin_categoria_da_nota). Não existe categoria padrão: ela vem da FAMÍLIA do
 * produto, pelo mapa família → categoria da loja. Vale a família de maior valor entre os itens que geram conta a pagar
 * (produto sem família é um grupo próprio). Se a família predominante não tem categoria no mapa, a conta fica sem categoria
 * ("A definir"): não se usa a 2ª família nem se inventa uma. Empate: família antes de "sem família", depois o menor código.
 * O contas a pagar guarda UMA categoria por título (fin_titulos_pagar.categoria_id, sem rateio), por isso a predominante.
 */
export function categoriaDaNota(itens: ItemCategoria[], mapa: Map<number, number>): CategoriaDaNota {
  const somas = new Map<number | null, number>()
  for (const it of itens) {
    if (it.geraContaPagar === false) continue
    const c = centavos(it.valor)
    if (!Number.isFinite(c)) continue
    const k = it.codigoFamilia ?? null
    somas.set(k, (somas.get(k) ?? 0) + c)
  }
  if (!somas.size) return { categoriaId: null, codigoFamilia: null, motivo: 'sem_itens' }
  const [fam] = [...somas.entries()].sort((a, b) =>
    b[1] - a[1] || (a[0] === null ? 1 : 0) - (b[0] === null ? 1 : 0) || (a[0] ?? 0) - (b[0] ?? 0))[0]
  if (fam === null) return { categoriaId: null, codigoFamilia: null, motivo: 'sem_familia' }
  const cat = mapa.get(fam)
  return cat ? { categoriaId: cat, codigoFamilia: fam, motivo: 'mapeada' } : { categoriaId: null, codigoFamilia: fam, motivo: 'familia_sem_categoria' }
}

const isoValida = (v: string | null | undefined): string | null => dataDaDuplicata(v ?? null)

/** Competência da conta da nota de entrada (espelho de fin_competencia_da_nota): 1º dia do mês da ENTRADA da nota no estoque;
 *  sem entrada conhecida, o da emissão; sem nenhuma das duas, o do vencimento. O vencimento continua o da duplicata. */
export function competenciaDaNota(dataEntrada: string | null | undefined, emissao: string | null | undefined, vencimento: string): string {
  const base = isoValida(dataEntrada) ?? isoValida(emissao) ?? isoValida(vencimento) ?? vencimento
  return `${base.slice(0, 7)}-01`
}

/** Conta sem categoria aparece como "A definir" (a família predominante da nota ainda não tem categoria). */
export function rotuloCategoria(nome: string | null | undefined): string {
  return nome && nome.trim() ? nome : 'A definir'
}

/** "Gerar das selecionadas": ids válidos, sem repetir, com teto (cada nota é uma transação; muitas de uma vez travam a tela). */
export function selecaoParaGerar(ids: unknown[], teto: number): { ids: number[]; erro: string | null } {
  const ok = [...new Set(ids.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))]
  if (!ok.length) return { ids: [], erro: 'Selecione pelo menos uma nota.' }
  if (ok.length > teto) return { ids: [], erro: `Selecione no máximo ${teto} notas de uma vez.` }
  return { ids: ok, erro: null }
}
