import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import type { LojaOmie } from '@/lib/omie/client'
import { buscarKardexOmie, normalizarMovOmie } from '@/lib/omie/kardex'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { pegarTravaSync, soltarTravaSync } from '@/lib/omie/trava-sync'

export const maxDuration = 300
const JANELA_DIAS = 55
const INTERVALO_MIN = 10
const br = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })

/** Carrega do Omie os movimentos de 1 produto (todos os locais ativos, últimos 55 dias). Só leitura do Omie. */
export async function POST(req: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  if ((await modoDaLoja(lojaId)) !== 'omie') return NextResponse.json({ error: 'Só para loja com Omie' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const codigoProduto = Number(body?.codigoProduto)
  if (!Number.isFinite(codigoProduto) || codigoProduto <= 0) return NextResponse.json({ error: 'codigoProduto inválido' }, { status: 400 })

  const supabase = createServiceClient()
  // 1 carga por produto a cada 10 min: a trava fica de pé 10 min depois de uma carga boa (vale também
  // para produto sem movimento) e é solta na hora se a carga falhar (o usuário pode tentar de novo).
  const recurso = `kardex:${codigoProduto}`
  if (!(await pegarTravaSync(lojaId, recurso, INTERVALO_MIN * 60))) {
    return NextResponse.json({ ok: true, gravados: 0, doCache: true })
  }

  const { data: loja } = await supabase.from('lojas').select('id, omie_app_key, omie_app_secret, is_test').eq('id', lojaId).single<LojaOmie>()
  if (!loja?.omie_app_key) { await soltarTravaSync(lojaId, recurso); return NextResponse.json({ error: 'Loja sem integração Omie' }, { status: 400 }) }
  const { data: locais } = await supabase.from('local_estoques').select('codigo_local_estoque').eq('loja_id', lojaId).neq('inativo', 'S')

  const fim = new Date(), ini = new Date(Date.now() - JANELA_DIAS * 86_400_000)
  let gravados = 0
  try {
    for (const l of locais ?? []) {
      const movs = await buscarKardexOmie(loja, codigoProduto, Number(l.codigo_local_estoque), br(ini), br(fim))
      const linhas = movs.map((m) => ({ ...normalizarMovOmie(m, lojaId), carregado_em: new Date().toISOString() }))
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await supabase.from('kardex_omie').upsert(linhas.slice(i, i + 500), { onConflict: 'loja_id,id_mov,codigo_local_estoque' })
        if (error) throw new Error(error.message)
      }
      gravados += linhas.length
    }
    const { error } = await supabase.from('kardex_omie_carga')
      .upsert({ loja_id: lojaId, n_cod_prod: codigoProduto, carregado_em: new Date().toISOString(), movimentos: gravados }, { onConflict: 'loja_id,n_cod_prod' })
    if (error) throw new Error(error.message)
  } catch (e) {
    await soltarTravaSync(lojaId, recurso)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha ao ler o Omie', gravados }, { status: 502 })
  }
  return NextResponse.json({ ok: true, gravados, doCache: false })
}
