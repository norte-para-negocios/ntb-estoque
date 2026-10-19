import { createClient } from '@/lib/supabase/server'

// Fornecedores e locais para o formulário do pedido (sessão do usuário, RLS por loja).
export async function cadastrosDoPedido(lojaId: number): Promise<{ fornecedores: { id: number; nome: string; cnpj: string | null }[]; locais: { codigo: number; descricao: string }[] }> {
  const sb = await createClient()
  const [{ data: fs }, { data: ls }] = await Promise.all([
    sb.from('fornecedores').select('id, razao_social, nome_fantasia, cnpj_cpf, inativo').eq('loja_id', lojaId).order('razao_social').limit(2000),
    sb.from('local_estoques').select('codigo_local_estoque, descricao, inativo').eq('loja_id', lojaId).is('deleted_at', null).order('descricao'),
  ])
  return {
    fornecedores: (fs ?? []).filter((f) => !f.inativo).map((f) => ({
      id: Number(f.id), nome: (f.nome_fantasia && f.nome_fantasia !== f.razao_social ? `${f.razao_social} (${f.nome_fantasia})` : f.razao_social) || f.nome_fantasia || `Fornecedor ${f.id}`,
      cnpj: (f.cnpj_cpf ?? '').replace(/\D/g, '') || null,
    })),
    locais: (ls ?? []).filter((l) => l.inativo !== 'S').map((l) => ({ codigo: Number(l.codigo_local_estoque), descricao: l.descricao ?? String(l.codigo_local_estoque) })),
  }
}
