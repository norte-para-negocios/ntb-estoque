import { omieRequest, type LojaOmie } from './client'
import { createServiceClient } from '@/lib/supabase/server'

// Campos retornados pelo ListarEmpresas (confirmados por leitura real em 16/06).
interface OmieEmpresa {
  razao_social?: string
  nome_fantasia?: string
  cnpj?: string
  inscricao_estadual?: string
  inscricao_municipal?: string
  cnae?: string
  cnae_municipal?: string
  regime_tributario?: string
  optante_simples_nacional?: string
  csc_producao?: string
  csc_id_producao?: string
  codigo_empresa?: string | number
  complemento?: string
  email?: string
  website?: string
  telefone1_ddd?: string
  telefone1_numero?: string
  telefone2_ddd?: string
  telefone2_numero?: string
  sped_nome_contador?: string
  sped_cpf_contador?: string
  sped_email_contador?: string
  cep?: string
  estado?: string
  cidade?: string
  bairro?: string
  endereco?: string
  endereco_numero?: string
}
interface OmieEmpresaResp {
  empresas_cadastro?: OmieEmpresa[]
}

function telefone(ddd?: string, numero?: string): string | null {
  const d = (ddd ?? '').trim()
  const n = (numero ?? '').trim()
  if (!d && !n) return null
  return (d ? `(${d}) ${n}` : n).trim()
}

function soSePreenchido(valor: string | undefined, chave: string): Record<string, string> {
  const v = (valor ?? '').trim()
  return v ? { [chave]: v } : {}
}

/**
 * Puxa os dados da empresa do Omie (ListarEmpresas, somente leitura) e preenche
 * a loja: razao social, IE/IM, CNAE, regime, CSC, contador e completa o endereco.
 * Nao escreve nada no Omie. Status sem acento (regra do banco).
 */
export async function syncEmpresa(loja: LojaOmie): Promise<boolean> {
  const supabase = createServiceClient()
  try {
    const res = await omieRequest<OmieEmpresaResp>({
      loja_id: loja.id,
      omie_app_key: loja.omie_app_key,
      omie_app_secret: loja.omie_app_secret,
      endpoint: 'v1/geral/empresas',
      call: 'ListarEmpresas',
      data: { pagina: 1, registros_por_pagina: 50 },
    })

    const e = res.empresas_cadastro?.[0]
    if (!e) {
      await supabase
        .from('lojas')
        .update({ empresa_status: 'Sem dados', empresa_ultima_atualizacao: new Date().toISOString() })
        .eq('id', loja.id)
      return false
    }

    await supabase
      .from('lojas')
      .update({
        razao_social: e.razao_social ?? null,
        inscricao_estadual: e.inscricao_estadual ?? null,
        inscricao_municipal: e.inscricao_municipal ?? null,
        cnae: e.cnae ?? null,
        cnae_municipal: e.cnae_municipal ?? null,
        regime_tributario: e.regime_tributario ?? null,
        optante_simples_nacional: e.optante_simples_nacional ?? null,
        csc_producao: e.csc_producao ?? null,
        csc_id_producao: e.csc_id_producao ?? null,
        codigo_empresa: e.codigo_empresa ? Number(e.codigo_empresa) : null,
        complemento: e.complemento ?? null,
        email: e.email ?? null,
        website: e.website ?? null,
        telefone1: telefone(e.telefone1_ddd, e.telefone1_numero),
        telefone2: telefone(e.telefone2_ddd, e.telefone2_numero),
        sped_nome_contador: e.sped_nome_contador ?? null,
        sped_cpf_contador: e.sped_cpf_contador ?? null,
        sped_email_contador: e.sped_email_contador ?? null,
        // completa o endereco/identificacao (colunas que ja existem em lojas)
        ...soSePreenchido(e.cnpj, 'cnpj'),
        ...soSePreenchido(e.nome_fantasia, 'nome_fantasia'),
        ...soSePreenchido(e.cep, 'cep'),
        ...soSePreenchido(e.estado, 'uf'),
        ...soSePreenchido(e.cidade, 'cidade'),
        ...soSePreenchido(e.bairro, 'bairro'),
        ...soSePreenchido(e.endereco, 'logradouro'),
        ...soSePreenchido(e.endereco_numero, 'numero'),
        full_object_empresa: e,
        empresa_status: 'Concluido',
        empresa_ultima_atualizacao: new Date().toISOString(),
      })
      .eq('id', loja.id)

    return true
  } catch (err) {
    await supabase
      .from('lojas')
      .update({ empresa_status: 'Erro', empresa_ultima_atualizacao: new Date().toISOString() })
      .eq('id', loja.id)
    throw err
  }
}
