import Link from 'next/link'
import { Package } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { DataTable } from '@/components/ui-kit/DataTable'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { btnClass } from '@/components/ui-kit/Button'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { Vazio, dataLonga } from '@/components/custo-cardapio/inicio/Secao'
import { BotaoCopiar } from '@/components/custo-cardapio/estoque/BotaoCopiar'
import { saldosDaLoja } from '@/lib/custo-cardapio/saldos'
import { comprasRecentes, dadosInsumos } from '@/lib/custo-cardapio/insumos'
import {
  agruparPorFornecedor, precisaComprar, quantidadeSugerida, quantidadeTexto, situacaoEstoque, textoWhatsApp,
  type ItemCompra, type SituacaoEstoque,
} from '@/lib/custo-cardapio/insumos-puro'
import { brl } from '@/lib/custo-cardapio/formato'
import { formatCustoUnit } from '@/lib/num-br'

// Norte Cozinha, Estoque: só os insumos das fichas — saldo, mínimo, situação e valor — e a lista de compras do que
// está abaixo do mínimo, por último fornecedor, pronta para o WhatsApp. Contagem, ajuste e o resto ficam nas telas do ERP.
// Consultas: carregarBase (cache), saldosDaLoja (foto dos saldos) e a função da Sugestão de compra (fornecedor e consumo).

type Sp = { ver?: string; filtro?: string; q?: string }
const FILTROS = [
  { v: '', rotulo: 'Todos' },
  { v: 'abaixo', rotulo: 'Abaixo do mínimo' },
  { v: 'zerado', rotulo: 'Zerados' },
  { v: 'negativo', rotulo: 'Negativos' },
  { v: 'sem_minimo', rotulo: 'Sem mínimo' },
] as const
const ROTULO: Record<SituacaoEstoque, { txt: string; cor: string }> = {
  negativo: { txt: 'Negativo', cor: 'bg-err' },
  zerado: { txt: 'Zerado', cor: 'bg-err' },
  abaixo: { txt: 'Abaixo do mínimo', cor: 'bg-warn' },
  ok: { txt: 'Ok', cor: 'bg-ok' },
  sem_minimo: { txt: 'Sem mínimo', cor: 'bg-text-muted/40' },
}
const DIAS_COBERTURA = 7
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const q3 = (v: number) => Math.round(v * 1000) / 1000

