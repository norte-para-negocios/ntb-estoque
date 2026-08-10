import { createClient } from '@/lib/supabase/server'

// Seção "Nota fiscal vinculada" da tela de detalhe de OP. Confirmado na Task 17
// da auditoria de retry Omie (task-17-report.md, "Pergunta 2"): NÃO existe
// vínculo direto OP <-> NF em nenhum lugar do schema, nem no `full_object`. O
// único cruzamento possível é fraco: comparar os insumos consumidos pela OP
// (nIdProdutoMalha dentro de full_object.itensDetalhes) com os itens de NF de
// ENTRADA da mesma loja numa janela retroativa (a compra do insumo normalmente
// precede a produção) -- não é rastreabilidade de lote real, é uma pista.
//
// nota_fiscal_items/notas_fiscais NÃO precisam do complemento Contabo aqui:
// achado documentado em lib/historico-contabo.ts (topo do arquivo) -- desde que
// o Supabase self-hosted não poda mais essas tabelas, ele já cobre virtualmente
// o mesmo intervalo que o Contabo-frio pra essas duas tabelas especificamente.
//
// Achado da revisão desta task (fix round 1): a versão anterior filtrava
// `nota_fiscal_items` só por `n_id_produto` no servidor, com `.limit(500)` E
// SEM `.order()`, e só depois aplicava o filtro de janela de 30 dias em JS --
// ou seja, o corte de 500 linhas era tirado ANTES do filtro de data rodar,
// dependente da ordem arbitrária que o Postgres decidisse devolver. Medido ao
// vivo numa OP real (id=10570440, loja 5): 101 itens de verdade caem na janela
// de 30 dias, mas só 32 sobreviviam ao corte -- 68% do sinal perdido em
// silêncio, e a mensagem de "nenhuma NF" tratava isso como correlação fraca
// normal, quando era um bug. Corrigido com paginação real (.range() +
// .order('id'), mesmo padrão de app/(app)/pendencias-classificacao/page.tsx
// `carregarQuentes`) -- nunca trunca, filtra em JS só depois de trazer TODAS as
// linhas que batem no produto. `notas_fiscais!inner(...)` é usado só pra trazer
// colunas extra (sem nenhum filtro dot-path no embed -- mesmo achado de
// instabilidade de plano documentado em components/movimentacoes/MovimentosTab.tsx).
type NFRow = {
  id: number
  n_id_produto: number
  n_qtde_nfe: number | null
  nota_fiscal_id: number
  c_numero_nfe: string | null
  d_emissao_nfe: string
  n_id_fornecedor: number | null
}

type RawItem = {
  id: number
  n_id_produto: number
  n_qtde_nfe: number | null
  nota_fiscal_id: number
  notas_fiscais:
    | { c_numero_nfe: string | null; d_emissao_nfe: string; n_id_fornecedor: number | null; deleted_at: string | null }
    | { c_numero_nfe: string | null; d_emissao_nfe: string; n_id_fornecedor: number | null; deleted_at: string | null }[]
}

function fmtDataBR(d: string | null): string | null {
  if (!d) return null
  const m = d.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

// Busca TODOS os itens de NF que batem no(s) código(s) de insumo, paginando
// com .range()+.order('id') pra nunca cair no teto padrão de 1000 linhas do
// PostgREST em silêncio (mesma classe de bug já corrigida em várias telas
// desta auditoria -- ver AGENTS.md). Não filtra data aqui de propósito: o
// filtro de janela de 30 dias acontece em JS depois, sobre o conjunto
// COMPLETO, não sobre um corte arbitrário.
async function buscarItensNFPorInsumo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lojaId: number,
  insumoCodes: number[]
): Promise<{ rows: RawItem[]; erro: boolean }> {
  const acc: RawItem[] = []
  let erro = false
  const LOTE = 1000
  const MAX_LOTES = 50 // teto de segurança (~50k linhas) pra não travar o SSR
  for (let p = 0; p < MAX_LOTES; p++) {
    const { data, error } = await supabase
      .from('nota_fiscal_items')
      .select(
        'id, n_id_produto, n_qtde_nfe, nota_fiscal_id, notas_fiscais!inner(c_numero_nfe, d_emissao_nfe, n_id_fornecedor, deleted_at)'
      )
      .eq('loja_id', lojaId)
      .in('n_id_produto', insumoCodes)
      .order('id')
      .range(p * LOTE, p * LOTE + LOTE - 1)
    if (error) {
      erro = true
      console.error('NotaFiscalVinculadaOP: falha ao consultar nota_fiscal_items', error.message)
      break
    }
    if (!data?.length) break
    acc.push(...(data as unknown as RawItem[]))
    if (data.length < LOTE) break
  }
  return { rows: acc, erro }
}

