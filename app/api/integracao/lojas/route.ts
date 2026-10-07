import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { semearLojaProprio } from '@/lib/estoque/proprio-driver'

// Rota externa (nao-sessao) pro ntb-vendas criar uma loja aqui automaticamente
// ao criar uma loja de la, com um clique so ("Criar no NTB Estoque tambem"),
// sem o operador precisar mexer com chave nenhuma na hora. Autenticada por
// um segredo fixo compartilhado entre os dois deploys (CROSS_SYSTEM_BOOTSTRAP_KEY,
// nao e a integracao_api_key por loja -- essa so existe DEPOIS que a loja e
// criada aqui, e' o que essa rota gera e devolve). Pedido explicito do usuario
// (2026-08-16): "clico pra criar loja e' so aparecer e acabou e cria no outro
// lugar tambem", sem chave do Omie obrigatoria (omie_app_key/secret ficam null
// -- ja e' assim que a loja fica "fora do Omie", ver LojaForm.tsx).

function gerarChave(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function urlPublica(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://app-estoque.norteparanegocios.com.br'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RequestBody {
  nome?: string
  nomeFantasia?: string
  cnpj?: string
  /** Contrato com o Vendas: stores.stock_mode. Ausente = 'omie' (comportamento de sempre). */
  stockMode?: 'omie' | 'proprio' | 'nenhum'
  /** Loja do Vendas que pediu a criação: grava o vínculo na hora (sem isso o cron tentaria ligar de novo e podia duplicar). */
  vendasStoreId?: string
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const chave = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const segredo = process.env.CROSS_SYSTEM_BOOTSTRAP_KEY
  if (!segredo || chave !== segredo) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as RequestBody | null
  if (!body?.nome?.trim()) {
    return NextResponse.json({ error: 'Informe nome' }, { status: 400 })
  }

  const modo = body.stockMode === 'proprio' || body.stockMode === 'nenhum' ? body.stockMode : 'omie'
  const vendasStoreId = typeof body.vendasStoreId === 'string' && UUID_RE.test(body.vendasStoreId) ? body.vendasStoreId : null
  const supabase = createServiceClient()

  // Idempotente por CNPJ (ligação automática Estoque <-> Vendas): se a loja já existe aqui, devolve a existente.
  const digitos = (body.cnpj ?? '').replace(/\D/g, '')
  if (digitos.length >= 11) {
    const { data: todas } = await supabase.from('lojas').select('id, cnpj, integracao_api_key, modo_estoque').not('cnpj', 'is', null)
    const existente = (todas ?? []).find((l) => String(l.cnpj).replace(/\D/g, '') === digitos)
    if (existente) {
      let chave = existente.integracao_api_key as string | null
      if (!chave) {
        chave = gerarChave()
        await supabase.from('lojas').update({ integracao_api_key: chave }).eq('id', existente.id)
      }
      if (vendasStoreId) await supabase.from('lojas').update({ vendas_store_id: vendasStoreId }).eq('id', existente.id)
      return NextResponse.json({ ok: true, lojaId: existente.id, integracaoApiKey: chave, url: urlPublica(), modo: existente.modo_estoque, existente: true })
    }
  }

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const integracaoApiKey = gerarChave()
    const { data: loja, error } = await supabase
      .from('lojas')
      .insert({
        nome: body.nome.trim(),
        nome_fantasia: body.nomeFantasia?.trim() || null,
        cnpj: body.cnpj?.trim() || null,
        ativo: true,
        integracao_api_key: integracaoApiKey,
        modo_estoque: modo,
        ...(vendasStoreId ? { vendas_store_id: vendasStoreId } : {}),
      })
      .select('id')
      .single()

    if (!error) {
      if (modo === 'proprio') await semearLojaProprio(loja.id).catch((e) => console.error('integracao/lojas: semente do estoque próprio falhou:', e))
      return NextResponse.json({ ok: true, lojaId: loja.id, integracaoApiKey, url: urlPublica(), modo })
    }
    // 23505 = unique_violation -- pode ser colisao de chave (rarissima) ou
    // CNPJ duplicado. So retenta no caso de chave; CNPJ duplicado e' erro real.
    if (error.code === '23505' && error.message.includes('integracao_api_key')) continue
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ error: 'Não foi possível gerar uma chave única. Tente de novo.' }, { status: 500 })
}

// Atualização de loja vinda do Norte Vendas (nome, CNPJ, ativa). Autenticada pela chave de integração da própria loja,
// então só a loja ligada consegue se alterar. Achado do QA de 07/10: editar a loja num sistema não mudava o outro.
export async function PATCH(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const chave = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!chave) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { nome?: string; cnpj?: string | null; ativo?: boolean } | null
  if (!body) return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  const supabase = createServiceClient()
  const { data: loja } = await supabase.from('lojas').select('id').eq('integracao_api_key', chave).maybeSingle()
  if (!loja) return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })
  const upd: Record<string, unknown> = {}
  if (typeof body.nome === 'string' && body.nome.trim()) upd.nome = body.nome.trim()
  if (typeof body.cnpj === 'string' && body.cnpj.replace(/\D/g, '').length >= 11) upd.cnpj = body.cnpj.trim()
  if (typeof body.ativo === 'boolean') upd.ativo = body.ativo
  if (!Object.keys(upd).length) return NextResponse.json({ ok: true, alterado: false })
  const { error } = await supabase.from('lojas').update(upd).eq('id', loja.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, alterado: true })
}
