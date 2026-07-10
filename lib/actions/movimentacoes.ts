'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { carimboUsuario, getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { omieRequest, logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { dataCriacaoBahia, dataOmieBR, hojeBahiaISO } from '@/lib/data-bahia'
import { registrarAuditoria } from '@/lib/auditoria'

const TIPOS_MANUAIS = new Set(['ENT', 'SAI'])

/**
 * Cria um ajuste manual de saldo (entrada ou saida num unico local) direto da
 * tela de Movimentacoes, sem passar pela contagem de inventario. Perda/quebra e
 * transferencia entre locais continuam pelo fluxo /transferencia (que ja lanca
 * TPQ como TRF para um local de perda dedicado -- nao duplicar essa logica aqui).
 * Grava o `movimentos` local e lanca o Ajuste de Estoque no Omie na hora (mesma
 * chamada usada por inventario/transferencia).
 */
export async function criarAjusteManual(input: {
  idProd: number
  tipo: 'ENT' | 'SAI'
  codigoLocalEstoque: number
  quantidade: number
  motivo: string
  data?: string // YYYY-MM-DD; vazio = hoje. Nao pode ser futura.
}) {
  if (!TIPOS_MANUAIS.has(input.tipo)) {
    return { error: 'Tipo de ajuste invalido' }
  }
  if (!(input.quantidade > 0)) {
    return { error: 'Quantidade precisa ser maior que zero' }
  }
  if (!input.motivo.trim()) {
    return { error: 'Informe o motivo do ajuste' }
  }
  const hojeBahia = hojeBahiaISO()
  if (input.data && input.data > hojeBahia) {
    return { error: 'A data nao pode ser futura' }
  }

  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes - Criar'))) {
    return { error: 'Sem permissao para criar movimento' }
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return { error: 'Loja nao encontrada' }

  const dataCriacao = dataCriacaoBahia(input.data) ?? dataCriacaoBahia(hojeBahia)!
  const obsCarimbo = `${input.motivo.trim()} · ${await carimboUsuario()}`

  const { data: mov } = await supabase
    .from('movimentos')
    .insert({
      loja_id: lojaId,
      tipo: input.tipo,
      origem: 'AJU',
      motivo: input.tipo,
      data: dataCriacao,
      id_prod: input.idProd,
      codigo_local_estoque: input.codigoLocalEstoque,
      quan: input.tipo === 'SAI' ? -Math.abs(input.quantidade) : Math.abs(input.quantidade),
      obs: obsCarimbo,
      status: 'Processando',
    })
    .select('id')
    .single()
  if (!mov) return { error: 'Falha ao gravar o movimento' }

  try {
    const posicao = await getPosicaoProduto(loja, input.codigoLocalEstoque, input.idProd, dataOmieBR(null))
    const valor = posicao?.n_cmc ?? 0

    if (valor <= 0) {
      await supabase.from('movimentos').update({ status: 'Sem CMC', descricao_status: 'Sem CMC' }).eq('id', mov.id)
      revalidatePath('/movimentacoes')
      return { id: mov.id, status: 'Sem CMC' }
    }

    const quan = input.tipo === 'SAI' ? -Math.abs(input.quantidade) : Math.abs(input.quantidade)
    const param = {
      codigo_local_estoque: input.codigoLocalEstoque,
      id_prod: input.idProd,
      cod_int_ajuste: `MOV-${mov.id}`,
      data: dataOmieBR(dataCriacao),
      quan,
      valor,
      obs: obsCarimbo,
      origem: 'AJU',
      tipo: input.tipo,
      motivo: input.tipo,
    }

    const res = await omieRequest<{
      codigo_status?: string
      descricao_status?: string
      id_movest?: number
      id_ajuste?: number
    }>({
      loja_id: lojaId,
      omie_app_key: loja.omie_app_key,
      omie_app_secret: loja.omie_app_secret,
      endpoint: 'v1/estoque/ajuste',
      call: 'IncluirAjusteEstoque',
      data: param,
    })

    await logIntegrationAttempt({
      loja_id: lojaId,
      model: 'Movimento',
      request: JSON.stringify(param),
      response: JSON.stringify(res),
      code: res.codigo_status ?? '200',
    })

    const sucesso = res.id_ajuste != null
    await supabase
      .from('movimentos')
      .update({
        status: sucesso ? 'Concluido' : 'Erro',
        codigo_status: res.codigo_status ?? null,
        descricao_status: res.descricao_status ?? (sucesso ? null : 'Omie nao retornou id do ajuste'),
        id_movest: res.id_movest ?? null,
        id_ajuste: res.id_ajuste ?? null,
        response: JSON.stringify(res),
      })
      .eq('id', mov.id)

    if (sucesso) await registrarAuditoria('criar', 'movimento', mov.id, `Ajuste manual ${input.tipo} · ${input.motivo.trim()}`)
    revalidatePath('/movimentacoes')
    return { id: mov.id, status: sucesso ? 'Concluido' : 'Erro', erro: sucesso ? undefined : (res.descricao_status ?? 'Omie recusou o ajuste') }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('movimentos').update({ status: 'Erro', descricao_status: msg }).eq('id', mov.id)
    await logIntegrationAttempt({ loja_id: lojaId, model: 'Movimento', request: JSON.stringify(input), error: true, error_message: msg })
    revalidatePath('/movimentacoes')
    return { error: msg }
  }
}
