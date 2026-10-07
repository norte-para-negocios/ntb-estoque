import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { criarLocalProprio } from '@/lib/estoque/proprio-driver'

// Lista os locais de estoque (Omie) da loja pro Norte Vendas (30/09, pedido do dono):
// lá o lojista escolhe, pra cada destino de impressão (Cozinha, Bar, Pizzaria...), de
// qual local a venda baixa. Mesma autenticação da rota de Ordem de Produção
// (lojas.integracao_api_key). Só leitura.
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

  const { data, error } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao, inativo')
    .eq('loja_id', loja.id)
    .order('descricao')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const locais = (data ?? [])
    .filter((l: { inativo: string | null }) => l.inativo !== 'S')
    .map((l: { codigo_local_estoque: number; descricao: string | null }) => ({
      codigo: Number(l.codigo_local_estoque),
      nome: l.descricao ?? String(l.codigo_local_estoque),
    }))
  return NextResponse.json({ locais, modo: loja.modo_estoque === 'proprio' || loja.modo_estoque === 'nenhum' ? loja.modo_estoque : 'omie' })
}

// Cria um local de estoque aqui, a partir do Norte Vendas ("Locais de estoque" nas configurações, 06/10/2026).
// So em loja com estoque PROPRIO (em loja do Omie o local nasce no Omie). Body: { nome, codigo? }.
// Idempotente por nome: se ja existe um local com o mesmo nome (sem diferenciar caixa), devolve ele.
export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { nome?: string; codigo?: string } | null
  const nome = body?.nome?.trim()
  if (!nome) return NextResponse.json({ error: 'Informe nome' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, modo_estoque')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<{ id: number; modo_estoque: string | null }>()
  if (!loja) return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })
  if (loja.modo_estoque !== 'proprio') {
    return NextResponse.json({ error: 'Criar local por aqui só vale para loja com estoque próprio' }, { status: 409 })
  }

  const { data: existentes } = await supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', loja.id)
  const ja = ((existentes ?? []) as { codigo_local_estoque: number; descricao: string | null }[]).find((l) => (l.descricao ?? '').trim().toLowerCase() === nome.toLowerCase())
  if (ja) return NextResponse.json({ ok: true, existente: true, codigo: Number(ja.codigo_local_estoque), nome: ja.descricao })

  const r = await criarLocalProprio(loja.id, { descricao: nome, codigo: body?.codigo })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, existente: false, codigo: r.codigoLocalEstoque, nome })
}
