import Anthropic from '@anthropic-ai/sdk'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { criarLimitador } from '@/lib/seguranca/regras'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { criarContexto, executar, FERRAMENTAS, responderRapido } from '@/lib/custo-cardapio/pacioli-ferramentas'
import {
  acaoDaFerramenta, interpretarPergunta, LIMITES, SISTEMA_FIXO, sistemaDaLoja, validarEntrada, validarHistorico, type AcaoPacioli,
} from '@/lib/custo-cardapio/pacioli-puro'

// Pacioli: conversa com o assistente da cozinha. POST só (sem server action), só desenvolvedor e quem gere a loja.
// { modo: 'rapido', pergunta } → resposta pronta calculada aqui, sem modelo (funciona sem chave).
// { modo: 'conversa', mensagens } → Claude com ferramentas SÓ DE LEITURA; resposta em NDJSON (uma linha por evento):
//   { t: 'acao', v } troca a animação do mascote · { t: 'texto', v } pedaço da resposta · { t: 'fim', acao } · { t: 'erro', v, codigo }
// Sem ANTHROPIC_API_KEY a conversa responde 503 { codigo: 'sem_chave' } e a tela fica no modo rápido.

const MODELO = process.env.PACIOLI_MODELO || 'claude-sonnet-5-5'
const MAX_VOLTAS = 6
const conversaExcedeu = criarLimitador(20, 5 * 60_000)
const rapidoExcedeu = criarLimitador(60, 5 * 60_000)

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
const erro = (status: number, codigo: string, mensagem: string) => json({ codigo, mensagem }, status)

