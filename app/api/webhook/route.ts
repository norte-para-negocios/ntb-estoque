import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchNotaFiscal } from '@/lib/omie/nota-fiscal'
import { fetchOrdemProducao } from '@/lib/omie/ordem-producao'
import { syncLocaisEstoque } from '@/lib/omie/local-estoque'
import type { LojaOmie } from '@/lib/omie/client'
import { lojaOpTempoReal } from '@/lib/omie/sync-all'
import { webhookTokenOk } from '@/lib/seguranca/regras'
import { deveRelerNota, lojasForaDaReleitura, nIdRecebDoAviso } from '@/lib/omie/nf-releitura'

// Topicos de movimentacao de estoque: ignorados (igual ao Laravel, evita loop de ajuste)
const IGNORED_TOPICS = ['Produto.AjusteEstoque', 'Produto.MovimentacaoEstoque']

interface OmieWebhookBody {
  messageId?: string
  appKey?: string
  topic?: string
  // RecebimentoProduto.*: o id vem em event.cabecalho.nIdReceb (nIdRecebDoAviso, paridade 20/10/2026 B7)
  event?: { nIdReceb?: number; nCodOP?: number; cabecalho?: { nIdReceb?: number } }
}

// Fase H: aviso do Omie é pequeno (p99 = 1,5 KB; o maior já gravado, 175 KB, em 19/10/2026). Corpo gigante é
// recusado antes de ir para o banco (o JSON inteiro é gravado em `webhooks.message` e no Contabo).
const MAX_BYTES = 1_000_000

export async function POST(request: Request) {
  // Fase H: o Omie não assina o aviso. Com OMIE_WEBHOOK_TOKEN configurado, só aceita `?t=<token>` (o endereço
  // cadastrado nos apps do Omie precisa ser trocado ANTES de ligar a env). Sem a env: comportamento de sempre.
  if (!webhookTokenOk(new URL(request.url).searchParams.get('t'), process.env.OMIE_WEBHOOK_TOKEN)) {
    return NextResponse.json({ ok: true })
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }
  const texto = await request.text().catch(() => '')
  if (texto.length > MAX_BYTES) return NextResponse.json({ ok: false }, { status: 413 })
  let body: OmieWebhookBody | null = null
  try {
    body = JSON.parse(texto) as OmieWebhookBody
  } catch {
    body = null
  }

  const supabase = createServiceClient()

  if (!body?.messageId || !body?.appKey) {
    return NextResponse.json({ ok: true })
  }

  // is_test=false: webhook da Omie sempre pertence à loja real -- a gêmea de
  // teste reusa a mesma omie_app_key (pra leitura), então sem esse filtro a
  // query deixa de ser única (2 lojas com a mesma chave) e maybeSingle()
  // falha, descartando o webhook em silêncio.
  const { data: loja, error } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('omie_app_key', body.appKey)
    .eq('ativo', true)
    .eq('is_test', false)
    .maybeSingle<LojaOmie>()

  if (error) {
    console.error('Erro ao resolver loja do webhook Omie:', error)
    return NextResponse.json({ ok: true })
  }
  if (!loja) return NextResponse.json({ ok: true })

  // Deduplicacao por messageId
  const { data: existing } = await supabase
    .from('webhooks')
    .select('id')
    .eq('loja_id', loja.id)
    .eq('message_id', body.messageId)
    .maybeSingle()

  if (existing) return NextResponse.json({ ok: true })

  const topic = body.topic ?? ''
  if (IGNORED_TOPICS.some((t) => topic.startsWith(t))) {
    return NextResponse.json({ ok: true })
  }

  await supabase.from('webhooks').insert({
    loja_id: loja.id,
    message_id: body.messageId,
    message: body,
  })

  // Dual-write pro Contabo (historico completo, sem prune) -- fire-and-forget,
  // nunca bloqueia nem quebra a resposta do webhook se falhar.
  if (process.env.NTB_FRIO_API_URL) {
    fetch(`${process.env.NTB_FRIO_API_URL}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.NTB_FRIO_API_KEY! },
      body: JSON.stringify({ loja_id: loja.id, message_id: body.messageId, message: body }),
    }).catch((e) => console.error('Dual-write pro Contabo falhou:', e))
  }

  // Processa por topico. Erros nao quebram a resposta 200 (Omie reenvia se 5xx).
  try {
    if (topic.startsWith('RecebimentoProduto.')) {
      // Antes lia event.nIdReceb (que o Omie não manda) e nunca relia a nota. Agora só em conclusão/reversão (o que
      // muda associação do item e etapa), nunca na loja 4 nem na 7 (OMIE_NF_RELEITURA_LOJAS_FORA); aviso perdido é
      // retomado pelo cron sync-nfs (relerNotasComAvisoPendente).
      const nIdReceb = nIdRecebDoAviso(body)
      if (nIdReceb && deveRelerNota(topic) && !lojasForaDaReleitura(process.env.OMIE_NF_RELEITURA_LOJAS_FORA).has(loja.id)) {
        await fetchNotaFiscal(loja, nIdReceb, { semRepetir: true })
      }
    } else if (topic.startsWith('OrdemProducao.') && topic !== 'OrdemProducao.Excluida' && body.event?.nCodOP) {
      // Só loja com `omie_op_tempo_real` (migration 250; até 20/10 era `espelho_completo !== false`, o que tirava
      // TODAS as lojas sem a flag): uma escrita gera 3-4 avisos (Incluida/Alterada/Concluida) e as consultas repetidas
      // da mesma OP bloqueiam a API da loja (MISUSE, 16/10, faxina da loja 5). O sync de OPs (cron) continua
      // atualizando o espelho. Ligar o espelho completo (D5) não liga esta consulta.
      if (await lojaOpTempoReal(loja.id)) await fetchOrdemProducao(loja, body.event.nCodOP)
    } else if (topic.startsWith('LocalEstoque.')) {
      await syncLocaisEstoque(loja)
    }
  } catch (e) {
    console.error('Erro processando webhook Omie:', e)
  }

  return NextResponse.json({ ok: true })
}
