'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { syncEmpresa } from '@/lib/omie/empresa'
import { registrarAuditoria } from '@/lib/auditoria'
import type { LojaOmie } from '@/lib/omie/client'
import { gerarChaveIntegracaoNtbVendas } from '@/lib/actions/integracao-ntb-vendas'
import type { ModoEstoque } from '@/lib/estoque/ledger'
import { semearLojaProprio } from '@/lib/estoque/proprio-driver'

/**
 * Force-sync da loja (admin): zera os campos *_status para null, fazendo o proximo
 * webhook/sync reprocessar do zero. Espelha o forceSync de loja do sistema Laravel.
 */
export type LojaInput = {
  cnpj: string
  nome: string
  nome_fantasia: string
  cep: string
  uf: string
  cidade: string
  bairro: string
  logradouro: string
  numero: string
  omie_app_key: string
  omie_app_secret: string
  ativo: boolean
  /** Como a loja controla estoque: omie (espelho do Omie), proprio (Norte Estoque é o dono), nenhum. Default omie. */
  modo_estoque?: ModoEstoque
}

const MODOS: ModoEstoque[] = ['omie', 'proprio', 'nenhum']
function modoDe(dados: LojaInput): ModoEstoque {
  return dados.modo_estoque && MODOS.includes(dados.modo_estoque) ? dados.modo_estoque : 'omie'
}

function normalizarDados(dados: LojaInput) {
  const modo = modoDe(dados)
  return {
    modo_estoque: modo,
    cnpj: dados.cnpj.trim(),
    nome: dados.nome.trim(),
    nome_fantasia: dados.nome_fantasia.trim() || null,
    cep: dados.cep.trim() || null,
    uf: dados.uf.trim() || null,
    cidade: dados.cidade.trim() || null,
    bairro: dados.bairro.trim() || null,
    logradouro: dados.logradouro.trim() || null,
    numero: dados.numero.trim() || null,
    // Loja "fora do Omie": chaves podem ser vazias -> grava null
    // Fora do modo omie as chaves nunca são guardadas.
    omie_app_key: modo === 'omie' ? dados.omie_app_key.trim() || null : null,
    omie_app_secret: modo === 'omie' ? dados.omie_app_secret.trim() || null : null,
    ativo: dados.ativo,
  }
}

export async function criarLoja(dados: LojaInput, criarNoVendasTambem?: boolean) {
  if (!(await isAdmin())) return { error: 'Somente administradores' }
  if (!dados.cnpj.trim() || !dados.nome.trim()) {
    return { error: 'CNPJ e nome são obrigatórios' }
  }

  const supabase = createServiceClient()
  const { data: loja, error } = await supabase
    .from('lojas')
    .insert(normalizarDados(dados))
    .select('id')
    .single()

  if (error) return { error: error.message }

  await registrarAuditoria('criar', 'loja', null, dados.nome.trim())
  revalidatePath('/loja')

  // Estoque próprio: já nasce com Estoque Geral (padrão), Bar, Cozinha e as famílias básicas.
  let avisoSemente: string | undefined
  if (modoDe(dados) === 'proprio') {
    try { await semearLojaProprio(loja.id) } catch (e) { avisoSemente = 'Loja criada, mas os locais e famílias padrão falharam: ' + (e instanceof Error ? e.message : String(e)) }
  }

  if (!criarNoVendasTambem) return { ok: true, lojaId: loja.id, avisoSemente }

  const vendasResult = await criarLojaNoNtbVendas(loja.id, dados.nome.trim(), dados.cnpj.trim(), modoDe(dados))
  if (vendasResult.error) return { ok: true, lojaId: loja.id, avisoSemente, avisoVendas: vendasResult.error }
  return { ok: true, lojaId: loja.id, avisoSemente }
}

