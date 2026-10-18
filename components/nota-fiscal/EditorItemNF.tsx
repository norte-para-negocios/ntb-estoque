'use client'

// Editor do item da nota de entrada (estoque próprio, Fase B): o que o cartão de recebimento do Omie deixa ajustar por
// item — quantidade recebida e unidade, local de estoque, CFOP de entrada, "movimenta estoque", "gera conta a pagar",
// as 8 marcações "é custo de estoque" e as alíquotas de crédito. A prévia usa a mesma conta do lançamento (R15).
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, CircleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { campoCompra } from '@/components/compras-proprio/SeletorProduto'
import { configurarItemNF } from '@/lib/actions/nota-fiscal-proprio'
import { flagsDeTexto, flagsParaTexto, formatarCfop, previaCustoItem, ORDEM_FLAGS, UNIDADES_ESTOQUE, type FlagsCusto, type ConfigItemNF } from '@/lib/estoque/nf-item-regras'
import type { ItemConferencia } from './ConferenciaNF'

const ROTULO_FLAG: Record<(typeof ORDEM_FLAGS)[number], string> = {
  icms: 'ICMS é custo de estoque', icmsSt: 'ICMS-ST é custo de estoque', ipi: 'IPI é custo de estoque', seguro: 'Seguro é custo de estoque',
  pis: 'PIS é custo de estoque', cofins: 'COFINS é custo de estoque', frete: 'Frete é custo de estoque', outras: 'Outras despesas são custo de estoque',
}
const ORIGEM_FLAGS: Record<string, string> = {
  produto: 'sugerido: mesmo produto na última nota', fornecedor: 'sugerido: mesmo código do fornecedor', regra: 'sugerido pela regra do Omie',
  padrao: 'padrão — confira', manual: 'ajustado por você',
}
const ORIGEM_CFOP: Record<string, string> = { produto: 'sugerido: mesmo produto na última nota', tabela: 'sugerido pela tabela', regra: 'sugerido pela regra', manual: 'ajustado por você' }
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtCusto = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 6 })
const numBR = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))