export async function POST(req: Request) {
  // notFound()/redirect() lançam: aqui viram 404/401 em vez de página.
  try { await exigirDev() } catch { return erro(404, 'nao_encontrado', 'Não encontrado.') }
  let atorId: string
  let lojaId: number
  try {
    const ator = await getAtorGestao()
    if (!ator.podeGerir) return erro(404, 'nao_encontrado', 'Não encontrado.')
    atorId = ator.id
    lojaId = await getCurrentLojaId()
  } catch {
    return erro(401, 'sem_sessao', 'Entre de novo no sistema.')
  }

  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return erro(415, 'formato', 'Envie JSON.')
  const bruto = await req.text()
  if (bruto.length > 60_000) return erro(413, 'grande_demais', 'Conversa longa demais. Comece uma nova.')
  let corpo: Record<string, unknown>
  try { corpo = JSON.parse(bruto) } catch { return erro(400, 'formato', 'Pedido inválido.') }

  // ------------------------------------------------ modo rápido: sem modelo
  if (corpo.modo === 'rapido') {
    if (rapidoExcedeu(atorId)) return erro(429, 'limite', 'Muitas perguntas seguidas. Espere um pouco.')
    const pergunta = typeof corpo.pergunta === 'string' ? corpo.pergunta.trim().slice(0, LIMITES.caracteresPergunta) : ''
    const intencao = interpretarPergunta(pergunta)
    if (!intencao) {
      return json({ acao: '14-nao-entendi', texto: 'No modo rápido eu respondo perguntas como as sugestões: pratos acima da meta, preço de um prato no salão ou no delivery, um insumo subindo X%, o insumo que mais pesa, onde um insumo é usado e o saldo de um insumo.' })
    }
    const base = await carregarBase(lojaId)
    if (!base) return erro(409, 'sem_estoque', 'Esta loja não controla estoque: não há fichas nem custos para consultar.')
    return json(await responderRapido(criarContexto(base), intencao))
  }

  // ------------------------------------------------ conversa com o modelo
  if (corpo.modo !== 'conversa') return erro(400, 'formato', 'Pedido inválido.')
  const chave = process.env.ANTHROPIC_API_KEY
  if (!chave) return erro(503, 'sem_chave', 'A conversa liga quando a chave da Anthropic for configurada no servidor.')
  const hist = validarHistorico(corpo.mensagens)
  if ('erro' in hist) return erro(400, 'historico', hist.erro)
  if (conversaExcedeu(atorId)) return erro(429, 'limite', 'Muitas perguntas seguidas. Espere uns minutos ou use as perguntas rápidas.')
  const base = await carregarBase(lojaId)
  if (!base) return erro(409, 'sem_estoque', 'Esta loja não controla estoque: não há fichas nem custos para consultar.')

  const ctx = criarContexto(base)
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: SISTEMA_FIXO, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: sistemaDaLoja({ taxas: base.taxas, modo: base.modo, dataCusto: base.dataCusto, pratos: ctx.linhas.length, hoje }) },
  ]
  const messages: Anthropic.Beta.BetaMessageParam[] = hist.mensagens.map((m) => ({ role: m.papel === 'usuario' ? 'user' : 'assistant', content: m.texto }))
  const client = new Anthropic({ apiKey: chave, maxRetries: 1, timeout: 90_000 })
  const cod = new TextEncoder()

  const corpoResposta = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fechado = false
      const enviar = (ev: Record<string, unknown>) => { if (!fechado) { try { controller.enqueue(cod.encode(JSON.stringify(ev) + '\n')) } catch { fechado = true } } }
      let falou = false, separar = false, tudoCerto = false
      let fim: AcaoPacioli = '03-tudo-certo'
      try {
        let tentativasJson = 0
        for (let volta = 0; volta < MAX_VOLTAS; volta++) {
          const stream = client.beta.messages.stream({
            model: MODELO, max_tokens: 16000, system, tools: FERRAMENTAS, messages,
            output_config: { effort: 'low' },
            // Recusa por engano do classificador: a própria API refaz no modelo reserva.
            betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
            cache_control: { type: 'ephemeral' },
          }, { signal: req.signal })
          stream.on('text', (delta) => {
            if (!delta) return
            if (!falou) { enviar({ t: 'acao', v: '12-falando' }); falou = true }
            if (separar) { enviar({ t: 'texto', v: '\n\n' }); separar = false }
            enviar({ t: 'texto', v: delta })
          })
          let msg: Anthropic.Beta.BetaMessage
          try {
            msg = await stream.finalMessage()
            tentativasJson = 0
          } catch (e) {
            // Só a entrada de ferramenta que não deu para ler é repetida; erro da API sobe.
            if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIUserAbortError || tentativasJson++ >= 2) throw e
            continue
          }
          if (msg.stop_reason === 'refusal') { enviar({ t: 'texto', v: (falou ? '\n\n' : '') + 'Não posso ajudar com isso. Pergunte sobre custo, cardápio ou estoque da cozinha.' }); fim = '14-nao-entendi'; break }
          if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: msg.content }); continue }
          const usos = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
          if (!usos.length) break
          if (msg.stop_reason === 'max_tokens') break
          messages.push({ role: 'assistant', content: msg.content })
          if (falou) separar = true
          const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = []
          for (const u of usos) {
            enviar({ t: 'acao', v: acaoDaFerramenta(u.name) })
            const entrada = validarEntrada(u.name, u.input)
            if ('erro' in entrada) { resultados.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: entrada.erro }); continue }
            const r = await executar(ctx, entrada)
            if (entrada.ferramenta === 'pratos_acima_da_meta' && r && typeof r === 'object' && 'total' in r && r.total === 0) tudoCerto = true
            const erroR = r && typeof r === 'object' && 'erro' in r
            resultados.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r), ...(erroR ? { is_error: true } : {}) })
          }
          messages.push({ role: 'user', content: resultados })
          if (volta === MAX_VOLTAS - 1) enviar({ t: 'texto', v: (falou ? '\n\n' : '') + 'Essa pergunta pediu contas demais de uma vez. Tente dividir em partes.' })
        }
        if (!falou) enviar({ t: 'texto', v: 'Não consegui montar uma resposta. Tente perguntar de outro jeito.' })
        enviar({ t: 'fim', acao: tudoCerto ? '40-comemorando' : fim })
      } catch (e) {
        if (e instanceof Anthropic.APIUserAbortError || req.signal.aborted) { /* a pessoa saiu ou parou */ }
        else {
          const status = e instanceof Anthropic.APIError ? e.status : undefined
          console.error('pacioli: conversa falhou', status ?? (e instanceof Error ? e.name : 'erro'))
          const [codigo, v] =
            e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError ? ['chave_invalida', 'A chave da Anthropic do servidor não foi aceita. Use as perguntas rápidas enquanto isso.']
              : e instanceof Anthropic.RateLimitError ? ['ocupado', 'O serviço está ocupado. Tente de novo em instantes.']
                : ['falha', 'Não consegui responder agora. Tente de novo ou use as perguntas rápidas.']
          enviar({ t: 'erro', codigo, v })
        }
      } finally {
        fechado = true
        try { controller.close() } catch { /* já fechado */ }
      }
    },
  })

  return new Response(corpoResposta, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      // nginx do servidor: sem buffer, senão a resposta chega toda de uma vez no fim.
      'X-Accel-Buffering': 'no',
    },
  })
}
