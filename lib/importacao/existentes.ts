// Leitura do cadastro atual (produtos e fornecedores) no formato da importação por planilha: usada pela prévia da importação
// e pela exportação do cadastro (Fase 6). Cadastro lido pela metade faria um produto existente parecer novo (e duplicar):
// falha na leitura LANÇA, nunca devolve lista parcial.
import { createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import type { FornecedorExistente, ProdutoExistente } from './planilha-puro'

const falhou = (e: { message: string }) => { throw new Error(`leitura do cadastro falhou: ${e.message}`) }

export async function produtosExistentes(lojaId: number): Promise<ProdutoExistente[]> {
  const sb = createServiceClient()
  type Row = { codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null; ean: string | null; ncm: string | null
    tipo_item: string | null; valor_unitario: number | null; estoque_minimo: number | null; pdv: boolean | null; inativo: boolean | null
    codigo_familia: number | null; validade_dias: number | null; full_object: { extras?: Record<string, string> } | null }
  const rows = await buscarTodasLinhas<Row>((de, ate) => sb.from('produtos')
    .select('codigo_produto, codigo, descricao, unidade, ean, ncm, tipo_item, valor_unitario, estoque_minimo, pdv, inativo, codigo_familia, validade_dias, full_object')
    .eq('loja_id', lojaId).order('id').range(de, ate), undefined, falhou)
  return rows.map((p) => ({
    codigoProduto: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, ean: p.ean, ncm: p.ncm, tipoItem: p.tipo_item,
    valorUnitario: p.valor_unitario == null ? null : Number(p.valor_unitario), estoqueMinimo: p.estoque_minimo == null ? null : Number(p.estoque_minimo),
    pdv: !!p.pdv, inativo: !!p.inativo, codigoFamilia: p.codigo_familia == null ? null : Number(p.codigo_familia), validadeDias: p.validade_dias,
    cest: p.full_object?.extras?.cest ?? null, origem: p.full_object?.extras?.origem ?? null,
  }))
}

export async function fornecedoresExistentes(lojaId: number): Promise<FornecedorExistente[]> {
  const sb = createServiceClient()
  type Row = { id: number; razao_social: string; nome_fantasia: string | null; cnpj_cpf: string | null; inscricao_estadual: string | null; email: string | null
    telefone: string | null; cep: string | null; uf: string | null; cidade: string | null; bairro: string | null; logradouro: string | null; numero: string | null; complemento: string | null }
  const rows = await buscarTodasLinhas<Row>((de, ate) => sb.from('fornecedores')
    .select('id, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, email, telefone, cep, uf, cidade, bairro, logradouro, numero, complemento')
    .eq('loja_id', lojaId).order('id').range(de, ate), undefined, falhou)
  return rows.map((f) => ({
    id: Number(f.id), razaoSocial: f.razao_social, nomeFantasia: f.nome_fantasia, cnpjCpf: f.cnpj_cpf, inscricaoEstadual: f.inscricao_estadual, email: f.email,
    telefone: f.telefone, cep: f.cep, uf: f.uf, cidade: f.cidade, bairro: f.bairro, logradouro: f.logradouro, numero: f.numero, complemento: f.complemento,
  }))
}

/** Famílias ATIVAS da loja, para pôr o nome da família na planilha exportada. A importação só aceita família ativa: produto numa
 *  família inativa sai com a coluna em branco (= não muda), senão a planilha devolvida daria erro nessa linha (loja 19, 07/11: 19 de 572). */
export async function familiasDaLoja(lojaId: number): Promise<{ codigo: number; descricao: string }[]> {
  const sb = createServiceClient()
  const { data, error } = await sb.from('familias').select('codigo_familia, nome, inativo').eq('loja_id', lojaId)
  if (error) falhou(error)
  return (data ?? []).filter((f) => f.nome && !f.inativo).map((f) => ({ codigo: Number(f.codigo_familia), descricao: String(f.nome) }))
}
