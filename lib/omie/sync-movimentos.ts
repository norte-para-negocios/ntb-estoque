import { createServiceClient } from '@/lib/supabase/server'
import { omieRequest, type LojaOmie } from './client'

interface OmieMovItem {
  nCodProd: number
  cCodigo: string
  cDescricao: string
  movimentos: { dDataMovimento: string; nQtdeEntradas: number; nQtdeSaidas: number }[]
}

interface OmieMovResponse {
  pagina: number
  total_de_paginas: number
  total_de_registros: number
  cadastros?: OmieMovItem[]
}

interface MovimentoRow {
  loja_id: number
  cod_prod: number
  codigo: string | null
  descricao: string | null
  data: string
  entradas: number
  saidas: number
}

/** Converte 'DD/MM/AAAA' em 'AAAA-MM-DD'. Retorna null se invalido. */
function brToISO(d: string): string | null {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Importa movimentos de estoque (entradas/saidas por produto/dia) do Omie
 * para movimentos_historico em Supabase, periodo MES A MES para evitar o
 * truncamento silencioso do ListarMovimentos em janelas longas.
 *
 * Sempre roda os ULTIMOS_DIAS dias mais o mes corrente completo ate hoje,
 * garantindo atualizacao incremental e idempotente.
 */
export async function syncMovimentos(loja: LojaOmie): Promise<number> {
  const supabase = createServiceClient()
  let totalGravados = 0

  // Janela: do inicio do mes passado ate hoje (cobre todo dado que pode ter
  // chegado atrasado e garante que o mes atual seja sempre atualizado).
  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const mesAtual = hoje.getMonth() + 1 // 1-12

  // Inicio: primeiro dia do mes passado
  const mesPassado = mesAtual === 1 ? 12 : mesAtual - 1
  const anoMesPassado = mesAtual === 1 ? anoAtual - 1 : anoAtual

  // Gera intervalos mes-a-mes para evitar o truncamento do Omie
  const intervalos: [string, string][] = []

  // Mes passado inteiro
  const ultimoDiaMesPassado = new Date(anoAtual, mesPassado, 0).getDate()
  intervalos.push([
    `01/${String(mesPassado).padStart(2, '0')}/${anoMesPassado}`,
    `${String(ultimoDiaMesPassado).padStart(2, '0')}/${String(mesPassado).padStart(2, '0')}/${anoMesPassado}`,
  ])

  // Mes atual do dia 1 ate hoje
  const diaAtual = hoje.getDate()
  intervalos.push([
    `01/${String(mesAtual).padStart(2, '0')}/${anoAtual}`,
    `${String(diaAtual).padStart(2, '0')}/${String(mesAtual).padStart(2, '0')}/${anoAtual}`,
  ])

  for (const [di, df] of intervalos) {
    let pagina = 1
    let totalPaginas = 1

    do {
      let res: OmieMovResponse
      try {
        res = await omieRequest<OmieMovResponse>({
          loja_id: loja.id,
          omie_app_key: loja.omie_app_key,
          omie_app_secret: loja.omie_app_secret,
          endpoint: 'v1/estoque/movestoque',
          call: 'ListarMovimentos',
          data: {
            pagina,
            registros_por_pagina: 100,
            data_inicial: di,
            data_final: df,
            ordenar_por: 'CODIGO',
          },
        })
      } catch (e) {
        // "Nao existem registros" => periodo vazio, sai do loop do mes
        const msg = e instanceof Error ? e.message : String(e)
        if (/n.o existem registros/i.test(msg)) break
        throw e
      }

      // omieRequest ja trata "nao existem registros" retornando {} (nao lanca erro)
      // mas por seguranca: se retornou objeto vazio (sem cadastros), encerra.
      if (!res || !res.total_de_paginas) break

      totalPaginas = res.total_de_paginas || 1

      const linhas: MovimentoRow[] = []
      for (const c of res.cadastros ?? []) {
        for (const mv of c.movimentos ?? []) {
          const data = brToISO(mv.dDataMovimento)
          if (!data) continue
          linhas.push({
            loja_id: loja.id,
            cod_prod: c.nCodProd,
            codigo: c.cCodigo || null,
            descricao: c.cDescricao || null,
            data,
            entradas: mv.nQtdeEntradas ?? 0,
            saidas: mv.nQtdeSaidas ?? 0,
          })
        }
      }

      if (linhas.length) {
        const { error } = await supabase
          .from('movimentos_historico')
          .upsert(linhas, { onConflict: 'loja_id,cod_prod,data' })
        if (error) throw new Error(`Supabase upsert movimentos_historico: ${error.message}`)
        totalGravados += linhas.length
      }

      pagina++
      // Anti-rajada: respeita rate limit do Omie (mesmo padrao do backfill-movimentos.mjs)
      await sleep(700)
    } while (pagina <= totalPaginas)
  }

  return totalGravados
}
