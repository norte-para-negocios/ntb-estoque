// Transferência entre locais no modo 'proprio' (06/10/2026): a tela de Transferências de sempre (documento em `transferencias`,
// itens em `movimentos`), mas cada item lançado vira um PAR de movimentos no ledger (saída na origem, entrada no destino) na
// mesma transação, com custo inalterado. Nada aqui importa o Omie. As RPCs estão na migration 138.
import { createServiceClient } from '@/lib/supabase/server'
import { limparObservacao, montarObsTransferencia } from '@/lib/transferencia-obs'

export type EnvioProprioResult = {
  status: string
  descricao_status: string | null
  valor: number | null
  id_ajuste: number | null
  error?: string
}

type RespostaLancamento = {
  ok: boolean
  ref: string
  cmc: number | null
  saida?: { saldo?: number; negativo?: boolean }
  entrada?: { saldo?: number }
}

/** Texto de observação que acompanha o lançamento no ledger: motivo do item + observação geral + quem fez. */
export async function observacaoDoLancamento(lojaId: number, movimentoId: number, carimbo: string): Promise<string> {
  const supabase = createServiceClient()
  const { data: mov } = await supabase
    .from('movimentos')
    .select('obs_item, transferencia:transferencias(observacao)')
    .eq('id', movimentoId)
    .eq('loja_id', lojaId)
    .maybeSingle<{ obs_item: string | null; transferencia: { observacao: string | null } | null }>()
  return montarObsTransferencia(carimbo, mov?.transferencia?.observacao ?? null, mov?.obs_item ?? null)
}

/** Lança (ou relança, se a quantidade mudou) um item no ledger. Erro vira status 'Erro' no item, sem afetar os outros. */
export async function lancarItemTransferencia(
  lojaId: number,
  movimentoId: number,
  usuario: { id: string | null; carimbo: string }
): Promise<EnvioProprioResult & { lancamento?: RespostaLancamento }> {
  const supabase = createServiceClient()
  const obs = await observacaoDoLancamento(lojaId, movimentoId, usuario.carimbo)
  const { data, error } = await supabase.rpc('lancar_transferencia_item', {
    // p_user: o carimbo ("NTB Estoque · Nome"), igual aos outros lançamentos; o kardex mostra isso em Usuário.
    p_loja: lojaId, p_movimento: movimentoId, p_user: usuario.carimbo || usuario.id, p_obs: obs,
  })
  if (error) {
    await supabase
      .from('movimentos')
      .update({ status: 'Erro', descricao_status: error.message.slice(0, 300), updated_at: new Date().toISOString() })
      .eq('id', movimentoId)
      .eq('loja_id', lojaId)
    return { status: 'Erro', descricao_status: error.message, valor: null, id_ajuste: null, error: error.message }
  }
  const lancamento = data as RespostaLancamento
  return { status: 'Concluido', descricao_status: null, valor: lancamento.cmc ?? null, id_ajuste: null, lancamento }
}

/** Desfaz o lançamento de um item (estorna as duas pernas). Item sem lançamento: não faz nada. */
export async function desfazerItemTransferencia(lojaId: number, movimentoId: number, userId: string | null): Promise<{ ok: true } | { error: string }> {
  const { error } = await createServiceClient().rpc('estornar_transferencia_item', { p_loja: lojaId, p_movimento: movimentoId, p_user: userId })
  if (error) return { error: error.message }
  return { ok: true }
}

/** Desfaz todos os itens já lançados de uma transferência (usado ao excluí-la). Para no primeiro erro. */
export async function desfazerTransferenciaInteira(lojaId: number, transferenciaId: number, userId: string | null): Promise<{ ok: true } | { error: string }> {
  const { data: itens, error } = await createServiceClient()
    .from('movimentos')
    .select('id, ledger_ref')
    .eq('loja_id', lojaId)
    .eq('transferencia_id', transferenciaId)
  if (error) return { error: error.message }
  for (const it of (itens ?? []) as { id: number; ledger_ref: string | null }[]) {
    if (!it.ledger_ref) continue
    const r = await desfazerItemTransferencia(lojaId, it.id, userId)
    if ('error' in r) return { error: `Não foi possível estornar o item ${it.id}: ${r.error}` }
  }
  return { ok: true }
}

