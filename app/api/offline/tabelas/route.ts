// Lista do que o desktop sincroniza e o cursor atual do log (gravado ANTES do snapshot: o que
// mudar durante a carga chega depois pelo pull, e o upsert local é idempotente).
import { createServiceClient } from '@/lib/supabase/server'
import { autenticarCanal, erro } from '@/lib/offline/canal'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const u = await autenticarCanal(req)
  if (u instanceof Response) return u
  const svc = createServiceClient()
  await svc.rpc('offline_compactar')
  const [{ data: tabelas, error }, { data: cursor }, { data: piso }] = await Promise.all([
    svc.from('offline_tabelas').select('tabela, pk_cols, modo').order('tabela'),
    svc.from('offline_versoes').select('versao').order('versao', { ascending: false }).limit(1).maybeSingle(),
    svc.from('offline_meta').select('valor').eq('chave', 'piso_versao').maybeSingle(),
  ])
  if (error) return erro(500, 'Falha ao listar tabelas.')
  return Response.json({
    ok: true,
    tabelas,
    cursor: Number(cursor?.versao ?? 0),
    piso: Number(piso?.valor ?? 0),
    lojas: u.lojas,
    lojaAtual: u.lojaAtual,
    frio: ['fat_cupons', 'fat_cupom_itens', 'fat_cupom_pagamentos'],
  })
}
