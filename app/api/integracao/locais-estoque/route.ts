import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

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
    .select('id')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<{ id: number }>()
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
  return NextResponse.json({ locais })
}
