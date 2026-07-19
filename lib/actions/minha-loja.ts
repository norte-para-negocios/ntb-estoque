'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { registrarAuditoria } from '@/lib/auditoria'
import { revalidatePath } from 'next/cache'
import { ORDEM_CAMPOS_PADRAO, type CampoEtiqueta } from '@/components/etiqueta/EtiquetaPDF'
import type { EtiquetaFormValores } from '@/lib/etiqueta-config'

// Quem pode mexer na "Minha loja": POR ENQUANTO só o administrador GERAL (admin
// global), e a loja ATUAL precisa estar entre as lojas dele. Retorna o id ou null.
// (Os admins de loja veem a aba com cadeado / "em breve".)
async function lojaGerivel(): Promise<number | null> {
  const ator = await getAtorGestao()
  if (!ator.isAdminGlobal) return null
  const lojaId = await getCurrentLojaId()
  return ator.lojaIds.includes(lojaId) ? lojaId : null
}

export type LojaNegocioInput = {
  nome_fantasia: string
  cep: string
  uf: string
  cidade: string
  bairro: string
  logradouro: string
  numero: string
  meta_compras_pct: string
}

const clamp = (n: number, min: number, max: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback

// Edita SÓ os dados de negócio/endereço da loja atual. CNPJ, razão, chaves Omie e
// ativo continuam só com o admin global (pela tela Lojas).
export async function editarLojaNegocio(dados: LojaNegocioInput) {
  const lojaId = await lojaGerivel()
  if (!lojaId) return { error: 'Sem permissão para editar esta loja' }

  // Aceita "," como separador decimal (o input permite digitar vírgula, comum
  // no Brasil): Number("35,5") é NaN, então sem essa troca o valor digitado
  // cai silenciosamente no fallback de 40% em vez do que a pessoa quis salvar.
  const metaPct = dados.meta_compras_pct.trim().replace(',', '.')
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('lojas')
    .update({
      nome_fantasia: dados.nome_fantasia.trim() || null,
      cep: dados.cep.trim() || null,
      uf: dados.uf.trim() || null,
      cidade: dados.cidade.trim() || null,
      bairro: dados.bairro.trim() || null,
      logradouro: dados.logradouro.trim() || null,
      numero: dados.numero.trim() || null,
      meta_compras_pct: metaPct ? clamp(Number(metaPct), 0, 100, 40) : null,
    })
    .eq('id', lojaId)
  if (error) return { error: error.message }

  await registrarAuditoria('editar', 'loja', lojaId, 'Dados da loja')
  revalidatePath('/minha-loja')
  return { ok: true }
}

// Salva o padrão da etiqueta da loja atual (upsert em etiqueta_config).
export async function salvarEtiquetaConfig(form: EtiquetaFormValores) {
  const lojaId = await lojaGerivel()
  if (!lojaId) return { error: 'Sem permissão para editar esta loja' }
  const ator = await getAtorGestao()

  // Ordem dos campos: mantém só chaves válidas e completa com as faltantes.
  const validas = new Set(ORDEM_CAMPOS_PADRAO)
  const ordem = (form.ordem_campos as CampoEtiqueta[]).filter((k) => validas.has(k))
  for (const k of ORDEM_CAMPOS_PADRAO) if (!ordem.includes(k)) ordem.push(k)

  const linha = {
    loja_id: lojaId,
    nome_exibido: form.nome_exibido.trim() || null,
    mostrar_fabricacao: !!form.mostrar_fabricacao,
    mostrar_validade: !!form.mostrar_validade,
    mostrar_qtde_nf: !!form.mostrar_qtde_nf,
    mostrar_qtde_etiqueta: !!form.mostrar_qtde_etiqueta,
    mostrar_lote: !!form.mostrar_lote,
    mostrar_recebido: !!form.mostrar_recebido,
    mostrar_fornecedor: !!form.mostrar_fornecedor,
    mostrar_cnpj: !!form.mostrar_cnpj,
    ordem_campos: ordem,
    fonte_escala: clamp(Number(form.fonte_escala), 0.7, 1.5, 1.0),
    negrito_nome: !!form.negrito_nome,
    negrito_descricao: !!form.negrito_descricao,
    cor_destaque: /^#[0-9a-fA-F]{6}$/.test(form.cor_destaque.trim()) ? form.cor_destaque.trim() : null,
    mostrar_logo: !!form.mostrar_logo,
    mostrar_borda: !!form.mostrar_borda,
    largura_cm: clamp(Number(form.largura_cm), 2, 30, 7.26),
    altura_cm: clamp(Number(form.altura_cm), 2, 30, 4.0),
    offset_x: clamp(Number(form.offset_x), -20, 20, 0),
    offset_y: clamp(Number(form.offset_y), -20, 20, 0),
    updated_at: new Date().toISOString(),
    updated_by: ator.id,
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from('etiqueta_config').upsert(linha, { onConflict: 'loja_id' })
  if (error) return { error: error.message }

  await registrarAuditoria('editar', 'etiqueta_config', lojaId, 'Padrão da etiqueta')
  revalidatePath('/minha-loja')
  return { ok: true }
}
