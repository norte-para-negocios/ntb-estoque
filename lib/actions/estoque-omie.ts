'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

// "Nosso Omie" Fase 4: escrever no Omie pelas telas de estoque da loja Omie. Reaproveita as actions de sempre
// (criarAjusteManual, transferência), que leem o CMC ao vivo. Loja 4 bloqueada; loja de teste = escrita simulada.

import { revalidatePath } from 'next/cache'
import { contextoEscritaOmie } from '@/lib/estoque/contexto-escrita-omie'
import { deltaDoAjuste } from '@/lib/estoque/escrita-omie-puro'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { dataOmieBR } from '@/lib/data-bahia'
import { criarAjusteManual } from '@/lib/actions/movimentacoes'
import { addMovimento, createTransferencia, enviarMovimento, finishTransferencia, salvarObservacaoTransferencia } from '@/lib/actions/transferencia'

type Resposta = { ok: true; aviso?: string } | { error: string }

const PERM = 'Estoque - Lancar no Omie'

function numero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function atualizarTelas() {
  revalidatePath('/estoque')
  revalidatePath('/estoque/produto/[codigo]', 'page')
  revalidatePath('/estoque/local/[codigo]', 'page')
  revalidatePath('/estoque/ajustes')
  revalidatePath('/movimentacoes')
}

/** Resultado do criarAjusteManual (Omie) → resposta da tela. 'Sem CMC' fica gravado e o cron reenvia. */
function respostaDoAjuste(r: { error?: string; status?: string; erro?: string }, sucesso: string): Resposta {
  if (r.error) return { error: r.error }
  if (r.status === 'Concluido') return { ok: true, aviso: sucesso }
  if (r.status === 'Sem CMC') return { ok: true, aviso: 'Gravado, mas o produto está sem custo médio no Omie: o lançamento fica pendente e o sistema reenvia sozinho quando o custo aparecer.' }
  return { error: r.erro ?? 'O Omie recusou o lançamento. Ele fica pendente e o sistema tenta de novo.' }
}

/** Entrada no Omie (ENT) pelo custo médio atual do produto (lido na hora). */
export async function entradaOmie(dados: { codigoProduto: number; codigoLocal: number; quantidade: number | string; obs?: string }): Promise<Resposta> {
  const __d = viaDesktop('estoque-omie#entradaOmie', entradaOmie, [dados]); if (__d) return __d as never
  const ctx = await contextoEscritaOmie(PERM, 'Movimentacoes - Criar')
  if ('error' in ctx) return ctx
  const quantidade = numero(dados.quantidade)
  if (quantidade == null || quantidade <= 0) return { error: 'Informe uma quantidade maior que zero.' }
  const r = await criarAjusteManual({
    idProd: dados.codigoProduto, tipo: 'ENT', codigoLocalEstoque: dados.codigoLocal, quantidade,
    motivo: dados.obs?.trim() || 'Entrada pela tela de estoque',
  })
  atualizarTelas()
  return respostaDoAjuste(r, ctx.loja.is_test ? 'Loja de teste: lançamento simulado, nada foi enviado ao Omie.' : 'Lançada no Omie.')
}

/**
 * Ajuste no Omie: "saldo contado" (lê o saldo do local ao vivo no Omie e lança a diferença) ou "diferença"
 * (+ sobra, − falta). Vira uma entrada ou saída pelo custo médio atual.
 */
