'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

// Fase G [K10/O6] (migration 223): importação de produtos e fornecedores por planilha, SÓ estoque próprio.
// 1) previaImportacao: lê, valida linha a linha e grava a prévia (nada muda no cadastro); 2) confirmarImportacao: aplica numa
// transação só (RPC importacao_aplicar), idempotente (confirmar 2x = mesma resposta).
import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getProfile, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { fornecedoresExistentes, produtosExistentes } from '@/lib/importacao/existentes'
import { entregarAgora } from '@/lib/estoque/catalogo-sync'
import { LIMITE_LINHAS, LIMITE_PLANILHA_BYTES, lerArquivoPlanilha } from '@/lib/importacao/ler-arquivo'
import {
  lerTabela, prepararFornecedores, prepararProdutos, resumoPrevia,
  type AcaoLinha, type LinhaPrevia, type TipoImportacao,
} from '@/lib/importacao/planilha-puro'
import { tabelaAusente } from '@/lib/supabase/tabela-ausente'

type Erro = { error: string }
// Cadastro lido pela metade faria um produto existente parecer novo (e duplicar): falha na leitura = prévia recusada.
const PERMISSAO: Record<TipoImportacao, string> = { produtos: 'Produtos - Importar planilha', fornecedores: 'Fornecedores - Importar planilha' }

async function contexto(tipo: TipoImportacao): Promise<{ lojaId: number } | Erro> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Importação por planilha só existe no estoque próprio (no Omie o cadastro é feito no Omie).' }
  if (!(await requirePermissao(lojaId, PERMISSAO[tipo]))) return { error: 'Sem permissão para importar' }
  return { lojaId }
}

export type PreviaImportacao = {
  id: number
  tipo: TipoImportacao
  linhas: LinhaPrevia[]
  resumo: Record<AcaoLinha, number>
  desconhecidas: string[]
  jaImportadaEm: string | null
}

export async function previaImportacao(formData: FormData): Promise<PreviaImportacao | Erro> {
  const __d = viaDesktop('importacao#previaImportacao', previaImportacao, [formData]); if (__d) return __d as never
  const tipo = formData.get('tipo')
  if (tipo !== 'produtos' && tipo !== 'fornecedores') return { error: 'Tipo de importação inválido' }
  const ctx = await contexto(tipo)
  if ('error' in ctx) return ctx
  const arquivo = formData.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) return { error: 'Selecione a planilha' }
  if (arquivo.size > LIMITE_PLANILHA_BYTES) return { error: 'Planilha muito grande (máximo 900 KB). Divida em partes.' }
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const lido = await lerArquivoPlanilha(arquivo.name, bytes)
  if ('error' in lido) return lido
  const tabela = lerTabela(lido.linhas, tipo)
  if (!tabela.colunas.length) return { error: 'Não achei nenhuma coluna conhecida na primeira linha. Use o modelo desta tela.' }
  if (!tabela.linhas.length) return { error: 'A planilha não tem linhas preenchidas abaixo do cabeçalho.' }
  if (tabela.linhas.length > LIMITE_LINHAS) return { error: `A planilha tem ${tabela.linhas.length} linhas; o máximo é ${LIMITE_LINHAS} por vez.` }

  let linhas: LinhaPrevia[]
  try {
    if (tipo === 'produtos') {
      const sb = createServiceClient()
      const [existentes, { data: fams, error }] = await Promise.all([
        produtosExistentes(ctx.lojaId),
        sb.from('familias').select('codigo_familia, nome, inativo').eq('loja_id', ctx.lojaId),
      ])
      if (error) return { error: 'Não foi possível ler as famílias agora' }
      const familias = (fams ?? []).filter((f) => !f.inativo && f.nome).map((f) => ({ codigo: Number(f.codigo_familia), descricao: f.nome as string }))
      linhas = prepararProdutos(tabela.linhas, { familias, existentes })
    } else {
      linhas = prepararFornecedores(tabela.linhas, { existentes: await fornecedoresExistentes(ctx.lojaId) })
    }
  } catch (e) {
    console.error('importacao: prévia', e)
    return { error: 'Não foi possível ler o cadastro atual agora. Tente de novo.' }
  }
  const resumo = resumoPrevia(linhas)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const perfil = await getProfile()
  const sb = createServiceClient()
  const [{ data: anterior }, { data, error }] = await Promise.all([
    sb.from('importacoes_planilha').select('aplicada_em').eq('loja_id', ctx.lojaId).eq('tipo', tipo).eq('hash', hash).eq('status', 'aplicada')
      .order('aplicada_em', { ascending: false }).limit(1),
    sb.from('importacoes_planilha').insert({
      loja_id: ctx.lojaId, tipo, nome_arquivo: arquivo.name.slice(0, 200), hash, linhas, resumo, criado_por: perfil.id, criado_por_nome: perfil.name,
    }).select('id').single(),
  ])
  if (error) return { error: tabelaAusente(error) ? 'Importação ainda não ativada neste servidor.' : 'Não foi possível guardar a prévia agora' }
  return { id: Number(data.id), tipo, linhas, resumo, desconhecidas: tabela.desconhecidas, jaImportadaEm: (anterior?.[0]?.aplicada_em as string | undefined) ?? null }
}

export async function confirmarImportacao(id: number, tipo: TipoImportacao): Promise<{ ok: true; criados: number; atualizados: number; duplicado: boolean } | Erro> {
  const __d = viaDesktop('importacao#confirmarImportacao', confirmarImportacao, [id, tipo]); if (__d) return __d as never
  if (tipo !== 'produtos' && tipo !== 'fornecedores') return { error: 'Tipo de importação inválido' }
  if (!Number.isInteger(id) || id <= 0) return { error: 'Prévia inválida' }
  const ctx = await contexto(tipo)
  if ('error' in ctx) return ctx
  const perfil = await getProfile()
  const sb = createServiceClient()
  const { data: imp } = await sb.from('importacoes_planilha').select('tipo').eq('id', id).eq('loja_id', ctx.lojaId).maybeSingle()
  if (!imp || imp.tipo !== tipo) return { error: 'Prévia não encontrada' }
  const { data, error } = await sb.rpc('importacao_aplicar', { p_id: id, p_loja: ctx.lojaId, p_user: perfil.id, p_nome: perfil.name })
  if (error) return { error: (error.message || 'Falha ao importar').replace(/^.*?ERROR:\s*/, '') }
  const r = (data ?? {}) as { criados?: number; atualizados?: number; duplicado?: boolean }
  if (tipo === 'produtos') {
    revalidatePath('/produto')
    after(() => entregarAgora(ctx.lojaId)) // catálogo do Norte Vendas recebe na hora, sem esperar o cron
  } else revalidatePath('/fornecedor')
  return { ok: true, criados: Number(r.criados ?? 0), atualizados: Number(r.atualizados ?? 0), duplicado: !!r.duplicado }
}
