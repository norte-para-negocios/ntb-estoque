import { omieRequest, logIntegrationAttempt, type LojaOmie } from './client'
import { createServiceClient } from '@/lib/supabase/server'

// Campos reais do PesquisarFamilias (probe real loja 3, 18/06): famCadastro[].
interface OmieFamilia {
  codigo: number
  codFamilia?: string
  codInt?: string
  nomeFamilia: string
  inativo?: string
}
interface OmieFamiliasResp {
  pagina?: number
  total_de_paginas?: number
  famCadastro?: OmieFamilia[]
}
interface OmieFamiliaWriteResp {
  codigo?: number
  codigo_status?: string
  descricao_status?: string
}

/** Cria uma familia no Omie (IncluirFamilia). Retorna o codigo gerado. */
export async function incluirFamilia(
  loja: LojaOmie,
  dados: { nomeFamilia: string; codInt?: string }
): Promise<{ codigo: number }> {
  const res = await omieRequest<OmieFamiliaWriteResp>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/geral/familias',
    call: 'IncluirFamilia',
    data: {
      nomeFamilia: dados.nomeFamilia,
      ...(dados.codInt ? { codInt: dados.codInt } : {}),
    },
  })
  if (!res?.codigo) throw new Error('Omie nao retornou codigo da familia criada')
  return { codigo: res.codigo }
}

/** Altera uma familia no Omie (AlterarFamilia). */
export async function alterarFamilia(
  loja: LojaOmie,
  dados: { codigo: number; nomeFamilia: string; codInt?: string; inativo?: boolean }
) {
  return omieRequest<OmieFamiliaWriteResp>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/geral/familias',
    call: 'AlterarFamilia',
    data: {
      codigo: dados.codigo,
      nomeFamilia: dados.nomeFamilia,
      ...(dados.codInt ? { codInt: dados.codInt } : {}),
      ...(dados.inativo != null ? { inativo: dados.inativo ? 'S' : 'N' } : {}),
    },
  })
}

/** Exclui uma familia no Omie (ExcluirFamilia). Pode falhar se houver produtos vinculados. */
export async function excluirFamiliaOmie(loja: LojaOmie, codigo: number) {
  return omieRequest<OmieFamiliaWriteResp>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/geral/familias',
    call: 'ExcluirFamilia',
    data: { codigo },
  })
}

/**
 * Puxa as familias do Omie (PesquisarFamilias, SO LEITURA) e grava no banco.
 * A grafia certa e PesquisarFamilias (ListarFamilias nao existe; confirmado por probe
 * real 18/06). Nao escreve nada no Omie.
 */
export async function syncFamilias(loja: LojaOmie) {
  const supabase = createServiceClient()
  await supabase.from('lojas').update({ familia_status: 'Processando' }).eq('id', loja.id)

  try {
    let pagina = 1
    let totalPaginas = 1

    do {
      const res = await omieRequest<OmieFamiliasResp>({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        is_test: loja.is_test,
        endpoint: 'v1/geral/familias',
        call: 'PesquisarFamilias',
        data: { pagina, registros_por_pagina: 100 },
      })

      totalPaginas = res.total_de_paginas || 1
      const familias = res.famCadastro ?? []

      if (familias.length) {
        const rows = familias.map((f) => ({
          loja_id: loja.id,
          codigo_familia: f.codigo,
          codigo: f.codInt || null,
          nome: f.nomeFamilia,
          inativo: f.inativo === 'S',
          origem: 'omie',
          full_object: f,
          updated_at: new Date().toISOString(),
        }))
        const { error: upErr } = await supabase
          .from('familias')
          .upsert(rows, { onConflict: 'loja_id,codigo_familia' })
        if (upErr) throw new Error(`Falha ao gravar familias: ${upErr.message}`)
      }

      pagina++
    } while (pagina <= totalPaginas)

    await supabase
      .from('lojas')
      .update({
        familia_status: 'Concluido',
        familia_ultima_atualizacao: new Date().toISOString(),
      })
      .eq('id', loja.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('lojas').update({ familia_status: 'Erro' }).eq('id', loja.id)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'Familia',
      request: 'syncFamilias',
      error: true,
      error_message: msg,
    })
    throw e
  }
}
