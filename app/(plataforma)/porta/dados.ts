import { createClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { NAO_CANCELADA_OR } from '@/lib/nf-status'
import { hojeBahiaISO } from '@/lib/data-bahia'

// Porta da Norte: resumo do dia com consultas baratas (as mesmas da /home). Cada linha é opcional: erro ou demora
// vira "sem linha", nunca derruba a página.

const LIMITE_MS = 3500

async function opcional<T>(nome: string, fn: () => PromiseLike<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(fn()),
      new Promise<null>((ok) => { timer = setTimeout(() => ok(null), LIMITE_MS) }),
    ])
  } catch (e) {
    console.error(`[porta] ${nome} falhou:`, e)
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type ResumoPorta = {
  notasPendentes: number | null
  abaixoMinimo: number | null
  evento: { id: number; nome: string; data: string | null; convidados: number } | null
}

export async function carregarResumoPorta(lojaId: number | null, quer: { erp: boolean; cozinha: boolean }): Promise<ResumoPorta> {
  if (lojaId == null) return { notasPendentes: null, abaixoMinimo: null, evento: null }
  const supabase = await createClient()
  const hoje = hojeBahiaISO()
  const [y, m, d] = hoje.split('-').map(Number)
  const ontem = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
  const primeiroDiaMes = `${hoje.slice(0, 7)}-01`

  const [notasPendentes, abaixoMinimo, evento] = await Promise.all([
    // Mesma regra do alerta da /home: notas do mês até ontem que não chegaram à etapa 60 (entrada concluída).
    quer.erp
      ? opcional('notas pendentes', async () => {
          const { count, error } = await supabase
            .from('notas_fiscais')
            .select('id', { count: 'exact', head: true })
            .eq('loja_id', lojaId)
            .is('deleted_at', null)
            .neq('c_etapa', '60')
            .or(NAO_CANCELADA_OR)
            .gte('d_emissao_nfe', primeiroDiaMes)
            .lte('d_emissao_nfe', ontem)
          if (error) throw new Error(error.message)
          return count ?? 0
        })
      : null,
    // Mesma lista da /home ("produtos abaixo do mínimo para repor").
    quer.erp
      ? opcional('abaixo do mínimo', async () => {
          let erro: string | null = null
          const codigos = await rpcTodos<number>(supabase, 'produtos_repor', { p_loja_id: lojaId }, (e) => { erro = e.message })
          if (erro) throw new Error(erro)
          return codigos.length
        })
      : null,
    quer.cozinha
      ? opcional('próximo evento', async () => {
          const { data, error } = await supabase
            .from('custo_eventos')
            .select('id, nome, data_evento, convidados')
            .eq('loja_id', lojaId)
            .eq('status', 'confirmado')
            .is('finalizado_em', null)
            .gte('data_evento', hoje)
            .order('data_evento', { ascending: true })
            .limit(1)
            .maybeSingle<{ id: number; nome: string; data_evento: string | null; convidados: number }>()
          if (error) throw new Error(error.message)
          return data ? { id: data.id, nome: data.nome, data: data.data_evento, convidados: data.convidados } : null
        })
      : null,
  ])
  return { notasPendentes, abaixoMinimo, evento }
}

export type LojaDaPorta = { id: number; nome: string }

/** Mesma regra do seletor do ERP (app/(app)/layout.tsx): Admin vê toda loja ativa; os outros, só as suas e nunca as de teste. */
export async function lojasDoUsuario(profileId: string, isAdmin: boolean): Promise<LojaDaPorta[]> {
  const r = await opcional('lojas', async () => {
    const supabase = await createClient()
    let q = supabase.from('lojas').select('id, nome, nome_fantasia').eq('ativo', true).order('nome_fantasia')
    if (!isAdmin) {
      const { data: vinculos } = await supabase.from('loja_user').select('loja_id').eq('user_id', profileId)
      const ids = [...new Set((vinculos ?? []).map((v) => v.loja_id).filter((v): v is number => v != null))]
      q = q.eq('is_test', false).in('id', ids.length ? ids : [-1])
    }
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []).map((l) => ({ id: l.id as number, nome: (l.nome_fantasia as string | null) || (l.nome as string) }))
  })
  return r ?? []
}
