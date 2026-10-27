// Cubo "Recebimentos" (nota fiscal de entrada, uma linha por item da nota) — os campos e rótulos são os do Omie
// (omie-rea/relatorios/COM/rel-com-recebimentos-por-periodo/fields.json). A linha vem da RPC cubo_recebimentos (migration 299).
import { statusNF } from '../../nf-status'
import type { Linha } from '../pivot.ts'
import type { CampoCubo, Cubo, TipoCampo } from './tipos.ts'

const c = (grupo: string, tipo: TipoCampo, ids: string[], medida = false): CampoCubo[] => ids.map((id) => ({ id, tipo, grupo, ...(medida ? { medida: true } : {}) }))

export const CAMPOS_RECEBIMENTOS: CampoCubo[] = [
  ...c('Nota', 'texto', ['Situação', 'Operação', 'Etapa', 'Origem', 'Categoria', 'Nota Fiscal', 'Série', 'Chave de Acesso da NF-e', 'Manifestação do Destinatário', 'Pedido de Compra', 'Departamento', 'Comprador', 'Projeto', 'Número de Parcelas', 'Dados Adicionais para a Nota Fiscal']),
  ...c('Datas', 'data', ['Data de Emissão (completa)', 'Data de Registro (completa)', 'Data do Recebimento (completa)', 'Data do Cancelamento (completa)']),
  ...c('Datas', 'texto', ['Data de Registro.Ano', 'Data de Registro.Mês', 'Data de Emissão.Ano', 'Data de Emissão.Mês']),
  ...c('Fornecedor', 'texto', ['Fornecedor/Cliente (Razão Social)', 'Fornecedor/Cliente (Nome Fantasia)', 'Fornecedor/Cliente (CNPJ/CPF)', 'Fornecedor/Cliente (Inscrição Estadual)']),
  ...c('Transportadora', 'texto', ['Transportadora (Razão Social)', 'Transportadora (Nome Fantasia)', 'Transportadora (CNPJ/CPF)']),
  ...c('Item', 'texto', ['Código do Produto', 'Descrição do Produto', 'Descrição do Produto (completa)', 'Código do Produto na NF-e', 'Descrição do Produto na NF-e', 'Código da Família', 'Família de Produto', 'Código EAN (GTIN)', 'Código NCM', 'CFOP de Entrada', 'CFOP no Documento Fiscal', 'Unidade']),
  ...c('Item', 'numero', ['Item', 'Quantidade', 'Valor Unitário'], true),
  ...c('Valores', 'moeda', ['Total de Mercadoria', 'Desconto', 'Frete', 'Seguro', 'Outras Despesas Acessórias', 'Total do Documento Fiscal', 'Valor Aprox. dos Impostos', 'Valor do ICMS', 'Valor do ICMS ST', 'Valor do IPI', 'Valor do PIS', 'Valor do COFINS'], true),
  ...c('Custo de Estoque', 'moeda', ['Custo de Estoque - Valor de Entrada'], true),
  ...c('Custo de Estoque', 'texto', ['Custo de Estoque - ICMS é Custo', 'Custo de Estoque - ICMS ST é Custo', 'Custo de Estoque - IPI é Custo', 'Custo de Estoque - PIS é Custo', 'Custo de Estoque - COFINS é Custo', 'Custo de Estoque - Frete é Custo', 'Custo de Estoque - Seguro é Custo', 'Custo de Estoque - Outras Despesas é Custo']),
]

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const txt = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
/** 'dd/mm/aaaa' (Omie) ou 'aaaa-mm-dd' (banco) -> 'aaaa-mm-dd'. */
function dataISO(v: unknown): string | null {
  const s = txt(v)
  if (!s) return null
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}
const sn = (v: unknown): string | null => (v === 'S' ? 'Sim' : v === 'N' ? 'Não' : null)

