import { hojeBahiaISO } from '@/lib/data-bahia'
import { entradaDreLoja, lojasDaConsolidada, PERM } from '@/lib/financeiro/dados'
import { mesesEntre, montarDre, type EntradaDre, type Mes } from '@/lib/financeiro/dre-puro'

// DRE: lê os filtros da URL e monta a DRE (tela /financeiro/dre e exportação para Excel usam a mesma carga).
// Chamar depois de acessoFinanceiro(PERM.contasCorrentes).
export const MAX_MESES_DRE = 12
export type FiltroDre = { de?: string; ate?: string; escopo?: string }

export function mesAntes(mes: Mes, n: number): Mes {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 - n, 1))
  return d.toISOString().slice(0, 7)
}

export const okMes = (v?: string | null) => (v && /^\d{4}-\d{2}$/.test(v) ? v : null)

export async function carregarDre(lojaId: number, sp: FiltroDre) {
  const mesAtual = hojeBahiaISO().slice(0, 7)
  const ate = okMes(sp.ate) ?? mesAtual
  const de = okMes(sp.de) ?? mesAntes(ate, 1)
  const meses = mesesEntre(de <= ate ? de : ate, ate, MAX_MESES_DRE)
  const consolidada = sp.escopo === 'consolidada'
  const lojas = consolidada ? await lojasDaConsolidada(PERM.contasCorrentes) : [{ id: lojaId, nome: '' }]

  let erro: string | null = null
  const avisosLeitura: string[] = []
  const ent: EntradaDre = { meses, categorias: [], vendas: [], taxasCartao: [], titulos: [], lancamentos: [], nomesLojas: {} }
  const inicio = Date.now()
  try {
    const lidas = await Promise.all(lojas.map((l) => entradaDreLoja(l.id, meses)))
    lidas.forEach((r, i) => {
      ent.categorias.push(...r.entrada.categorias); ent.vendas.push(...r.entrada.vendas); ent.taxasCartao.push(...r.entrada.taxasCartao)
      ent.titulos.push(...r.entrada.titulos); ent.lancamentos.push(...r.entrada.lancamentos)
      ent.nomesLojas![lojas[i].id] = lojas[i].nome || `Loja ${lojas[i].id}`
      avisosLeitura.push(...r.avisos.map((a) => (consolidada ? `${lojas[i].nome}: ${a}` : a)))
    })
  } catch (e) {
    erro = e instanceof Error ? e.message : 'Não foi possível montar a DRE.'
  }
  const dre = montarDre(ent)
  console.info(`financeiro/dre: ${consolidada ? 'consolidada' : `loja ${lojaId}`} ${meses.length} mes(es) em ${Date.now() - inicio} ms`)
  return { mesAtual, ate, de, meses, consolidada, lojas, ent, dre, erro, avisosLeitura }
}