export async function ajusteOmie(dados: {
  codigoProduto: number; codigoLocal: number; motivo: string; novoSaldo?: number | string | null; diferenca?: number | string | null
}): Promise<Resposta> {
  const __d = viaDesktop('estoque-omie#ajusteOmie', ajusteOmie, [dados]); if (__d) return __d as never
  const ctx = await contextoEscritaOmie(PERM, 'Movimentacoes - Criar')
  if ('error' in ctx) return ctx
  if (!dados.motivo?.trim()) return { error: 'Informe o motivo do ajuste.' }
  const contagem = dados.novoSaldo != null && String(dados.novoSaldo).trim() !== ''
  const valor = numero(contagem ? dados.novoSaldo : dados.diferenca)
  if (valor == null) return { error: 'Valor inválido.' }
  let saldoAtual = 0
  if (contagem) {
    try {
      const pos = await getPosicaoProduto(ctx.loja, dados.codigoLocal, dados.codigoProduto, dataOmieBR(null))
      saldoAtual = pos?.n_saldo ?? 0
    } catch (e) {
      return { error: `Não foi possível ler o saldo atual no Omie: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  const d = deltaDoAjuste({ modo: contagem ? 'contagem' : 'diferenca', valor, saldoAtual })
  if ('erro' in d) return { error: d.erro }
  const r = await criarAjusteManual({
    idProd: dados.codigoProduto, tipo: d.tipo, codigoLocalEstoque: dados.codigoLocal, quantidade: d.quantidade, motivo: dados.motivo.trim(),
  })
  atualizarTelas()
  const feito = `${d.tipo === 'ENT' ? 'Entrada' : 'Saída'} de ${d.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${contagem ? ` (saldo no Omie era ${saldoAtual.toLocaleString('pt-BR', { maximumFractionDigits: 3 })})` : ''}`
  return respostaDoAjuste(r, ctx.loja.is_test ? `Loja de teste: ${feito} simulada, nada foi enviado ao Omie.` : `${feito} lançada no Omie.`)
}

/**
 * Transferência de um produto entre dois locais no Omie: cria a transferência, o item e envia na hora (mesmo
 * caminho da tela de Transferências: TRF pelo custo médio). Se o Omie não confirmar, ela fica pendente lá e o
 * cron reenvia; só fecha (sem nova chamada ao Omie) quando o item concluiu.
 */
export async function transferirOmie(dados: { codigoProduto: number; de: number; para: number; quantidade: number | string; obs?: string }): Promise<Resposta> {
  const __d = viaDesktop('estoque-omie#transferirOmie', transferirOmie, [dados]); if (__d) return __d as never
  const ctx = await contextoEscritaOmie(PERM, 'Transferencias - Criar', 'Transferencias - Editar')
  if ('error' in ctx) return ctx
  if (dados.de === dados.para) return { error: 'Origem e destino não podem ser o mesmo local.' }
  const quantidade = numero(dados.quantidade)
  if (quantidade == null || quantidade <= 0) return { error: 'Informe uma quantidade maior que zero.' }

  const t = await createTransferencia({ codigoLocalOrigem: dados.de, codigoLocalDestino: dados.para, tipo: 'TRF' })
  if ('error' in t && t.error) return { error: t.error }
  const id = (t as { id?: number }).id
  if (!id) return { error: 'Não foi possível criar a transferência.' }
  if (dados.obs?.trim()) await salvarObservacaoTransferencia(id, dados.obs)
  const mov = await addMovimento(id, { id_prod: dados.codigoProduto })
  if (!mov?.id) return { error: `Transferência ${id} criada, mas o item não foi gravado. Termine pela tela de Transferências.` }
  const envio = await enviarMovimento(mov.id, quantidade)
  atualizarTelas()
  revalidatePath('/transferencia')
  if (envio.status === 'Concluido') {
    await finishTransferencia(id)
    return { ok: true, aviso: ctx.loja.is_test ? 'Loja de teste: transferência simulada, nada foi enviado ao Omie.' : 'Transferida no Omie.' }
  }
  if (envio.status === 'Sem CMC') return { ok: true, aviso: `Transferência ${id} gravada, mas o produto está sem custo médio no Omie: fica pendente e o sistema reenvia sozinho.` }
  return { error: `Transferência ${id} gravada, mas o Omie não confirmou (${envio.descricao_status ?? envio.error ?? envio.status}). Ela fica pendente e o sistema tenta de novo; acompanhe em Transferências.` }
}
