'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Boxes, Layers, Link2, Plus, Trash2, ChevronDown } from 'lucide-react'
import { criarProdutoCatalogo, salvarProdutoCatalogo, type GrupoLinha, type ProdutoCatalogo } from '@/lib/actions/catalogo-proprio'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { parseNumBR } from '@/lib/num-br'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'

const inputClass =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-muted focus:ring-2 focus:ring-brand/40 max-sm:text-base'

const ORIGENS = ['0 - Nacional', '1 - Estrangeira (importação direta)', '2 - Estrangeira (mercado interno)', '3 - Nacional, importação >40% e ≤70%', '4 - Nacional (conforme PPB)', '5 - Nacional, importação ≤40%', '6 - Estrangeira, imp. direta sem similar', '7 - Estrangeira, merc. interno sem similar', '8 - Nacional, importação >70%']

type Familia = { codigo: number; descricao: string }
type LinhaVar = { codigo: string | null; valor: string; preco: string; inativo: boolean }

function Campo({ label, dica, children }: { label: string; dica?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-text-muted">{label}</label>
      {children}
      {dica && <p className="text-[12px] text-text-muted">{dica}</p>}
    </div>
  )
}

function Secao({ titulo, descricao, span, children }: { titulo: string; descricao?: string; span?: boolean; children: ReactNode }) {
  return (
    <section className={`flex flex-col ${span ? 'lg:col-span-2' : ''}`}>
      <div className="mb-2 px-1">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-text">{titulo}</h2>
        {descricao && <p className="mt-0.5 text-[13px] text-text-muted">{descricao}</p>}
      </div>
      <div className="flex-1 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">{children}</div>
    </section>
  )
}

/** Opções do seletor de grupo, indentadas pela profundidade da árvore ("Bebidas › Sucos"). */
function opcoesGrupo(grupos: GrupoLinha[]): { id: number; rotulo: string; ativo: boolean }[] {
  const porPai = new Map<number | null, GrupoLinha[]>()
  for (const g of grupos) porPai.set(g.pai_id, [...(porPai.get(g.pai_id) ?? []), g])
  const out: { id: number; rotulo: string; ativo: boolean }[] = []
  const visita = (pai: number | null, trilha: string[]) => {
    for (const g of porPai.get(pai) ?? []) {
      const t = [...trilha, g.nome]
      out.push({ id: g.id, rotulo: t.join(' › '), ativo: g.ativo })
      visita(g.id, t)
    }
  }
  visita(null, [])
  return out
}