export default async function EstoqueCozinhaPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams
  const lojaId = await getCurrentLojaId()
  const d = await dadosInsumos(lojaId)
  if (!d) {
    return (
      <div className="space-y-4">
        <PageHeader title="Estoque" icon={Package} />
        <EmptyState icon={Package} title="Esta loja não controla estoque" hint="Sem estoque não há saldo nem lista de compras." />
      </div>
    )
  }
  const { base } = d
  const [saldos, compras] = await Promise.all([saldosDaLoja(lojaId, base.modo), comprasRecentes(lojaId, base.modo)])

  const linhas = d.insumos.filter((i) => !i.inativo).map((i) => {
    const s = saldos.porProduto.get(i.codigo) ?? { saldo: 0, minimo: 0 }
    const custo = i.custo != null && !i.suspeito ? i.custo : null
    return { i, saldo: s.saldo, minimo: s.minimo, situacao: situacaoEstoque(s.saldo, s.minimo), valor: custo != null && s.saldo > 0 ? s.saldo * custo : 0 }
  })
  const valorTotal = linhas.reduce((a, l) => a + l.valor, 0)
  const nAbaixo = linhas.filter((l) => precisaComprar(l.saldo, l.minimo)).length
  const nZerado = linhas.filter((l) => l.situacao === 'zerado').length
  const nNegativo = linhas.filter((l) => l.situacao === 'negativo').length
  const semMinimo = linhas.filter((l) => !(l.minimo > 0)).length

  const itensCompra: (ItemCompra & { saldo: number; minimo: number })[] = linhas
    .filter((l) => precisaComprar(l.saldo, l.minimo))
    .map((l) => {
      const c = compras.porProduto.get(l.i.codigo)
      return {
        codigo: l.i.codigo, descricao: l.i.descricao, unidade: l.i.unidade, fornecedor: c?.fornecedor ?? null,
        quantidade: quantidadeSugerida(l.saldo, l.minimo, l.i.unidade, c?.consumoPorDia ?? null, DIAS_COBERTURA),
        custoUnitario: c?.ultimoCusto ?? (l.i.suspeito ? null : l.i.custo), saldo: l.saldo, minimo: l.minimo,
      }
    })
    .filter((x) => x.quantidade > 0)
  const grupos = agruparPorFornecedor(itensCompra)
  const extra = new Map(itensCompra.map((x) => [x.codigo, x]))
  const totalCompra = grupos.reduce((a, g) => a + g.total, 0)
  const ver = sp.ver === 'compras' ? 'compras' : ''

  const filtro = FILTROS.some((f) => f.v === sp.filtro) ? (sp.filtro as string) : ''
  const termo = sp.q?.trim() ? norm(sp.q.trim()) : null
  const ordem: Record<SituacaoEstoque, number> = { negativo: 0, zerado: 1, abaixo: 2, ok: 3, sem_minimo: 4 }
  const lista = linhas
    .filter((l) => (!termo || norm(l.i.descricao).includes(termo) || l.i.codigoTexto.toLowerCase().includes(termo)) &&
      (filtro === '' || (filtro === 'abaixo' ? precisaComprar(l.saldo, l.minimo) : l.situacao === filtro)))
    .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || b.i.pratos - a.i.pratos || a.i.descricao.localeCompare(b.i.descricao, 'pt-BR'))
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ filtro, q: sp.q ?? '', ...over })) if (v) q.set(k, v)
    return `/cozinha/estoque${q.size ? `?${q}` : ''}`
  }
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`

  return (
    <div className="space-y-4">
      <PageHeader title="Estoque" icon={Package}
        description="Os insumos das fichas: quanto tem, o que está abaixo do mínimo e o que comprar."
        actions={<>
          <Link href="/estoque" className={btnClass('outline')}>Estoque completo</Link>
          <Link href="/sugestao-compra" className={btnClass('outline')}>Sugestão de compra</Link>
          <Link href="/inventario" className={btnClass('outline')}>Inventário</Link>
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoResumo titulo="Valor em estoque" valor={brl(valorTotal)} sub={`insumos das fichas${saldos.data ? `, saldo de ${dataLonga(saldos.data)}` : ''}`} />
        <CartaoResumo titulo="Abaixo do mínimo" valor={<span className={nAbaixo ? 'text-warn' : ''}>{nAbaixo}</span>} sub={`${semMinimo} sem mínimo definido`} />
        <CartaoResumo titulo="Zerados" valor={nZerado} sub="saldo zero hoje" />
        <CartaoResumo titulo="Negativos" valor={<span className={nNegativo ? 'text-err' : ''}>{nNegativo}</span>} sub="saiu mais do que entrou: falta lançar entrada" />
      </div>

      <SegmentLinks basePath="/cozinha/estoque" param="ver" aria-label="Ver" opcoes={[{ value: '', label: 'Saldos' }, { value: 'compras', label: `Lista de compras${itensCompra.length ? ` (${itensCompra.length})` : ''}` }]} />

      {ver === 'compras' ? (
        itensCompra.length === 0 ? (
          <Vazio>{semMinimo === linhas.length ? 'Nenhum insumo tem estoque mínimo. Defina o mínimo no Estoque completo e a lista se monta sozinha.' : 'Nada abaixo do mínimo agora.'}</Vazio>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-4 rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
              <div>
                <p className="text-[13px] text-text-muted">Compra estimada</p>
                <p className="num mt-1 text-[30px] font-semibold leading-none tracking-[-0.03em] text-text">{brl(totalCompra)}</p>
                <p className="mt-2 text-[13px] text-text-muted">
                  {itensCompra.length} {itensCompra.length === 1 ? 'item' : 'itens'} em {grupos.length} {grupos.length === 1 ? 'fornecedor' : 'fornecedores'}, pelo último custo.
                  Sugestão = o que falta para o mínimo + {DIAS_COBERTURA} dias de consumo (sem consumo conhecido, metade do mínimo).
                </p>
              </div>
              <BotaoCopiar texto={textoWhatsApp(grupos)} variante="primary" rotulo={grupos.length > 1 ? 'Copiar tudo para WhatsApp' : 'Copiar para WhatsApp'} />
            </div>
            {compras.erro && <p className="text-[12px] text-text-muted">Não deu para ler o último fornecedor agora: os itens ficaram sem fornecedor.</p>}
            {grupos.map((g) => (
              <section key={g.fornecedor ?? '__sem'}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                  <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-text">{g.fornecedor ?? 'Sem fornecedor'} <span className="num ml-1 text-[14px] font-normal text-text-muted">{brl(g.total)}</span></h2>
                  {grupos.length > 1 && <BotaoCopiar texto={textoWhatsApp([g], `Pedido${g.fornecedor ? ` para ${g.fornecedor}` : ''}`)} rotulo="Copiar" />}
                </div>
                <div className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
                  {g.itens.map((x) => {
                    const e = extra.get(x.codigo)!
                    return (
                      <div key={x.codigo} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <Link href={`/cozinha/insumos/${x.codigo}`} className="truncate text-[14px] font-medium text-text hover:text-brand">{x.descricao}</Link>
                          <p className="num text-[12.5px] text-text-muted">Tem {quantidadeTexto(q3(e.saldo), x.unidade)}, mínimo {quantidadeTexto(q3(e.minimo), x.unidade)}</p>
                        </div>
                        <div className="text-right">
                          <p className="num text-[14px] font-semibold text-text">{quantidadeTexto(x.quantidade, x.unidade)}</p>
                          <p className="num text-[12.5px] text-text-muted">{x.custoUnitario != null ? brl(x.quantidade * x.custoUnitario) : 'sem custo'}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
            <p className="text-[12px] text-text-muted">Fornecedor = o da última nota de entrada do produto. Para prazo de entrega e pedidos em aberto, use a Sugestão de compra.</p>
          </div>
        )
      ) : (
        <>
          <form action="/cozinha/estoque" className="flex flex-wrap items-center gap-2">
            {filtro && <input type="hidden" name="filtro" value={filtro} />}
            <input name="q" defaultValue={sp.q ?? ''} placeholder="Buscar insumo ou código"
              className="h-9 w-full max-w-[320px] rounded-full bg-surface-2 px-4 text-[14px] outline-none focus:ring-2 focus:ring-brand/40" />
            <div className="flex gap-2 overflow-x-auto">
              {FILTROS.map((f) => <Link key={f.v} href={href({ filtro: f.v })} className={chip(filtro === f.v)}>{f.rotulo}</Link>)}
            </div>
          </form>
          {lista.length === 0 ? (
            <EmptyState icon={Package} title={linhas.length ? 'Nada com esse filtro' : 'Nenhum insumo nas fichas'} hint={linhas.length ? 'Tire o filtro ou mude a busca.' : 'As fichas técnicas ficam no cadastro do produto (Estrutura).'} />
          ) : (
            <DataTable minLargura="max-2xl:min-w-[900px]">
              <thead>
                <tr>
                  <th className="w-[36%]">Insumo</th>
                  <th className="w-[13%] text-right">Saldo</th>
                  <th className="w-[13%] text-right">Mínimo</th>
                  <th className="w-[18%]">Situação</th>
                  <th className="w-[20%] text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((l) => (
                  <tr key={l.i.codigo}>
                    <td>
                      <Link href={`/cozinha/insumos/${l.i.codigo}`} className="block min-w-0 hover:text-brand">
                        <span className="block truncate font-medium text-text">{l.i.descricao}</span>
                        <span className="block truncate text-[12px] text-text-muted">{l.i.codigoTexto}{l.i.familia ? ` · ${l.i.familia}` : ''} · {l.i.pratos} {l.i.pratos === 1 ? 'prato' : 'pratos'}</span>
                      </Link>
                    </td>
                    <td className={`num text-right ${l.saldo < 0 ? 'text-err' : ''}`}>{quantidadeTexto(q3(l.saldo), l.i.unidade)}</td>
                    <td className="num text-right text-text-muted">{l.minimo > 0 ? quantidadeTexto(q3(l.minimo), l.i.unidade) : '—'}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-text">
                        <span className={`size-2 shrink-0 rounded-full ${ROTULO[l.situacao].cor}`} />{ROTULO[l.situacao].txt}
                      </span>
                    </td>
                    <td className="num text-right">
                      {l.valor > 0 ? brl(l.valor) : '—'}
                      {l.i.custo != null && !l.i.suspeito && <span className="block text-[12px] text-text-muted">{formatCustoUnit(l.i.custo, l.i.unidade)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          <p className="text-[12px] text-text-muted">Saldo somado de todos os locais. Valor = saldo × custo médio (custo a conferir não entra). Para contar, ajustar ou transferir, use o Estoque completo.</p>
        </>
      )}
    </div>
  )
}
