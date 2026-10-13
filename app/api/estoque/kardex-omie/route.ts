import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import type { LojaOmie } from '@/lib/omie/client'
import { buscarKardexOmie, normalizarMovOmie } from '@/lib/omie/kardex'
import { modoDaLoja } from '@/lib/estoque/ledger'

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
  const { data: recente } = await supabase.from('kardex_omie').select('carregado_em')
    .eq('loja_id', lojaId).eq('n_cod_prod', codigoProduto).order('carregado_em', { ascending: false }).limit(1).maybeSingle()
  if (recente && Date.now() - new Date(recente.carregado_em as string).getTime() < INTERVALO_MIN * 60_000) {
    return NextResponse.json({ ok: true, gravados: 0, doCache: true })
  }

  const { data: loja } = await supabase.from('lojas').select('id, omie_app_key, omie_app_secret, is_test').eq('id', lojaId).single<LojaOmie>()
  if (!loja?.omie_app_key) return NextResponse.json({ error: 'Loja sem integração Omie' }, { status: 400 })
  const { data: locais } = await supabase.from('local_estoques').select('codigo_local_estoque').eq('loja_id', lojaId).neq('inativo', 'S')

  const fim = new Date(), ini = new Date(Date.now() - JANELA_DIAS * 86_400_000)
  let gravados = 0
  try {
    for (const l of locais ?? []) {
      const movs = await buscarKardexOmie(loja, codigoProduto, Number(l.codigo_local_estoque), br(ini), br(fim))
      const linhas = movs.map((m) => ({ ...normalizarMovOmie(m, lojaId), carregado_em: new Date().toISOString() }))
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await supabase.from('kardex_omie').upsert(linhas.slice(i, i + 500), { onConflict: 'loja_id,id_mov' })
        if (error) throw new Error(error.message)
      }
      gravados += linhas.length
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha ao ler o Omie', gravados }, { status: 502 })
  }
  return NextResponse.json({ ok: true, gravados, doCache: false })
}
