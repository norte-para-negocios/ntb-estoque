'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { createHash } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { contextoCompras, msgErroCompras, type ErroCompras } from '@/lib/compras/servidor'
import { lerPlanilha, TAMANHO_MAX_PLANILHA } from '@/lib/compras/ler-planilha'
import { parcelasDoTexto } from '@/lib/compras/pedido-puro'
import { pedidosParaSql, validarImportacao, type CadastroImportacao, type ResultadoImportacao } from '@/lib/compras/importar-pedidos-puro'

// Importar pedidos de compra por planilha (Fase C2, I5; só estoque próprio). A prévia e a confirmação leem e validam o
// arquivo de novo no servidor (nunca confiam na prévia que voltou do navegador). A gravação é pc_importar (242): tudo ou
// nada, idempotente pelo sha256 do arquivo. Nada aqui fala com o Omie.

export type ArquivoImportacao = { nome: string; base64: string }
type PedidoJaImportado = { id: number; numero: number; fornecedor: string }

async function cadastro(lojaId: number): Promise<CadastroImportacao> {
  const sb = createServiceClient()
  const [produtos, { data: fs }, { data: ls }] = await Promise.all([
    buscarTodasLinhas<{ codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null }>((de, ate) =>
      sb.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).neq('inativo', true).order('id').range(de, ate)),
    sb.from('fornecedores').select('id, razao_social, nome_fantasia, cnpj_cpf, inativo').eq('loja_id', lojaId).limit(5000),
    sb.from('local_estoques').select('codigo_local_estoque').eq('loja_id', lojaId).is('deleted_at', null),
  ])
  return {
    produtos: produtos.map((p) => ({ codigoProduto: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao ?? String(p.codigo_produto), unidade: p.unidade })),
    fornecedores: (fs ?? []).filter((f) => !f.inativo).map((f) => ({ id: Number(f.id), nome: (f.razao_social || f.nome_fantasia || `Fornecedor ${f.id}`) as string, cnpj: (f.cnpj_cpf ?? '').replace(/\D/g, '') || null })),
    locais: (ls ?? []).map((l) => Number(l.codigo_local_estoque)),
    lerParcelas: parcelasDoTexto,
  }
}

async function lerEValidar(lojaId: number, arq: ArquivoImportacao): Promise<{ resultado: ResultadoImportacao; chave: string } | ErroCompras> {
  if (!/\.(xlsx|csv)$/i.test(arq?.nome ?? '')) return { error: 'Envie a planilha em .xlsx ou .csv (use o modelo).' }
  if (!arq.base64 || arq.base64.length > Math.ceil((TAMANHO_MAX_PLANILHA * 4) / 3) + 8) return { error: 'Arquivo vazio ou grande demais (máximo 600 KB).' }
  const buf = Buffer.from(arq.base64, 'base64')
  const matriz = await lerPlanilha(buf)
  if ('erro' in matriz) return { error: matriz.erro }
  return { resultado: validarImportacao(matriz, await cadastro(lojaId)), chave: `imp:${createHash('sha256').update(buf).digest('hex')}` }
}

async function jaImportada(lojaId: number, chave: string): Promise<PedidoJaImportado[]> {
  const { data } = await createServiceClient().from('pedidos_compra').select('id, numero, fornecedor_nome')
    .eq('loja_id', lojaId).like('chave_idempotencia', `${chave}:%`).order('id')
  return (data ?? []).map((p) => ({ id: Number(p.id), numero: Number(p.numero), fornecedor: p.fornecedor_nome }))
}

/** Prévia: cada linha com seus erros e os pedidos que vão ser criados. Não grava nada. */
export async function previaImportacaoPedidos(arq: ArquivoImportacao): Promise<{ resultado: ResultadoImportacao; jaImportada: PedidoJaImportado[] } | ErroCompras> {
  const __d = viaDesktop('importar-pedidos#previaImportacaoPedidos', previaImportacaoPedidos, [arq]); if (__d) return __d as never
  const ctx = await contextoCompras(['Compras - Pedidos'])
  if ('error' in ctx) return ctx
  const r = await lerEValidar(ctx.lojaId, arq)
  if ('error' in r) return r
  return { resultado: r.resultado, jaImportada: await jaImportada(ctx.lojaId, r.chave) }
}

/** Grava os pedidos (rascunho) se a planilha não tiver nenhum erro. O mesmo arquivo de novo devolve os pedidos da 1ª vez. */
export async function confirmarImportacaoPedidos(arq: ArquivoImportacao): Promise<{ pedidos: PedidoJaImportado[]; duplicado: boolean } | ErroCompras> {
  const __d = viaDesktop('importar-pedidos#confirmarImportacaoPedidos', confirmarImportacaoPedidos, [arq]); if (__d) return __d as never
  const ctx = await contextoCompras(['Compras - Pedidos'])
  if ('error' in ctx) return ctx
  const r = await lerEValidar(ctx.lojaId, arq)
  if ('error' in r) return r
  if (r.resultado.erroGeral) return { error: r.resultado.erroGeral }
  if (r.resultado.erros > 0) return { error: `A planilha tem ${r.resultado.erros} linha(s) com erro. Corrija e envie de novo.` }
  const { data, error } = await createServiceClient().rpc('pc_importar', {
    p_loja: ctx.lojaId, p_chave: r.chave, p_pedidos: pedidosParaSql(r.resultado.pedidos), p_user: ctx.userId, p_nome: ctx.nome,
  })
  if (error) return { error: msgErroCompras('importar-pedidos', error) }
  const res = data as { duplicado: boolean; pedidos: PedidoJaImportado[] }
  if (!res.duplicado) {
    for (const p of res.pedidos) await registrarAuditoria('criar', 'pedido_compra', p.id, `Pedido de compra ${p.numero} (planilha ${arq.nome.slice(0, 80)})`)
  }
  revalidatePath('/pedido-compra')
  revalidatePath('/tarefas-compras')
  return { pedidos: res.pedidos, duplicado: res.duplicado }
}
