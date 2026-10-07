import { requirePermissao } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { FiltroDataMovimentos } from '@/components/movimentacoes/FiltroDataMovimentos'
import { FiltroLocalMovimentos } from '@/components/movimentacoes/FiltroLocalMovimentos'
import { FiltroFamiliaMovimentos } from '@/components/movimentacoes/FiltroFamiliaMovimentos'
import { FiltroTipoLedger } from '@/components/movimentacoes/FiltroTipoLedger'
import { FiltrosKardex } from '@/components/movimentacoes/FiltrosKardex'
import { NovoAjusteManual } from '@/components/movimentacoes/NovoAjusteManual'
import { ListaMovimentosProprio } from '@/components/movimentacoes/ListaMovimentosProprio'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { buscarKardex, hojeBahia, periodoKardex, POR_PAGINA_KARDEX, type ParamsKardex } from '@/lib/estoque/kardex'

const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDia = (d: string) => { const [y, m, dia] = d.slice(0, 10).split('-'); return `${dia}/${m}/${y}` }

/** Aba Movimentos de uma loja de estoque próprio: o kardex completo da loja (busca livre, filtros, ordenação, totais, exportação). */
export async function MovimentosProprio({ sp, lojaId }: { sp: ParamsKardex; lojaId: number }) {
  const supabase = await createClient()
  const { ini, fim } = periodoKardex(sp)
  const page = Math.max(1, Number(sp.page) || 1)
  const localFiltro = sp.local ? Number(sp.local) : null

  const [{ data: locaisRaw }, { data: familiasRaw }, podeCriar, k] = await Promise.all([
    supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId).neq('inativo', 'S').order('descricao'),
    supabase.from('familias').select('nome').eq('loja_id', lojaId).eq('inativo', false).order('nome'),
    requirePermissao(lojaId, 'Movimentacoes - Criar'),
    buscarKardex(lojaId, sp),
  ])
  const locais = (locaisRaw ?? []) as { codigo_local_estoque: number; descricao: string | null }[]
  const familias = ((familiasRaw ?? []) as { nome: string }[]).map((f) => f.nome)
  const temProxima = k.total > page * POR_PAGINA_KARDEX

  // Saldo inicial/final quando todos os movimentos são de UM produto e UM local (busca por código exato + local escolhido).
  let saldoInicial: number | null = null
  let saldoFinal: number | null = null
  const unicoProduto = k.linhas.length > 0 && k.linhas.every((l) => l.codigo_produto === k.linhas[0].codigo_produto) && sp.produto && k.total === k.linhas.length ? k.linhas[0] : null
  let produtoManual: { id_prod: number; codigo: string; descricao: string } | null = null
  if (unicoProduto && localFiltro) {
    const base = () => supabase.from('estoque_movimentos').select('saldo_apos').eq('loja_id', lojaId).eq('codigo_produto', unicoProduto.codigo_produto).eq('codigo_local_estoque', localFiltro).order('id', { ascending: false }).limit(1)
    const [{ data: a }, { data: b }] = await Promise.all([base().lt('data_ref', ini), base().lte('data_ref', fim)])
    saldoInicial = a?.[0] ? Number(a[0].saldo_apos) : 0
    saldoFinal = b?.[0] ? Number(b[0].saldo_apos) : 0
  }
  if (unicoProduto) produtoManual = { id_prod: unicoProduto.codigo_produto, codigo: unicoProduto.codigo ?? '', descricao: unicoProduto.descricao ?? '' }

  const chip = 'rounded-full bg-surface px-3.5 py-1.5 text-[13px] text-text-muted shadow-[var(--shadow-sm)]'
  return (
    <div className="space-y-4">
      <FiltrosKardex hoje={hojeBahia()} />
      <div className="flex flex-wrap items-center gap-2">
        <FiltroDataMovimentos ini={ini} fim={fim} />
        <FiltroLocalMovimentos locais={locais} valorAtual={sp.local ?? ''} />
        <FiltroFamiliaMovimentos familias={familias} valorAtual={sp.familia ?? ''} />
        <FiltroTipoLedger valorAtual={sp.tm ?? ''} />
        {podeCriar && produtoManual && <NovoAjusteManual locais={locais} produto={produtoManual} proprio />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={chip}><span className="num font-semibold text-text">{k.total.toLocaleString('pt-BR')}</span> movimentos</span>
        <span className={chip}>Entradas <span className="num font-semibold text-ok">{fmtQtd(k.entradas)}</span> <span className="num">({fmtBRL(k.valor_entradas)})</span></span>
        <span className={chip}>Saídas <span className="num font-semibold text-err">{fmtQtd(k.saidas)}</span> <span className="num">({fmtBRL(k.valor_saidas)})</span></span>
        {saldoInicial != null && <span className={chip}>Saldo inicial (antes de <span className="num">{fmtDia(ini)}</span>) <span className="num font-semibold text-text">{fmtQtd(saldoInicial)}</span></span>}
        {saldoFinal != null && <span className={chip}>Saldo final (até <span className="num">{fmtDia(fim)}</span>) <span className="num font-semibold text-text">{fmtQtd(saldoFinal)}</span></span>}
      </div>

      <ListaMovimentosProprio linhas={k.linhas} podeEstornar={podeCriar} />

      {(page > 1 || temProxima) && <Paginacao basePath="/movimentacoes" page={page} temProxima={temProxima} total={k.total} porPagina={POR_PAGINA_KARDEX} />}
    </div>
  )
}
