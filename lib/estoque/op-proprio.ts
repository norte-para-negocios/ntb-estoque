import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { revalidatePath } from 'next/cache'
import { modoDaLoja } from '@/lib/estoque/ledger'

// Ordem de Produção do estoque próprio. A OP vive em `ordens_producao` (a mesma tabela que a tela lê) e o consumo/entrega
// passa pelo ledger (migration 136 + `produzir` da 133). Nenhuma chamada ao Omie. As actions de `lib/actions/ordem-producao.ts`
// chamam `ehLojaProprio` no começo e desviam para cá; os modos `omie` e `nenhum` seguem o caminho antigo.

export async function ehLojaProprio(lojaId: number): Promise<boolean> {
  return (await modoDaLoja(lojaId)) === 'proprio'
}

type Erro = { error: string }

function msg(e: { message?: string } | null | undefined, padrao: string): string {
  const m = e?.message ?? ''
  return m.replace(/^.*?(ERROR:\s*)/, '').trim() || padrao
}

function addDiasISO(iso: string, dias: number): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export async function criarOPProprio(
  lojaId: number,
  input: { nCodProduto: number; data: string; quantidade: number; codigoLocalEstoque?: number | null; codigoLocalDestino?: number | null; validade?: string | null; obs?: string },
  usuario: string
): Promise<Erro | { ok: true; nCodOP: number; id: number }> {
  const { data, error } = await createServiceClient().rpc('op_proprio_criar', {
    p_loja: lojaId, p_produto: input.nCodProduto, p_data: input.data, p_qtde: input.quantidade,
    p_local: input.codigoLocalEstoque ?? null, p_local_destino: input.codigoLocalDestino ?? null,
    p_validade: input.validade ?? null, p_obs: input.obs ?? null, p_user: usuario || null,
  })
  if (error) return { error: msg(error, 'Falha ao criar a OP') }
  const r = data as { n_cod_op: number; id: number }
  await registrarAuditoria('criar', 'ordem de produção', r.n_cod_op, null)
  revalidatePath('/ordem-producao')
  return { ok: true, nCodOP: Number(r.n_cod_op), id: Number(r.id) }
}

export async function criarOPsProprio(
  lojaId: number,
  input: { itens: { nCodProduto: number; quantidade: number; validadeDias?: number | null }[]; datas: string[]; codigoLocalEstoque?: number | null; codigoLocalDestino?: number | null; obs?: string },
  usuario: string
): Promise<{ ok: true; criadas: number; erros: string[] }> {
  let criadas = 0
  const erros: string[] = []
  for (const dataISO of input.datas) {
    for (const item of input.itens) {
      if (!item.nCodProduto || !item.quantidade || item.quantidade <= 0) { erros.push('Produto/quantidade inválidos'); continue }
      const validade = item.validadeDias && item.validadeDias > 0 ? addDiasISO(dataISO, item.validadeDias) : null
      const r = await criarOPProprio(lojaId, {
        nCodProduto: item.nCodProduto, data: dataISO, quantidade: item.quantidade, codigoLocalEstoque: input.codigoLocalEstoque,
        codigoLocalDestino: input.codigoLocalDestino, validade, obs: input.obs,
      }, usuario)
      if ('error' in r) erros.push(r.error)
      else criadas++
    }
  }
  return { ok: true, criadas, erros }
}

export async function alterarOPProprio(
  lojaId: number, opId: number, campos: { data?: string; qtd?: number }
): Promise<Erro | { ok: true }> {
  const { data, error } = await createServiceClient().rpc('op_proprio_alterar', {
    p_loja: lojaId, p_op: opId, p_data: campos.data ?? null, p_qtde: campos.qtd ?? null,
  })
  if (error) return { error: msg(error, 'Falha ao alterar a OP') }
  await registrarAuditoria('editar', 'ordem de produção', Number((data as { n_cod_op?: number })?.n_cod_op ?? opId), campos.data ? `data → ${campos.data}` : `qtde planejada → ${campos.qtd}`)
  revalidatePath('/ordem-producao')
  return { ok: true }
}

async function codOP(lojaId: number, opId: number): Promise<number> {
  const { data } = await createServiceClient().from('ordens_producao').select('identificacao_n_cod_op').eq('id', opId).eq('loja_id', lojaId).maybeSingle()
  return Number(data?.identificacao_n_cod_op ?? opId)
}

export async function concluirOPProprio(
  lojaId: number, opId: number, dataISO: string | null | undefined, qtde: number | null | undefined, usuario: string, usuarioId: string | null
): Promise<Erro | { ok: true; semEtiqueta?: boolean }> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('op_proprio_concluir', {
    p_loja: lojaId, p_op: opId, p_data: dataISO && /^\d{4}-\d{2}-\d{2}$/.test(dataISO) ? dataISO : null,
    p_qtde: qtde && qtde > 0 ? qtde : null, p_user: usuario || null, p_user_uuid: usuarioId,
  })
  if (error) return { error: msg(error, 'Falha ao concluir a OP') }
  void data
  let semEtiqueta = false
  try {
    const { count } = await supabase.from('impressao_etiquetas').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).eq('origem', 'OP').eq('referencia_id', opId)
    semEtiqueta = !count
  } catch { /* só um lembrete */ }
  await registrarAuditoria('concluir', 'ordem de produção', await codOP(lojaId, opId), null)
  revalidatePath('/ordem-producao')
  return { ok: true, semEtiqueta }
}

export async function reverterOPProprio(lojaId: number, opId: number, usuario: string): Promise<Erro | { ok: true }> {
  const cod = await codOP(lojaId, opId)
  const { error } = await createServiceClient().rpc('op_proprio_reverter', { p_loja: lojaId, p_op: opId, p_user: usuario || null })
  if (error) return { error: msg(error, 'Falha ao reverter a OP') }
  await registrarAuditoria('reverter', 'ordem de produção', cod, null)
  revalidatePath('/ordem-producao')
  return { ok: true }
}

export async function excluirOPProprio(lojaId: number, opId: number, usuario: string): Promise<Erro | { ok: true; fantasma: boolean }> {
  const cod = await codOP(lojaId, opId)
  const { error } = await createServiceClient().rpc('op_proprio_excluir', { p_loja: lojaId, p_op: opId, p_user: usuario || null })
  if (error) return { error: msg(error, 'Falha ao excluir a OP') }
  await registrarAuditoria('excluir', 'ordem de produção', cod, null)
  revalidatePath('/ordem-producao')
  return { ok: true, fantasma: false }
}
