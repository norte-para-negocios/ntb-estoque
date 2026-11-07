// Fase 6: exportar o cadastro atual no MESMO formato da importação por planilha (colunas de COLUNAS). Baixar, editar e importar de volta:
// o que não foi editado volta como "sem mudança" na prévia (provado no teste de ida e volta).
import type { FornecedorExistente, ProdutoExistente } from './planilha-puro'

export type LinhaExport = Record<string, string>

// número no formato que parseNumeroBR lê de volta sem ambiguidade: vírgula decimal, sem separador de milhar
export function numeroBR(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return ''
  return String(Math.round(x * 1e6) / 1e6).replace('.', ',')
}
const simNao = (b: boolean) => (b ? 'sim' : 'não')
const txt = (s: string | null | undefined) => (s ?? '').trim()

export function linhasExportProdutos(existentes: ProdutoExistente[], familias: { codigo: number; descricao: string }[]): LinhaExport[] {
  const nomeFamilia = new Map(familias.map((f) => [f.codigo, f.descricao]))
  return [...existentes]
    .sort((a, b) => txt(a.descricao).localeCompare(txt(b.descricao), 'pt-BR') || a.codigoProduto - b.codigoProduto)
    .map((p) => ({
      codigo: txt(p.codigo),
      descricao: txt(p.descricao),
      unidade: txt(p.unidade),
      tipo: txt(p.tipoItem),
      familia: p.codigoFamilia == null ? '' : nomeFamilia.get(p.codigoFamilia) ?? '',
      ncm: txt(p.ncm),
      ean: txt(p.ean),
      cest: txt(p.cest),
      origem: txt(p.origem),
      preco_venda: numeroBR(p.valorUnitario),
      estoque_minimo: numeroBR(p.estoqueMinimo),
      pdv: simNao(p.pdv),
      validade_dias: p.validadeDias == null ? '' : String(p.validadeDias),
      inativo: simNao(p.inativo),
    }))
}

export function linhasExportFornecedores(existentes: FornecedorExistente[]): LinhaExport[] {
  return [...existentes]
    .sort((a, b) => txt(a.razaoSocial).localeCompare(txt(b.razaoSocial), 'pt-BR') || a.id - b.id)
    .map((f) => ({
      razao_social: txt(f.razaoSocial),
      nome_fantasia: txt(f.nomeFantasia),
      cnpj_cpf: txt(f.cnpjCpf),
      inscricao_estadual: txt(f.inscricaoEstadual),
      email: txt(f.email),
      telefone: txt(f.telefone),
      cep: txt(f.cep),
      uf: txt(f.uf),
      cidade: txt(f.cidade),
      bairro: txt(f.bairro),
      logradouro: txt(f.logradouro),
      numero: txt(f.numero),
      complemento: txt(f.complemento),
    }))
}