export function linhaRecebimentos(r: Record<string, unknown>): Linha {
  const nota = obj(r.nota_full)
  const item = obj(r.item_full)
  const cab = obj(item.itensCabec)
  const aj = obj(item.itensAjustes)
  const custo = obj(item.itensCustoEstoque)
  const sefaz = obj(item.sefaz)
  const info = obj(nota.infoCadastro)
  const adic = obj(nota.infoAdicionais)
  const transp = obj(nota.transporte)
  const parcelas = obj(nota.parcelas).parcelasLista
  const qtd = num(r.n_qtde_nfe) ?? num(cab.nQtdeNFe)
  const unit = num(r.n_preco_unit) ?? num(cab.nPrecoUnit)
  const emissao = dataISO(r.d_emissao_nfe)
  const registro = dataISO(adic.dRegistro) ?? emissao
  const recebimento = dataISO(info.dRec)
  const mes = (d: string | null) => (d ? d.slice(0, 7) : null)
  const ano = (d: string | null) => (d ? d.slice(0, 4) : null)
  const status = statusNF(txt(r.c_etapa), nota)

  return {
    'Situação': status.label,
    'Operação': 'Nota Fiscal Recebida',
    'Etapa': txt(r.c_etapa),
    'Origem': txt(r.origem),
    'Categoria': txt(r.categoria),
    'Nota Fiscal': txt(r.c_numero_nfe),
    'Série': txt(r.c_serie_nfe),
    'Chave de Acesso da NF-e': txt(r.c_chave_nfe),
    'Manifestação do Destinatário': info.cRecebido === 'S' ? 'Manifestada' : null,
    'Pedido de Compra': txt(r.n_id_pedido),
    'Departamento': null,
    'Comprador': null,
    'Projeto': null,
    'Número de Parcelas': Array.isArray(parcelas) ? String(parcelas.length) : null,
    'Dados Adicionais para a Nota Fiscal': txt(adic.cInfoCompl),
    'Data de Emissão (completa)': emissao,
    'Data de Registro (completa)': registro,
    'Data do Recebimento (completa)': recebimento,
    'Data do Cancelamento (completa)': info.cCancelada === 'S' ? registro : null,
    'Data de Registro.Ano': ano(registro),
    'Data de Registro.Mês': mes(registro),
    'Data de Emissão.Ano': ano(emissao),
    'Data de Emissão.Mês': mes(emissao),
    'Fornecedor/Cliente (Razão Social)': txt(r.c_razao_social),
    'Fornecedor/Cliente (Nome Fantasia)': txt(r.c_nome) ?? txt(r.c_razao_social),
    'Fornecedor/Cliente (CNPJ/CPF)': txt(r.c_cnpj_cpf),
    'Fornecedor/Cliente (Inscrição Estadual)': txt(r.c_inscricao),
    'Transportadora (Razão Social)': txt(transp.cNomeTransp),
    'Transportadora (Nome Fantasia)': txt(transp.cNomeTransp),
    'Transportadora (CNPJ/CPF)': txt(transp.cCnpjCpfTransp),
    'Código do Produto': txt(r.prod_codigo) ?? txt(r.n_id_produto),
    'Descrição do Produto': txt(r.prod_descricao) ?? txt(r.c_descricao_produto),
    'Descrição do Produto (completa)': txt(r.prod_descricao) ?? txt(r.c_descricao_produto),
    'Código do Produto na NF-e': txt(r.c_codigo_produto),
    'Descrição do Produto na NF-e': txt(r.c_descricao_produto),
    'Código da Família': txt(r.prod_cod_familia),
    'Família de Produto': txt(r.prod_familia),
    'Código EAN (GTIN)': txt(r.c_ean),
    'Código NCM': txt(r.c_ncm),
    'CFOP de Entrada': txt(aj.cCFOPEntrada),
    'CFOP no Documento Fiscal': txt(r.c_cfop),
    'Unidade': txt(r.c_unidade_nfe),
    'Item': num(r.n_sequencia),
    'Quantidade': qtd,
    'Valor Unitário': unit,
    'Total de Mercadoria': qtd != null && unit != null ? Math.round(qtd * unit * 100) / 100 : null,
    'Desconto': num(r.v_desconto) ?? num(cab.vDesconto),
    'Frete': num(r.v_frete) ?? num(sefaz.vFrete),
    'Seguro': num(sefaz.vSeg),
    'Outras Despesas Acessórias': num(sefaz.vOutro),
    'Total do Documento Fiscal': num(r.v_total_item) ?? num(cab.vTotalItem),
    'Valor Aprox. dos Impostos': null,
    'Valor do ICMS': num(obj(item.itensICMS).nValor),
    'Valor do ICMS ST': num(obj(item.itensICMSST).nValorST),
    'Valor do IPI': num(obj(item.itensIPI).nValIPI),
    'Valor do PIS': num(obj(item.itensPIS).nValPIS),
    'Valor do COFINS': num(obj(item.itensCOFINS).nValCOFINS),
    'Custo de Estoque - Valor de Entrada': null,
    'Custo de Estoque - ICMS é Custo': sn(custo.cICMSCusto),
    'Custo de Estoque - ICMS ST é Custo': sn(custo.cICMSSTCusto),
    'Custo de Estoque - IPI é Custo': sn(custo.cIPICusto),
    'Custo de Estoque - PIS é Custo': sn(custo.cPISCusto),
    'Custo de Estoque - COFINS é Custo': sn(custo.cCOFINSCusto),
    'Custo de Estoque - Frete é Custo': sn(custo.cFreteCusto),
    'Custo de Estoque - Seguro é Custo': sn(custo.cSeguroCusto),
    'Custo de Estoque - Outras Despesas é Custo': sn(custo.cOutrosDespCusto),
  }
}

export const CUBO_RECEBIMENTOS: Cubo = { id: 'recebimentos', titulo: 'Recebimentos', campos: CAMPOS_RECEBIMENTOS, linhaDoCubo: linhaRecebimentos }
