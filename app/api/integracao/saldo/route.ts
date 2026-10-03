import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Saldo atual por produto pro Norte Vendas (alerta de estoque baixo, 03/10): recebe os
// códigos (SKU = produtos.codigo, o mesmo omie_codigo do Vendas) e devolve o saldo somado
// de todos os locais, usando a posição mais recente de cada produto/local. Só leitura.
// Mesma autenticação das outras rotas de integração (lojas.integracao_api_key).
export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<{ id: number }>()
  if (!loja) {
    return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })
  }

  const codigos = (new URL(request.url).searchParams.get('codigos') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 300)
  if (codigos.length === 0) return NextResponse.json({ saldos: [] })

  const { data: prods, error: errProd } = await supabase
    .from('produtos')
    .select('codigo, codigo_produto')
    .eq('loja_id', loja.id)
    .in('codigo', codigos)
  if (errProd) return NextResponse.json({ error: errProd.message }, { status: 500 })

  const idPorCodigo = new Map<number, string>()
  for (const p of (prods ?? []) as { codigo: string; codigo_produto: number }[]) {
    idPorCodigo.set(Number(p.codigo_produto), p.codigo)
  }
  if (idPorCodigo.size === 0) return NextResponse.json({ saldos: [] })

  const { data: pos, error: errPos } = await supabase
    .from('posicao_estoques')
    .select('n_cod_prod, codigo_local_estoque, n_saldo, data_posicao')
    .eq('loja_id', loja.id)
    .in('n_cod_prod', Array.from(idPorCodigo.keys()))
    .order('data_posicao', { ascending: false })
  if (errPos) return NextResponse.json({ error: errPos.message }, { status: 500 })

  // Posição mais recente de cada produto/local (a lista já vem da data mais nova pra mais velha).
  const vistos = new Set<string>()
  const saldoPorCodigo = new Map<string, number>()
  for (const r of (pos ?? []) as { n_cod_prod: number; codigo_local_estoque: number; n_saldo: number | null }[]) {
    const chave = `${r.n_cod_prod}|${r.codigo_local_estoque}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    const codigo = idPorCodigo.get(Number(r.n_cod_prod))
    if (!codigo) continue
    saldoPorCodigo.set(codigo, (saldoPorCodigo.get(codigo) ?? 0) + Number(r.n_saldo ?? 0))
  }

  return NextResponse.json({
    saldos: Array.from(saldoPorCodigo.entries()).map(([codigo, saldo]) => ({ codigo, saldo })),
  })
}
