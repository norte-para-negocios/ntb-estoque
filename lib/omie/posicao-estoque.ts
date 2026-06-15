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

/**
 * Sincroniza a posição de estoque (CMC, saldo, preço) de TODA a loja para a
 * tabela posicao_estoques, percorrendo cada local de estoque ativo. Só leitura
 * do Omie. Usado para alimentar custo/margem na tela de produtos.
 */
export async function syncPosicaoEstoque(loja: LojaOmie): Promise<number> {
  const supabase = createServiceClient()
  const hoje = new Date().toLocaleDateString('pt-BR') // d/m/Y
  const dataISO = new Date().toISOString().split('T')[0]

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque')
    .eq('loja_id', loja.id)
    .neq('inativo', 'S')

  let gravados = 0
  for (const local of locais ?? []) {
    let pagina = 1
    let total = 1
    do {
      const res = await omieRequest<OmiePosResponse>({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        endpoint: 'v1/estoque/consulta',
        call: 'ListarPosEstoque',
        data: {
          nPagina: pagina,
          nRegPorPagina: 500,
          dDataPosicao: hoje,
          codigo_local_estoque: local.codigo_local_estoque,
          cExibeTodos: 'S',
        },
      })
      total = res.nTotPaginas || 1
      const rows = (res.produtos ?? []).map((p) => ({
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
        estoque_minimo: p.estoque_minimo ?? 0,
        fisico: p.fisico ?? 0,
        reservado: p.reservado ?? 0,
        // Re-sync no mesmo dia colide na unique key (vira UPDATE). Sem setar
        // updated_at aqui ele congelaria no 1o INSERT e o cron (que escolhe a
        // loja por updated_at) distorceria o rodizio. Igual aos outros syncs.
        updated_at: new Date().toISOString(),
      }))
      if (rows.length) {
        await supabase
          .from('posicao_estoques')
          .upsert(rows, { onConflict: 'loja_id,codigo_local_estoque,n_cod_prod,data_posicao' })
        gravados += rows.length
      }
      pagina++
    } while (pagina <= total)
  }
  return gravados
}
