'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, FileUp, ReceiptText } from 'lucide-react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { lancarCompraXml, previaXml, type PreviaCompra, type ProdutoBusca } from '@/lib/actions/compras-proprio'
import { custoUnitarioBase } from '@/lib/estoque/custo-compra'
import { campoCompra, SeletorProduto } from './SeletorProduto'

type Mapa = Record<number, { produto: ProdutoBusca | null; fator: string }>
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtCnpj = (c: string) => c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c

export function ImportarXml({ locais }: { locais: { codigoLocal: number; descricao: string; padrao: boolean }[] }) {
  const router = useRouter()
  const entrada = useRef<HTMLInputElement>(null)
  const [xml, setXml] = useState('')
  const [nomeArquivo, setNomeArquivo] = useState('')
  const [previa, setPrevia] = useState<PreviaCompra | null>(null)
  const [mapa, setMapa] = useState<Mapa>({})
  const [local, setLocal] = useState<number | ''>(locais.find((l) => l.padrao)?.codigoLocal ?? (locais.length === 1 ? locais[0].codigoLocal : ''))
  const [icms, setIcms] = useState(false)
  const [lendo, iniciarLeitura] = useTransition()
  const [lancando, iniciarLancamento] = useTransition()
  const [arrastando, setArrastando] = useState(false)

  async function carregar(arquivo: File | undefined) {
    if (!arquivo) return
    if (!/\.xml$/i.test(arquivo.name)) { toast.error('Envie o arquivo .xml da nota'); return }
    const texto = await arquivo.text()
    setXml(texto); setNomeArquivo(arquivo.name); setPrevia(null)
    iniciarLeitura(async () => {
      const r = await previaXml(texto)
      if ('error' in r) { toast.error('Não foi possível ler a nota', { description: r.error }); return }
      setPrevia(r.previa)
      const m: Mapa = {}
      for (const i of r.previa.itens) {
        m[i.linha] = { produto: i.produto && i.codigoProduto ? { codigoProduto: i.codigoProduto, codigo: i.produto.codigo, descricao: i.produto.descricao, unidade: i.produto.unidade } : null, fator: String(i.fator) }
      }
      setMapa(m)
    })
  }

  const itensCusto = previa?.itens.map((i) => ({ valorTotal: i.valorTotal, desconto: i.desconto, quantidade: i.quantidade, fator: Number((mapa[i.linha]?.fator ?? '1').replace(',', '.')) || 1, icms: i.icms })) ?? []
  const mapeados = previa ? previa.itens.filter((i) => mapa[i.linha]?.produto).length : 0
  const bloqueada = previa?.jaExiste && (previa.jaExiste.status === 'lancada' || previa.jaExiste.status === 'cancelada')

  function lancar() {
    if (!previa) return
    if (local === '') { toast.error('Escolha o local que recebe a mercadoria'); return }
    iniciarLancamento(async () => {
      const r = await lancarCompraXml({
        xml, codigoLocal: local, icmsRecuperavel: icms,
        mapeamentos: previa.itens.map((i) => ({ linha: i.linha, codigoProduto: mapa[i.linha]?.produto?.codigoProduto ?? null, fator: Number((mapa[i.linha]?.fator ?? '1').replace(',', '.')) || 1 })),
      })
      if ('error' in r) { toast.error('Não foi possível lançar', { description: r.error }); return }
      toast.success(r.status === 'lancada' ? 'Compra lançada no estoque' : `${r.lancados} itens lançados, ${r.pendentes} pendentes de produto`)
      router.push(`/compras/${r.compraId}`)
    })
  }

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setArrastando(true) }} onDragLeave={() => setArrastando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); void carregar(e.dataTransfer.files[0]) }}
        className={`rounded-[var(--r-lg)] border-2 border-dashed p-6 text-center transition-colors ${arrastando ? 'border-brand bg-brand/5' : 'border-[var(--border)] bg-surface'}`}
      >
        <FileUp className="mx-auto size-8 text-text-muted" strokeWidth={1.5} />
        <p className="mt-2 text-[15px] font-medium text-text">{nomeArquivo || 'Arraste o XML da nota aqui'}</p>
        <p className="text-[13px] text-text-muted">Use o XML completo (procNFe) que o fornecedor enviou, não o resumo.</p>
        <input ref={entrada} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => void carregar(e.target.files?.[0])} />
        <button type="button" className={`${btnClass('outline')} mt-3`} onClick={() => entrada.current?.click()} disabled={lendo}>{lendo ? <Spinner /> : null}Escolher arquivo</button>
      </div>

      {previa && (
        <>
          <section className="rounded-[var(--r-lg)] bg-surface p-4 u-card" aria-label="Nota fiscal">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[13px] text-text-muted"><ReceiptText className="size-4" /> NF {previa.nfe.numero} · série {previa.nfe.serie} · {previa.nfe.emissao ? new Date(previa.nfe.emissao + 'T12:00:00').toLocaleDateString('pt-BR') : 'sem data'}</div>
                <h2 className="mt-1 truncate text-[18px] font-semibold text-text">{previa.nfe.fornecedor.nome || 'Fornecedor sem nome'}</h2>
                <p className="num text-[12px] text-text-muted">{fmtCnpj(previa.nfe.fornecedor.cnpj)}</p>
                <p className="num mt-1 break-all text-[11px] text-text-muted">{previa.nfe.chave}</p>
              </div>
              <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-right text-[13px]">
                <div><dt className="text-text-muted">Produtos</dt><dd className="num font-medium">{fmtBRL(previa.nfe.valores.produtos)}</dd></div>
                <div><dt className="text-text-muted">Frete e outros</dt><dd className="num font-medium">{fmtBRL(previa.nfe.valores.frete)}</dd></div>
                <div><dt className="text-text-muted">Total da nota</dt><dd className="num text-[16px] font-semibold">{fmtBRL(previa.nfe.valores.total)}</dd></div>
              </dl>
            </div>
            {previa.nfe.avisos.map((a) => <p key={a} className="mt-2 flex items-center gap-2 text-[13px] text-warn"><AlertTriangle className="size-4 shrink-0" />{a}</p>)}
            {previa.jaExiste && (
              <p className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-[13px]">
                <CheckCircle2 className="size-4 text-ok" /> Esta nota já foi importada ({previa.jaExiste.status}).
                <Link href={`/compras/${previa.jaExiste.id}`} className="font-medium text-brand hover:underline">Abrir a compra</Link>
              </p>
            )}
          </section>

          <section aria-label="Itens da nota" className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-text">Itens da nota <span className="font-normal text-text-muted">· {mapeados} de {previa.itens.length} ligados a um produto</span></h3>
            </div>
            <ul className="space-y-3">
              {previa.itens.map((i) => {
                const m = mapa[i.linha] ?? { produto: null, fator: '1' }
                const fator = Number(m.fator.replace(',', '.')) || 1
                const custo = custoUnitarioBase({ valorTotal: i.valorTotal, desconto: i.desconto, quantidade: i.quantidade, fator, icms: i.icms }, itensCusto, previa.nfe.valores.frete, previa.nfe.valores.descontoNota, icms)
                return (
                  <li key={i.linha} className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-text">{i.descricao}</p>
                        <p className="num text-[12px] text-text-muted">cód. {i.cProd}{i.ncm ? ` · NCM ${i.ncm}` : ''}{i.cfop ? ` · CFOP ${i.cfop}` : ''}</p>
                      </div>
                      <p className="num text-right text-[13px] text-text-muted">{fmtQtd(i.quantidade)} {i.unidade} × {fmtBRL(i.valorUnitario)}<br /><span className="font-medium text-text">{fmtBRL(i.valorTotal - i.desconto)}</span></p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                      <div className="space-y-1.5">
                        <Label>Produto no estoque{i.sugestao === 'depara' ? ' · lembrado deste fornecedor' : i.sugestao === 'descricao' ? ' · mesmo nome' : ''}</Label>
                        <SeletorProduto value={m.produto} sugestaoDescricao={i.descricao} sugestaoUnidade={i.unidade}
                          onChange={(p) => setMapa((x) => ({ ...x, [i.linha]: { ...m, produto: p } }))} />
                      </div>
                      {m.produto && (
                        <div className="space-y-1.5 md:w-64">
                          <Label>1 {i.unidade} da nota = quantos {m.produto.unidade}?</Label>
                          <input inputMode="decimal" className={`${campoCompra} num`} value={m.fator} onChange={(e) => setMapa((x) => ({ ...x, [i.linha]: { ...m, fator: e.target.value } }))} />
                          <p className="text-[12px] text-text-muted">{custo != null ? <>Entra {fmtQtd(i.quantidade * fator)} {m.produto.unidade} a <span className="num font-medium text-text">{fmtBRL(custo)}</span> cada</> : 'Informe a quantidade'}</p>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="rounded-[var(--r-lg)] bg-surface p-4 u-card" aria-label="Lançamento">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5"><Label>Local que recebe a mercadoria</Label>
                <select className={campoCompra} value={local} onChange={(e) => setLocal(Number(e.target.value))}>
                  <option value="" disabled>Escolha o local</option>
                  {locais.map((l) => <option key={l.codigoLocal} value={l.codigoLocal}>{l.descricao}</option>)}
                </select></div>
              <label className="flex items-start gap-3 text-[13px]">
                <input type="checkbox" className="mt-1 size-4" checked={icms} onChange={(e) => setIcms(e.target.checked)} />
                <span><span className="font-medium text-text">O ICMS desta nota é recuperável</span><br /><span className="text-text-muted">Deixe desmarcado no Simples Nacional: o custo é o valor cheio. Confirme com o contador.</span></span>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-text-muted">{mapeados < previa.itens.length ? `${previa.itens.length - mapeados} itens ficam pendentes e podem ser ligados depois.` : 'Todos os itens estão ligados.'}</p>
              <button type="button" className={btnClass('primary')} onClick={lancar} disabled={lancando || !!bloqueada || mapeados === 0}>
                {lancando && <Spinner />}Lançar {mapeados} {mapeados === 1 ? 'item' : 'itens'} no estoque
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