/** Lança todos os itens ainda pendentes (com quantidade e sem lançamento) de uma transferência. */
export async function lancarPendentesDaTransferencia(
  lojaId: number,
  transferenciaId: number,
  usuario: { id: string | null; carimbo: string }
): Promise<{ lancados: number; erros: number }> {
  const { data: itens } = await createServiceClient()
    .from('movimentos')
    .select('id, quan, status, ledger_ref')
    .eq('loja_id', lojaId)
    .eq('transferencia_id', transferenciaId)
    .order('id')
  let lancados = 0
  let erros = 0
  for (const it of (itens ?? []) as { id: number; quan: number | null; status: string | null; ledger_ref: string | null }[]) {
    if (it.quan == null || !(it.quan > 0)) continue
    if (it.ledger_ref && it.status === 'Concluido') continue // já lançado: relançar estornaria e refaria à toa
    const r = await lancarItemTransferencia(lojaId, it.id, usuario)
    if (r.status === 'Concluido') lancados++
    else erros++
  }
  return { lancados, erros }
}

/**
 * Transferência de UM produto entre dois locais, já concluída: cria o documento (aparece em Transferências com o histórico de
 * sempre) e lança o par no ledger. Usada pelo botão "Transferir" da tela de Estoque, para os dois caminhos serem o mesmo.
 */
export async function transferenciaRapida(d: {
  lojaId: number
  userId: string | null
  carimbo: string
  de: number
  para: number
  produto: number
  quantidade: number
  observacao?: string | null
  dataIso: string // timestamp ancorado (dataCriacaoBahia)
}): Promise<{ ok: true; saldoDestino: number | null; negativo: boolean; transferenciaId: number } | { error: string }> {
  const supabase = createServiceClient()
  const { data: trans, error: e1 } = await supabase
    .from('transferencias')
    .insert({
      loja_id: d.lojaId, codigo_local_origem: d.de, codigo_local_destino: d.para, motivo: 'TRF', status: 'Concluido',
      user_id: d.userId, data: d.dataIso, observacao: limparObservacao(d.observacao ?? null),
    })
    .select('id')
    .single<{ id: number }>()
  if (e1 || !trans) return { error: e1?.message ?? 'Falha ao criar a transferência' }

  const { data: mov, error: e2 } = await supabase
    .from('movimentos')
    .insert({
      loja_id: d.lojaId, transferencia_id: trans.id, tipo: 'TRF', origem: 'AJU', motivo: 'TRF', data: new Date().toISOString(),
      id_prod: d.produto, codigo_local_estoque: d.de, codigo_local_estoque_destino: d.para, quan: d.quantidade, status: 'Iniciado',
    })
    .select('id')
    .single<{ id: number }>()
  if (e2 || !mov) {
    await supabase.from('transferencias').delete().eq('id', trans.id).eq('loja_id', d.lojaId)
    return { error: e2?.message ?? 'Falha ao criar o item da transferência' }
  }

  const r = await lancarItemTransferencia(d.lojaId, mov.id, { id: d.userId, carimbo: d.carimbo })
  if (r.status !== 'Concluido' || !r.lancamento) {
    await supabase.from('transferencias').delete().eq('id', trans.id).eq('loja_id', d.lojaId) // cascade remove o item
    return { error: r.error ?? 'Falha ao lançar a transferência' }
  }
  return { ok: true, saldoDestino: r.lancamento.entrada?.saldo ?? null, negativo: !!r.lancamento.saida?.negativo, transferenciaId: trans.id }
}
