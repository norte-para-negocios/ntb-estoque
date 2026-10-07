import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Catálogo unificado Vendas <-> Estoque (lojas modo 'proprio'). Autenticação: Bearer = lojas.integracao_api_key.
//   POST: o Vendas entrega mudanças (grupos e produtos) -> aplicar_catalogo_vendas (idempotente, sem eco no outbox);
//         devolve o mapa de códigos e ids criados para o Vendas gravar do lado dele.
//   GET : snapshot do catálogo do Estoque (usado na reconciliação do Vendas).
// Modelo e regras de conflito: docs/superpowers/specs/2026-10-06-sync-catalogo-design.md

type Loja = { id: number; modo_estoque: string }

async function lojaPelaChave(request: Request): Promise<Loja | NextResponse> {
  const auth = request.headers.get('authorization') ?? ''
  const chave = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!chave) return NextResponse.json({ ok: false, error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })
  const { data } = await createServiceClient()
    .from('lojas').select('id, modo_estoque').eq('integracao_api_key', chave).eq('ativo', true).maybeSingle()
  if (!data) return NextResponse.json({ ok: false, error: 'Chave de integração inválida' }, { status: 401 })
  if (data.modo_estoque !== 'proprio') return NextResponse.json({ ok: false, error: 'Esta loja não usa estoque próprio' }, { status: 409 })
  return data as Loja
}

export async function POST(request: Request) {
  const loja = await lojaPelaChave(request)
  if (loja instanceof NextResponse) return loja
  const body = (await request.json().catch(() => null)) as { grupos?: unknown[]; produtos?: unknown[] } | null
  if (!body || (!Array.isArray(body.grupos) && !Array.isArray(body.produtos))) {
    return NextResponse.json({ ok: false, error: 'Informe grupos[] e/ou produtos[]' }, { status: 400 })
  }
  if ((body.grupos?.length ?? 0) + (body.produtos?.length ?? 0) > 1000) {
    return NextResponse.json({ ok: false, error: 'Máximo de 1000 itens por chamada' }, { status: 400 })
  }
  const { data, error } = await createServiceClient().rpc('aplicar_catalogo_vendas', {
    p_loja: loja.id, p_payload: { grupos: body.grupos ?? [], produtos: body.produtos ?? [] },
  })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function GET(request: Request) {
  const loja = await lojaPelaChave(request)
  if (loja instanceof NextResponse) return loja
  const supabase = createServiceClient()
  const [{ data: grupos }, { data: produtos }] = await Promise.all([
    supabase.from('grupos_produto').select('id, pai_id, nome, ordem, ativo, vendas_ref, updated_at').eq('loja_id', loja.id).order('id'),
    supabase
      .from('produtos')
      .select('codigo, codigo_produto, descricao, valor_unitario, inativo, eh_mae, produto_pai_codigo, grupo_id, atributos, unidade, tipo_item, vendas_ref, updated_at, pdv')
      .eq('loja_id', loja.id).not('codigo', 'is', null).eq('pdv', true).order('id').limit(5000),
  ])
  const codigoDoPai = new Map((produtos ?? []).map((p) => [p.codigo_produto as number, p.codigo as string]))
  return NextResponse.json({
    ok: true,
    grupos: (grupos ?? []).map((g) => ({
      estoque_id: g.id, vendas_ref: g.vendas_ref, nome: g.nome, pai_estoque_id: g.pai_id, ordem: g.ordem, ativo: g.ativo, updated_at: g.updated_at,
    })),
    produtos: (produtos ?? []).map((p) => ({
      codigo: p.codigo, vendas_ref: p.vendas_ref, nome: p.descricao, preco: Number(p.valor_unitario) || 0, ativo: !p.inativo, mae: p.eh_mae,
      pai_codigo: p.produto_pai_codigo != null ? codigoDoPai.get(p.produto_pai_codigo as number) ?? null : null,
      grupo_estoque_id: p.grupo_id, atributos: p.atributos ?? {}, unidade: p.unidade, tipo_item: p.tipo_item, updated_at: p.updated_at,
    })),
  })
}
