// Produto de serviço não mexe em estoque (decisão do dono, 03/11/2026): nem OP nem saída no Omie, igual ao modo
// próprio (lib/estoque/venda-proprio.ts, `servicos`). Serviço = tipo_item '09' do cadastro (tipo do item do Omie/SPED).
// Módulo puro (node --test).

export function ehProdutoServico(tipoItem: string | null | undefined): boolean {
  return (tipoItem ?? '').trim() === '09'
}

/** Resposta ao Norte Vendas para item de serviço: op 'sem_estrutura' com baixa != 'sem local de estoque' = ok lá. */
export function resultadoServico(codigo: string): { codigo: string; ok: true; op: 'sem_estrutura'; baixa: string; nCodOP?: undefined } {
  return { codigo, ok: true, op: 'sem_estrutura', baixa: 'Serviço (sem estoque)' }
}
