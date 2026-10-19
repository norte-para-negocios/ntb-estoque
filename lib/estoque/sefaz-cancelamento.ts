// Cancelamento de NF-e vindo da SEFAZ (evento 110111 ou resumo com situação 3): chama sefaz_marcar_cancelada
// (migrations 180/230) e LANÇA se o banco falhar, para quem processa o documento não marcá-lo como processado
// (revisão da Fase F, I2: o erro era ignorado e o cancelamento se perdia). Sem imports: node --test lib/estoque/sefaz-cancelamento.test.ts

export type RespostaCancelamento = { nota: boolean; estornada: boolean; estornoPendente: boolean; mesFechado: boolean }
type Rpc = (nome: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>

export async function marcarCanceladaNaSefaz(rpc: Rpc, lojaId: number, chave: string): Promise<RespostaCancelamento> {
  const { data, error } = await rpc('sefaz_marcar_cancelada', { p_loja: lojaId, p_chave: chave })
  if (error) throw new Error(`cancelamento da nota na SEFAZ: ${error.message}`)
  const d = (data ?? {}) as { nota?: boolean; estornada?: boolean; estorno_pendente?: boolean; mes_fechado?: boolean }
  return { nota: !!d.nota, estornada: !!d.estornada, estornoPendente: !!d.estorno_pendente, mesFechado: !!d.mes_fechado }
}
