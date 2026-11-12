'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'
import { guardaModulo } from '@/lib/plataforma/guarda'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getProfile, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { exigirDevAcao } from '@/lib/recursos-dev'
import { nivelAprovacaoUsuario, PERM, semMigration } from '@/lib/financeiro/dados'
import { calcularPagamento, paraCentavos } from '@/lib/financeiro/titulo-puro'
import { selecaoParaGerar } from '@/lib/financeiro/titulos-da-nota-puro'
import { validarConfig } from '@/lib/financeiro/aprovacao-puro'
import { validarRecorrente, type Periodicidade } from '@/lib/financeiro/recorrentes-puro'
import { validarTransferencia } from '@/lib/financeiro/lancamentos-puro'

// Finanças, etapa 1 (migrations 285/286): contas correntes, categorias, contas a pagar e registro de pagamento.
// Só desenvolvedores, só loja de estoque próprio, sempre depois da permissão. Escrita só pelas funções SQL (security definer,
// só service role): cada uma é uma transação com trava no título e chave de idempotência. NENHUMA chamada ao Omie nem a banco:
// pagar é só registrar. Precisa de internet (fora da política offline do desktop, lib/offline/politica.ts).

type Erro = { error: string }
type Ctx = { lojaId: number; userId: string; nome: string }

async function contexto(permissao: string): Promise<Ctx | Erro> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'O financeiro do Norte só existe na loja de estoque próprio.' }
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  const p = await getProfile()
  return { lojaId, userId: p.id, nome: p.name }
}

const msgErro = (e: { message?: string; code?: string } | null | undefined) => {
  if ((e?.code === '22023' || e?.code === 'PF001') && e.message) return e.message
  if (semMigration(e)) return 'O financeiro ainda não foi ativado nesta instalação (migrations 285 e 286).'
  console.error('financeiro:', e?.code, e?.message)
  return 'Não foi possível concluir agora. Tente de novo; se continuar, avise o suporte.'
}

const num = (v: unknown): number => { const c = paraCentavos(v as number | string); return Number.isNaN(c) ? NaN : c / 100 }
const texto = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max)
const dataISO = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : '')

function atualizar() {
  revalidatePath('/financeiro/aprovacoes')
  revalidatePath('/financeiro/recorrentes')
  revalidatePath('/financeiro/lancamentos')
  revalidatePath('/financeiro/contas-pagar')
  revalidatePath('/financeiro/notas-sem-conta')
  revalidatePath('/financeiro/notas-desfeitas')
  revalidatePath('/financeiro/familias')
  revalidatePath('/financeiro/contas-correntes')
  revalidatePath('/financeiro/extrato')
  revalidatePath('/financeiro/categorias')
}

// ------------------------------------------------------------------------------------------------ contas correntes
export type ContaInput = {
  id?: number | null; nome: string; tipo: 'caixa' | 'banco' | 'outro'; banco?: string; agencia?: string; numeroConta?: string
  saldoInicial: number | string; dataSaldoInicial?: string; ativa?: boolean; observacao?: string
}

