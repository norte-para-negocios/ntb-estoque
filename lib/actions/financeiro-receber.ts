'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'
import { guardaModulo } from '@/lib/plataforma/guarda'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getProfile, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { exigirDevAcao } from '@/lib/recursos-dev'
import { PERM } from '@/lib/financeiro/dados'
import { paraCentavos } from '@/lib/financeiro/titulo-puro'
import { MAX_DIAS_GERACAO, validarFormaRecebimento, type FormaRecebimento } from '@/lib/financeiro/receber-vendas-puro'

// Contas a receber das vendas do Norte Vendas (migration 380). Só desenvolvedores, só loja de estoque próprio, sempre depois da
// permissão. Escrita só pelas funções SQL (security definer, só service role): trava por loja/título e chave de idempotência.
// Nada fala com o Omie, a SEFAZ, a adquirente ou o banco do Vendas: baixa é só REGISTRO. Precisa de internet (fora da política
// offline do desktop, lib/offline/politica.ts).

type Erro = { error: string }
type Ctx = { lojaId: number; userId: string; nome: string }

async function contexto(permissao: string): Promise<Ctx | Erro> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'O financeiro do Norte só existe na loja de estoque próprio.' }
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  const p = await getProfile()
  return { lojaId, userId: p.id, nome: p.name }
}

const FALTA = new Set(['PGRST202', 'PGRST205', '42883', '42P01', '42703'])
const msgErro = (e: { message?: string; code?: string } | null | undefined) => {
  if (e?.code === '22023' && e.message) return e.message
  if (e?.code && FALTA.has(e.code)) return 'As contas a receber ainda não foram ativadas nesta instalação (migration 380).'
  console.error('financeiro-receber:', e?.code, e?.message)
  return 'Não foi possível concluir agora. Tente de novo; se continuar, avise o suporte.'
}

const num = (v: unknown): number => { const c = paraCentavos(v as number | string); return Number.isNaN(c) ? NaN : c / 100 }
const texto = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max)
const dataISO = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : '')
// Taxa % com até 4 casas, vírgula ou ponto decimal ("3,19" / "3.19"). Vazio = 0.
const percentual = (v: unknown): number => {
  const s = String(v ?? '').trim().replace(',', '.')
  if (!s) return 0
  return /^\d{1,2}(\.\d{1,4})?$/.test(s) ? Number(s) : NaN
}

function atualizar() {
  revalidatePath('/financeiro/contas-receber')
  revalidatePath('/financeiro/formas-recebimento')
  revalidatePath('/financeiro/extrato')
  revalidatePath('/financeiro/contas-correntes')
}

export type FormaRecebimentoInput = {
  forma: FormaRecebimento; adquirente?: string; taxaPercentual: string | number; taxaFixa: string | number; prazoDias: string | number
  diasUteis?: boolean; contaId?: number | null; observacao?: string
}