// Bootstrap cross-sistema (2026-08-16, pedido explícito do usuário): cria a
// loja correspondente no ntb-vendas e já grava a chave de integração lá,
// tudo num clique só ("Criar no NTB Vendas também" no formulário de loja) —
// sem o operador ver/copiar chave nenhuma. Falha aqui não desfaz a loja já
// criada de-este lado (mesmo princípio de "loja salva, mas..." já usado no
// ntb-vendas pra fiscal/estoque) -- por isso nunca retorna `error` de verdade,
// só um aviso separado (`avisoVendas`) que não bloqueia o resto do fluxo.
async function criarLojaNoNtbVendas(lojaId: number, nome: string, cnpj: string, modo: ModoEstoque = 'omie'): Promise<{ error?: string }> {
  const segredo = process.env.CROSS_SYSTEM_BOOTSTRAP_KEY
  const vendasUrl = process.env.NTB_VENDAS_INTERNAL_URL
  if (!segredo || !vendasUrl) return { error: 'Integração cross-sistema não configurada neste servidor.' }

  let resposta: { ok?: boolean; storeId?: string; slug?: string; error?: string }
  try {
    const res = await fetch(`${vendasUrl.replace(/\/$/, '')}/api/integracao/lojas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${segredo}` },
      // stockMode: contrato com o Vendas (stores.stock_mode): 'omie' | 'proprio' | 'nenhum'. Vendas antigo ignora o campo.
      body: JSON.stringify({ nome, cnpj, stockMode: modo }),
    })
    resposta = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    if (!res.ok || !resposta.ok) return { error: resposta.error || 'Falha ao criar loja no NTB Vendas.' }
  } catch (e) {
    return { error: 'Não foi possível contatar o NTB Vendas: ' + (e instanceof Error ? e.message : String(e)) }
  }

  const chaveResult = await gerarChaveIntegracaoNtbVendas(lojaId)
  if (chaveResult.error || !chaveResult.chave) return { error: chaveResult.error || 'Falha ao gerar chave de integração.' }

  try {
    const res = await fetch(`${vendasUrl.replace(/\/$/, '')}/api/integracao/configurar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: resposta.storeId, url: chaveResult.url, apiKey: chaveResult.chave, ativo: true }),
    })
    const configResposta = await res.json().catch(() => ({ success: false }))
    if (!res.ok || !configResposta.success) return { error: configResposta.message || 'Loja criada no NTB Vendas, mas falhou salvar a integração lá.' }
  } catch (e) {
    return { error: 'Loja criada no NTB Vendas, mas falhou salvar a integração lá: ' + (e instanceof Error ? e.message : String(e)) }
  }

  return {}
}

export async function editarLoja(lojaId: number, dados: LojaInput) {
  if (!(await isAdmin())) return { error: 'Somente administradores' }
  if (!dados.cnpj.trim() || !dados.nome.trim()) {
    return { error: 'CNPJ e nome são obrigatórios' }
  }

  const supabase = createServiceClient()
  const modo = modoDe(dados)
  const { data: antes } = await supabase.from('lojas').select('modo_estoque').eq('id', lojaId).maybeSingle()
  const modoAntes = (antes as { modo_estoque?: string } | null)?.modo_estoque ?? 'omie'
  const { error } = await supabase
    .from('lojas')
    .update(normalizarDados(dados))
    .eq('id', lojaId)

  // O banco recusa trocar o modo depois do primeiro movimento de estoque próprio.
  if (error) return { error: error.message }

  if (modo === 'proprio' && modoAntes !== 'proprio') {
    const { count } = await supabase.from('local_estoques').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId)
    if (!count) await semearLojaProprio(lojaId)
  }

  await registrarAuditoria('editar', 'loja', lojaId, dados.nome.trim())
  revalidatePath('/loja')
  return { ok: true }
}

/** Ativa ou desativa a loja (sem apagar nada). Loja inativa some das integrações. */
export async function alternarAtivoLoja(lojaId: number, ativo: boolean) {
  if (!(await isAdmin())) return { error: 'Somente administradores' }
  const supabase = createServiceClient()
  const { data: alvo } = await supabase.from('lojas').select('nome').eq('id', lojaId).maybeSingle()
  const { error } = await supabase.from('lojas').update({ ativo }).eq('id', lojaId)
  if (error) return { error: error.message }
  await registrarAuditoria('editar', 'loja', lojaId, alvo?.nome ?? null)
  revalidatePath('/loja')
  return { ok: true }
}

export async function excluirLoja(lojaId: number) {
  if (!(await isAdmin())) return { error: 'Somente administradores' }

  const supabase = createServiceClient()
  const { data: alvo } = await supabase.from('lojas').select('nome').eq('id', lojaId).maybeSingle()
  const { error } = await supabase.from('lojas').delete().eq('id', lojaId)

  if (error) return { error: error.message }

  await registrarAuditoria('excluir', 'loja', lojaId, alvo?.nome ?? null)
  revalidatePath('/loja')
  return { ok: true }
}

export async function forceSyncLoja(lojaId: number) {
  if (!(await isAdmin())) return { error: 'Somente administradores' }

  const supabase = createServiceClient()
  await supabase
    .from('lojas')
    .update({
      produto_status: null,
      local_estoque_status: null,
      posicao_estoque_status: null,
      nota_fiscal_status: null,
      ordem_producao_status: null,
    })
    .eq('id', lojaId)

  revalidatePath('/loja')
  return { ok: true }
}

/**
 * Puxa os dados da empresa do Omie (ListarEmpresas, so leitura) e preenche a loja:
 * razao social, IE/IM, CNAE, regime, CSC, contador, endereco. Nao escreve no Omie.
 */
export async function puxarEmpresaDoOmie(lojaId: number) {
  if (!(await isAdmin())) return { error: 'Somente administradores' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('id', lojaId)
    .single<LojaOmie>()

  if (!loja?.omie_app_key || !loja?.omie_app_secret) {
    return { error: 'Loja sem chave do Omie' }
  }

  try {
    const ok = await syncEmpresa(loja)
    revalidatePath('/loja')
    return ok ? { ok: true } : { error: 'O Omie não retornou dados da empresa.' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao puxar do Omie' }
  }
}