export function EditorItemNF({ item, locais, editavel }: { item: ItemConferencia; locais: { codigo: number; descricao: string }[]; editavel: boolean }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [pending, start] = useTransition()
  const c = item.config
  const flagsIniciais = flagsDeTexto(c.flags) ?? flagsDeTexto('NNNNNNNN')!
  const [qtd, setQtd] = useState(String(c.quantidadeRecebida).replace('.', ','))
  const [unidade, setUnidade] = useState(c.unidadeEstoque ?? item.produto?.unidade ?? '')
  const [local, setLocal] = useState<number | ''>(c.codigoLocal ?? '')
  const [cfop, setCfop] = useState(c.cfopEntrada ?? '')
  const [movimenta, setMovimenta] = useState(c.movimentaEstoque)
  const [geraConta, setGeraConta] = useState(c.geraContaPagar)
  const [flags, setFlags] = useState<FlagsCusto>(flagsIniciais)
  const [pis, setPis] = useState(String(c.aliqCredPis).replace('.', ','))
  const [cofins, setCofins] = useState(String(c.aliqCredCofins).replace('.', ','))

  const qtdNum = numBR(qtd)
  const previa = useMemo(() => {
    if (item.fiscal.valorTotalItem == null || !(qtdNum > 0)) return item.previa
    return previaCustoItem({
      quantidadeNota: item.quantidade, precoUnit: item.fiscal.precoUnit, valorTotalItem: item.fiscal.valorTotalItem,
      desconto: item.fiscal.desconto, ipi: item.fiscal.ipi, st: item.fiscal.st, icms: item.fiscal.icms, frete: item.fiscal.frete, seguro: item.fiscal.seguro,
      freteCte: item.fiscal.freteCte, flags, aliqCredPis: numBR(pis) || 0, aliqCredCofins: numBR(cofins) || 0, quantidadeRecebida: qtdNum,
    })
  }, [item, flags, pis, cofins, qtdNum])

  function salvar() {
    const cfg: ConfigItemNF = {}
    if (qtdNum !== c.quantidadeRecebida) cfg.quantidadeRecebida = qtdNum
    if ((unidade || null) !== (c.unidadeEstoque ?? null) && unidade) cfg.unidadeEstoque = unidade
    if ((local === '' ? null : local) !== c.codigoLocal) cfg.codigoLocal = local === '' ? null : local
    if ((cfop.replace(/\D/g, '') || null) !== (c.cfopEntrada ?? null)) cfg.cfopEntrada = cfop.replace(/\D/g, '') || null
    if (movimenta !== c.movimentaEstoque) cfg.movimentaEstoque = movimenta
    if (geraConta !== c.geraContaPagar) cfg.geraContaPagar = geraConta
    if (flagsParaTexto(flags) !== (c.flags ?? '')) cfg.flags = flags
    if ((numBR(pis) || 0) !== c.aliqCredPis) cfg.aliqCredPis = numBR(pis) || 0
    if ((numBR(cofins) || 0) !== c.aliqCredCofins) cfg.aliqCredCofins = numBR(cofins) || 0
    if (!Object.keys(cfg).length) { setAberto(false); return }
    start(async () => {
      const r = await configurarItemNF(item.id, cfg)
      if ('error' in r) { toast.error('Não foi possível salvar o item', { description: r.error }); return }
      toast.success('Item salvo', { description: 'A nota volta para "a conferir".' })
      setAberto(false); router.refresh()
    })
  }

  const und = unidade || item.produto?.unidade || item.unidade || ''
  return (
    <div className="space-y-2">
      {item.alertas.length > 0 && (
        <ul className="space-y-1 text-[13px]">
          {item.alertas.map((a) => <li key={a.tipo} className="flex items-start gap-2 rounded-[var(--r-md)] bg-warn/10 px-3 py-1.5 text-warn"><CircleAlert className="mt-0.5 size-4 shrink-0" />{a.texto}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <p className="text-text-muted">
          {!c.movimentaEstoque ? 'Fica fora do estoque.' : previa
            ? <>Entra no estoque: <span className="num font-medium text-text">{fmtQtd(qtdNum > 0 ? qtdNum : c.quantidadeRecebida)} {und}</span>
                {previa.custoUnitario != null && <> a <span className="num font-medium text-text">{fmtCusto(previa.custoUnitario)}</span></>}
                {' '}(valor de estoque <span className="num">{fmtBRL(previa.valorEstoque)}</span>)</>
            : <>Entra no estoque: <span className="num font-medium text-text">{fmtQtd(c.quantidadeRecebida)} {und}</span></>}
          {c.cfopEntrada && <> · CFOP de entrada <span className="num">{formatarCfop(c.cfopEntrada)}</span></>}
        </p>
        <button type="button" className="inline-flex items-center gap-1 font-medium text-brand hover:underline" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
          Detalhes do item {aberto ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {aberto && (
        <div className="space-y-3 rounded-[var(--r-md)] bg-surface-2 p-3 text-[13px]">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1">
              <span className="font-medium text-text">Quantidade recebida</span>
              <div className="flex gap-2">
                <input inputMode="decimal" disabled={!editavel} className={`${campoCompra} num`} value={qtd} onChange={(e) => setQtd(e.target.value)} aria-label="Quantidade recebida" />
                <select disabled={!editavel} className={`${campoCompra} w-28`} value={unidade} onChange={(e) => setUnidade(e.target.value)} aria-label="Unidade de estoque">
                  {!UNIDADES_ESTOQUE.some((u) => u.sigla === unidade) && unidade && <option value={unidade}>{unidade}</option>}
                  {UNIDADES_ESTOQUE.map((u) => <option key={u.sigla} value={u.sigla}>{u.sigla} · {u.nome}</option>)}
                </select>
              </div>
              <span className="text-text-muted">Nota: {fmtQtd(item.quantidade)} {item.unidade ?? ''}{item.fator !== 1 ? ` · 1 ${item.unidade ?? ''} = ${fmtQtd(item.fator)} ${und}` : ''}</span>
            </label>
            <label className="space-y-1">
              <span className="font-medium text-text">Local de estoque</span>
              <select disabled={!editavel} className={campoCompra} value={local} onChange={(e) => setLocal(e.target.value ? Number(e.target.value) : '')} aria-label="Local de estoque do item">
                <option value="">O local da nota</option>
                {locais.map((l) => <option key={l.codigo} value={l.codigo}>{l.descricao}{item.produto ? ` (saldo ${fmtQtd(item.saldosPorLocal[l.codigo] ?? 0)})` : ''}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-medium text-text">CFOP de entrada</span>
              <input disabled={!editavel} className={`${campoCompra} num`} value={cfop} onChange={(e) => setCfop(e.target.value)} placeholder="ex.: 1.102" aria-label="CFOP de entrada" />
              <span className="text-text-muted">{cfop.replace(/\D/g, '').length === 4 ? formatarCfop(cfop.replace(/\D/g, '')) : ''}{c.origemCfop ? ` · ${ORIGEM_CFOP[c.origemCfop] ?? c.origemCfop}` : ''}</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2"><input type="checkbox" disabled={!editavel} className="size-4" checked={movimenta} onChange={(e) => setMovimenta(e.target.checked)} />Movimenta estoque</label>
            <label className="flex items-center gap-2"><input type="checkbox" disabled={!editavel} className="size-4" checked={geraConta} onChange={(e) => setGeraConta(e.target.checked)} />Gera conta a pagar</label>
          </div>
          <fieldset className="space-y-2">
            <legend className="font-medium text-text">Custo de estoque {c.origemFlags && <span className="ml-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">{ORIGEM_FLAGS[c.origemFlags] ?? c.origemFlags}</span>}</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {ORDEM_FLAGS.map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" disabled={!editavel} className="size-4" checked={flags[k]} onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))} />{ROTULO_FLAG[k]}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2">Alíquota de crédito do PIS (%)<input inputMode="decimal" disabled={!editavel} className={`${campoCompra} num w-24`} value={pis} onChange={(e) => setPis(e.target.value)} /></label>
              <label className="flex items-center gap-2">do COFINS (%)<input inputMode="decimal" disabled={!editavel} className={`${campoCompra} num w-24`} value={cofins} onChange={(e) => setCofins(e.target.value)} /></label>
            </div>
          </fieldset>
          <div>
            <p className="font-medium text-text">Impostos da nota</p>
            <p className="num text-text-muted">
              {item.fiscal.cst ? `CST ${item.fiscal.cst}` : item.fiscal.csosn ? `CSOSN ${item.fiscal.csosn}` : 'CST —'} · ICMS {fmtBRL(item.fiscal.icms)} · ST {fmtBRL(item.fiscal.st)} · IPI {fmtBRL(item.fiscal.ipi)}
              {' '}· PIS {fmtBRL(item.fiscal.pis)} · COFINS {fmtBRL(item.fiscal.cofins)} · frete {fmtBRL(item.fiscal.frete)} · seguro {fmtBRL(item.fiscal.seguro)} · outras {fmtBRL(item.fiscal.outras)}
              {item.fiscal.freteCte > 0 && <> · CT-e {fmtBRL(item.fiscal.freteCte)}</>}
            </p>
          </div>
          {editavel && (
            <div className="flex justify-end gap-2">
              <button type="button" className={btnClass('outline')} onClick={() => setAberto(false)} disabled={pending}>Cancelar</button>
              <button type="button" className={btnClass('primary')} onClick={salvar} disabled={pending}>{pending && <Spinner />}Salvar item</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
