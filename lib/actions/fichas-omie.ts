'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

// "Nosso Omie" Fase 4: trocar um insumo por outro nas fichas técnicas do Omie (ex.: Coca → Pepsi), UM prato por
// chamada (a tela chama em sequência e para no primeiro erro). Por prato: ler a ficha ao vivo → IncluirEstrutura do
// novo (com intMalha) → reler → ExcluirEstrutura do antigo → reler. AlterarEstrutura NÃO troca o produto do item
// (provado no Omie real em 10/10). Loja 4 bloqueada; loja de teste: escritas simuladas, sem releitura.

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { contextoEscritaOmie } from '@/lib/estoque/contexto-escrita-omie'
import { conferirAntesDaTroca, conferirTroca, intMalhaDaTroca, montarTrocas, type ItemLido } from '@/lib/estoque/escrita-omie-puro'
import { consultarEstrutura, excluirEstrutura, incluirItemEstrutura, type EstruturaItem } from '@/lib/omie/malha'
import { gravarFichaLida } from '@/lib/omie/fichas'
import { pegarTravaSync, soltarTravaSync } from '@/lib/omie/trava-sync'
import { registrarAuditoria } from '@/lib/auditoria'

export type EtapaTroca = 'nada_feito' | 'incluido_sem_excluir' | 'nao_confirmado'
export type RespostaTroca = { ok: true; simulado: boolean; quantidade: number } | { error: string; etapa: EtapaTroca; parar: boolean }

const PAUSA_MS = 1500
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e))
const lidos = (itens: EstruturaItem[] | undefined): ItemLido[] =>
  (itens ?? []).map((i) => ({ idMalha: Number(i.idMalha), idProdMalha: Number(i.idProdMalha), quantProdMalha: Number(i.quantProdMalha), percPerdaProdMalha: Number(i.percPerdaProdMalha ?? 0) }))

