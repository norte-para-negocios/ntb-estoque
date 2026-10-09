'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { validarFicha, type ItemFicha } from '@/lib/estoque/receita'
import { desativarFicha as desativarNoBanco, produzirLote, salvarFicha as salvarNoBanco } from '@/lib/estoque/receita-db'

type Erro = { error: string }

async function contexto(permissao: string): Promise<{ lojaId: number; userId: string | null } | Erro> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Esta loja não usa o estoque próprio.' }
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  const user = await getUser()
  return { lojaId, userId: user?.id ?? null }
}

function mensagem(e: unknown, padrao: string): string {
  const m = e instanceof Error ? e.message : padrao
  if (/circular|ciclo/i.test(m)) return 'Receita circular: um dos insumos já usa este produto.'
  return m || padrao
}

function atualizar() {
  revalidatePath('/ficha-tecnica')
  revalidatePath('/producao-propria')
  revalidatePath('/estoque')
}

/** Grava uma NOVA versão da ficha (a anterior fica no histórico). */
export async function salvarFichaTecnica(dados: {
  codigoProduto: number
  rendimento: number
  itens: ItemFicha[]
  expandirNaVenda?: boolean
  obs?: string
}): Promise<{ ok: true; versao: number } | Erro> {
  const __d = viaDesktop('ficha-tecnica#salvarFichaTecnica', salvarFichaTecnica, [dados]); if (__d) return __d as never
  const ctx = await contexto('Produtos - Editar')
  if ('error' in ctx) return ctx
  const erros = validarFicha(dados.codigoProduto, dados.rendimento, dados.itens)
  if (erros.length) return { error: erros[0].mensagem }
  try {
    const r = await salvarNoBanco({
      lojaId: ctx.lojaId, produto: dados.codigoProduto, rendimento: dados.rendimento, itens: dados.itens,
      expandirNaVenda: dados.expandirNaVenda, user: ctx.userId, obs: dados.obs?.trim() || null,
    })
    await registrarAuditoria('editar', 'ficha técnica', dados.codigoProduto, `versão ${r.versao}`)
    atualizar()
    return { ok: true, versao: r.versao }
  } catch (e) {
    return { error: mensagem(e, 'Falha ao salvar a ficha técnica') }
  }
}

/** Desativa a receita: o produto volta a baixar a si mesmo na venda. */
export async function desativarFichaTecnica(codigoProduto: number): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('ficha-tecnica#desativarFichaTecnica', desativarFichaTecnica, [codigoProduto]); if (__d) return __d as never
  const ctx = await contexto('Produtos - Editar')
  if ('error' in ctx) return ctx
  try {
    await desativarNoBanco(ctx.lojaId, codigoProduto)
    await registrarAuditoria('editar', 'ficha técnica', codigoProduto, 'desativada')
    atualizar()
    return { ok: true }
  } catch (e) {
    return { error: mensagem(e, 'Falha ao desativar a ficha técnica') }
  }
}

/** Produz um lote: consome os insumos no local de consumo e entrega o produto no local de destino. */
export async function produzirLoteAction(dados: {
  codigoProduto: number
  quantidade: number
  localConsumo: number
  localDestino: number
  obs?: string
  /** Chave de idempotência da tela (um duplo clique não produz duas vezes). */
  ref?: string
}): Promise<{ ok: true; custoUnitario: number; custoTotal: number; duplicado: boolean } | Erro> {
  const __d = viaDesktop('ficha-tecnica#produzirLoteAction', produzirLoteAction, [dados]); if (__d) return __d as never
  const ctx = await contexto('Ordem de Producao - Criar')
  if ('error' in ctx) return ctx
  if (!(dados.quantidade > 0)) return { error: 'Informe a quantidade a produzir.' }
  const ref = dados.ref?.trim() || `prod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  try {
    const r = await produzirLote({
      lojaId: ctx.lojaId, produto: dados.codigoProduto, quantidade: dados.quantidade,
      localConsumo: dados.localConsumo, localDestino: dados.localDestino, ref, user: ctx.userId, obs: dados.obs?.trim() || null,
    })
    await registrarAuditoria('criar', 'produção de lote', dados.codigoProduto, `${dados.quantidade} un`)
    atualizar()
    return { ok: true, custoUnitario: Number(r.custo_unitario), custoTotal: Number(r.custo_total), duplicado: !!r.duplicado }
  } catch (e) {
    return { error: mensagem(e, 'Falha ao produzir o lote') }
  }
}
