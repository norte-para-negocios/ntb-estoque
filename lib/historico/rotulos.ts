// Rótulos dos campos rastreados pela migration 220 (gatilho historico_registrar), por entidade.
import type { RotulosEntidade } from './historico-puro'

export type EntidadeHistorico = 'produto' | 'fornecedor' | 'nota_entrada' | 'pedido_compra' | 'op'

const sim = (rotulo: string) => ({ rotulo })
const num = (rotulo: string) => ({ rotulo, formato: 'numero' as const })
const brl = (rotulo: string) => ({ rotulo, formato: 'moeda' as const })
const cod = (rotulo: string) => ({ rotulo, formato: 'codigo' as const })

export const ROTULOS_HISTORICO: Record<EntidadeHistorico, RotulosEntidade> = {
  produto: {
    tabelaPrincipal: 'produtos',
    campos: {
      codigo: cod('Código'), descricao: sim('Descrição'), unidade: sim('Unidade'), ncm: cod('NCM'), ean: cod('EAN'),
      valor_unitario: brl('Preço de venda'), estoque_minimo: num('Estoque mínimo'), inativo: sim('Inativo'), bloqueado: sim('Bloqueado'),
      pdv: sim('Produto de PDV'), tipo_item: cod('Tipo do item'), codigo_familia: cod('Família (código)'), descricao_familia: sim('Família'),
      grupo_id: cod('Grupo'), validade_dias: num('Validade (dias)'), produto_pai_codigo: cod('Produto mãe'), eh_mae: sim('Produto mãe'),
      atributos: sim('Atributos'),
      'full_object.extras.cest': cod('CEST'), 'full_object.extras.origem': cod('Origem da mercadoria'), 'full_object.extras.marca': sim('Marca'),
      'full_object.extras.modelo': sim('Modelo'), 'full_object.extras.pesoLiq': num('Peso líquido'), 'full_object.extras.pesoBruto': num('Peso bruto'),
      'full_object.extras.descrDetalhada': sim('Descrição detalhada'), 'full_object.extras.obsInternas': sim('Observações internas'),
    },
  },
  fornecedor: {
    tabelaPrincipal: 'fornecedores',
    campos: {
      razao_social: sim('Razão social'), nome_fantasia: sim('Nome fantasia'), cnpj_cpf: cod('CNPJ/CPF'), pessoa_fisica: sim('Pessoa física'),
      inscricao_estadual: cod('Inscrição estadual'), inscricao_municipal: cod('Inscrição municipal'), email: sim('E-mail'), telefone: cod('Telefone'),
      cep: cod('CEP'), uf: sim('UF'), cidade: sim('Cidade'), bairro: sim('Bairro'), logradouro: sim('Endereço'), numero: cod('Número'),
      complemento: sim('Complemento'), inativo: sim('Inativo'),
    },
  },
  nota_entrada: {
    tabelaPrincipal: 'compras_proprio',
    campos: {
      status: sim('Situação'), numero: cod('Número'), serie: cod('Série'), fornecedor_cnpj: cod('CNPJ do fornecedor'), fornecedor_nome: sim('Fornecedor'),
      emissao: sim('Emissão'), valor_produtos: brl('Valor dos produtos'), valor_frete: brl('Frete'), valor_desconto: brl('Desconto'),
      valor_total: brl('Valor total'), icms_recuperavel: sim('ICMS recuperável'), codigo_local_estoque: cod('Local de estoque'), obs: sim('Observação'),
      lancada_em: sim('Entrada lançada em'), conferida_em: sim('Conferida em'), conferida_por: sim('Conferida por'), estornos: num('Estornos'),
      codigo_produto: cod('Produto ligado'), fator: num('Fator'), unidade_estoque: sim('Unidade de estoque'), quantidade: num('Quantidade'),
      quantidade_recebida: num('Quantidade recebida'), valor_unitario: brl('Valor unitário'), lancado: sim('Lançado no estoque'), lote: cod('Lote'),
      validade: sim('Validade'), cfop_entrada: cod('CFOP de entrada'), movimenta_estoque: sim('Movimenta estoque'),
      gera_conta_pagar: sim('Gera conta a pagar'), custo_icms: sim('ICMS no custo'), custo_icms_st: sim('ICMS-ST no custo'), custo_ipi: sim('IPI no custo'),
      custo_pis: sim('PIS no custo'), custo_cofins: sim('COFINS no custo'), custo_frete: sim('Frete no custo'), custo_seguro: sim('Seguro no custo'),
      custo_outras: sim('Outras despesas no custo'),
    },
  },
  pedido_compra: {
    tabelaPrincipal: 'pedidos_compra',
    campos: {
      etapa: sim('Etapa'), fornecedor_nome: sim('Fornecedor'), fornecedor_cnpj: cod('CNPJ do fornecedor'), previsao_entrega: sim('Previsão de entrega'),
      frete: brl('Frete'), outras_despesas: brl('Outras despesas'), parcelas: sim('Parcelas'), numero_fornecedor: cod('Nº no fornecedor'),
      contato: sim('Contato'), obs: sim('Observação'), obs_interna: sim('Observação interna'), motivo_cancelamento: sim('Motivo do cancelamento'),
      codigo_produto: cod('Produto'), descricao: sim('Descrição'), unidade: sim('Unidade'), fator: num('Fator'), quantidade: num('Quantidade'),
      preco_unitario: brl('Preço combinado'), codigo_local_estoque: cod('Local de estoque'),
    },
  },
  op: {
    tabelaPrincipal: 'ordens_producao',
    campos: {
      identificacao_n_qtde: num('Quantidade planejada'), identificacao_d_dt_previsao: sim('Data prevista'),
      identificacao_codigo_local_estoque: cod('Local'), local_destino: cod('Local de destino'), validade: sim('Validade'),
      quantidade: num('Quantidade de etiqueta'), concluida: sim('Concluída'), dt_conclusao_real: sim('Data de conclusão'), observacao: sim('Observação'),
      conclusao_status: sim('Situação da conclusão'), revertida_em: sim('Revertida em'), ficha_versao: num('Versão da ficha'), custo_total: brl('Custo total'),
    },
  },
}
