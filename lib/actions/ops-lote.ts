'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

// "Nosso Omie" Fase 4: concluir / excluir / mudar a data de OPs em lote a partir de /ordem-producao/abertas.
// A tela chama UMA OP por vez (uma escrita no Omie por vez, para no primeiro bloqueio do Omie e cabe no corte de
// 60 s do nginx). Cada chamada delega às actions de sempre (finishOP, excluirOP, setDataOP), que conferem a
// permissão específica (Concluir/Excluir/Editar) e a loja; aqui entram a permissão "OP - Acoes em lote", o bloqueio
// da loja 4, a OP ainda aberta e a trava por OP (duas abas não mexem na mesma OP ao mesmo tempo).

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { contextoEscritaOmie } from '@/lib/estoque/contexto-escrita-omie'
import { ehLimiteOmie, selecionarLoteOPs } from '@/lib/estoque/escrita-omie-puro'
import { pegarTravaSync, soltarTravaSync } from '@/lib/omie/trava-sync'
import { registrarAuditoria } from '@/lib/auditoria'
import { excluirOP, finishOP, setDataOP } from '@/lib/actions/ordem-producao'

export type AcaoLoteOP = 'concluir' | 'excluir' | 'data'
export type RespostaLoteOP = { ok: true; simulado?: boolean } | { error: string; parar: boolean }

type OPRow = { id: number; identificacao_n_cod_op: number | null; concluida: boolean | null; aberta_omie?: boolean | null }

export async function acaoOPLote(input: { acao: AcaoLoteOP; opId: number; dataISO?: string | null }): Promise<RespostaLoteOP> {
  const __d = viaDesktop('ops-lote#acaoOPLote', acaoOPLote, [input]); if (__d) return __d as never
  const ctx = await contextoEscritaOmie('OP - Acoes em lote')
  if ('error' in ctx) return { error: ctx.error, parar: true }
  if (!['concluir', 'excluir', 'data'].includes(input.acao)) return { error: 'Ação inválida.', parar: true }
  if (input.acao === 'data' && !/^\d{4}-\d{2}-\d{2}$/.test(input.dataISO ?? '')) return { error: 'Escolha a data nova.', parar: true }

  const supabase = createServiceClient()
  let { data: op, error } = await supabase.from('ordens_producao').select('id, identificacao_n_cod_op, concluida, aberta_omie')
    .eq('id', input.opId).eq('loja_id', ctx.lojaId).maybeSingle<OPRow>()
  if (error) {
    // Migration 160 não aplicada: sem aberta_omie.
    ({ data: op, error } = await supabase.from('ordens_producao').select('id, identificacao_n_cod_op, concluida')
      .eq('id', input.opId).eq('loja_id', ctx.lojaId).maybeSingle<OPRow>())
  }
  if (error) return { error: `Não foi possível ler a OP: ${error.message}`, parar: false }
  const sel = selecionarLoteOPs(op ? [{
    id: Number(op.id), nCodOP: op.identificacao_n_cod_op == null ? null : Number(op.identificacao_n_cod_op),
    aberta: op.concluida !== true && op.aberta_omie !== false,
  }] : [], [input.opId])
  if (!sel.validas.length) return { error: sel.ignoradas[0]?.motivo ?? 'OP inválida.', parar: false }

  const trava = `op:${input.opId}`
  if (!(await pegarTravaSync(ctx.lojaId, trava, 120))) return { error: 'Esta OP já está sendo alterada (outra aba ou pessoa). Tente de novo em instantes.', parar: false }
  try {
    const r = input.acao === 'concluir' ? await finishOP(input.opId, input.dataISO && /^\d{4}-\d{2}-\d{2}$/.test(input.dataISO) ? input.dataISO : null)
      : input.acao === 'excluir' ? await excluirOP(input.opId)
      : await setDataOP(input.opId, input.dataISO!)
    if ('error' in r && r.error) return { error: r.error, parar: ehLimiteOmie(r.error) }
    if (input.acao === 'concluir') {
      // Some da lista na hora (o cron sync-ops-abertas confirma depois). Sem a coluna (160), ignora.
      await supabase.from('ordens_producao').update({ aberta_omie: false }).eq('id', input.opId).eq('loja_id', ctx.lojaId)
      await registrarAuditoria('concluir', 'ordem de produção', op?.identificacao_n_cod_op ?? input.opId, 'OP concluída em lote (OPs abertas)')
    }
    revalidatePath('/ordem-producao/abertas')
    revalidatePath('/estoque/correcoes')
    return { ok: true, simulado: ctx.loja.is_test }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { error: msg, parar: ehLimiteOmie(msg) }
  } finally {
    await soltarTravaSync(ctx.lojaId, trava)
  }
}
