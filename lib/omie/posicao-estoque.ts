import { omieRequest, type LojaOmie } from './client'
import { createServiceClient } from '@/lib/supabase/server'

interface OmiePosicao {
  codigo_local_estoque: number
  nCodProd: number
  cCodInt: string
  cCodigo: string
  cDescricao: string
  nPrecoUnitario: number
  nSaldo: number
  nCMC: number
  nPendente: number
  // O Omie traz o minimo aqui (NAO no cadastro do produto, que vem 0). Fonte
  // real do estoque minimo. fisico/reservado completam a fotografia do estoque.
  estoque_minimo: number
  fisico: number
  reservado: number
}

interface OmiePosResponse {
  nPagina: number
  nTotPaginas: number
  produtos?: OmiePosicao[]
}

/**
 * Busca o CMC (custo medio) de um produto especifico num local de estoque.
 * Critico para inventario e transferencia: o ajuste no Omie exige nValorUnitario = CMC.
 * Retorna null se nao encontrado.
 */
export async function getPosicaoProduto(
  loja: LojaOmie,
  codigoLocalEstoque: number,
  produtoCodigo: number,
  dataPosicao: string // formato d/m/Y
): Promise<{ n_cmc: number; n_saldo: number } | null> {
  const res = await omieRequest<OmiePosResponse>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/estoque/consulta',
    call: 'ListarPosEstoque',
    data: {
      nPagina: 1,
      nRegPorPagina: 1,
      dDataPosicao: dataPosicao,
      codigo_local_estoque: codigoLocalEstoque,
      lista_produtos: { nCodProd: produtoCodigo },
      cExibeTodos: 'S',
    },
  })

  const p = res.produtos?.[0]
  if (!p) return null
  return { n_cmc: p.nCMC ?? 0, n_saldo: p.nSaldo ?? 0 }
}

// Local sentinela da linha que carrega o ESTOQUE MINIMO (e o custo base) do
// produto. O minimo do Omie so vem na varredura "sem local" (= local padrao) e
// inclui ate produtos com saldo zero; essa linha guarda o minimo com saldo 0
// para NAO entrar na soma dos saldos. Ver syncPosicaoEstoque.
const LOCAL_MINIMO = 0

/**
 * Sincroniza a posição de estoque (saldo por local, mínimo e custo) de toda a
 * loja para posicao_estoques. Só leitura do Omie. O único leitor da tabela é a
 * tela de produtos, que SOMA os saldos dos locais — o total real é a soma. O Omie
 * NÃO tem endpoint que devolva o consolidado somado: chamar sem `codigo_local_estoque`
 * retorna apenas o Local de Estoque Padrão, não a soma.
 *
 * Duas varreduras enxutas (o ListarPosEstoque trava em 50 itens/página):
 *  1) Mínimo + custo: varredura sem local (= local padrão) com cExibeTodos='S',
 *     que traz TODOS os produtos com o estoque mínimo do Omie, inclusive os de
 *     saldo 0. Guardada como local = LOCAL_MINIMO com saldo 0.
 *  2) Saldos: por local ativo, com cExibeTodos='N' (só produtos COM saldo),
 *     reduzindo de ~58 para ~3 páginas por local.
 *
 * Antes era cExibeTodos='S' POR local (~58 páginas × N locais = centenas de
 * chamadas numa execução só), o que estourava o tempo/limite do Omie ("Já existe
 * uma requisição desse método") e cortava o último local — o estoque dele sumia
 * (ex.: o almoxarifado NUCLEO da Brotas). Agora são ~85 chamadas no total.
 */
