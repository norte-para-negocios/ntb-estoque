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
    .select('id, modo_estoque')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<{ id: number; modo_estoque: string | null }>()
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

  // Estoque proprio: o saldo vem do ledger (estoque_saldos), somado de todos os locais. Loja sem controle: nada a alertar.
  if (loja.modo_estoque === 'nenhum') return NextResponse.json({ saldos: [] })
  if (loja.modo_estoque === 'proprio') {
    const soma = new Map<string, number>()
    for (let de = 0; de < 20000; de += 1000) {
      const { data, error } = await supabase
        .from('estoque_saldos')
        .select('codigo_produto, codigo_local_estoque, saldo')
        .eq('loja_id', loja.id)
        .in('codigo_produto', Array.from(idPorCodigo.keys()))
        .order('codigo_produto')
        .order('codigo_local_estoque')
        .range(de, de + 999)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      for (const r of (data ?? []) as { codigo_produto: number; saldo: number | null }[]) {
        const codigo = idPorCodigo.get(Number(r.codigo_produto))
        if (codigo) soma.set(codigo, (soma.get(codigo) ?? 0) + Number(r.saldo ?? 0))
      }
      if ((data?.length ?? 0) < 1000) break
    }
    // Produto sem nenhum movimento ainda tem saldo 0 (nao some da lista).
    for (const codigo of idPorCodigo.values()) if (!soma.has(codigo)) soma.set(codigo, 0)
    return NextResponse.json({ saldos: Array.from(soma.entries()).map(([codigo, saldo]) => ({ codigo, saldo })) })
  }

  // O PostgREST devolve no máximo 1000 linhas por consulta: pagina até acabar (com teto de segurança),
  // senão o saldo de alguns produtos podia vir truncado.
  const pos: { n_cod_prod: number; codigo_local_estoque: number; n_saldo: number | null; data_posicao: string }[] = []
  for (let de = 0; de < 20000; de += 1000) {
    const { data, error } = await supabase
      .from('posicao_estoques')
      .select('n_cod_prod, codigo_local_estoque, n_saldo, data_posicao')
      .eq('loja_id', loja.id)
      .in('n_cod_prod', Array.from(idPorCodigo.keys()))
      .order('data_posicao', { ascending: false })
      .range(de, de + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    pos.push(...((data ?? []) as typeof pos))
    if ((data?.length ?? 0) < 1000) break
  }

  // Posição mais recente de cada produto/local (a lista já vem da data mais nova pra mais velha).
  const vistos = new Set<string>()
  const saldoPorCodigo = new Map<string, number>()
  for (const r of pos) {
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
