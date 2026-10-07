'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Save, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Combobox } from '@/components/ui-kit/Combobox'
import { Spinner } from '@/components/ui-kit/Spinner'
import { fmtBRL, fmtQtd } from '@/components/estoque-proprio/Apresentacao'
import { desativarFichaTecnica, salvarFichaTecnica } from '@/lib/actions/ficha-tecnica'
import { brutaDoItem, custoUnitarioFicha, validarFicha, type Ficha, type ItemFicha } from '@/lib/estoque/receita'

export type InsumoOpcao = { codigoProduto: number; codigo: string; descricao: string; unidade: string; cmc: number }
export type VersaoLinha = { id: number; versao: number; ativa: boolean; rendimento: number; criadaPor: string | null; obs: string | null; criadaEm: string; nItens: number }

type Linha = { chave: number; insumo: string; qtd: string; fc: string; perda: string }

const campo = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none max-sm:text-base focus:ring-2 focus:ring-brand/40 num'
const num = (v: string) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN }

export function EditorFicha({
  produto, rendimentoInicial, itensIniciais, expandirInicial, ativaAtual, versaoAtual, insumos, outrasFichas, versoes, podeEditar,
}: {
  produto: { codigoProduto: number; codigo: string; descricao: string; unidade: string }
  rendimentoInicial: number
  itensIniciais: ItemFicha[]
  expandirInicial: boolean
  ativaAtual: boolean
  versaoAtual: number | null
  insumos: InsumoOpcao[]
  outrasFichas: Ficha[]
  versoes: VersaoLinha[]
  podeEditar: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [seq, setSeq] = useState(itensIniciais.length + 1)
  const [rendimento, setRendimento] = useState(String(rendimentoInicial || 1))
  const [expandir, setExpandir] = useState(expandirInicial)
  const [obs, setObs] = useState('')
  const [confirmaDesativar, setConfirmaDesativar] = useState(false)
  const [linhas, setLinhas] = useState<Linha[]>(
    itensIniciais.map((i, n) => ({ chave: n + 1, insumo: String(i.codigoInsumo), qtd: String(i.quantidadeLiquida), fc: String(i.fatorCorrecao), perda: String(i.perdaPct) })),
  )

  const porCodigo = useMemo(() => new Map(insumos.map((i) => [i.codigoProduto, i])), [insumos])
  const cmc = useMemo(() => new Map(insumos.map((i) => [i.codigoProduto, i.cmc])), [insumos])

  const itens: Partial<ItemFicha>[] = linhas.map((l) => ({
    codigoInsumo: l.insumo ? Number(l.insumo) : undefined, quantidadeLiquida: num(l.qtd), fatorCorrecao: l.fc === '' ? 1 : num(l.fc), perdaPct: l.perda === '' ? 0 : num(l.perda),
  }))
  const rend = num(rendimento)
  const erros = validarFicha(produto.codigoProduto, rend, itens)

  // Custo ao vivo: sub-receita que abre na venda custa pelos insumos dela; as demais, pelo CMC do próprio item.
  const { custos, total, cicloErro } = useMemo(() => {
    const fichas = new Map<number, Ficha>(outrasFichas.map((f) => [f.codigoProduto, f]))
    let ciclo = false
    const unit = (codigo: number): number => {
      const filha = fichas.get(codigo)
      if (filha?.expandirNaVenda) {
        try { return custoUnitarioFicha(fichas, cmc, codigo) ?? 0 } catch { ciclo = true; return 0 }
      }
      return cmc.get(codigo) ?? 0
    }
    const mapa = linhas.map((l, n) => {
      const i = itens[n]
      if (!i?.codigoInsumo || !((i.quantidadeLiquida ?? 0) > 0)) return 0
      const bruta = brutaDoItem({ quantidadeLiquida: i.quantidadeLiquida!, fatorCorrecao: Number.isFinite(i.fatorCorrecao ?? NaN) ? i.fatorCorrecao! : 1, perdaPct: Number.isFinite(i.perdaPct ?? NaN) ? i.perdaPct! : 0 })
      return bruta * unit(i.codigoInsumo)
    })
    return { custos: mapa, total: mapa.reduce((a, b) => a + b, 0), cicloErro: ciclo }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, outrasFichas, cmc])

  const custoUnidade = rend > 0 ? total / rend : 0
  const semCusto = linhas.filter((l) => l.insumo && !(cmc.get(Number(l.insumo)) ?? 0) && !outrasFichas.find((f) => f.codigoProduto === Number(l.insumo) && f.expandirNaVenda)).length
  const escolhidos = new Set(linhas.map((l) => l.insumo))

  function atualizar(chave: number, parte: Partial<Linha>) {
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...parte } : l)))
  }
  function adicionar() {
    setLinhas((ls) => [...ls, { chave: seq, insumo: '', qtd: '', fc: '1', perda: '0' }])
    setSeq((s) => s + 1)
  }

  function salvar() {
    if (erros.length) { toast.error('Confira a ficha', { description: erros[0].mensagem }); return }
    start(async () => {
      const r = await salvarFichaTecnica({
        codigoProduto: produto.codigoProduto, rendimento: rend, expandirNaVenda: expandir, obs,
        itens: itens.map((i) => ({ codigoInsumo: i.codigoInsumo!, quantidadeLiquida: i.quantidadeLiquida!, fatorCorrecao: i.fatorCorrecao ?? 1, perdaPct: i.perdaPct ?? 0 })),
      })
      if ('error' in r) { toast.error('Não foi possível salvar', { description: r.error }); return }
      toast.success(`Ficha salva (versão ${r.versao})`, { description: 'A venda já usa esta receita.' })
      setObs('')
      router.refresh()
    })
  }
  function desativar() {
    start(async () => {
      const r = await desativarFichaTecnica(produto.codigoProduto)
      if ('error' in r) { toast.error('Não foi possível desativar', { description: r.error }); return }
      toast.success('Receita desativada', { description: 'O produto volta a baixar o próprio estoque na venda.' })
      setConfirmaDesativar(false)
      router.refresh()
    })
  }

  const barras = linhas.map((l, n) => ({ chave: l.chave, parte: total > 0 ? custos[n] / total : 0 }))
  const CORES = ['bg-brand', 'bg-brand/70', 'bg-brand/50', 'bg-brand/35', 'bg-brand/25']

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      {/* Insumos */}
      <section className="rounded-[var(--r-lg)] bg-surface p-4 u-card" aria-label="Insumos da ficha">
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label htmlFor="rendimento" className="mb-1 block text-[13px] font-medium text-text">Esta receita rende</label>
            <div className="relative max-w-[220px]">
              <input id="rendimento" inputMode="decimal" disabled={!podeEditar} className={`${campo} pr-12`} value={rendimento} onChange={(e) => setRendimento(e.target.value)} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-text-muted">{produto.unidade}</span>
            </div>
          </div>
          <label className="flex items-start gap-2 text-[13px] text-text sm:max-w-[320px]">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" disabled={!podeEditar} checked={expandir} onChange={(e) => setExpandir(e.target.checked)} />
            <span><span className="font-medium">Abrir na venda</span><span className="block text-[12px] text-text-muted">Só para preparos usados em outras receitas: se ligado, quem usa este preparo baixa os ingredientes dele em vez do preparo pronto.</span></span>
          </label>
        </div>

        <div className="hidden grid-cols-[minmax(0,1fr)_110px_90px_90px_110px_36px] gap-2 px-1 pb-1.5 text-[12px] font-medium text-text-muted md:grid">
          <span>Insumo</span><span>Líquido</span><span title="Fator de correção: peso bruto ÷ peso líquido">Fator corr.</span><span>Perda %</span><span className="text-right">Sai do estoque</span><span />
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {linhas.map((l, n) => {
            const op = l.insumo ? porCodigo.get(Number(l.insumo)) : undefined
            const bruta = brutaDoItem({ quantidadeLiquida: num(l.qtd) || 0, fatorCorrecao: num(l.fc) || 1, perdaPct: num(l.perda) || 0 })
            return (
              <li key={l.chave} className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_110px_90px_90px_110px_36px] md:items-center">
                <Combobox
                  options={insumos.filter((i) => i.codigoProduto !== produto.codigoProduto && (!escolhidos.has(String(i.codigoProduto)) || String(i.codigoProduto) === l.insumo)).map((i) => ({ value: String(i.codigoProduto), label: `${i.descricao} · ${i.codigo}` }))}
                  value={l.insumo} onChange={(v) => atualizar(l.chave, { insumo: v })} placeholder="Escolha o insumo" />
                <div className="relative">
                  <input aria-label="Quantidade líquida" inputMode="decimal" disabled={!podeEditar} className={`${campo} pr-9`} value={l.qtd} onChange={(e) => atualizar(l.chave, { qtd: e.target.value })} placeholder="0" />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-text-muted">{op?.unidade ?? ''}</span>
                </div>
                <input aria-label="Fator de correção" inputMode="decimal" disabled={!podeEditar} className={campo} value={l.fc} onChange={(e) => atualizar(l.chave, { fc: e.target.value })} />
                <input aria-label="Perda em porcentagem" inputMode="decimal" disabled={!podeEditar} className={campo} value={l.perda} onChange={(e) => atualizar(l.chave, { perda: e.target.value })} />
                <div className="flex items-baseline justify-between gap-2 md:block md:text-right">
                  <span className="text-[12px] text-text-muted md:hidden">Sai do estoque</span>
                  <span className="num text-[13px] font-medium text-text">{fmtQtd(bruta)} <span className="text-[11px] font-normal text-text-muted">{op?.unidade ?? ''}</span></span>
                  <span className="block text-[12px] text-text-muted num">{fmtBRL(custos[n] ?? 0)}</span>
                </div>
                {podeEditar ? (
                  <button type="button" aria-label="Remover insumo" onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))} className="flex size-8 items-center justify-center rounded-full text-text-muted u-motion hover:bg-surface-2 hover:text-err">
                    <Trash2 className="size-4" />
                  </button>
                ) : <span />}
              </li>
            )
          })}
        </ul>
        {linhas.length === 0 && <p className="py-6 text-center text-[13px] text-text-muted">Nenhum insumo ainda. Adicione o primeiro.</p>}
        {podeEditar && (
          <button type="button" onClick={adicionar} className={`${btnClass('outline')} mt-3`}><Plus className="size-4" />Adicionar insumo</button>
        )}
      </section>

      {/* Resumo de custo e ações */}
      <aside className="space-y-3 lg:sticky lg:top-24">
        <div className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
          <div className="text-[12px] font-medium uppercase tracking-wide text-text-muted">Custo por {produto.unidade}</div>
          <div className="mt-1 text-[32px] font-semibold leading-none tracking-[-0.02em] num">{fmtBRL(custoUnidade)}</div>
          <div className="mt-1 text-[13px] text-text-muted num">{fmtBRL(total)} a receita inteira ({fmtQtd(rend > 0 ? rend : 0)} {produto.unidade})</div>
          <div className="mt-3 flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Participação de cada insumo no custo">
            {barras.filter((b) => b.parte > 0).map((b, n) => <div key={b.chave} className={`h-full ${CORES[n % CORES.length]}`} style={{ width: `${b.parte * 100}%` }} />)}
          </div>
          {semCusto > 0 && (
            <p className="mt-3 flex items-start gap-1.5 text-[12px] text-warn"><TriangleAlert className="mt-px size-3.5 shrink-0" />{semCusto} insumo{semCusto === 1 ? '' : 's'} sem custo médio ainda: o custo real aparece depois da primeira compra com valor.</p>
          )}
          {cicloErro && <p className="mt-3 text-[12px] text-err">Receita circular detectada.</p>}
        </div>

        {podeEditar && (
          <div className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
            <label htmlFor="obs" className="mb-1 block text-[13px] font-medium text-text">O que mudou (opcional)</label>
            <input id="obs" className={campo} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: menos sal, rende 10% a mais" maxLength={200} />
            {erros.length > 0 && <ul className="mt-2 space-y-0.5 text-[12px] text-err">{erros.slice(0, 3).map((e) => <li key={e.mensagem}>{e.mensagem}</li>)}</ul>}
            <button type="button" onClick={salvar} disabled={pending || erros.length > 0} className={`${btnClass('primary')} mt-3 w-full`}>
              {pending ? <Spinner /> : <Save className="size-4" />}{versaoAtual && ativaAtual ? `Salvar como versão ${versaoAtual + 1}` : 'Salvar ficha'}
            </button>
            <p className="mt-2 text-[12px] text-text-muted">Cada salvamento cria uma nova versão. As vendas anteriores continuam ligadas à versão que usaram.</p>
            {ativaAtual && (
              confirmaDesativar ? (
                <div className="mt-3 flex items-center gap-2">
                  <button type="button" onClick={desativar} disabled={pending} className={btnClass('danger')}>Desativar mesmo</button>
                  <button type="button" onClick={() => setConfirmaDesativar(false)} className={btnClass('ghost')}>Cancelar</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmaDesativar(true)} className={`${btnClass('dangerSoft')} mt-3`}>Desativar receita</button>
              )
            )}
          </div>
        )}

        {versoes.length > 0 && (
          <div className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
            <div className="text-[13px] font-semibold text-text">Versões</div>
            <ul className="mt-2 divide-y divide-[var(--border)] text-[13px]">
              {versoes.map((v) => (
                <li key={v.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">v{v.versao}{v.ativa && <span className="ml-1.5 rounded-full bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand">em uso</span>}</span>
                    <span className="text-text-muted num">{new Date(v.criadaEm).toLocaleDateString('pt-BR')}</span>
                  </div>
                  <div className="text-[12px] text-text-muted">{v.nItens} insumo{v.nItens === 1 ? '' : 's'} · rende {fmtQtd(v.rendimento)}{v.obs ? ` · ${v.obs}` : ''}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  )
}
