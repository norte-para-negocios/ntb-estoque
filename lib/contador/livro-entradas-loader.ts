import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { montarLivro, notaEntraNoLivro, type ItemLivro, type NotaLivro } from '@/lib/contador/livro-entradas-puro'

// Fase F: livro de entradas do mês lido do banco principal (tem todo o histórico de NF: conferido 15/10, loja 5,
// 0 notas só no Contabo). Duas lojas: notas do Omie e notas do estoque próprio (mesmas tabelas, Fase B).
// A data de entrada (dRec) pode ser até alguns meses depois da emissão: a busca pega emissões desde 120 dias antes.

const LOTE = 150
const n = (v: unknown) => Number(v ?? 0) || 0

function addDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function limitesDoMes(mes: string): { ini: string; fim: string } {
  const [a, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return { ini: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

export async function carregarLivroEntradas(lojaId: number, mes: string) {
  const sb = await createClient()
  const erros: string[] = []
  const anotar = (onde: string) => (e: { message: string }) => { erros.push(onde); console.error(`livro-entradas: ${onde}`, e.message) }
  const { ini, fim } = limitesDoMes(mes)

  type NotaDb = {
    id: number; c_numero_nfe: string | null; c_serie_nfe: string | null; c_modelo_nfe: string | null; c_chave_nfe: string | null
    d_emissao_nfe: string | null; c_etapa: string | null; c_nome: string | null; c_razao_social: string | null; c_cnpj_cpf: string | null
    n_valor_nfe: number | null; info: { dRec?: string; cCancelada?: string } | null; origem: string | null
  }
  const notasDb = await buscarTodasLinhas<NotaDb>(
    (from, to) => sb.from('notas_fiscais')
      .select('id, c_numero_nfe, c_serie_nfe, c_modelo_nfe, c_chave_nfe, d_emissao_nfe, c_etapa, c_nome, c_razao_social, c_cnpj_cpf, n_valor_nfe, origem, info:full_object->infoCadastro')
      .eq('loja_id', lojaId).is('deleted_at', null).eq('c_etapa', '60')
      .gte('d_emissao_nfe', addDias(ini, -120)).lte('d_emissao_nfe', fim)
      .order('id').range(from, to) as unknown as PromiseLike<{ data: NotaDb[] | null; error: { message: string } | null }>,
    undefined, anotar('notas fiscais'))
  const notas: (NotaLivro & { origem: string | null })[] = notasDb.map((x) => ({
    id: n(x.id), numero: x.c_numero_nfe, serie: x.c_serie_nfe, modelo: x.c_modelo_nfe, chave: x.c_chave_nfe, emissao: x.d_emissao_nfe,
    dRec: x.info?.dRec ?? null, etapa: x.c_etapa, cancelada: x.info?.cCancelada === 'S',
    fornecedor: x.c_razao_social || x.c_nome, cnpj: x.c_cnpj_cpf, valorNota: x.n_valor_nfe == null ? null : n(x.n_valor_nfe), origem: x.origem,
  }))
  const doMes = notas.filter((x) => notaEntraNoLivro(x, mes))

  const ids = doMes.map((x) => x.id)
  const itens: ItemLivro[] = []
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE)
    const rows = await buscarTodasLinhas<{ nota_fiscal_id: number; c_cfop: string | null; v_total_item: number | null; full_object: Record<string, unknown> | null }>(
      (from, to) => sb.from('nota_fiscal_items').select('nota_fiscal_id, c_cfop, v_total_item, full_object')
        .eq('loja_id', lojaId).in('nota_fiscal_id', lote).order('id').range(from, to),
      undefined, anotar('itens das notas'))
    for (const r of rows) itens.push({ notaId: n(r.nota_fiscal_id), cfopNota: r.c_cfop, fo: r.full_object, vTotalItem: r.v_total_item == null ? null : n(r.v_total_item) })
  }
  const livro = montarLivro(doMes, itens, mes)
  return { ...livro, notas: doMes, ini, fim, erros: [...new Set(erros)] }
}
