import { AlertTriangle, Info } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermissao } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { Filtros } from '@/components/ui-kit/Filtros'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { NovoAjusteManual } from '@/components/movimentacoes/NovoAjusteManual'
import { TabelaMovimentos } from '@/components/movimentacoes/TabelaMovimentos'
import { carregarMovimentacoes } from '@/lib/movimentacoes/dados'

const POR_PAGINA = 100
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtBR = (iso: string) => iso.split('-').reverse().join('/')
const chip = 'rounded-full bg-surface px-3.5 py-1.5 text-[13px] text-text-muted shadow-[var(--shadow-sm)]'

/**
 * Aba Movimentos da loja Omie: TODOS os movimentos do período (kardex do Omie na loja com espelho completo; senão a lista
 * reconstruída de ajustes, vendas, OPs e notas), com busca por produto, local, origem, documento e autor.
 */
export async function MovimentosOmie({ sp, lojaId }: { sp: Record<string, string | undefined>; lojaId: number }) {
  const supabase = await createClient()
  const hoje = hojeBahiaISO()
  const [{ filtros: f, res, origens }, { data: locaisRaw }, podeCriar] = await Promise.all([
    carregarMovimentacoes(lojaId, sp, hoje, POR_PAGINA),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao, inativo').eq('loja_id', lojaId).order('descricao'),
    requirePermissao(lojaId, 'Movimentacoes - Criar'),
  ])
  const locais = ((locaisRaw ?? []) as { codigo_local_estoque: number; descricao: string | null; inativo: string | null }[])
  const locaisAtivos = locais.filter((l) => l.inativo !== 'S')

  const base = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) if (v && k !== 'page') base.set(k, v)
  const soProduto = (cod: number) => {
    const p = new URLSearchParams(base)
    p.delete('q')
    p.delete('produto')
    p.set('cod', String(cod))
    return `/movimentacoes?${p}`
  }
  const tirarProduto = (() => { const p = new URLSearchParams(base); p.delete('cod'); return `/movimentacoes?${p}` })()

  // Produto único no filtro: nome (da 1ª linha ou do cadastro) e o botão de ajuste manual, como antes.
  let produtoUnico: { id_prod: number; codigo: string; descricao: string } | null = null
  if (f.produto != null) {
    const l = res.linhas.find((x) => x.n_cod_prod === f.produto)
    if (l) produtoUnico = { id_prod: l.n_cod_prod, codigo: l.codigo, descricao: l.produto }
    else {
      const { data } = await supabase.from('produtos').select('codigo, descricao').eq('loja_id', lojaId).eq('codigo_produto', f.produto).maybeSingle()
      produtoUnico = { id_prod: f.produto, codigo: data?.codigo ?? String(f.produto), descricao: data?.descricao ?? `Produto ${f.produto}` }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-[var(--r-lg)] bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0 text-brand" />
        <div className="space-y-1">
          {res.fonte === 'kardex' ? (
            <p>Kardex do Omie: <b className="text-text">todos os movimentos</b> de todos os produtos e locais, com custo e saldo depois de cada um.</p>
          ) : (
            <p>
              Lista montada a partir dos <b className="text-text">ajustes, vendas do PDV, contagens, transferências, OPs concluídas (produção e consumo
              pela ficha gravada na OP) e notas de entrada</b>. O kardex completo do Omie (com custo e saldo) aparece aqui quando o espelho
              completo for ligado nesta loja.
            </p>
          )}
          {f.erro && <p className="text-warn">{f.erro}</p>}
          {res.avisos.map((a) => <p key={a} className="text-warn">{a}</p>)}
          {res.erro && <p className="text-err">Não foi possível ler os movimentos: {res.erro}</p>}
        </div>
      </div>

      <Filtros key={base.toString()} basePath="/movimentacoes"
        defaults={{ data_inicio: f.ini, data_final: f.fim, q: f.q, local: f.local != null ? String(f.local) : '', origem: f.origem, doc: f.doc, autor: f.autor }}
        campos={[
          { tipo: 'data', nome: 'data_inicio', label: 'De' },
          { tipo: 'data', nome: 'data_final', label: 'Até' },
          { tipo: 'texto', nome: 'q', label: 'Produto (nome ou código)' },
          { tipo: 'select', nome: 'local', label: 'Local', opcoes: locaisAtivos.map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })) },
          { tipo: 'select', nome: 'origem', label: 'Origem', opcoes: origens },
          { tipo: 'texto', nome: 'doc', label: 'Documento (nº da nota, OP, ajuste)' },
          { tipo: 'texto', nome: 'autor', label: 'Quem lançou' },
        ]} />

      {produtoUnico && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
          <span>Só o produto <b className="text-text">{produtoUnico.descricao}</b> ({produtoUnico.codigo})</span>
          <a className="text-brand hover:underline" href={tirarProduto}>ver todos</a>
          {podeCriar && <NovoAjusteManual locais={locaisAtivos} produto={produtoUnico} />}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className={chip}><span className="num font-semibold text-text">{res.total.toLocaleString('pt-BR')}</span> movimento{res.total === 1 ? '' : 's'} de {fmtBR(f.ini)} a {fmtBR(f.fim)}</span>
        {res.entradas != null && <span className={chip}>Entradas <span className="num font-semibold text-ok">{fmtQtd(res.entradas)}</span></span>}
        {res.saidas != null && <span className={chip}>Saídas <span className="num font-semibold text-err">{fmtQtd(res.saidas)}</span></span>}
        {res.totalOmie && (
          <span className={chip} title="Total do Omie no período (movimentos_historico): é o número oficial; a lista acima é montada aqui e pode diferir em datas de OP">
            Pelo Omie: entradas <span className="num font-semibold text-ok">{fmtQtd(res.totalOmie.entradas)}</span> · saídas <span className="num font-semibold text-err">{fmtQtd(res.totalOmie.saidas)}</span>
          </span>
        )}
      </div>
      {res.fonte === 'reconstruido' && (
        <p className="flex items-start gap-2 text-[12px] text-text-muted">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
          Quantidades na unidade do produto (as notas vêm na unidade da nota). Contagens de inventário não entram nas entradas e saídas.
        </p>
      )}

      <TabelaMovimentos linhas={res.linhas} comSaldo={res.fonte === 'kardex'} filtrarProduto={f.produto == null ? soProduto : undefined} />

      <Paginacao basePath="/movimentacoes" page={f.page} temProxima={f.page * POR_PAGINA < res.total} total={res.total} porPagina={POR_PAGINA} />
    </div>
  )
}
