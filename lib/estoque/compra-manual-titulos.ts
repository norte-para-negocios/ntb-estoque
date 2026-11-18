// F-01: a compra digitada ("Lançar sem XML") só ganha o vínculo com a nota DEPOIS de entrar no estoque. O gatilho
// trg_compra_conta_pagar (migrations 340/360) dispara só quando o status muda e sai calado se nota_fiscal_id ainda é nulo,
// então a conta a pagar nunca nascia. Depois de gravar o vínculo, esta função pede a geração (idempotente; a função do banco
// respeita a chave lojas.fin_cp_da_nota_ativo). Falha aqui nunca desfaz a entrada: o motivo vai para fin_eventos, como no gatilho.

type RpcResp = { data: unknown; error: { message: string } | null }
export type ClienteRpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResp> }

export async function gerarTitulosDaCompraManual(
  db: ClienteRpc, lojaId: number, notaId: number,
): Promise<{ ok: true; gerados: number } | { ok: false; erro: string }> {
  let erro: string | null = null
  try {
    const { data, error } = await db.rpc('fin_titulos_da_nota_gerar', {
      p_loja: lojaId, p_nota: notaId, p_user: null, p_user_nome: 'Entrada da nota fiscal',
    })
    if (error) erro = error.message
    else return { ok: true, gerados: Number((data as { gerados?: number } | null)?.gerados) || 0 }
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e)
  }
  try {
    await db.rpc('fin_registrar_evento', {
      p_loja: lojaId, p_entidade: 'nota_entrada', p_id: notaId, p_tipo: 'titulos_falha',
      p_detalhe: { erro: erro.slice(0, 300), status: 'lancada' }, p_user: null, p_user_nome: 'Entrada da nota fiscal',
    })
  } catch { /* o registro é só aviso; não pode quebrar a entrada */ }
  return { ok: false, erro }
}