export async function NotaFiscalVinculadaOP({
  lojaId,
  insumoCodes,
  dataReferencia, // YYYY-MM-DD (dt_conclusao_real ou identificacao_d_dt_previsao) ou null -- fim da janela de 30 dias
}: {
  lojaId: number
  insumoCodes: number[]
  dataReferencia: string | null
}) {
  const supabase = await createClient()

  let rows: NFRow[] = []
  const podeConsultar = insumoCodes.length > 0 && !!dataReferencia
  let falhaConsulta = false

  if (podeConsultar && dataReferencia) {
    const dtIni = addDias(dataReferencia, -30)
    const { rows: raw, erro } = await buscarItensNFPorInsumo(supabase, lojaId, insumoCodes)
    falhaConsulta = erro

    rows = raw
      .map((r) => {
        const nf = Array.isArray(r.notas_fiscais) ? r.notas_fiscais[0] : r.notas_fiscais
        return {
          id: r.id,
          n_id_produto: r.n_id_produto,
          n_qtde_nfe: r.n_qtde_nfe,
          nota_fiscal_id: r.nota_fiscal_id,
          c_numero_nfe: nf?.c_numero_nfe ?? null,
          d_emissao_nfe: nf?.d_emissao_nfe ?? '',
          n_id_fornecedor: nf?.n_id_fornecedor ?? null,
          _deleted: nf?.deleted_at ?? null,
        }
      })
      // Filtro de deleted_at/data em JS (não no embed) -- mesmo achado de
      // instabilidade de plano do MovimentosTab.tsx citado no topo do arquivo.
      // Roda sobre o conjunto COMPLETO (já paginado acima), não um corte parcial.
      .filter((r) => !r._deleted && r.d_emissao_nfe >= dtIni && r.d_emissao_nfe <= dataReferencia)
      .sort((a, b) => (a.d_emissao_nfe < b.d_emissao_nfe ? 1 : -1))
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-[13px] font-medium text-text-muted">Nota fiscal vinculada</h2>
      <p className="mb-3 text-[11px] text-text-muted">
        Correlação fraca: NFs de entrada dos insumos da ficha técnica desta OP, na mesma loja, nos 30 dias
        antes da conclusão/previsão. O sistema não guarda nenhum vínculo real entre nota fiscal e ordem de
        produção -- isto NÃO é rastreabilidade de lote, é só uma pista de &ldquo;de onde pode ter vindo o insumo&rdquo;.
      </p>

      {!podeConsultar ? (
        <p className="text-[13px] text-text-muted">
          {insumoCodes.length === 0
            ? 'Esta OP não tem insumos identificados na ficha técnica para cruzar com NF.'
            : 'Sem data de referência (a OP não tem conclusão real nem data prevista) para calcular a janela de 30 dias.'}
        </p>
      ) : falhaConsulta ? (
        <p className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-[12px] text-text-muted">
          Não foi possível consultar notas fiscais agora (falha de banco/rede) -- tente recarregar a página. Isto é
          diferente de &ldquo;nenhuma NF encontrada&rdquo;.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[12px] text-text-muted">
          Nenhuma NF de entrada encontrada com esses insumos nessa janela de 30 dias. Comum e esperado -- a
          correlação é fraca por natureza (compras não são fáceis de datar a partir da produção).
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <a
              key={r.id}
              href={`/nota-fiscal/${r.nota_fiscal_id}`}
              className="block rounded-md border border-border bg-surface-2/40 px-3 py-2 transition-colors hover:border-brand"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-text">NFe {r.c_numero_nfe ?? r.nota_fiscal_id}</span>
                <span className="num text-[12px] text-text-muted">{fmtDataBR(r.d_emissao_nfe)}</span>
              </div>
              <div className="mt-1 text-[12px] text-text-muted">
                Insumo <span className="num">{r.n_id_produto}</span> ·{' '}
                Qtde <span className="num">{r.n_qtde_nfe?.toLocaleString('pt-BR') ?? '-'}</span>
                {r.n_id_fornecedor ? <> · Fornecedor <span className="num">{r.n_id_fornecedor}</span></> : null}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function addDias(dataISO: string, dias: number): string {
  const [y, m, d] = dataISO.slice(0, 10).split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + dias)
  const mm = String(base.getMonth() + 1).padStart(2, '0')
  const dd = String(base.getDate()).padStart(2, '0')
  return `${base.getFullYear()}-${mm}-${dd}`
}