export async function trocarInsumoNoPrato(input: { de: number; para: number; quantidadeFixa: number | null; produto: number }): Promise<RespostaTroca> {
  const __d = viaDesktop('fichas-omie#trocarInsumoNoPrato', trocarInsumoNoPrato, [input]); if (__d) return __d as never
  const falha = (error: string, etapa: EtapaTroca = 'nada_feito', parar = true): RespostaTroca => ({ error, etapa, parar })
  const ctx = await contextoEscritaOmie('Fichas - Trocar insumo')
  if ('error' in ctx) return falha(ctx.error)
  const { loja, lojaId } = ctx
  const { de, para, produto } = input
  if (![de, para, produto].every((n) => Number.isSafeInteger(n) && n > 0)) return falha('Produto inválido.')
  if (de === para) return falha('O insumo novo é igual ao antigo.')
  const fixa = input.quantidadeFixa
  if (fixa != null && !(Number.isFinite(fixa) && fixa > 0 && fixa < 1e6)) return falha('Quantidade inválida.')

  const supabase = createServiceClient()
  // Loja de teste não tem fichas lidas (crons a excluem): usa as da loja real de origem, só leitura.
  const lojaFicha = loja.is_test ? (loja.loja_origem_id ?? lojaId) : lojaId
  const { data: novo } = await supabase.from('produtos').select('codigo_produto, descricao, inativo, tipo_item')
    .eq('loja_id', lojaFicha).eq('codigo_produto', para).maybeSingle<{ codigo_produto: number; descricao: string | null; inativo: boolean | null; tipo_item: string | null }>()
  if (!novo) return falha('O insumo novo não está cadastrado nesta loja.')
  if (novo.inativo) return falha('O insumo novo está inativo.')

  type CacheRow = { codigo_produto: number; codigo_produto_insumo: number; quantidade: number; percentual_perda: number | null; id_malha?: number | null }
  const lerCache = (cols: string) => supabase.from('estrutura_produto_cache').select(cols)
    .eq('loja_id', lojaFicha).eq('codigo_produto', produto).order('id') as unknown as PromiseLike<{ data: CacheRow[] | null; error: { message: string } | null }>
  let { data: cache, error: errCache } = await lerCache('codigo_produto, codigo_produto_insumo, quantidade, percentual_perda, id_malha')
  // Sem a migration 160 (coluna id_malha): lê sem ela.
  if (errCache) ({ data: cache, error: errCache } = await lerCache('codigo_produto, codigo_produto_insumo, quantidade, percentual_perda'))
  if (errCache) return falha(`Não foi possível ler a ficha: ${errCache.message}`)
  const linhas = cache ?? []
  const troca = montarTrocas(linhas.map((r) => ({ produto: Number(r.codigo_produto), insumo: Number(r.codigo_produto_insumo), quantidade: Number(r.quantidade), perda: Number(r.percentual_perda ?? 0) })), de, para, fixa)
    .find((t) => t.produto === produto)
  if (!troca) return falha('Este prato não usa mais o insumo antigo (atualize a prévia).', 'nada_feito', false)
  if (troca.jaTemNovo) return falha('Este prato já tem o insumo novo na ficha: confira no Omie.', 'nada_feito', false)

  const trava = `ficha:${produto}`
  if (!(await pegarTravaSync(lojaId, trava, 180))) return falha('Esta ficha já está sendo alterada (outra aba ou pessoa).', 'nada_feito', false)
  const intMalha = intMalhaDaTroca(Date.now(), Math.random())
  const descricao = `troca de insumo ${de} → ${para} no prato ${produto}`
  try {
    if (loja.is_test) {
      // Simulado: o omieRequest não chama o Omie (escrita) e a releitura do Omie real não veria nada.
      const idMalhaCache = Number(linhas.find((r) => Number(r.codigo_produto_insumo) === de)?.id_malha ?? 0)
      await incluirItemEstrutura(loja, produto, { intMalha, idProdMalha: para, quantProdMalha: troca.quantidadeNova, percPerdaProdMalha: troca.perda })
      await excluirEstrutura(loja, produto, idMalhaCache)
      await registrarAuditoria('editar', 'ficha técnica', produto, `[simulado] ${descricao} (${troca.quantidadeNova})`)
      return { ok: true, simulado: true, quantidade: troca.quantidadeNova }
    }

    // 1. Ficha ao vivo: o antigo está lá (1 vez) e o novo ainda não.
    let est
    try { est = await consultarEstrutura(loja, produto, { semRepetir: true }) } catch (e) { return falha(`Não foi possível ler a ficha no Omie: ${msgDe(e)}`, 'nada_feito', true) }
    const antes = conferirAntesDaTroca(lidos(est?.itens), de, para)
    if (!antes.ok) return falha(antes.motivo, 'nada_feito', false)
    const quantidade = fixa ?? Number(antes.antigo.quantProdMalha)
    const perda = Number(antes.antigo.percPerdaProdMalha ?? 0)

    // 2. Inclui o novo.
    await dormir(PAUSA_MS)
    try {
      await incluirItemEstrutura(loja, produto, { intMalha, idProdMalha: para, quantProdMalha: quantidade, percPerdaProdMalha: perda })
    } catch (e) {
      const m = msgDe(e)
      // Sem resposta (timeout), o Omie pode ter gravado: não dá para afirmar que nada mudou.
      return falha(`O Omie recusou incluir o insumo novo: ${m}`, /não respondeu|TIMEOUT/i.test(m) ? 'nao_confirmado' : 'nada_feito', true)
    }
    await dormir(PAUSA_MS)
    let depoisInc
    try { depoisInc = await consultarEstrutura(loja, produto, { semRepetir: true }) } catch (e) { return falha(`Insumo novo incluído, mas não deu para reler a ficha: ${msgDe(e)}. Confira no Omie (pode estar com os dois).`, 'nao_confirmado') }
    const c1 = conferirTroca('incluido', lidos(depoisInc?.itens), de, para, quantidade)
    if (!c1.ok) return falha(`Depois de incluir: ${c1.motivo}`, 'nao_confirmado')

    // 3. Exclui o antigo (pelo idMalha lido ao vivo).
    await dormir(PAUSA_MS)
    try {
      await excluirEstrutura(loja, produto, antes.antigo.idMalha)
    } catch (e) {
      return falha(`O insumo novo entrou, mas o Omie recusou excluir o antigo: ${msgDe(e)}. A ficha está com OS DOIS: exclua o antigo no Omie.`, 'incluido_sem_excluir')
    }
    await dormir(PAUSA_MS)
    let depoisExc
    try { depoisExc = await consultarEstrutura(loja, produto, { semRepetir: true }) } catch (e) { return falha(`Antigo excluído, mas não deu para reler a ficha: ${msgDe(e)}. Confira no Omie.`, 'nao_confirmado') }
    const itensFinais = depoisExc?.itens ?? []
    const c2 = conferirTroca('excluido', lidos(itensFinais), de, para, quantidade)
    if (!c2.ok) return falha(`Depois de excluir: ${c2.motivo}`, 'nao_confirmado')

    // 4. Espelho da ficha atualizado na hora (o cron relê a cada 7 dias).
    try {
      const cods = [...new Set(itensFinais.map((i) => Number(i.idProdMalha)))]
      const { data: tipos } = await supabase.from('produtos').select('codigo_produto, tipo_item').eq('loja_id', lojaId).in('codigo_produto', cods)
      await gravarFichaLida(supabase, lojaId, produto, itensFinais, new Map((tipos ?? []).map((t) => [Number(t.codigo_produto), t.tipo_item as string | null])))
    } catch (e) {
      console.error(`[trocarInsumo] ficha ${produto} trocada no Omie, espelho não atualizado: ${msgDe(e)}`)
    }
    await registrarAuditoria('editar', 'ficha técnica', produto, `${descricao} (${quantidade})`)
    revalidatePath('/estoque/fichas')
    return { ok: true, simulado: false, quantidade }
  } catch (e) {
    const m = msgDe(e)
    return falha(m, 'nao_confirmado')
  } finally {
    await soltarTravaSync(lojaId, trava)
  }
}
