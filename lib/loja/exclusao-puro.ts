// excluirLoja apagava `lojas` com ON DELETE CASCADE em todo o ledger (movimentos, notas, OPs, inventários...) só com isAdmin()
// (auditoria 2026-11, 9.3a). Agora só exclui loja que nunca teve histórico; as demais são desativadas.
export const TABELAS_QUE_IMPEDEM_EXCLUSAO: { tabela: string; colunas: string[]; rotulo: string }[] = [
  { tabela: 'movimentos', colunas: ['loja_id'], rotulo: 'movimentos' },
  { tabela: 'estoque_movimentos', colunas: ['loja_id'], rotulo: 'movimentos do estoque próprio' },
  { tabela: 'notas_fiscais', colunas: ['loja_id'], rotulo: 'notas fiscais' },
  { tabela: 'compras_proprio', colunas: ['loja_id'], rotulo: 'notas de entrada' },
  { tabela: 'ordens_producao', colunas: ['loja_id'], rotulo: 'ordens de produção' },
  { tabela: 'ordens_producao_proprio', colunas: ['loja_id'], rotulo: 'ordens de produção do estoque próprio' },
  { tabela: 'vendas_proprio', colunas: ['loja_id'], rotulo: 'vendas' },
  { tabela: 'venda_op_vinculo', colunas: ['loja_id'], rotulo: 'vendas ligadas a OP' },
  { tabela: 'vendas_integracao_fila', colunas: ['loja_id'], rotulo: 'fila de vendas' },
  { tabela: 'inventarios', colunas: ['loja_id'], rotulo: 'inventários' },
  { tabela: 'inventarios_proprio', colunas: ['loja_id'], rotulo: 'inventários do estoque próprio' },
  { tabela: 'transferencias', colunas: ['loja_id'], rotulo: 'transferências' },
  { tabela: 'transferencias_loja', colunas: ['loja_id', 'loja_destino_id'], rotulo: 'transferências entre lojas' },
  { tabela: 'pedidos_compra', colunas: ['loja_id'], rotulo: 'pedidos de compra' },
  { tabela: 'faturamento_importado', colunas: ['loja_id'], rotulo: 'faturamento' },
]

/** null = pode excluir. Texto = motivo da recusa (simples, para a tela). `total: null` = a consulta falhou. */
export function mensagemDeExclusao(contagens: { rotulo: string; total: number | null }[]): string | null {
  const semConferir = contagens.filter((c) => c.total === null)
  if (semConferir.length) return `Não foi possível conferir o histórico da loja (${semConferir.map((c) => c.rotulo).join(', ')}). Nada foi excluído; tente de novo.`
  const com = contagens.filter((c) => (c.total ?? 0) > 0)
  if (!com.length) return null
  return `Esta loja já tem ${com.map((c) => c.rotulo).join(', ')}. Para não perder o histórico, desative a loja em vez de excluir.`
}