export function FormProdutoProprio({ modo, familias, grupos, inicial }: { modo: 'novo' | 'editar'; familias: Familia[]; grupos: GrupoLinha[]; inicial?: ProdutoCatalogo }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const edicao = modo === 'editar' && !!inicial
  const ehMaeInicial = !!inicial?.ehMae

  const [comVariacoes, setComVariacoes] = useState(ehMaeInicial)
  const [tipo, setTipo] = useState(inicial?.tipoItem ?? '04')
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '')
  const [unidade, setUnidade] = useState(inicial?.unidade ?? 'UN')
  const [ncm, setNcm] = useState(inicial?.ncm ?? '')
  const [ean, setEan] = useState(inicial?.ean ?? '')
  const [valor, setValor] = useState(inicial ? String(inicial.valorUnitario).replace('.', ',') : '')
  const [minimo, setMinimo] = useState(inicial?.estoqueMinimo != null ? String(inicial.estoqueMinimo).replace('.', ',') : '')
  const [validadeDias, setValidadeDias] = useState(inicial?.validadeDias != null ? String(inicial.validadeDias) : '')
  const [familia, setFamilia] = useState(inicial?.codigoFamilia != null ? String(inicial.codigoFamilia) : '')
  const [grupoId, setGrupoId] = useState(inicial?.grupoId != null ? String(inicial.grupoId) : '')
  const [pdv, setPdv] = useState(inicial?.pdv ?? true)
  const [inativo, setInativo] = useState(inicial?.inativo ?? false)
  const [atributo, setAtributo] = useState(() => {
    const primeira = inicial?.variacoes[0]?.atributos
    return primeira ? Object.keys(primeira)[0] ?? 'Tamanho' : 'Tamanho'
  })
  const [linhas, setLinhas] = useState<LinhaVar[]>(() =>
    inicial?.variacoes.length
      ? inicial.variacoes.map((v) => ({ codigo: v.codigo, valor: Object.values(v.atributos)[0] ?? v.descricao, preco: String(v.valorUnitario).replace('.', ','), inativo: v.inativo }))
      : [{ codigo: null, valor: '', preco: '', inativo: false }, { codigo: null, valor: '', preco: '', inativo: false }]
  )
  const [extras, setExtras] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(inicial?.extras ?? {}).map(([k, v]) => [k, String(v)])))
  const setX = (k: string, v: string) => setExtras((e) => ({ ...e, [k]: v }))
  const [maisAberto, setMaisAberto] = useState(Object.keys(inicial?.extras ?? {}).length > 0)

  const opcoes = useMemo(() => opcoesGrupo(grupos), [grupos])
  const menorPreco = useMemo(() => {
    const ps = linhas.filter((l) => !l.inativo).map((l) => parseNumBR(l.preco)).filter((n): n is number => n != null && Number.isFinite(n))
    return ps.length ? Math.min(...ps) : null
  }, [linhas])

  function enviar() {
    if (!descricao.trim()) return toast.error('Informe a descrição')
    if (!unidade.trim()) return toast.error('Informe a unidade')
    const n8 = ncm.replace(/\D/g, '')
    if (n8 && n8.length !== 8) return toast.error('O NCM deve ter 8 dígitos (ou deixe em branco)')
    const precoNum = parseNumBR(valor)
    if (!comVariacoes && precoNum != null && (Number.isNaN(precoNum) || precoNum < 0)) return toast.error('Preço de venda inválido')
    const minNum = parseNumBR(minimo)
    if (minNum != null && (Number.isNaN(minNum) || minNum < 0)) return toast.error('Estoque mínimo inválido')
    const diasNum = validadeDias.trim() ? Math.trunc(Number(validadeDias)) : null
    if (diasNum != null && (!Number.isFinite(diasNum) || diasNum < 1 || diasNum > 3650)) return toast.error('Validade em dias inválida (1 a 3650)')

    const vars = comVariacoes
      ? linhas.filter((l) => l.valor.trim()).map((l) => {
          const p = parseNumBR(l.preco)
          return { codigo: l.codigo, descricao: `${descricao.trim()} - ${l.valor.trim()}`, preco: p != null && Number.isFinite(p) ? p : 0, inativo: l.inativo, atributos: { [atributo.trim() || 'Variação']: l.valor.trim() } }
        })
      : []
    if (comVariacoes && vars.length < 2 && !edicao) return toast.error('Informe pelo menos 2 variações (ou crie como produto simples)')
    const nomes = vars.map((v) => v.descricao.toLowerCase())
    if (new Set(nomes).size !== nomes.length) return toast.error('Há variações repetidas')
    const extrasLimpos = Object.fromEntries(Object.entries(extras).filter(([, v]) => v.trim()))
    const fam = familias.find((f) => String(f.codigo) === familia)

    start(async () => {
      if (edicao && inicial) {
        const r = await salvarProdutoCatalogo(
          inicial.codigo,
          { descricao, unidade, ncm: n8 || null, estoqueMinimo: minNum ?? null, pdv, inativo, valorUnitario: precoNum ?? null, grupoId: grupoId ? Number(grupoId) : null, atributos: inicial.atributos, ean: ean || null, extras: extrasLimpos, validadeDias: diasNum },
          vars
        )
        if ('error' in r) { toast.error('Não foi possível salvar', { description: r.error }); return }
        toast.success('Produto salvo. O Norte Vendas é atualizado automaticamente.')
        router.refresh()
        return
      }
      const r = await criarProdutoCatalogo({
        descricao, unidade, ncm: n8 || null, tipoItem: tipo, valorUnitario: precoNum ?? 0, estoqueMinimo: minNum ?? null, pdv,
        codigoFamilia: fam?.codigo ?? null, descricaoFamilia: fam?.descricao ?? null, grupoId: grupoId ? Number(grupoId) : null,
        ean: ean || null, extras: extrasLimpos, validadeDias: diasNum,
        variacoes: vars.map((v) => ({ descricao: v.descricao, preco: v.preco, atributos: v.atributos })),
      })
      if ('error' in r) { toast.error('Não foi possível criar', { description: r.error }); return }
      toast.success(comVariacoes ? `Produto mãe ${r.codigo} criado com ${r.variacoes.length} variações` : `Produto ${r.codigo} criado`)
      router.push('/produto')
    })
  }

  return (
    <div className="space-y-4 pb-24">
      {!edicao && (
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de cadastro">
          {[
            { v: false, titulo: 'Produto simples', texto: 'Um item com um código, um preço e um saldo. Ex.: Heineken 330ml.', icone: Boxes },
            { v: true, titulo: 'Produto com variações', texto: 'Um produto mãe com versões (tamanho, sabor…). Cada variação tem código, preço e estoque próprios; no cardápio vira uma escolha.', icone: Layers },
          ].map((o) => (
            <button
              key={o.titulo} type="button" role="radio" aria-checked={comVariacoes === o.v} onClick={() => setComVariacoes(o.v)}
              className={`flex gap-3 rounded-[var(--r-lg)] p-4 text-left u-motion u-press shadow-[var(--shadow-sm)] ${comVariacoes === o.v ? 'bg-brand-soft ring-2 ring-brand' : 'bg-surface hover:bg-surface-2'}`}
            >
              <o.icone className={`mt-0.5 size-5 shrink-0 ${comVariacoes === o.v ? 'text-brand' : 'text-text-muted'}`} strokeWidth={1.8} />
              <span>
                <span className="block text-[15px] font-semibold text-text">{o.titulo}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-text-muted">{o.texto}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {edicao && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
          <span className="rounded-full bg-surface-2 px-3 py-1 font-mono text-text">{inicial!.codigo}</span>
          {ehMaeInicial && <span className="rounded-full bg-brand-soft px-3 py-1 font-medium text-brand">Produto mãe</span>}
          {inicial!.paiCodigoProduto != null && <span className="rounded-full bg-surface-2 px-3 py-1">Variação</span>}
          {inicial!.vinculado && <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-brand"><Link2 className="size-3.5" />No Norte Vendas</span>}
          <span>O código é automático e nunca muda.</span>
        </div>
      )}

      <div className="grid gap-x-4 gap-y-6 lg:grid-cols-2">
        <Secao titulo="Identificação" span>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Campo label="Descrição *">
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inputClass} placeholder={comVariacoes ? 'Ex.: Moqueca de Peixe' : 'Nome do produto'} />
            </Campo>
            {!edicao && (
              <Campo label="Tipo do item *" dica="Define o prefixo do código: 90 vendável, 80 matéria-prima, 70 intermediário, 60 consumo, 50 outros.">
                <select value={tipo} onChange={(e) => { setTipo(e.target.value); if (!inicial) setPdv(['00', '04'].includes(e.target.value)) }} className={inputClass}>
                  {PRODUTO_TIPO_ITEM.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Campo>
            )}
            <Campo label="Unidade *" dica="Unidade de estoque: g, ml e un para receitas.">
              <input value={unidade} onChange={(e) => setUnidade(e.target.value.toUpperCase())} className={inputClass} placeholder="UN, KG, G, ML…" />
            </Campo>
            {!comVariacoes && (
              <Campo label="Preço de venda" dica="O Norte Vendas é quem manda no preço.">
                <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className={inputClass} placeholder="0,00" />
              </Campo>
            )}
            <Campo label="NCM"><input value={ncm} onChange={(e) => setNcm(e.target.value)} className={inputClass} placeholder="8 dígitos" inputMode="numeric" /></Campo>
            <Campo label="EAN / código de barras"><input value={ean} onChange={(e) => setEan(e.target.value)} className={inputClass} placeholder="Opcional" inputMode="numeric" /></Campo>
          </div>
        </Secao>

        {comVariacoes && (
          <Secao titulo="Variações" descricao="Cada linha vira um produto com código e saldo próprios. O preço da mãe no cardápio é o menor preço; as demais viram acréscimo." span>
            <div className="mb-3 max-w-xs">
              <Campo label="O que varia?"><input value={atributo} onChange={(e) => setAtributo(e.target.value)} className={inputClass} placeholder="Tamanho, Sabor, Volume…" /></Campo>
            </div>
            <div className="space-y-2">
              <div className="hidden grid-cols-[minmax(0,1fr)_140px_120px_36px] gap-2 px-1 text-[12px] font-medium text-text-muted sm:grid">
                <span>{atributo || 'Variação'}</span><span>Preço de venda</span><span>Código</span><span />
              </div>
              {linhas.map((l, i) => (
                <div key={i} className={`grid grid-cols-[minmax(0,1fr)_36px] gap-2 sm:grid-cols-[minmax(0,1fr)_140px_120px_36px] ${l.inativo ? 'opacity-50' : ''}`}>
                  <input value={l.valor} onChange={(e) => setLinhas((a) => a.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} className={inputClass} placeholder={`Ex.: ${i === 0 ? 'Individual' : 'Família'}`} aria-label={`${atributo || 'Variação'} ${i + 1}`} />
                  <button type="button" aria-label="Remover variação" disabled={l.codigo != null} title={l.codigo ? 'Variação já criada: inative em vez de remover' : 'Remover'}
                    onClick={() => setLinhas((a) => a.filter((_, j) => j !== i))}
                    className="order-last flex size-9 items-center justify-center self-center rounded-full text-text-muted u-motion hover:bg-surface-2 hover:text-err disabled:opacity-30 sm:order-none sm:col-start-4 sm:row-start-1">
                    <Trash2 className="size-4" />
                  </button>
                  <input inputMode="decimal" value={l.preco} onChange={(e) => setLinhas((a) => a.map((x, j) => (j === i ? { ...x, preco: e.target.value } : x)))} className={`${inputClass} col-span-1 sm:col-span-1`} placeholder="0,00" aria-label="Preço" />
                  <span className="hidden items-center rounded-[var(--r-md)] bg-surface-2 px-3 font-mono text-[13px] text-text-muted sm:flex">{l.codigo ?? 'automático'}</span>
                  {l.codigo && (
                    <label className="col-span-2 flex items-center gap-2 text-[13px] text-text-muted sm:col-span-4">
                      <input type="checkbox" checked={l.inativo} onChange={(e) => setLinhas((a) => a.map((x, j) => (j === i ? { ...x, inativo: e.target.checked } : x)))} className="size-4 accent-[var(--brand)]" /> Inativa
                    </label>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button type="button" className={btnClass('outline')} onClick={() => setLinhas((a) => [...a, { codigo: null, valor: '', preco: '', inativo: false }])}><Plus className="size-4" />Adicionar variação</button>
              {menorPreco != null && <span className="text-[13px] text-text-muted">No cardápio: a partir de <b className="text-text">R$ {menorPreco.toFixed(2).replace('.', ',')}</b></span>}
            </div>
          </Secao>
        )}

        <Secao titulo="Classificação">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Grupo / subgrupo" dica="Vira a categoria do produto no cardápio do Norte Vendas.">
              <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)} className={inputClass}>
                <option value="">Sem grupo</option>
                {opcoes.map((o) => <option key={o.id} value={o.id}>{o.rotulo}{o.ativo ? '' : ' (inativo)'}</option>)}
              </select>
              <Link href="/grupo-produto" className="text-[12px] text-brand hover:underline">Gerenciar grupos e subgrupos</Link>
            </Campo>
            {!edicao && (
              <Campo label="Família">
                <select value={familia} onChange={(e) => setFamilia(e.target.value)} className={inputClass}>
                  <option value="">Sem família</option>
                  {familias.map((f) => <option key={f.codigo} value={f.codigo}>{f.descricao}</option>)}
                </select>
              </Campo>
            )}
            <Campo label="Estoque mínimo" dica={comVariacoes ? 'Aplicado em cada variação.' : undefined}>
              <input inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} className={inputClass} placeholder="0" />
            </Campo>
            <Campo label="Validade (dias)" dica="Sem validade informada na entrada, o lote vence em entrada + estes dias.">
              <input inputMode="numeric" value={validadeDias} onChange={(e) => setValidadeDias(e.target.value.replace(/\D/g, ''))} className={inputClass} placeholder="Ex.: 5" />
            </Campo>
          </div>
          <label className="mt-4 flex min-h-[44px] items-center gap-2.5 text-[15px] text-text sm:min-h-0">
            <input type="checkbox" checked={pdv} onChange={(e) => setPdv(e.target.checked)} className="size-4 accent-[var(--brand)]" />
            Produto de PDV (aparece no cardápio do Norte Vendas)
          </label>
          {edicao && (
            <label className="mt-2 flex min-h-[44px] items-center gap-2.5 text-[15px] text-text sm:min-h-0">
              <input type="checkbox" checked={inativo} onChange={(e) => setInativo(e.target.checked)} className="size-4 accent-[var(--brand)]" />
              Produto inativo
            </label>
          )}
        </Secao>

        <Secao titulo="Mais detalhes" descricao="Opcional: fiscal, medidas e observações.">
          <button type="button" onClick={() => setMaisAberto((v) => !v)} className="flex w-full items-center justify-between text-[14px] font-medium text-text" aria-expanded={maisAberto}>
            {maisAberto ? 'Ocultar campos' : 'Mostrar campos'} <ChevronDown className={`size-4 u-motion ${maisAberto ? 'rotate-180' : ''}`} />
          </button>
          {maisAberto && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Campo label="Origem da mercadoria">
                <select value={extras.origem ?? '0'} onChange={(e) => setX('origem', e.target.value)} className={inputClass}>{ORIGENS.map((o, i) => <option key={i} value={String(i)}>{o}</option>)}</select>
              </Campo>
              <Campo label="CEST"><input value={extras.cest ?? ''} onChange={(e) => setX('cest', e.target.value)} className={inputClass} placeholder="Opcional" inputMode="numeric" /></Campo>
              <Campo label="Marca"><input value={extras.marca ?? ''} onChange={(e) => setX('marca', e.target.value)} className={inputClass} placeholder="Opcional" /></Campo>
              <Campo label="Modelo"><input value={extras.modelo ?? ''} onChange={(e) => setX('modelo', e.target.value)} className={inputClass} placeholder="Opcional" /></Campo>
              <Campo label="Peso líquido (kg)"><input value={extras.pesoLiq ?? ''} onChange={(e) => setX('pesoLiq', e.target.value)} className={inputClass} inputMode="decimal" placeholder="0" /></Campo>
              <Campo label="Peso bruto (kg)"><input value={extras.pesoBruto ?? ''} onChange={(e) => setX('pesoBruto', e.target.value)} className={inputClass} inputMode="decimal" placeholder="0" /></Campo>
              <Campo label="Altura / Largura / Profundidade (cm)">
                <div className="grid grid-cols-3 gap-2">
                  {(['altura', 'largura', 'profundidade'] as const).map((k) => <input key={k} value={extras[k] ?? ''} onChange={(e) => setX(k, e.target.value)} className={inputClass} inputMode="decimal" placeholder={k.slice(0, 1).toUpperCase() + k.slice(1, 4)} aria-label={k} />)}
                </div>
              </Campo>
              <div className="sm:col-span-2"><Campo label="Descrição detalhada"><textarea value={extras.descrDetalhada ?? ''} onChange={(e) => setX('descrDetalhada', e.target.value)} className={inputClass} rows={2} /></Campo></div>
              <div className="sm:col-span-2"><Campo label="Observações internas"><textarea value={extras.obsInternas ?? ''} onChange={(e) => setX('obsInternas', e.target.value)} className={inputClass} rows={2} /></Campo></div>
            </div>
          )}
        </Secao>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-surface/85 px-4 py-3 backdrop-blur-xl max-lg:bottom-[calc(55px+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:gap-3 lg:-mx-8 lg:px-8">
        <span className="text-[12px] text-text-muted sm:text-[13px]">Tudo aqui é sincronizado sozinho com o Norte Vendas. O código é gerado pelo sistema.</span>
        <div className="flex items-center gap-2 max-sm:[&>*]:flex-1">
          <Link href="/produto" className={btnClass('outline')}>{edicao ? 'Voltar' : 'Cancelar'}</Link>
          <button onClick={enviar} disabled={pending} className={btnClass('primary')}>
            {pending && <Spinner />}
            {pending ? 'Salvando...' : edicao ? 'Salvar' : comVariacoes ? 'Criar produto e variações' : 'Criar produto'}
          </button>
        </div>
      </div>
    </div>
  )
}
