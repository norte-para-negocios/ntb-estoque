import { createServiceClient } from '@/lib/supabase/server'

// Espelha a nota no histórico do Contabo (mesmo contrato do dual-write do Omie: POST /notas_fiscais_bulk). Fire-and-forget:
// a gravação no Supabase nunca pode quebrar por causa do espelho. Chamado de novo a cada mudança de situação (etapa 40 → 60),
// porque o upsert do Contabo é por (loja_id, n_id_receb) e atualiza a linha.
export async function espelharNotaNoFrio(lojaId: number, notaId: number): Promise<void> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return
  try {
    const sb = createServiceClient()
    const { data: n } = await sb.from('notas_fiscais').select('*').eq('id', notaId).eq('loja_id', lojaId).maybeSingle()
    if (!n) return
    const { data: itens } = await sb.from('nota_fiscal_items').select('*').eq('nota_fiscal_id', notaId).order('n_sequencia')
    const nota = {
      n_id_receb: String(n.n_id_receb), n_id_fornecedor: n.n_id_fornecedor, c_pessoa_fisica: n.c_pessoa_fisica, c_nome: n.c_nome, c_razao_social: n.c_razao_social,
      c_inscricao: n.c_inscricao, c_cnpj_cpf: n.c_cnpj_cpf, c_chave_nfe: n.c_chave_nfe, c_etapa: n.c_etapa, c_numero_nfe: n.c_numero_nfe, c_serie_nfe: n.c_serie_nfe,
      c_modelo_nfe: n.c_modelo_nfe, d_emissao_nfe: n.d_emissao_nfe, n_valor_nfe: n.n_valor_nfe, c_ambiente_nfe: n.c_ambiente_nfe, c_natureza_operacao: n.c_natureza_operacao,
      full_object: n.full_object,
      itens: (itens ?? []).map((i) => ({
        n_sequencia: i.n_sequencia, n_id_item: i.n_id_item, n_id_pedido: i.n_id_pedido, n_id_it_pedido: i.n_id_it_pedido, n_id_produto: i.n_id_produto,
        c_codigo_produto: i.c_codigo_produto, c_descricao_produto: i.c_descricao_produto, c_ignorar_item: i.c_ignorar_item, c_adicionar_novo: i.c_adicionar_novo,
        c_associar_existente: i.c_associar_existente, c_item_devolvido: i.c_item_devolvido, c_ncm: i.c_ncm, c_ean: i.c_ean, c_cfop: i.c_cfop,
        n_qtde_nfe: i.n_qtde_nfe, c_unidade_nfe: i.c_unidade_nfe, n_preco_unit: i.n_preco_unit, full_object: i.full_object,
      })),
    }
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 15000)
    const resp = await fetch(`${url}/notas_fiscais_bulk`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': key ?? '' },
      body: JSON.stringify({ loja_id: lojaId, notas: [nota] }), signal: ctl.signal,
    })
    clearTimeout(t)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
  } catch (e) {
    console.error('nf-sefaz: falha ao espelhar a nota no Contabo', e)
  }
}
