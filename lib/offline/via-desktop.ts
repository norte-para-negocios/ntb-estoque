// Primeira linha de toda server action (`const __d = viaDesktop(nome, fn, [params]); if (__d) return __d as never`).
// No servidor de produção não faz nada (NTB_MODO_LOCAL não existe lá). No app desktop decide,
// pela política da ação (lib/offline/politica.ts), se ela roda no banco local, vai ao servidor
// pelo gateway (processo principal do Electron, que guarda o token real) ou entra na fila offline.
import { revalidatePath } from 'next/cache'
import { notFound, redirect, RedirectType } from 'next/navigation'
import { comContexto, contextoOffline } from './contexto'
import { modoEfetivo, politicaDe, type ModoOffline } from './politica'
import { desserializarValor, lerDigest, serializarArgs, serializarValor, type Json } from './serializacao'

type Acao = (...a: never[]) => Promise<unknown>

export function viaDesktop(nome: string, fn: Acao, args: unknown[]): Promise<never> | undefined {
  if (process.env.NTB_MODO_LOCAL !== '1') return undefined
  if (contextoOffline()?.local) return undefined // já é a execução local desta ação
  const modo = politicaDe(nome)
  if (modo === 'leitura') return undefined
  return executar(nome, fn, args, modo) as Promise<never>
}

type RespostaGateway =
  | { tipo: 'remoto'; resultado: { ok: boolean; erro?: string; valor?: Json; redirect?: { url: string; modo: 'push' | 'replace' }; notFound?: boolean } }
  | { tipo: 'executar_local' }
  | { tipo: 'enfileirado' }
  | { tipo: 'erro'; erro: string }

async function gateway(caminho: string, corpo: unknown): Promise<RespostaGateway> {
  const porta = process.env.NTB_GATEWAY_PORTA ?? '54398'
  const r = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ntb-token': process.env.NTB_GATEWAY_TOKEN ?? '' },
    body: JSON.stringify(corpo),
  })
  if (!r.ok) return { tipo: 'erro', erro: 'Falha interna do app. Feche e abra de novo.' }
  return r.json()
}

async function lojaAtualPropria(): Promise<boolean> {
  const { getCurrentLojaId } = await import('@/lib/auth')
  const { modoDaLoja } = await import('@/lib/estoque/ledger')
  return (await modoDaLoja(await getCurrentLojaId())) === 'proprio'
}

async function executar(nome: string, fn: Acao, args: unknown[], modo: ModoOffline | null): Promise<unknown> {
  const efetivo = modo === 'depende' ? modoEfetivo(modo, await lojaAtualPropria()) : modo
  const intentId = crypto.randomUUID()
  const resp = await gateway('/__ntb/acao', { intentId, acao: nome, args: await serializarArgs(args), modo: efetivo })

  if (resp.tipo === 'erro') return { error: resp.erro }

  if (resp.tipo === 'enfileirado') {
    revalidatePath('/', 'layout')
    return {}
  }

  if (resp.tipo === 'executar_local') {
    try {
      const valor = await comContexto({ intentId, local: true }, () => fn(...(args as never[])))
      await gateway('/__ntb/resultado-local', { intentId, ok: true, valor: await serializarValor(valor) })
      return valor
    } catch (e) {
      const interrupcao = lerDigest(e)
      await gateway('/__ntb/resultado-local', {
        intentId,
        ok: interrupcao !== null,
        valor: interrupcao ? { __interrupcao: interrupcao as unknown as Json } : null,
        erro: interrupcao ? undefined : e instanceof Error ? e.message : 'erro',
      })
      throw e
    }
  }

  const r = resp.resultado
  if (!r.ok) return { error: r.erro ?? 'Não foi possível concluir.' }
  revalidatePath('/', 'layout')
  if (r.redirect) redirect(r.redirect.url, r.redirect.modo === 'push' ? RedirectType.push : RedirectType.replace)
  if (r.notFound) notFound()
  return desserializarValor(r.valor ?? null)
}
