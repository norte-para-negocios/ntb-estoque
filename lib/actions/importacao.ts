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
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { entregarAgora } from '@/lib/estoque/catalogo-sync'
import { LIMITE_LINHAS, LIMITE_PLANILHA_BYTES, lerArquivoPlanilha } from '@/lib/importacao/ler-arquivo'
import {
  lerTabela, prepararFornecedores, prepararProdutos, resumoPrevia,
  type AcaoLinha, type FornecedorExistente, type LinhaPrevia, type ProdutoExistente, type TipoImportacao,
} from '@/lib/importacao/planilha-puro'

type Erro = { error: string }
// Cadastro lido pela metade faria um produto existente parecer novo (e duplicar): falha na leitura = prévia recusada.
const falhou = (e: { message: string }) => { throw new Error(`leitura do cadastro falhou: ${e.message}`) }
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

async function produtosExistentes(lojaId: number): Promise<ProdutoExistente[]> {
  const sb = createServiceClient()
  type Row = { codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null; ean: string | null; ncm: string | null
    tipo_item: string | null; valor_unitario: number | null; estoque_minimo: number | null; pdv: boolean | null; inativo: boolean | null
    codigo_familia: number | null; validade_dias: number | null; full_object: { extras?: Record<string, string> } | null }
  const rows = await buscarTodasLinhas<Row>((de, ate) => sb.from('produtos')
    .select('codigo_produto, codigo, descricao, unidade, ean, ncm, tipo_item, valor_unitario, estoque_minimo, pdv, inativo, codigo_familia, validade_dias, full_object')
    .eq('loja_id', lojaId).order('id').range(de, ate), undefined, falhou)
  return rows.map((p) => ({
    codigoProduto: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, ean: p.ean, ncm: p.ncm, tipoItem: p.tipo_item,
    valorUnitario: p.valor_unitario == null ? null : Number(p.valor_unitario), estoqueMinimo: p.estoque_minimo == null ? null : Number(p.estoque_minimo),
    pdv: !!p.pdv, inativo: !!p.inativo, codigoFamilia: p.codigo_familia == null ? null : Number(p.codigo_familia), validadeDias: p.validade_dias,
    cest: p.full_object?.extras?.cest ?? null, origem: p.full_object?.extras?.origem ?? null,
  }))
}

async function fornecedoresExistentes(lojaId: number): Promise<FornecedorExistente[]> {
  const sb = createServiceClient()
  type Row = { id: number; razao_social: string; nome_fantasia: string | null; cnpj_cpf: string | null; inscricao_estadual: string | null; email: string | null
    telefone: string | null; cep: string | null; uf: string | null; cidade: string | null; bairro: string | null; logradouro: string | null; numero: string | null; complemento: string | null }
  const rows = await buscarTodasLinhas<Row>((de, ate) => sb.from('fornecedores')
    .select('id, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, email, telefone, cep, uf, cidade, bairro, logradouro, numero, complemento')
    .eq('loja_id', lojaId).order('id').range(de, ate), undefined, falhou)
  return rows.map((f) => ({
    id: Number(f.id), razaoSocial: f.razao_social, nomeFantasia: f.nome_fantasia, cnpjCpf: f.cnpj_cpf, inscricaoEstadual: f.inscricao_estadual, email: f.email,
    telefone: f.telefone, cep: f.cep, uf: f.uf, cidade: f.cidade, bairro: f.bairro, logradouro: f.logradouro, numero: f.numero, complemento: f.complemento,
  }))
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
  if (error) return { error: error.code === '42P01' ? 'Importação ainda não ativada neste servidor.' : 'Não foi possível guardar a prévia agora' }
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
