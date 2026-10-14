import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { validarLinhas, MAX_LINHAS } from '@/lib/correcoes/robo'

// Ingestão das correções automáticas (08/10/2026). O robô ("faxina") manda em lotes o que corrigiu/parou no Omie
// da loja; esta rota SÓ grava no Supabase (tabela correcoes_automaticas). NÃO chama o Omie.
// Auth: mesma chave por loja das rotas /api/integracao/* (Authorization: Bearer <lojas.integracao_api_key>).
// A loja é SEMPRE a da chave: qualquer loja_id no corpo é ignorado, então uma chave nunca escreve em outra loja.
// Idempotente: upsert em (loja_id, lote, acao, produto_cod, data_ref, omie_ref); reenviar o mesmo lote não duplica.
// Formato do payload: ver AGENTS.md, seção "Correções automáticas (08/10/2026)".
export const dynamic = 'force-dynamic'

const MAX_BYTES = 2_000_000

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })
  }

  const declarado = Number(request.headers.get('content-length') ?? 0)
  if (declarado > MAX_BYTES) {
    return NextResponse.json({ error: 'Corpo grande demais' }, { status: 413 })
  }
  const texto = await request.text().catch(() => '')
  if (texto.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Corpo grande demais' }, { status: 413 })
  }
  let corpo: unknown = null
  try { corpo = JSON.parse(texto) } catch { /* cai na validação */ }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    // Loja de teste pode ter a mesma chave da real (AGENTS.md "Lojas de Teste": coluna que não é id deixou de ser única).
    .eq('is_test', false)
    .maybeSingle<{ id: number }>()
  if (!loja) {
    return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })
  }

  const v = validarLinhas(corpo)
  if (!v.ok) {
    return NextResponse.json({ error: 'Payload inválido', detalhes: v.erros, maxLinhas: MAX_LINHAS }, { status: 400 })
  }

  const registros = v.linhas.map((l) => ({ ...l, loja_id: loja.id }))
  const { data, error } = await supabase
    .from('correcoes_automaticas')
    .upsert(registros, { onConflict: 'loja_id,lote,acao,produto_cod,data_ref,omie_ref' })
    .select('id')
  if (error) {
    // Não devolve a mensagem do banco ao chamador (pode vazar nome de coluna/constraint); fica no log do servidor.
    console.error('correcoes/ingest: falha no upsert', { lojaId: loja.id, code: error.code, message: error.message })
    return NextResponse.json({ error: 'Falha ao gravar' }, { status: 500 })
  }

  return NextResponse.json({
    lojaId: loja.id,
    recebidas: (corpo as { linhas: unknown[] }).linhas.length,
    // Linhas distintas gravadas (inseridas ou atualizadas); duplicatas dentro do mesmo envio contam uma vez.
    gravadas: data?.length ?? registros.length,
  })
}