export async function salvarContaCorrente(input: ContaInput): Promise<{ ok: true; id: number } | Erro> {
  const __d = viaDesktop('financeiro#salvarContaCorrente', salvarContaCorrente, [input]); if (__d) return __d as never
  await guardaModulo('financeiro#salvarContaCorrente')
  await exigirDevAcao()
  const ctx = await contexto(PERM.contasCorrentes)
  if ('error' in ctx) return ctx
  const saldo = num(input.saldoInicial === '' ? 0 : input.saldoInicial)
  if (Number.isNaN(saldo)) return { error: 'Saldo inicial inválido.' }
  const { data, error } = await createServiceClient().rpc('fin_conta_salvar', {
    p_loja: ctx.lojaId, p_id: input.id ?? null, p_user: ctx.userId, p_user_nome: ctx.nome,
    p_dados: {
      nome: texto(input.nome, 80), tipo: input.tipo, banco: texto(input.banco, 80), agencia: texto(input.agencia, 20), numero_conta: texto(input.numeroConta, 30),
      saldo_inicial: saldo, data_saldo_inicial: dataISO(input.dataSaldoInicial) || null, ativa: input.ativa ?? true, observacao: texto(input.observacao),
    },
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; criada: boolean }
  await registrarAuditoria(r.criada ? 'criar' : 'editar', 'conta corrente', r.id, texto(input.nome, 80))
  atualizar()
  return { ok: true, id: r.id }
}

// ----------------------------------------------------------------------------------------------------- categorias
export type CategoriaInput = {
  id?: number | null; codigo?: string; nome: string; tipo: 'despesa' | 'receita'; grupoDre: string; categoriaContabilId?: number | null; ativa?: boolean
}

export async function salvarCategoriaFinanceira(input: CategoriaInput): Promise<{ ok: true; id: number } | Erro> {
  const __d = viaDesktop('financeiro#salvarCategoriaFinanceira', salvarCategoriaFinanceira, [input]); if (__d) return __d as never
  await guardaModulo('financeiro#salvarCategoriaFinanceira')
  await exigirDevAcao()
  const ctx = await contexto(PERM.categorias)
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().rpc('fin_categoria_salvar', {
    p_loja: ctx.lojaId, p_id: input.id ?? null, p_user: ctx.userId, p_user_nome: ctx.nome,
    p_dados: {
      codigo: texto(input.codigo, 20), nome: texto(input.nome, 80), tipo: input.tipo, grupo_dre: input.grupoDre,
      categoria_contabil_id: input.categoriaContabilId ?? null, ativa: input.ativa ?? true,
    },
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; criada: boolean }
  await registrarAuditoria(r.criada ? 'criar' : 'editar', 'categoria financeira', r.id, texto(input.nome, 80))
  atualizar()
  return { ok: true, id: r.id }
}

export async function criarCategoriasPadrao(): Promise<{ ok: true; criadas: number } | Erro> {
  const __d = viaDesktop('financeiro#criarCategoriasPadrao', criarCategoriasPadrao, []); if (__d) return __d as never
  await guardaModulo('financeiro#criarCategoriasPadrao')
  await exigirDevAcao()
  const ctx = await contexto(PERM.categorias)
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().rpc('fin_categorias_semear', { p_loja: ctx.lojaId })
  if (error) return { error: msgErro(error) }
  const criadas = Number(data ?? 0)
  if (criadas > 0) await registrarAuditoria('criar', 'categoria financeira', null, `${criadas} categorias padrão`)
  atualizar()
  return { ok: true, criadas }
}

// ------------------------------------------------------------------------------------------------------- títulos
export type TituloInput = {
  id?: number | null; fornecedorId: number; documento?: string; valor: number | string; dataEmissao?: string; dataVencimento: string
  competencia?: string; categoriaId?: number | null; observacao?: string; chave: string
}

export async function salvarTituloPagar(input: TituloInput): Promise<{ ok: true; id: number; numero: number } | Erro> {
  const __d = viaDesktop('financeiro#salvarTituloPagar', salvarTituloPagar, [input]); if (__d) return __d as never
  await guardaModulo('financeiro#salvarTituloPagar')
  await exigirDevAcao()
  const ctx = await contexto(PERM.contasPagar)
  if ('error' in ctx) return ctx
  const valor = num(input.valor)
  if (!(valor > 0)) return { error: 'Informe um valor maior que zero.' }
  if (!dataISO(input.dataVencimento)) return { error: 'Informe o vencimento.' }
  if (!Number(input.fornecedorId)) return { error: 'Escolha o fornecedor.' }
  const { data, error } = await createServiceClient().rpc('fin_titulo_pagar_salvar', {
    p_loja: ctx.lojaId, p_id: input.id ?? null, p_user: ctx.userId, p_user_nome: ctx.nome, p_chave: input.id ? null : input.chave || null,
    p_dados: {
      fornecedor_id: Number(input.fornecedorId), documento: texto(input.documento, 60), valor, data_emissao: dataISO(input.dataEmissao) || null,
      data_vencimento: input.dataVencimento, data_competencia: texto(input.competencia, 10) || null, categoria_id: input.categoriaId ?? null,
      observacao: texto(input.observacao, 500), origem_tipo: 'manual',
    },
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; numero: number; duplicado: boolean }
  if (!r.duplicado) await registrarAuditoria(input.id ? 'editar' : 'criar', 'conta a pagar', r.id, `Título nº ${r.numero}`)
  atualizar()
  return { ok: true, id: r.id, numero: r.numero }
}

export async function cancelarTituloPagar(id: number, motivo: string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('financeiro#cancelarTituloPagar', cancelarTituloPagar, [id, motivo]); if (__d) return __d as never
  await guardaModulo('financeiro#cancelarTituloPagar')
  await exigirDevAcao()
  const ctx = await contexto(PERM.contasPagar)
  if ('error' in ctx) return ctx
  if (texto(motivo).length < 3) return { error: 'Informe o motivo do cancelamento.' }
  const { data, error } = await createServiceClient().rpc('fin_titulo_pagar_cancelar', {
    p_loja: ctx.lojaId, p_id: Number(id), p_motivo: texto(motivo), p_user: ctx.userId, p_user_nome: ctx.nome,
  })
  if (error) return { error: msgErro(error) }
  if (!(data as { duplicado?: boolean })?.duplicado) await registrarAuditoria('cancelar', 'conta a pagar', id, texto(motivo))
  atualizar()
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------- pagamentos
export type PagamentoInput = {
  tituloId: number; contaId: number; dataPagamento: string; valorPrincipal?: number | string | null
  juros?: number | string; desconto?: number | string; forma?: string; observacao?: string; chave: string
}

export async function registrarPagamentoTitulo(input: PagamentoInput): Promise<{ ok: true; status: string; restante: number } | Erro> {
  const __d = viaDesktop('financeiro#registrarPagamentoTitulo', registrarPagamentoTitulo, [input]); if (__d) return __d as never
  await guardaModulo('financeiro#registrarPagamentoTitulo')
  await exigirDevAcao()
  const ctx = await contexto(PERM.pagar)
  if ('error' in ctx) return ctx
  if (!input.chave) return { error: 'Recarregue a tela e tente de novo.' }
  if (!Number(input.contaId)) return { error: 'Escolha a conta corrente do pagamento.' }
  const vazio = input.valorPrincipal === null || input.valorPrincipal === undefined || input.valorPrincipal === ''
  const principal = vazio ? null : num(input.valorPrincipal)
  const juros = num(input.juros === undefined || input.juros === '' ? 0 : input.juros)
  const desconto = num(input.desconto === undefined || input.desconto === '' ? 0 : input.desconto)
  // Confere as contas antes de ir ao banco (o banco confere de novo, com a trava): mensagem rápida e igual.
  if (Number.isNaN(juros) || Number.isNaN(desconto) || (principal !== null && Number.isNaN(principal))) return { error: 'Valor inválido.' }
  if (juros < 0 || desconto < 0) return { error: 'Juros e desconto não podem ser negativos.' }
  // Com valor informado, confere as contas (o saldo do título só o banco sabe, com a trava). "Quitar tudo" (vazio) vai direto: o banco
  // calcula o principal pelo saldo real e confere desconto, juros e saída.
  if (principal !== null) {
    const pre = calcularPagamento({ restanteCent: Number.MAX_SAFE_INTEGER, principalCent: Math.round(principal * 100), jurosCent: Math.round(juros * 100), descontoCent: Math.round(desconto * 100) })
    if (!pre.ok && !/passa do que falta/.test(pre.erro)) return { error: pre.erro }
  }
  const { data, error } = await createServiceClient().rpc('fin_pagamento_registrar', {
    p_loja: ctx.lojaId, p_titulo: Number(input.tituloId), p_user: ctx.userId, p_user_nome: ctx.nome, p_chave: input.chave,
    p_dados: {
      conta_id: Number(input.contaId), data_pagamento: dataISO(input.dataPagamento) || null, valor_principal: principal,
      juros, desconto, forma: texto(input.forma, 40), observacao: texto(input.observacao, 300),
    },
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; duplicado: boolean; status: string; restante: number }
  if (!r.duplicado) await registrarAuditoria('concluir', 'pagamento de conta a pagar', r.id, `Título ${input.tituloId}`)
  atualizar()
  return { ok: true, status: r.status, restante: Number(r.restante) }
}

export async function estornarPagamentoTitulo(pagamentoId: number, motivo: string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('financeiro#estornarPagamentoTitulo', estornarPagamentoTitulo, [pagamentoId, motivo]); if (__d) return __d as never
  await guardaModulo('financeiro#estornarPagamentoTitulo')
  await exigirDevAcao()
  const ctx = await contexto(PERM.pagar)
  if ('error' in ctx) return ctx
  if (texto(motivo).length < 3) return { error: 'Informe o motivo do estorno.' }
  const { data, error } = await createServiceClient().rpc('fin_pagamento_estornar', {
    p_loja: ctx.lojaId, p_pagamento: Number(pagamentoId), p_motivo: texto(motivo), p_user: ctx.userId, p_user_nome: ctx.nome,
  })
  if (error) return { error: msgErro(error) }
  if (!(data as { duplicado?: boolean })?.duplicado) await registrarAuditoria('reverter', 'pagamento de conta a pagar', pagamentoId, texto(motivo))
  atualizar()
  return { ok: true }
}

// ------------------------------------------------------------------------ conta a pagar gerada pela nota (migration 340)
/** "Gerar agora" na tela da nota (só desenvolvedor). Desde a 360 é geração À MÃO (decisão humana explícita): vale mesmo com
 *  a chave lojas.fin_cp_da_nota_ativo desligada. Sem a 360 aplicada, cai na função da 340 (que respeita a chave).
 *  Idempotente: parcela que já tem conta não é gerada de novo. */
export async function gerarContasPagarDaNota(notaId: number): Promise<{ ok: true; gerados: number; jaExistiam: number; motivo: string | null } | Erro> {
  const __d = viaDesktop('financeiro#gerarContasPagarDaNota', gerarContasPagarDaNota, [notaId]); if (__d) return __d as never
  await guardaModulo('financeiro#gerarContasPagarDaNota')
  await exigirDevAcao()
  const ctx = await contexto(PERM.contasPagar)
  if ('error' in ctx) return ctx
  const db = createServiceClient()
  const args = { p_loja: ctx.lojaId, p_nota: Number(notaId), p_user: ctx.userId, p_user_nome: ctx.nome }
  let { data, error } = await db.rpc('fin_titulos_da_nota_gerar_manual', args)
  if (error && semMigration(error)) ({ data, error } = await db.rpc('fin_titulos_da_nota_gerar', args))
  if (error) return { error: msgErro(error) }
  const r = data as { gerados: number; ja_existiam: number; motivo?: string | null }
  if (r.gerados > 0) await registrarAuditoria('criar', 'conta a pagar', null, `${r.gerados} parcela(s) da nota ${notaId}`)
  atualizar()
  revalidatePath(`/nota-fiscal/${notaId}`)
  return { ok: true, gerados: Number(r.gerados) || 0, jaExistiam: Number(r.ja_existiam) || 0, motivo: r.motivo ?? null }
}

// ------------------------------------------------------------- decisões do dono de 05/11 (migration 360)
const SEM_360 = 'Recurso ainda não ativado nesta instalação (migration 360).'

/** Mapa família → categoria financeira da loja atual (null desliga). A conta da nota leva a categoria da família de maior valor. */
export async function salvarFamiliaCategoria(codigoFamilia: number, categoriaId: number | null): Promise<{ ok: true; mudou: boolean } | Erro> {
  const __d = viaDesktop('financeiro#salvarFamiliaCategoria', salvarFamiliaCategoria, [codigoFamilia, categoriaId]); if (__d) return __d as never
  await guardaModulo('financeiro#salvarFamiliaCategoria')
  await exigirDevAcao()
  const ctx = await contexto(PERM.categorias)
  if ('error' in ctx) return ctx
  if (!Number.isFinite(Number(codigoFamilia))) return { error: 'Família inválida.' }
  const { data, error } = await createServiceClient().rpc('fin_familia_categoria_salvar', {
    p_loja: ctx.lojaId, p_codigo_familia: Number(codigoFamilia), p_categoria: categoriaId ? Number(categoriaId) : null, p_user: ctx.userId, p_user_nome: ctx.nome,
  })
  if (error) return { error: semMigration(error) ? SEM_360 : msgErro(error) }
  const mudou = !!(data as { mudou?: boolean })?.mudou
  if (mudou) await registrarAuditoria('editar', 'categoria por família', Number(codigoFamilia), categoriaId ? `categoria ${categoriaId}` : 'sem categoria')
  atualizar()
  return { ok: true, mudou }
}

export type ResultadoGerarNota = { notaId: number; ok: boolean; gerados: number; mensagem: string | null }
const TETO_GERAR = 50

/** "Gerar contas desta nota" / "Gerar das selecionadas" (tela só dev "Notas sem conta a pagar", todas as lojas próprias). Geração
 *  À MÃO: vale com a chave da loja desligada. Cada nota numa transação; uma nota que falha não para as outras. */
export async function gerarContasNotasSemConta(notaIds: number[]): Promise<{ ok: true; resultados: ResultadoGerarNota[] } | Erro> {
  const __d = viaDesktop('financeiro#gerarContasNotasSemConta', gerarContasNotasSemConta, [notaIds]); if (__d) return __d as never
  await guardaModulo('financeiro#gerarContasNotasSemConta')
  await exigirDevAcao()
  const sel = selecaoParaGerar(Array.isArray(notaIds) ? notaIds : [], TETO_GERAR)
  if (sel.erro) return { error: sel.erro }
  const db = createServiceClient()
  const { data: notas, error: en } = await db.from('notas_fiscais').select('id, loja_id').in('id', sel.ids)
  if (en) return { error: msgErro(en) }
  const lojaDa = new Map(((notas ?? []) as { id: number; loja_id: number }[]).map((x) => [Number(x.id), Number(x.loja_id)]))
  const p = await getProfile()
  const podeNaLoja = new Map<number, string | null>()
  const resultados: ResultadoGerarNota[] = []
  for (const id of sel.ids) {
    const loja = lojaDa.get(id)
    if (!loja) { resultados.push({ notaId: id, ok: false, gerados: 0, mensagem: 'Nota não encontrada.' }); continue }
    if (!podeNaLoja.has(loja)) {
      const proprio = (await modoDaLoja(loja)) === 'proprio'
      podeNaLoja.set(loja, !proprio ? 'O financeiro do Norte só existe na loja de estoque próprio.' : (await requirePermissao(loja, PERM.contasPagar)) ? null : 'Sem permissão nesta loja.')
    }
    const bloqueio = podeNaLoja.get(loja)
    if (bloqueio) { resultados.push({ notaId: id, ok: false, gerados: 0, mensagem: bloqueio }); continue }
    const { data, error } = await db.rpc('fin_titulos_da_nota_gerar_manual', { p_loja: loja, p_nota: id, p_user: p.id, p_user_nome: p.name })
    if (error) {
      if (semMigration(error)) return { error: SEM_360 }
      resultados.push({ notaId: id, ok: false, gerados: 0, mensagem: msgErro(error) })
      continue
    }
    const r = data as { gerados: number; motivo?: string | null }
    const gerados = Number(r.gerados) || 0
    if (gerados > 0) await registrarAuditoria('criar', 'conta a pagar', null, `${gerados} parcela(s) da nota ${id} (à mão, loja ${loja})`)
    resultados.push({ notaId: id, ok: true, gerados, mensagem: gerados ? null : r.motivo ?? 'Nada a gerar: as parcelas já têm conta.' })
    revalidatePath(`/nota-fiscal/${id}`)
  }
  atualizar()
  return { ok: true, resultados }
}

/** Parcela paga em nota desfeita: o gerente decide. 'estornar' estorna os pagamentos (estorno de baixa de sempre) e cancela a conta;
 *  'manter' só registra a decisão. Motivo obrigatório. */
export async function decidirNotaDesfeita(tituloId: number, acao: 'estornar' | 'manter', motivo: string): Promise<{ ok: true; status: string } | Erro> {
  const __d = viaDesktop('financeiro#decidirNotaDesfeita', decidirNotaDesfeita, [tituloId, acao, motivo]); if (__d) return __d as never
  await guardaModulo('financeiro#decidirNotaDesfeita')
  await exigirDevAcao()
  const ctx = await contexto(PERM.decidirNotaDesfeita)
  if ('error' in ctx) return ctx
  if (acao !== 'estornar' && acao !== 'manter') return { error: 'Decisão inválida.' }
  if (texto(motivo).length < 3) return { error: 'Informe o motivo da decisão.' }
  const { data, error } = await createServiceClient().rpc('fin_nota_desfeita_decidir', {
    p_loja: ctx.lojaId, p_titulo: Number(tituloId), p_acao: acao, p_motivo: texto(motivo), p_user: ctx.userId, p_user_nome: ctx.nome,
  })
  if (error) return { error: semMigration(error) ? SEM_360 : msgErro(error) }
  const r = data as { status: string; duplicado?: boolean }
  if (!r.duplicado) await registrarAuditoria(acao === 'estornar' ? 'reverter' : 'editar', 'conta a pagar de nota desfeita', Number(tituloId),
    `${acao === 'estornar' ? 'Estornou o pagamento' : 'Manteve a conta'}: ${texto(motivo)}`)
  atualizar()
  return { ok: true, status: r.status }
}

// ------------------------------------------------- Fase 4 passo 2 (migration 370): aprovação, recorrentes, avulso e transferência
const SEM_370 = 'Recurso ainda não ativado nesta instalação (migration 370).'
const erro370 = (e: { message?: string; code?: string } | null | undefined) => (semMigration(e) ? SEM_370 : msgErro(e))
const real = (cent: number) => (cent / 100).toFixed(2)

export type ConfigInput = { ativa: boolean; ate: number | string; altoAcima: number | string; autorPodeAprovar: boolean; recorrentesDias: number | string }

/** Liga/desliga a aprovação e define as faixas (padrão do dono: desligada, R$ 1.000 / R$ 5.000, autor pode aprovar, 45 dias). */
export async function salvarConfigFinanceiro(input: ConfigInput): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('financeiro#salvarConfigFinanceiro', salvarConfigFinanceiro, [input]); if (__d) return __d as never
  await guardaModulo('financeiro#salvarConfigFinanceiro')
  await exigirDevAcao()
  const ctx = await contexto(PERM.configurarAprovacao)
  if ('error' in ctx) return ctx
  const ateCent = paraCentavos(input.ate as number | string)
  const altoCent = paraCentavos(input.altoAcima as number | string)
  const dias = Number(input.recorrentesDias)
  const cfg = { ativa: !!input.ativa, ateCent, altoAcimaCent: altoCent, autorPodeAprovar: !!input.autorPodeAprovar, recorrentesDias: dias }
  const invalido = validarConfig(cfg)
  if (invalido) return { error: invalido }
  const { error } = await createServiceClient().rpc('fin_config_salvar', {
    p_loja: ctx.lojaId, p_user: ctx.userId, p_user_nome: ctx.nome,
    p_dados: { aprovacao_ativa: cfg.ativa, aprovacao_ate: real(ateCent), aprovacao_alto_acima: real(altoCent),
      aprovacao_autor_pode_aprovar: cfg.autorPodeAprovar, recorrentes_dias: dias },
  })
  if (error) return { error: erro370(error) }
  await registrarAuditoria('editar', 'configuração do financeiro', ctx.lojaId,
    `aprovação ${cfg.ativa ? 'ligada' : 'desligada'}; até ${real(ateCent)}; admin acima de ${real(altoCent)}; ${dias} dias de recorrentes`)
  atualizar()
  return { ok: true }
}

/** Aprovar ou reprovar uma conta a pagar. O nível vem das permissões (gerente = 1, alto valor = 2); o banco confere a faixa. */
export async function decidirAprovacaoTitulo(tituloId: number, acao: 'aprovar' | 'reprovar', motivo: string): Promise<{ ok: true; aprovacao: string } | Erro> {
  const __d = viaDesktop('financeiro#decidirAprovacaoTitulo', decidirAprovacaoTitulo, [tituloId, acao, motivo]); if (__d) return __d as never
  await guardaModulo('financeiro#decidirAprovacaoTitulo')
  await exigirDevAcao()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'O financeiro do Norte só existe na loja de estoque próprio.' }
  const nivel = await nivelAprovacaoUsuario(lojaId)
  if (nivel < 1) return { error: 'Sem permissão' }
  if (acao !== 'aprovar' && acao !== 'reprovar') return { error: 'Decisão inválida.' }
  if (acao === 'reprovar' && texto(motivo).length < 3) return { error: 'Informe o motivo da reprovação.' }
  const p = await getProfile()
  const { data, error } = await createServiceClient().rpc('fin_titulo_aprovacao_decidir', {
    p_loja: lojaId, p_id: Number(tituloId), p_acao: acao, p_nivel_usuario: nivel, p_motivo: texto(motivo) || null, p_user: p.id, p_user_nome: p.name,
  })
  if (error) return { error: erro370(error) }
  const r = data as { aprovacao: string; duplicado?: boolean }
  if (!r.duplicado) await registrarAuditoria('editar', 'aprovação de conta a pagar', Number(tituloId),
    acao === 'reprovar' ? `Reprovou: ${texto(motivo)}` : `Aprovou (nível ${nivel})`)
  atualizar()
  revalidatePath(`/financeiro/contas-pagar/${tituloId}`)
  return { ok: true, aprovacao: r.aprovacao }
}

/** Conta de recorrente com valor estimado: grava o valor de verdade (só depois disso ela pode ser paga). */
export async function confirmarValorTitulo(tituloId: number, valor: number | string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('financeiro#confirmarValorTitulo', confirmarValorTitulo, [tituloId, valor]); if (__d) return __d as never
  await guardaModulo('financeiro#confirmarValorTitulo')
  await exigirDevAcao()
  const ctx = await contexto(PERM.contasPagar)
  if ('error' in ctx) return ctx
  const c = paraCentavos(valor)
  if (!(c > 0)) return { error: 'Informe um valor maior que zero.' }
  const { data, error } = await createServiceClient().rpc('fin_titulo_valor_confirmar', {
    p_loja: ctx.lojaId, p_id: Number(tituloId), p_valor: real(c), p_user: ctx.userId, p_user_nome: ctx.nome,
  })
  if (error) return { error: erro370(error) }
  if (!(data as { duplicado?: boolean })?.duplicado) await registrarAuditoria('editar', 'conta a pagar', Number(tituloId), `valor confirmado ${real(c)}`)
  atualizar()
  revalidatePath(`/financeiro/contas-pagar/${tituloId}`)
  return { ok: true }
}

export type RecorrenteInput = {
  id?: number | null; descricao: string; fornecedorId: number; categoriaId?: number | null; documento?: string; valor: number | string
  valorEstimado: boolean; periodicidade: Periodicidade; dia: number; inicio: string; fim?: string | null; ativa?: boolean; observacao?: string
}

export async function salvarRecorrente(input: RecorrenteInput): Promise<{ ok: true; id: number } | Erro> {
  const __d = viaDesktop('financeiro#salvarRecorrente', salvarRecorrente, [input]); if (__d) return __d as never
  await guardaModulo('financeiro#salvarRecorrente')
  await exigirDevAcao()
  const ctx = await contexto(PERM.recorrentes)
  if ('error' in ctx) return ctx
  const c = paraCentavos(input.valor)
  const fim = dataISO(input.fim) || null
  const invalido = validarRecorrente({ descricao: texto(input.descricao, 120), fornecedorId: Number(input.fornecedorId), valorCent: c,
    periodicidade: input.periodicidade, dia: Number(input.dia), inicio: dataISO(input.inicio), fim })
  if (invalido) return { error: invalido }
  const { data, error } = await createServiceClient().rpc('fin_recorrente_salvar', {
    p_loja: ctx.lojaId, p_id: input.id ?? null, p_user: ctx.userId, p_user_nome: ctx.nome,
    p_dados: { descricao: texto(input.descricao, 120), fornecedor_id: Number(input.fornecedorId), categoria_id: input.categoriaId ?? null,
      documento: texto(input.documento, 60), valor: real(c), valor_estimado: !!input.valorEstimado, periodicidade: input.periodicidade,
      dia: Number(input.dia), data_inicio: dataISO(input.inicio), data_fim: fim, ativa: input.ativa ?? true, observacao: texto(input.observacao, 300) },
  })
  if (error) return { error: erro370(error) }
  const r = data as { id: number; criada: boolean }
  await registrarAuditoria(r.criada ? 'criar' : 'editar', 'conta recorrente', r.id, texto(input.descricao, 120))
  atualizar()
  return { ok: true, id: r.id }
}

/** "Gerar agora" (a mesma função do cron diário, só na loja atual; idempotente). */
export async function gerarRecorrentesAgora(): Promise<{ ok: true; gerados: number; falhas: number } | Erro> {
  const __d = viaDesktop('financeiro#gerarRecorrentesAgora', gerarRecorrentesAgora, []); if (__d) return __d as never
  await guardaModulo('financeiro#gerarRecorrentesAgora')
  await exigirDevAcao()
  const ctx = await contexto(PERM.recorrentes)
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().rpc('fin_recorrentes_gerar', { p_loja: ctx.lojaId })
  if (error) return { error: erro370(error) }
  const l = ((data as { lojas?: { gerados: number; falhas: number }[] })?.lojas ?? [])[0]
  const gerados = Number(l?.gerados ?? 0)
  if (gerados > 0) await registrarAuditoria('criar', 'conta a pagar', null, `${gerados} conta(s) de recorrentes`)
  atualizar()
  return { ok: true, gerados, falhas: Number(l?.falhas ?? 0) }
}

export type AvulsoInput = { contaId: number; data: string; tipo: 'entrada' | 'saida'; valor: number | string; descricao: string; categoriaId: number | null; chave: string }

export async function registrarLancamentoAvulso(input: AvulsoInput): Promise<{ ok: true; id: number } | Erro> {
  const __d = viaDesktop('financeiro#registrarLancamentoAvulso', registrarLancamentoAvulso, [input]); if (__d) return __d as never
  await guardaModulo('financeiro#registrarLancamentoAvulso')
  await exigirDevAcao()
  const ctx = await contexto(PERM.lancamentos)
  if ('error' in ctx) return ctx
  if (!input.chave) return { error: 'Recarregue a tela e tente de novo.' }
  const c = paraCentavos(input.valor)
  if (!(c > 0)) return { error: 'Informe um valor maior que zero.' }
  if (!input.categoriaId) return { error: 'Escolha a categoria (entra na DRE).' }
  const { data, error } = await createServiceClient().rpc('fin_lancamento_avulso_registrar', {
    p_loja: ctx.lojaId, p_user: ctx.userId, p_user_nome: ctx.nome, p_chave: input.chave,
    p_dados: { conta_id: Number(input.contaId), data: dataISO(input.data) || null, tipo: input.tipo, valor: real(c),
      descricao: texto(input.descricao, 300), categoria_id: Number(input.categoriaId) },
  })
  if (error) return { error: erro370(error) }
  const r = data as { id: number; duplicado: boolean }
  if (!r.duplicado) await registrarAuditoria('criar', 'lançamento avulso', r.id, `${input.tipo} ${real(c)}: ${texto(input.descricao, 80)}`)
  atualizar()
  return { ok: true, id: r.id }
}

export async function estornarLancamentoAvulso(id: number, motivo: string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('financeiro#estornarLancamentoAvulso', estornarLancamentoAvulso, [id, motivo]); if (__d) return __d as never
  await guardaModulo('financeiro#estornarLancamentoAvulso')
  await exigirDevAcao()
  const ctx = await contexto(PERM.lancamentos)
  if ('error' in ctx) return ctx
  if (texto(motivo).length < 3) return { error: 'Informe o motivo do estorno.' }
  const { data, error } = await createServiceClient().rpc('fin_lancamento_avulso_estornar', {
    p_loja: ctx.lojaId, p_lancamento: Number(id), p_motivo: texto(motivo), p_user: ctx.userId, p_user_nome: ctx.nome,
  })
  if (error) return { error: erro370(error) }
  if (!(data as { duplicado?: boolean })?.duplicado) await registrarAuditoria('reverter', 'lançamento avulso', Number(id), texto(motivo))
  atualizar()
  return { ok: true }
}

export type TransferenciaInput = { origemId: number; destinoId: number; data: string; valor: number | string; descricao?: string; chave: string; hoje: string }

export async function registrarTransferencia(input: TransferenciaInput): Promise<{ ok: true; id: number } | Erro> {
  const __d = viaDesktop('financeiro#registrarTransferencia', registrarTransferencia, [input]); if (__d) return __d as never
  await guardaModulo('financeiro#registrarTransferencia')
  await exigirDevAcao()
  const ctx = await contexto(PERM.lancamentos)
  if ('error' in ctx) return ctx
  if (!input.chave) return { error: 'Recarregue a tela e tente de novo.' }
  const c = paraCentavos(input.valor)
  const invalido = validarTransferencia({ origemId: Number(input.origemId), destinoId: Number(input.destinoId), valorCent: c,
    data: dataISO(input.data), hoje: dataISO(input.hoje) || dataISO(input.data) })
  if (invalido) return { error: invalido }
  const { data, error } = await createServiceClient().rpc('fin_transferencia_registrar', {
    p_loja: ctx.lojaId, p_user: ctx.userId, p_user_nome: ctx.nome, p_chave: input.chave,
    p_dados: { conta_origem_id: Number(input.origemId), conta_destino_id: Number(input.destinoId), data: dataISO(input.data), valor: real(c),
      descricao: texto(input.descricao, 200) },
  })
  if (error) return { error: erro370(error) }
  const r = data as { id: number; duplicado: boolean }
  if (!r.duplicado) await registrarAuditoria('criar', 'transferência entre contas', r.id, real(c))
  atualizar()
  return { ok: true, id: r.id }
}

export async function estornarTransferencia(id: number, motivo: string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('financeiro#estornarTransferencia', estornarTransferencia, [id, motivo]); if (__d) return __d as never
  await guardaModulo('financeiro#estornarTransferencia')
  await exigirDevAcao()
  const ctx = await contexto(PERM.lancamentos)
  if ('error' in ctx) return ctx
  if (texto(motivo).length < 3) return { error: 'Informe o motivo do estorno.' }
  const { data, error } = await createServiceClient().rpc('fin_transferencia_estornar', {
    p_loja: ctx.lojaId, p_id: Number(id), p_motivo: texto(motivo), p_user: ctx.userId, p_user_nome: ctx.nome,
  })
  if (error) return { error: erro370(error) }
  if (!(data as { duplicado?: boolean })?.duplicado) await registrarAuditoria('reverter', 'transferência entre contas', Number(id), texto(motivo))
  atualizar()
  return { ok: true }
}
