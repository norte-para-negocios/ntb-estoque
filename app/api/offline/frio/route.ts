// Fato de faturamento (banco frio do Contabo) para o desktop. GET ?tabela=&loja=&desde=&depois=
import { autenticarCanal, erro, jsonGzip } from '@/lib/offline/canal'

export const dynamic = 'force-dynamic'

const TABELAS = new Set(['fat_cupons', 'fat_cupom_itens', 'fat_cupom_pagamentos'])

export async function GET(req: Request) {
  const u = await autenticarCanal(req)
  if (u instanceof Response) return u
  const sp = new URL(req.url).searchParams
  const tabela = sp.get('tabela') ?? ''
  const loja = Number(sp.get('loja'))
  if (!TABELAS.has(tabela)) return erro(400, 'Tabela inválida.')
  if (!u.lojas.includes(loja)) return erro(403, 'Loja sem acesso.')
  const base = process.env.NTB_FRIO_API_URL
  if (!base) return erro(503, 'Histórico indisponível.')
  const qs = new URLSearchParams({ tabela, loja_id: String(loja), limite: '5000' })
  const desde = sp.get('desde')
  if (desde && /^\d{4}-\d{2}-\d{2}$/.test(desde)) qs.set('desde', desde)
  const depois = sp.get('depois')
  if (depois) qs.set('depois', depois)
  const r = await fetch(`${base}/export?${qs}`, {
    headers: { 'x-api-key': process.env.NTB_FRIO_API_KEY ?? '' },
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null)
  if (!r?.ok) return erro(502, 'Histórico indisponível agora.')
  const { rows } = (await r.json()) as { rows: Record<string, unknown>[] }
  const pkCols = tabela === 'fat_cupons' ? ['n_id_cupom'] : tabela === 'fat_cupom_itens' ? ['id_item'] : ['n_id_cupom', 'sequencia']
  const ultima = rows.length ? Object.fromEntries(pkCols.map((c) => [c, rows[rows.length - 1][c]])) : null
  return jsonGzip({ ok: true, linhas: rows, depois: ultima, fim: rows.length < 5000 })
}
