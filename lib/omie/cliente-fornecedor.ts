import { omieRequest, logIntegrationAttempt, type LojaOmie } from './client'
import { createServiceClient } from '@/lib/supabase/server'

// Campos reais do ListarClientes (probe real loja 3, 18/06). Clientes e fornecedores
// vivem na MESMA base do Omie; a tag "Fornecedor"/"Cliente" distingue (758 fornecedores,
// 2585 clientes na loja 3). CEST NAO existe no cadastro de cliente do Omie (e do produto).
interface OmieCliente {
  codigo_cliente_omie: number
  codigo_cliente_integracao?: string
  razao_social?: string
  nome_fantasia?: string
  cnpj_cpf?: string
  pessoa_fisica?: string
  inscricao_estadual?: string
  inscricao_municipal?: string
  email?: string
  telefone1_ddd?: string
  telefone1_numero?: string
  cep?: string
  estado?: string
  cidade?: string
  bairro?: string
  endereco?: string
  endereco_numero?: string
  complemento?: string
  inativo?: string
  tags?: { tag: string }[]
}
interface OmieClientesResp {
  pagina?: number
  total_de_paginas?: number
  total_de_registros?: number
  clientes_cadastro?: OmieCliente[]
}

function telefone(ddd?: string, numero?: string): string | null {
  const d = (ddd ?? '').trim()
  const n = (numero ?? '').trim()
  if (!d && !n) return null
  return (d ? `(${d}) ${n}` : n).trim()
}

function mapBase(c: OmieCliente) {
  return {
    codigo_omie: c.codigo_cliente_omie,
    codigo_integracao: c.codigo_cliente_integracao || null,
    razao_social: c.razao_social || c.nome_fantasia || '(sem nome)',
    nome_fantasia: c.nome_fantasia || null,
    cnpj_cpf: c.cnpj_cpf || null,
    pessoa_fisica: c.pessoa_fisica === 'S',
    inscricao_estadual: c.inscricao_estadual || null,
    inscricao_municipal: c.inscricao_municipal || null,
    email: c.email || null,
    telefone: telefone(c.telefone1_ddd, c.telefone1_numero),
    cep: c.cep || null,
    uf: c.estado || null,
    cidade: c.cidade || null,
    bairro: c.bairro || null,
    logradouro: c.endereco || null,
    numero: c.endereco_numero || null,
    complemento: c.complemento || null,
    inativo: c.inativo === 'S',
    origem: 'omie',
    full_object: c,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Sincroniza fornecedores OU clientes do Omie (ListarClientes filtrando pela tag).
 * SO LEITURA do Omie; grava na tabela local. Pagina de 100 em 100.
 */
async function syncPorTag(
  loja: LojaOmie,
  tag: 'Fornecedor' | 'Cliente',
  tabela: 'fornecedores' | 'clientes',
  campoStatus: 'fornecedor_status' | 'cliente_status',
  campoData: 'fornecedor_ultima_atualizacao' | 'cliente_ultima_atualizacao'
) {
  const supabase = createServiceClient()
  await supabase.from('lojas').update({ [campoStatus]: 'Processando' }).eq('id', loja.id)

  try {
    let pagina = 1
    let totalPaginas = 1

    do {
      const res = await omieRequest<OmieClientesResp>({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        endpoint: 'v1/geral/clientes',
        call: 'ListarClientes',
        data: {
          pagina,
          registros_por_pagina: 100,
          apenas_importado_api: 'N',
          clientesFiltro: { tags: [{ tag }] },
        },
      })

      totalPaginas = res.total_de_paginas || 1
      const lista = res.clientes_cadastro ?? []

      if (lista.length) {
        const rows = lista.map((c) => ({ loja_id: loja.id, ...mapBase(c) }))
        await supabase.from(tabela).upsert(rows, { onConflict: 'loja_id,codigo_omie' })
      }

      pagina++
    } while (pagina <= totalPaginas)

    await supabase
      .from('lojas')
      .update({ [campoStatus]: 'Concluido', [campoData]: new Date().toISOString() })
      .eq('id', loja.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('lojas').update({ [campoStatus]: 'Erro' }).eq('id', loja.id)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: tag,
      request: `sync${tag}`,
      error: true,
      error_message: msg,
    })
    throw e
  }
}

export function syncFornecedores(loja: LojaOmie) {
  return syncPorTag(loja, 'Fornecedor', 'fornecedores', 'fornecedor_status', 'fornecedor_ultima_atualizacao')
}

export function syncClientes(loja: LojaOmie) {
  return syncPorTag(loja, 'Cliente', 'clientes', 'cliente_status', 'cliente_ultima_atualizacao')
}

export type ParceiroOmie = {
  codigo_omie: number
  razao_social: string
  nome_fantasia: string | null
  cnpj_cpf: string | null
  pessoa_fisica: boolean
  inscricao_estadual: string | null
  inscricao_municipal: string | null
  email: string | null
  telefone: string | null
  cep: string | null
  uf: string | null
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  ehFornecedor: boolean
  ehCliente: boolean
}

/**
 * Consulta no Omie (ListarClientes filtrando por CNPJ/CPF, SO LEITURA) o cadastro
 * de um parceiro. Identifica se e fornecedor e/ou cliente pelas tags. Base do SINTEGRA
 * por CNPJ: o Omie acha o que ja esta cadastrado la (cliente, fornecedor).
 */
export async function consultarPorCnpj(loja: LojaOmie, cnpjCpf: string): Promise<ParceiroOmie | null> {
  const res = await omieRequest<OmieClientesResp>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/geral/clientes',
    call: 'ListarClientes',
    data: {
      pagina: 1,
      registros_por_pagina: 5,
      apenas_importado_api: 'N',
      clientesFiltro: { cnpj_cpf: cnpjCpf },
    },
  })

  const c = res.clientes_cadastro?.[0]
  if (!c) return null

  const tags = (c.tags ?? []).map((t) => t.tag.toLowerCase())
  const base = mapBase(c)
  return {
    codigo_omie: base.codigo_omie,
    razao_social: base.razao_social,
    nome_fantasia: base.nome_fantasia,
    cnpj_cpf: base.cnpj_cpf,
    pessoa_fisica: base.pessoa_fisica,
    inscricao_estadual: base.inscricao_estadual,
    inscricao_municipal: base.inscricao_municipal,
    email: base.email,
    telefone: base.telefone,
    cep: base.cep,
    uf: base.uf,
    cidade: base.cidade,
    bairro: base.bairro,
    logradouro: base.logradouro,
    numero: base.numero,
    complemento: base.complemento,
    ehFornecedor: tags.includes('fornecedor'),
    ehCliente: tags.includes('cliente'),
  }
}