export async function syncPosicaoEstoque(loja: LojaOmie): Promise<number> {
  const supabase = createServiceClient()
  const hoje = new Date().toLocaleDateString('pt-BR') // d/m/Y
  const dataISO = new Date().toISOString().split('T')[0]

  const omieBase = {
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/estoque/consulta',
    call: 'ListarPosEstoque',
  }

  let gravados = 0
  async function upsert(rows: Record<string, unknown>[]) {
    if (!rows.length) return
    await supabase
      .from('posicao_estoques')
      .upsert(rows, { onConflict: 'loja_id,codigo_local_estoque,n_cod_prod,data_posicao' })
    gravados += rows.length
  }

  // 1) MINIMO + custo: varredura sem local (todos os produtos, inclusive saldo 0).
  {
    let pagina = 1
    let total = 1
    do {
      const res = await omieRequest<OmiePosResponse>({
        ...omieBase,
        data: { nPagina: pagina, nRegPorPagina: 50, dDataPosicao: hoje, cExibeTodos: 'S' },
      })
      total = res.nTotPaginas || 1
      await upsert(
        (res.produtos ?? []).map((p) => ({
          loja_id: loja.id,
          codigo_local_estoque: LOCAL_MINIMO,
          n_cod_prod: p.nCodProd,
          data_posicao: dataISO,
          c_codigo: p.cCodigo,
          c_descricao: p.cDescricao,
          n_preco_unitario: p.nPrecoUnitario,
          n_saldo: 0, // saldo vem das varreduras por local; aqui só mínimo/custo
          n_cmc: p.nCMC,
          n_pendente: 0,
          estoque_minimo: p.estoque_minimo ?? 0,
          fisico: 0,
          reservado: 0,
          updated_at: new Date().toISOString(),
        }))
      )
      pagina++
    } while (pagina <= total)
  }

  // 2) SALDOS por local ativo (cExibeTodos='N' = só produtos com saldo).
  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque')
    .eq('loja_id', loja.id)
    .neq('inativo', 'S')

  for (const local of locais ?? []) {
    // Cada local isolado: um local invalido/orfao no Omie (ex.: "ZZ VARREDURA
    // EXCLUIR", que existe no cadastro mas o Omie diz "nao cadastrado") ou uma
    // falha pontual NAO pode abortar a loja inteira. Pula e segue os demais.
    try {
      const linhas: Record<string, unknown>[] = []
      let pagina = 1
      let total = 1
      do {
        const res = await omieRequest<OmiePosResponse>({
          ...omieBase,
          data: {
            nPagina: pagina,
            nRegPorPagina: 50,
            dDataPosicao: hoje,
            codigo_local_estoque: local.codigo_local_estoque,
            cExibeTodos: 'N',
          },
        })
        total = res.nTotPaginas || 1
        for (const p of res.produtos ?? []) {
          linhas.push({
            loja_id: loja.id,
            codigo_local_estoque: local.codigo_local_estoque,
            n_cod_prod: p.nCodProd,
            data_posicao: dataISO,
            c_codigo: p.cCodigo,
            c_descricao: p.cDescricao,
            n_preco_unitario: p.nPrecoUnitario,
            n_saldo: p.nSaldo,
            n_cmc: p.nCMC,
            n_pendente: p.nPendente,
            estoque_minimo: 0,
            fisico: p.fisico ?? 0,
            reservado: p.reservado ?? 0,
            updated_at: new Date().toISOString(),
          })
        }
        pagina++
      } while (pagina <= total)
      // Substitui as linhas de HOJE deste local (deletar so apos buscar tudo: se a
      // busca falhar, as linhas antigas ficam de pe em vez de zerar). Com 'N' so
      // vem saldo != 0, entao o delete remove o que zerou desde o ultimo sync.
      await supabase
        .from('posicao_estoques')
        .delete()
        .eq('loja_id', loja.id)
        .eq('data_posicao', dataISO)
        .eq('codigo_local_estoque', local.codigo_local_estoque)
      await upsert(linhas)
    } catch (e) {
      console.error(
        `[posicao] loja ${loja.id} local ${local.codigo_local_estoque} pulado: ${(e as Error).message}`
      )
    }
  }

  // Mantem as DUAS fotos mais recentes (nao necessariamente dias consecutivos).
  // A foto do dia corrente as vezes vem SEM CMC (o Omie so fecha o custo no fim
  // do dia), entao a tela cai pra foto anterior (que tem custo). Usar "ontem fixo"
  // como corte falha quando uma loja fica um dia sem sync: o dia anterior ao atual
  // fica vazio e a segunda foto mais recente cai fora. Aqui: busca a data maxima
  // real, depois busca a maior data anterior a ela (penultima distinta), e apaga
  // so o que for mais antigo que a penultima -- seguro contra lacunas no rodizio.
  const { data: maxRow } = await supabase
    .from('posicao_estoques')
    .select('data_posicao')
    .eq('loja_id', loja.id)
    .order('data_posicao', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (maxRow) {
    const dataMax = (maxRow as { data_posicao: string }).data_posicao
    const { data: penultimaRow } = await supabase
      .from('posicao_estoques')
      .select('data_posicao')
      .eq('loja_id', loja.id)
      .lt('data_posicao', dataMax)
      .order('data_posicao', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (penultimaRow) {
      const penultima = (penultimaRow as { data_posicao: string }).data_posicao
      await supabase
        .from('posicao_estoques')
        .delete()
        .eq('loja_id', loja.id)
        .lt('data_posicao', penultima)
    }
  }
  return gravados
}
