'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { complementarNotasFiscais } from '@/lib/historico-contabo'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { addDias } from '@/lib/estoque/espelho-lojas'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { buscarFatCupomDetalhe, buscarFatCupons } from '@/lib/faturamento-frio'
import { interpretarBuscaRapida } from '@/lib/correcoes/central-puro'

export type BuscaItem = {
  tipo: 'Produto' | 'Nota' | 'OP' | 'Cupom'
  label: string
  sub: string
  href: string
  /** Na Central de correções a escolha abre o painel em vez de navegar. */
  alvo?: { tipo: 'produto' | 'op' | 'nota' | 'cupom'; id: number }
}

const DIAS_CUPOM = 45

/**
 * Busca rápida ("/" e ⌘K) no escopo da loja atual: produtos (nome/código), OPs (número com ou sem ano e zeros),
 * notas (número/fornecedor) e cupons (número, nos últimos 45 dias, ou o id do cupom). 6 por tipo, em paralelo.
 * Retorna sempre um array (vazio em qualquer erro ou termo curto), nunca quebra.
 */
export async function buscaGlobal(termo: string): Promise<BuscaItem[]> {
  const __d = viaDesktop('busca-global#buscaGlobal', buscaGlobal, [termo]); if (__d) return __d as never
  const t = (termo ?? '').trim()
  if (t.length < 2) return []

  let lojaId: number | null = null
  try {
    const profile = await getProfile()
    lojaId = profile.current_loja_id
  } catch {
    return []
  }
  if (!lojaId) return []
  const loja = lojaId

  const supabase = await createClient()
  const p = `%${escapeIlikeOr(t)}%`
  const q = interpretarBuscaRapida(t)
  const modo = await modoDaLoja(loja).catch(() => 'nenhum')
  const comEstoque = modo === 'omie' || modo === 'proprio'

  const buscaProdutos = async (): Promise<BuscaItem[]> => {
    try {
      const { data, error } = await supabase.from('produtos').select('id, codigo, codigo_produto, descricao, inativo')
        .eq('loja_id', loja).or(`codigo.ilike.${p},descricao.ilike.${p}`).order('inativo', { ascending: true }).order('id').limit(6)
      if (error || !data) return []
      return data.map((row) => ({
        tipo: 'Produto' as const,
        label: row.descricao || row.codigo || 'Produto',
        sub: [row.codigo, row.inativo ? 'inativo' : null].filter(Boolean).join(' · '),
        href: comEstoque && row.codigo_produto ? `/estoque/produto/${row.codigo_produto}` : `/produto?q=${encodeURIComponent(row.codigo || row.descricao || '')}`,
        alvo: comEstoque && row.codigo_produto ? { tipo: 'produto' as const, id: Number(row.codigo_produto) } : undefined,
      }))
    } catch {
      return []
    }
  }

  const buscaNotas = async (): Promise<BuscaItem[]> => {
    try {
      const { data, error } = await supabase.from('notas_fiscais').select('id, n_id_receb, c_numero_nfe, c_razao_social, c_nome, d_emissao_nfe')
        .eq('loja_id', loja).is('deleted_at', null).or(`c_numero_nfe.ilike.${p},c_razao_social.ilike.${p},c_nome.ilike.${p}`)
        .order('d_emissao_nfe', { ascending: false }).limit(6)
      if (error) return []
      const completas = await complementarNotasFiscais(data ?? [], { lojaId: loja, busca: t })
      return completas.slice(0, 6).map((row) => ({
        tipo: 'Nota' as const,
        label: `Nota ${row.c_numero_nfe ?? '-'} · ${row.c_razao_social || row.c_nome || 'Fornecedor'}`,
        sub: row.d_emissao_nfe ? String(row.d_emissao_nfe).slice(0, 10).split('-').reverse().join('/') : '',
        href: `/nota-fiscal/${row.id}`,
        alvo: { tipo: 'nota' as const, id: Number(row.id) },
      }))
    } catch {
      return []
    }
  }

  const buscaOrdens = async (): Promise<BuscaItem[]> => {
    try {
      // Número com ou sem ano/zeros ("2026/00396850", "396850"); texto livre também procura no número.
      const filtros = q.numerosOP.length
        ? [...q.numerosOP.map((n) => `identificacao_c_num_op.ilike.%${escapeIlikeOr(n)}`), ...q.numerosOP.filter((n) => /^\d{1,18}$/.test(n)).map((n) => `identificacao_n_cod_op.eq.${n}`)]
        : [`num_ordem.ilike.${p}`, `identificacao_c_num_op.ilike.${p}`]
      const { data, error } = await supabase.from('ordens_producao')
        .select('id, num_ordem, identificacao_c_num_op, produto_descricao, identificacao_d_dt_previsao, concluida')
        .eq('loja_id', loja).or(filtros.join(',')).order('id', { ascending: false }).limit(6)
      if (error || !data) return []
      return data.map((row) => ({
        tipo: 'OP' as const,
        label: `OP ${row.identificacao_c_num_op || row.num_ordem || row.id}`,
        sub: [row.produto_descricao, row.concluida ? 'concluída' : 'aberta'].filter(Boolean).join(' · '),
        href: `/ordem-producao/${row.id}`,
        alvo: { tipo: 'op' as const, id: Number(row.id) },
      }))
    } catch {
      return []
    }
  }

  const buscaCupons = async (): Promise<BuscaItem[]> => {
    if (modo !== 'omie' || (!q.cupomNum && !q.nIdCupom)) return []
    try {
      const hoje = hojeBahiaISO()
      const achados = q.nIdCupom
        ? [(await buscarFatCupomDetalhe(loja, q.nIdCupom, 3000)).cupom].filter((c): c is NonNullable<typeof c> => !!c)
        : (await buscarFatCupons({ lojaId: loja, dataInicio: addDias(hoje, -DIAS_CUPOM), dataFinal: hoje, timeoutMs: 3000, tentativas: 1 })).filter((c) => String(c.num ?? '').replace(/^0+/, '') === q.cupomNum!.replace(/^0+/, ''))
      return achados.slice(0, 6).map((c) => ({
        tipo: 'Cupom' as const,
        label: `Cupom ${c.num ?? c.n_id_cupom}`,
        sub: `${String(c.data).slice(0, 10).split('-').reverse().join('/')}${c.cancelado ? ' · cancelado' : ''}`,
        href: `/faturamento/cupom/${c.n_id_cupom}`,
        alvo: { tipo: 'cupom' as const, id: Number(c.n_id_cupom) },
      }))
    } catch {
      return []
    }
  }

  const [produtos, ordens, notas, cupons] = await Promise.all([buscaProdutos(), buscaOrdens(), buscaNotas(), buscaCupons()])
  return [...produtos, ...ordens, ...notas, ...cupons]
}
