import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { revalidatePath } from 'next/cache'
import type { EstruturaView, ItemEstruturaInput } from '@/lib/actions/estrutura'

// Estrutura (ficha técnica) do estoque próprio: mesmos campos da tela de estrutura de sempre (componente, quantidade, unidade,
// perda %) mais fator de correção, rendimento e "abrir sub-receita na venda". Lê e grava em `fichas_tecnicas*` (migration 133),
// sem Omie. Editar cria uma versão nova da ficha; as versões antigas ficam como histórico.

export const TIPOS_COM_FICHA_PROPRIO = ['04', '03', '06']

type FichaRow = { id: number; versao: number; rendimento: number; expandir_na_venda: boolean }
type ItemRow = { codigo_insumo: number; quantidade_liquida: number; fator_correcao: number; perda_pct: number; ordem: number }
type ProdRow = { codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null; tipo_item: string | null; codigo_familia: number | null }

export async function verEstruturaProprio(lojaId: number, codigoProduto: number): Promise<{ error: string } | { ok: true; view: EstruturaView }> {
  const supabase = createServiceClient()
  const { data: prod } = await supabase.from('produtos').select('codigo, descricao, tipo_item, unidade').eq('loja_id', lojaId).eq('codigo_produto', codigoProduto).maybeSingle()
  const { data: ficha } = await supabase.from('fichas_tecnicas').select('id, versao, rendimento, expandir_na_venda')
    .eq('loja_id', lojaId).eq('codigo_produto', codigoProduto).eq('ativa', true).maybeSingle<FichaRow>()

  let itens: EstruturaView['itens'] = []
  let custoUnitario: number | null = null
  if (ficha) {
    const { data: its } = await supabase.from('ficha_tecnica_itens').select('codigo_insumo, quantidade_liquida, fator_correcao, perda_pct, ordem')
      .eq('ficha_id', ficha.id).order('ordem')
    const lista = (its ?? []) as ItemRow[]
    const ids = lista.map((i) => i.codigo_insumo)
    const { data: prods } = ids.length
      ? await supabase.from('produtos').select('codigo_produto, codigo, descricao, unidade, tipo_item, codigo_familia').eq('loja_id', lojaId).in('codigo_produto', ids)
      : { data: [] as ProdRow[] }
    const mapa = new Map<number, ProdRow>()
    for (const p of (prods ?? []) as ProdRow[]) mapa.set(Number(p.codigo_produto), p)
    const { data: fams } = await supabase.from('familias').select('codigo, nome').eq('loja_id', lojaId)
    const nomeFam = new Map<number, string>()
    for (const f of (fams ?? []) as { codigo: number; nome: string }[]) nomeFam.set(Number(f.codigo), f.nome)
    itens = lista.map((i) => {
      const p = mapa.get(Number(i.codigo_insumo))
      return {
        idMalha: Number(i.codigo_insumo), // no estoque próprio a linha é identificada pelo insumo (um por ficha)
        idProdMalha: Number(i.codigo_insumo),
        codigo: p?.codigo ?? String(i.codigo_insumo),
        descricao: p?.descricao ?? '(componente)',
        familia: p?.codigo_familia != null ? nomeFam.get(Number(p.codigo_familia)) ?? '' : '',
        quantidade: Number(i.quantidade_liquida) || 0,
        unidade: p?.unidade ?? '',
        perda: Number(i.perda_pct) || 0,
        fatorCorrecao: Number(i.fator_correcao) || 1,
      }
    })
    const { data: custo } = await supabase.rpc('custo_unitario_ficha', { p_loja: lojaId, p_produto: codigoProduto })
    custoUnitario = custo == null ? null : Number(custo)
  }

  // Consumo real da última produção concluída desse produto (ordens do estoque próprio).
  let consumoOP: EstruturaView['consumoOP'] = null
  const { data: ultima } = await supabase.from('ordens_producao_proprio').select('id, ref, created_at')
    .eq('loja_id', lojaId).eq('codigo_produto', codigoProduto).eq('status', 'concluida').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (ultima) {
    const { data: its } = await supabase.from('ordens_producao_proprio_itens').select('codigo_insumo, quantidade').eq('ordem_id', ultima.id)
    const lista = (its ?? []) as { codigo_insumo: number; quantidade: number }[]
    const ids = lista.map((i) => i.codigo_insumo)
    const { data: prods } = ids.length ? await supabase.from('produtos').select('codigo_produto, codigo, descricao').eq('loja_id', lojaId).in('codigo_produto', ids) : { data: [] }
    const mapa = new Map<number, { codigo: string | null; descricao: string | null }>()
    for (const p of (prods ?? []) as { codigo_produto: number; codigo: string | null; descricao: string | null }[]) mapa.set(Number(p.codigo_produto), p)
    const m = /^OP:(\d+):/.exec(String(ultima.ref))
    let numero: string | null = null
    if (m) {
      const { data: op } = await supabase.from('ordens_producao').select('identificacao_c_num_op').eq('id', Number(m[1])).maybeSingle()
      numero = (op?.identificacao_c_num_op as string | null) ?? null
    }
    if (lista.length) {
      consumoOP = {
        numero,
        data: String(ultima.created_at).slice(0, 10),
        itens: lista.map((c) => ({ codigo: mapa.get(Number(c.codigo_insumo))?.codigo ?? String(c.codigo_insumo), descricao: mapa.get(Number(c.codigo_insumo))?.descricao ?? '(componente)', quantidade: Number(c.quantidade) || 0, doEstoque: true })),
      }
    }
  }

  return {
    ok: true,
    view: {
      produto: prod ? { codigo: String(prod.codigo ?? ''), descricao: String(prod.descricao ?? ''), tipo: String(prod.tipo_item ?? ''), unidade: String(prod.unidade ?? '') } : null,
      itens,
      consumoOP,
      semEstrutura: !itens.length,
      proprio: true,
      rendimento: ficha ? Number(ficha.rendimento) : 1,
      expandirNaVenda: ficha?.expandir_na_venda ?? false,
      versao: ficha?.versao ?? null,
      custoUnitario,
    },
  }
}

