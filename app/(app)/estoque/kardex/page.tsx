import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Download, ScrollText } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { formatCustoUnit } from '@/lib/num-br'
import { lerFiltrosKardex, paginaKardex, rotuloOrigemKardex } from '@/lib/estoque/kardex-loja-puro'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Filtros } from '@/components/ui-kit/Filtros'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { btnClass } from '@/components/ui-kit/Button'
import { EstoqueAtalhos } from '@/components/estoque-proprio/EstoqueAtalhos'
import { buscarKardexLoja, origensKardex } from '../dados-kardex'
import { fmtDataBR, historicoKardexDesde } from '../dados-comum'
import { createClient } from '@/lib/supabase/server'

const POR_PAGINA = 100
const fmt = (n: number | null) => (n == null ? '-' : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }))

type SP = Record<string, string | undefined>

export default async function KardexLojaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  if (modo !== 'proprio' && modo !== 'omie') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()
  // Estoque próprio: o kardex do ledger já existe em Movimentações (filtros, usuário e exportação).
  if (modo === 'proprio') redirect('/movimentacoes')

  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const f = lerFiltrosKardex(sp, hoje)
  const supabase = await createClient()
  const [res, origens, cobertura, { data: locais }] = await Promise.all([
    buscarKardexLoja(lojaId, f, paginaKardex(f.page, POR_PAGINA)),
    origensKardex(lojaId, hoje),
    historicoKardexDesde(lojaId),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao, inativo').eq('loja_id', lojaId).order('descricao'),
  ])
  const nomeProdutoFiltro = f.produto != null ? res.linhas.find((l) => l.n_cod_prod === f.produto)?.produto ?? `produto ${f.produto}` : null

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) if (v && k !== 'page') params.set(k, v)
  const csvHref = `/estoque/kardex/csv?${params.toString()}`

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="Kardex da loja" description="Todos os movimentos de estoque do Omie, de todos os produtos e locais"
          actions={<a href={csvHref} className={btnClass('outline')}><Download className="size-4" /> Baixar CSV</a>} />
      </ListaHeader>
      <EstoqueAtalhos atual="kardex" />

      <div className="rounded-[var(--r-lg)] bg-surface-2 px-4 py-3 text-[13px] text-text-muted">
        {cobertura.desde
          ? <>Histórico completo desde <b className="text-text">{fmtDataBR(cobertura.desde)}</b>. Antes disso aparecem só os produtos já abertos na tela do produto.</>
          : 'O histórico da loja inteira ainda está sendo lido do Omie. Por enquanto aparecem só os produtos já abertos na tela do produto.'}
        {f.erro && <p className="mt-1 text-warn">{f.erro}</p>}
        {res.aviso && <p className="mt-1 text-warn">{res.aviso}</p>}
        {res.erro && <p className="mt-1 text-err">Não foi possível ler o kardex: {res.erro}</p>}
      </div>

      <Filtros key={params.toString()} basePath="/estoque/kardex"
        defaults={{ data_inicio: f.ini, data_final: f.fim, q: f.q, local: f.local != null ? String(f.local) : '', origem: f.origem, autor: f.autor }}
        campos={[
          { tipo: 'data', nome: 'data_inicio', label: 'De' },
          { tipo: 'data', nome: 'data_final', label: 'Até' },
          { tipo: 'texto', nome: 'q', label: 'Produto (nome ou código)' },
          { tipo: 'select', nome: 'local', label: 'Local', opcoes: (locais ?? []).filter((l) => l.inativo !== 'S').map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })) },
          { tipo: 'select', nome: 'origem', label: 'Origem', opcoes: origens },
          { tipo: 'texto', nome: 'autor', label: 'Quem lançou (ajustes)' },
        ]} />

      {nomeProdutoFiltro && (
        <p className="text-[13px] text-text-muted">Só o produto <b className="text-text">{nomeProdutoFiltro}</b> · <Link className="text-brand hover:underline" href={`/estoque/kardex?${(() => { const p = new URLSearchParams(params); p.delete('produto'); return p.toString() })()}`}>ver todos</Link></p>
      )}

      <p className="text-[13px] text-text-muted"><span className="num font-semibold text-text">{res.total.toLocaleString('pt-BR')}</span> movimento{res.total === 1 ? '' : 's'} de {fmtDataBR(f.ini)} a {fmtDataBR(f.fim)}</p>

      {!res.linhas.length ? (
        <div className="rounded-[var(--r-lg)] bg-surface u-card"><EmptyState icon={ScrollText} title="Nenhum movimento neste filtro" hint="Mude o período ou os filtros." /></div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
          <table className="w-full min-w-[960px] text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2.5 font-medium">Data</th>
                <th className="px-2 py-2.5 font-medium">Produto</th>
                <th className="px-2 py-2.5 font-medium">Local</th>
                <th className="px-2 py-2.5 font-medium">Origem</th>
                <th className="px-2 py-2.5 text-right font-medium">Quantidade</th>
                <th className="px-2 py-2.5 text-right font-medium">Custo unit.</th>
                <th className="px-2 py-2.5 text-right font-medium">Custo médio após</th>
                <th className="px-2 py-2.5 text-right font-medium">Saldo após</th>
                <th className="px-2 py-2.5 font-medium">Documento</th>
                <th className="px-4 py-2.5 font-medium">Quem lançou</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map((m) => (
                <tr key={m.id} className={`border-t border-[var(--border)] ${m.cancelado ? 'line-through opacity-60' : ''}`}>
                  <td className="whitespace-nowrap px-4 py-2 text-text-muted num">{fmtDataBR(m.data_mov)}</td>
                  <td className="max-w-[260px] px-2 py-2">
                    <Link href={`/estoque/produto/${m.n_cod_prod}`} className="block truncate font-medium text-text hover:underline">{m.produto}</Link>
                    <span className="num text-[12px] text-text-muted">{m.codigo}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-text-muted">{m.local}</td>
                  <td className="px-2 py-2 text-text-muted">{rotuloOrigemKardex(m.cod_origem, m.des_origem)}</td>
                  <td className={`whitespace-nowrap px-2 py-2 text-right num font-medium ${m.quantidade > 0 ? 'text-ok' : 'text-err'}`}>{m.quantidade > 0 ? '+' : ''}{fmt(m.quantidade)} <span className="text-[12px] font-normal text-text-muted">{m.unidade}</span></td>
                  <td className="whitespace-nowrap px-2 py-2 text-right num text-text-muted">{m.valor_unit != null ? formatCustoUnit(m.valor_unit) : '-'}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right num">{m.cmc_apos != null ? formatCustoUnit(m.cmc_apos) : '-'}</td>
                  <td className={`whitespace-nowrap px-2 py-2 text-right num ${(m.saldo_apos ?? 0) < 0 ? 'font-semibold text-err' : ''}`}>{fmt(m.saldo_apos)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-text-muted">{m.num_pedido ?? m.num_doc ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-text-muted">{m.autor ?? (m.id_ajuste != null ? 'não identificado' : '-')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Paginacao basePath="/estoque/kardex" page={f.page} temProxima={f.page * POR_PAGINA < res.total} total={res.total} porPagina={POR_PAGINA} />
    </div>
  )
}