/** Cadastro de uma forma de recebimento da loja atual (adquirente, taxa, prazo, conta de destino). */
export async function salvarFormaRecebimento(input: FormaRecebimentoInput): Promise<{ ok: true; mudou: boolean } | Erro> {
  const __d = viaDesktop('financeiro-receber#salvarFormaRecebimento', salvarFormaRecebimento, [input]); if (__d) return __d as never
  const __g = await guardaModulo('financeiro-receber#salvarFormaRecebimento'); if (__g) return __g as never
  await exigirDevAcao()
  const ctx = await contexto(PERM.contasReceber)
  if ('error' in ctx) return ctx
  const taxaPercentual = percentual(input.taxaPercentual)
  const taxaFixa = String(input.taxaFixa ?? '').trim() === '' ? 0 : num(input.taxaFixa)
  const prazoTxt = String(input.prazoDias ?? '').trim()
  const prazoDias = prazoTxt === '' ? 0 : /^\d+$/.test(prazoTxt) ? Number(prazoTxt) : NaN
  const invalido = validarFormaRecebimento({ forma: input.forma, taxaPercentual, taxaFixa, prazoDias })
  if (invalido) return { error: invalido }
  const { data, error } = await createServiceClient().rpc('fin_forma_recebimento_salvar', {
    p_loja: ctx.lojaId, p_forma: input.forma, p_user: ctx.userId, p_user_nome: ctx.nome,
    p_dados: {
      adquirente: texto(input.adquirente, 60), taxa_percentual: String(taxaPercentual), taxa_fixa: String(taxaFixa), prazo_dias: String(prazoDias),
      dias_uteis: !!input.diasUteis, conta_id: input.contaId ? String(input.contaId) : '', observacao: texto(input.observacao),
    },
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; mudou: boolean }
  if (r.mudou) await registrarAuditoria('editar', 'forma de recebimento', r.id, `${input.forma}: ${taxaPercentual}% + ${taxaFixa}, D+${prazoDias}`)
  atualizar()
  return { ok: true, mudou: !!r.mudou }
}

export type ResultadoGeracao = { criados: number; atualizados: number; iguais: number; cancelados: number; divergentes: number }

/** "Gerar agora" do período (o cron faz o mesmo de hora em hora, nos últimos dias). Só com a chave da loja ligada. */
export async function gerarContasReceberVendas(de: string, ate: string): Promise<({ ok: true } & ResultadoGeracao) | Erro> {
  const __d = viaDesktop('financeiro-receber#gerarContasReceberVendas', gerarContasReceberVendas, [de, ate]); if (__d) return __d as never
  const __g = await guardaModulo('financeiro-receber#gerarContasReceberVendas'); if (__g) return __g as never
  await exigirDevAcao()
  const ctx = await contexto(PERM.contasReceber)
  if ('error' in ctx) return ctx
  const d = dataISO(de), a = dataISO(ate)
  if (!d || !a || d > a) return { error: 'Informe o período das vendas.' }
  if ((Date.parse(a) - Date.parse(d)) / 86400000 > MAX_DIAS_GERACAO) return { error: 'Gere no máximo 93 dias de cada vez.' }
  const { data, error } = await createServiceClient().rpc('fin_receber_vendas_gerar', {
    p_loja: ctx.lojaId, p_de: d, p_ate: a, p_user: ctx.userId, p_user_nome: ctx.nome,
  })
  if (error) return { error: msgErro(error) }
  const r = data as ResultadoGeracao
  if (r.criados || r.atualizados || r.cancelados) await registrarAuditoria('criar', 'contas a receber das vendas', null,
    `${d} a ${a}: ${r.criados} novas, ${r.atualizados} atualizadas, ${r.cancelados} canceladas`)
  atualizar()
  return { ok: true, criados: Number(r.criados) || 0, atualizados: Number(r.atualizados) || 0, iguais: Number(r.iguais) || 0,
    cancelados: Number(r.cancelados) || 0, divergentes: Number(r.divergentes) || 0 }
}

export type RecebimentoInput = { tituloId: number; contaId?: number | null; dataRecebimento?: string; valorRecebido?: string | number; observacao?: string; chave: string }

/** Baixa: valor que a adquirente/banco depositou e a data. Vazio = o líquido previsto. A diferença fica registrada. */
export async function registrarRecebimento(input: RecebimentoInput): Promise<{ ok: true; diferenca: number } | Erro> {
  const __d = viaDesktop('financeiro-receber#registrarRecebimento', registrarRecebimento, [input]); if (__d) return __d as never
  const __g = await guardaModulo('financeiro-receber#registrarRecebimento'); if (__g) return __g as never
  await exigirDevAcao()
  const ctx = await contexto(PERM.receber)
  if ('error' in ctx) return ctx
  if (!texto(input.chave, 100)) return { error: 'Recarregue a tela e tente de novo.' }
  const vazio = String(input.valorRecebido ?? '').trim() === ''
  const valor = vazio ? null : num(input.valorRecebido)
  if (valor !== null && (Number.isNaN(valor) || valor <= 0)) return { error: 'Valor recebido inválido.' }
  const { data, error } = await createServiceClient().rpc('fin_recebimento_registrar', {
    p_loja: ctx.lojaId, p_titulo: Number(input.tituloId), p_user: ctx.userId, p_user_nome: ctx.nome, p_chave: texto(input.chave, 100),
    p_dados: {
      conta_id: input.contaId ? String(input.contaId) : '', data_recebimento: dataISO(input.dataRecebimento),
      valor_recebido: valor === null ? '' : valor.toFixed(2), observacao: texto(input.observacao),
    },
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; duplicado: boolean; diferenca: number }
  if (!r.duplicado) await registrarAuditoria('concluir', 'recebimento de conta a receber', r.id, `Título ${input.tituloId}`)
  atualizar()
  return { ok: true, diferenca: Number(r.diferenca) || 0 }
}

export async function estornarRecebimento(recebimentoId: number, motivo: string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('financeiro-receber#estornarRecebimento', estornarRecebimento, [recebimentoId, motivo]); if (__d) return __d as never
  const __g = await guardaModulo('financeiro-receber#estornarRecebimento'); if (__g) return __g as never
  await exigirDevAcao()
  const ctx = await contexto(PERM.receber)
  if ('error' in ctx) return ctx
  if (texto(motivo).length < 3) return { error: 'Informe o motivo do estorno.' }
  const { data, error } = await createServiceClient().rpc('fin_recebimento_estornar', {
    p_loja: ctx.lojaId, p_recebimento: Number(recebimentoId), p_motivo: texto(motivo), p_user: ctx.userId, p_user_nome: ctx.nome,
  })
  if (error) return { error: msgErro(error) }
  if (!(data as { duplicado?: boolean })?.duplicado) await registrarAuditoria('reverter', 'recebimento de conta a receber', recebimentoId, texto(motivo))
  atualizar()
  return { ok: true }
}
