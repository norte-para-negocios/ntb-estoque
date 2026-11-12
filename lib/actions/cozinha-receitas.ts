'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getAtorGestao, getCurrentLojaId, getProfile } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { exigirDevAcao } from '@/lib/recursos-dev'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { BUCKET_FOTOS } from '@/lib/custo-cardapio/receita-info'
import { fotoEhDe, validarReceita, type DadosReceita } from '@/lib/custo-cardapio/guia-puro'

// Norte Cozinha (só dev): ficha de preparo do prato/preparação (custo_receita_info). Nunca escreve no Omie
// nem no estoque. Toda escrita é filtrada pela loja atual. O envio da foto é pela rota
// app/(app)/cozinha/pratos/[codigo]/foto (o corpo de server action é limitado a 1 MB; a foto vai até 5 MB).

type Resultado = { ok: true } | { error: string }

async function contexto(codigo: number): Promise<{ lojaId: number; nome: string } | { error: string }> {
  await exigirDevAcao()
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão' }
  const lojaId = await getCurrentLojaId()
  if (!ator.lojaIds.includes(lojaId)) return { error: 'Sem permissão nesta loja' }
  if (!Number.isSafeInteger(codigo) || codigo <= 0) return { error: 'Produto inválido' }
  const base = await carregarBase(lojaId)
  if (!base?.produtos.has(codigo)) return { error: 'Produto não encontrado nesta loja' }
  return { lojaId, nome: (await getProfile()).name }
}

function revalidar(codigo: number) {
  revalidatePath(`/cozinha/pratos/${codigo}`)
  revalidatePath('/cozinha/guia')
}

export async function salvarInfoReceita(codigo: number, dados: DadosReceita): Promise<Resultado> {
  const __d = viaDesktop('cozinha-receitas#salvarInfoReceita', salvarInfoReceita, [codigo, dados]); if (__d) return __d as never
  const ctx = await contexto(Number(codigo))
  if ('error' in ctx) return ctx
  const v = validarReceita(dados)
  if (!v.ok) return { error: v.erro }
  const { error } = await createServiceClient().from('custo_receita_info').upsert({
    loja_id: ctx.lojaId, codigo_produto: Number(codigo), ...v.row, atualizado_por: ctx.nome, updated_at: new Date().toISOString(),
  }, { onConflict: 'loja_id,codigo_produto' })
  if (error) return { error: 'Não foi possível salvar agora. Tente de novo.' }
  revalidar(Number(codigo))
  return { ok: true }
}

export async function removerFotoReceita(codigo: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-receitas#removerFotoReceita', removerFotoReceita, [codigo]); if (__d) return __d as never
  const ctx = await contexto(Number(codigo))
  if ('error' in ctx) return ctx
  const sb = createServiceClient()
  const { data: atual } = await sb.from('custo_receita_info').select('foto_path').eq('loja_id', ctx.lojaId).eq('codigo_produto', Number(codigo)).maybeSingle()
  if (!atual?.foto_path) return { ok: true }
  const { error } = await sb.from('custo_receita_info').update({ foto_path: null, atualizado_por: ctx.nome, updated_at: new Date().toISOString() })
    .eq('loja_id', ctx.lojaId).eq('codigo_produto', Number(codigo))
  if (error) return { error: 'Não foi possível tirar a foto agora. Tente de novo.' }
  // Só apaga do bucket o que é desta loja e deste produto.
  if (fotoEhDe(atual.foto_path, ctx.lojaId, Number(codigo))) {
    const { error: errRm } = await sb.storage.from(BUCKET_FOTOS).remove([atual.foto_path])
    if (errRm) console.error(`cozinha-fotos: foto de ${codigo} (loja ${ctx.lojaId}) saiu da ficha mas ficou no bucket: ${errRm.message}`)
  }
  revalidar(Number(codigo))
  return { ok: true }
}
