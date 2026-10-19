import { createClient } from '@/lib/supabase/server'

export type CompradorOpcao = { id: number; nome: string }

// Fornecedores, locais e compradores para os formulários de pedido e requisição (sessão do usuário, RLS por loja).
export async function cadastrosDoPedido(lojaId: number): Promise<{
  fornecedores: { id: number; nome: string; cnpj: string | null }[]; locais: { codigo: number; descricao: string }[]; compradores: CompradorOpcao[]
}> {
  const sb = await createClient()
  const [{ data: fs }, { data: ls }, compradores] = await Promise.all([
    sb.from('fornecedores').select('id, razao_social, nome_fantasia, cnpj_cpf, inativo').eq('loja_id', lojaId).order('razao_social').limit(2000),
    sb.from('local_estoques').select('codigo_local_estoque, descricao, inativo').eq('loja_id', lojaId).is('deleted_at', null).order('descricao'),
    compradoresAtivos(lojaId),
  ])
  return {
    fornecedores: (fs ?? []).filter((f) => !f.inativo).map((f) => ({
      id: Number(f.id), nome: (f.nome_fantasia && f.nome_fantasia !== f.razao_social ? `${f.razao_social} (${f.nome_fantasia})` : f.razao_social) || f.nome_fantasia || `Fornecedor ${f.id}`,
      cnpj: (f.cnpj_cpf ?? '').replace(/\D/g, '') || null,
    })),
    locais: (ls ?? []).filter((l) => l.inativo !== 'S').map((l) => ({ codigo: Number(l.codigo_local_estoque), descricao: l.descricao ?? String(l.codigo_local_estoque) })),
    compradores,
  }
}

/** Compradores ativos (migration 240). Sem a 240 aplicada: lista vazia (o campo some do formulário). */
export async function compradoresAtivos(lojaId: number): Promise<CompradorOpcao[]> {
  const sb = await createClient()
  const { data, error } = await sb.from('compradores').select('id, nome').eq('loja_id', lojaId).eq('ativo', true).order('nome')
  if (error) return []
  return (data ?? []).map((c) => ({ id: Number(c.id), nome: c.nome as string }))
}

/** Nome de cada comprador (ativo ou não), para mostrar em pedidos e requisições antigos. */
export async function nomesCompradores(lojaId: number): Promise<Map<number, string>> {
  const sb = await createClient()
  const { data, error } = await sb.from('compradores').select('id, nome').eq('loja_id', lojaId)
  if (error) return new Map()
  return new Map((data ?? []).map((c) => [Number(c.id), c.nome as string]))
}