export async function salvarEstruturaProprio(
  lojaId: number, codigoProduto: number, itens: ItemEstruturaInput[],
  opts: { rendimento?: number; expandirNaVenda?: boolean } | undefined, usuario: string
): Promise<{ error: string } | { ok: true; incluidos: number; alterados: number; excluidos: number }> {
  const supabase = createServiceClient()
  const { data: prod } = await supabase.from('produtos').select('tipo_item, descricao').eq('loja_id', lojaId).eq('codigo_produto', codigoProduto).maybeSingle()
  if (prod && !TIPOS_COM_FICHA_PROPRIO.includes(String(prod.tipo_item))) return { error: 'Só produto acabado, em processo ou intermediário tem ficha técnica' }
  if (itens.some((i) => !(i.quantidade > 0))) return { error: 'Quantidade inválida em algum componente' }
  if (itens.some((i) => i.fatorCorrecao != null && !(i.fatorCorrecao > 0))) return { error: 'Fator de correção inválido em algum componente' }
  if (itens.some((i) => i.perda < 0 || i.perda > 100)) return { error: 'Perda deve ficar entre 0 e 100%' }
  if (itens.some((i) => i.idProdMalha === codigoProduto)) return { error: 'Um produto não entra na própria ficha técnica' }

  // diff para o resumo (a gravação em si é uma versão nova da ficha)
  const { data: atual } = await supabase.from('fichas_tecnicas').select('id, rendimento, expandir_na_venda').eq('loja_id', lojaId).eq('codigo_produto', codigoProduto).eq('ativa', true).maybeSingle<FichaRow>()
  const antes = new Map<number, ItemRow>()
  if (atual) {
    const { data: its } = await supabase.from('ficha_tecnica_itens').select('codigo_insumo, quantidade_liquida, fator_correcao, perda_pct, ordem').eq('ficha_id', atual.id)
    for (const i of (its ?? []) as ItemRow[]) antes.set(Number(i.codigo_insumo), i)
  }
  const novos = new Set(itens.map((i) => i.idProdMalha))
  const incluidos = itens.filter((i) => !antes.has(i.idProdMalha)).length
  const alterados = itens.filter((i) => {
    const a = antes.get(i.idProdMalha)
    return a && (Math.abs(Number(a.quantidade_liquida) - i.quantidade) > 1e-9 || Math.abs(Number(a.perda_pct) - i.perda) > 1e-9 || Math.abs(Number(a.fator_correcao) - (i.fatorCorrecao ?? 1)) > 1e-9)
  }).length
  const excluidos = [...antes.keys()].filter((k) => !novos.has(k)).length

  if (!itens.length) {
    const { error } = await supabase.rpc('desativar_ficha', { p_loja: lojaId, p_produto: codigoProduto })
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.rpc('salvar_ficha', {
      p_loja: lojaId, p_produto: codigoProduto, p_rendimento: opts?.rendimento && opts.rendimento > 0 ? opts.rendimento : Number(atual?.rendimento ?? 1),
      p_itens: itens.map((i) => ({ codigo_insumo: i.idProdMalha, quantidade_liquida: i.quantidade, fator_correcao: i.fatorCorrecao ?? 1, perda_pct: i.perda })),
      p_expandir_na_venda: opts?.expandirNaVenda ?? atual?.expandir_na_venda ?? false, p_user: usuario || null, p_obs: null,
    })
    if (error) return { error: error.message.replace(/^.*?(ERROR:\s*)/, '') }
  }
  await registrarAuditoria('editar', 'ficha técnica', codigoProduto, `${prod?.descricao ?? ''}: +${incluidos} ~${alterados} -${excluidos}`)
  revalidatePath('/produto')
  return { ok: true, incluidos, alterados, excluidos }
}
