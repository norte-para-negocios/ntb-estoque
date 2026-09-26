'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { criarProduto, sugerirProximoCodigo } from '@/lib/actions/produto'
import { PRODUTO_TIPO_ITEM, FAIXA_CODIGO_POR_TIPO } from '@/lib/constants-omie'
import { parseNumBR } from '@/lib/num-br'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'

const inputClass =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-muted focus:ring-2 focus:ring-brand/40 max-sm:text-base'

const ORIGENS = [
  { value: '0', label: '0 - Nacional' },
  { value: '1', label: '1 - Estrangeira (importação direta)' },
  { value: '2', label: '2 - Estrangeira (mercado interno)' },
  { value: '3', label: '3 - Nacional, importação >40% e ≤70%' },
  { value: '4', label: '4 - Nacional (conforme PPB)' },
  { value: '5', label: '5 - Nacional, importação ≤40%' },
  { value: '6', label: '6 - Estrangeira, imp. direta sem similar' },
  { value: '7', label: '7 - Estrangeira, merc. interno sem similar' },
  { value: '8', label: '8 - Nacional, importação >70%' },
]

const EXTRA_VAZIO = {
  ean: '', descrDetalhada: '', obsInternas: '', marca: '', modelo: '',
  pesoLiq: '', pesoBruto: '', altura: '', largura: '', profundidade: '', cest: '',
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-text-muted">{label}</label>
      {children}
    </div>
  )
}

function Secao({ titulo, span, children }: { titulo: string; span?: boolean; children: ReactNode }) {
  return (
    // Estilo Ajustes: título da seção fora, grupo de campos num cartão branco sem borda.
    <section className={`flex flex-col ${span ? 'lg:col-span-2' : ''}`}>
      <h2 className="mb-2 px-1 text-[17px] font-semibold tracking-[-0.01em] text-text">{titulo}</h2>
      <div className="flex-1 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">{children}</div>
    </section>
  )
}

export function FormNovoProduto({ familias }: { familias: { codigo: number; descricao: string }[] }) {
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [unidade, setUnidade] = useState('UN')
  const [ncm, setNcm] = useState('')
  const [valor, setValor] = useState('')
  const [minimo, setMinimo] = useState('')
  const [pdv, setPdv] = useState(false)
  const [tipo, setTipo] = useState('')
  const [criarNoNtbVendas, setCriarNoNtbVendas] = useState(false)
  const [familia, setFamilia] = useState('')
  const [origem, setOrigem] = useState('0')
  const [extra, setExtra] = useState({ ...EXTRA_VAZIO })
  const setX = (k: keyof typeof extra, v: string) => setExtra((e) => ({ ...e, [k]: v }))
  // Marca se o codigo atual foi sugerido pelo sistema (e nao digitado a mao): só
  // sobrescrevemos ao trocar o tipo enquanto o usuario nao editou manualmente.
  const [codigoSugerido, setCodigoSugerido] = useState(false)
  const [sugerindo, setSugerindo] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // Ao escolher o tipo: sugere o proximo codigo livre na faixa do tipo (reuniao 18/06).
  // Não sobrescreve um codigo que o usuario digitou a mao.
  async function onChangeTipo(novoTipo: string) {
    setTipo(novoTipo)
    if (!FAIXA_CODIGO_POR_TIPO[novoTipo]) return
    if (codigo.trim() && !codigoSugerido) return // respeita codigo digitado a mao
    setSugerindo(true)
    try {
      const sugestao = await sugerirProximoCodigo(novoTipo)
      if (sugestao) {
        setCodigo(sugestao)
        setCodigoSugerido(true)
      }
    } finally {
      setSugerindo(false)
    }
  }

  function criar() {
    if (!tipo) {
      toast.error('Escolha o tipo do produto')
      return
    }
    if (!codigo.trim() || !descricao.trim() || !unidade.trim()) {
      toast.error('Preencha código, descrição e unidade')
      return
    }
    if (ncm.replace(/\D/g, '').length !== 8) {
      toast.error('O NCM deve ter 8 dígitos')
      return
    }
    if (!familia) {
      toast.error('Escolha a família do produto')
      return
    }
    const fam = familias.find((f) => String(f.codigo) === familia)
    const valNum = parseNumBR(valor)
    if (valNum != null && (Number.isNaN(valNum) || valNum < 0)) {
      toast.error('Valor unitário inválido')
      return
    }
    const minNum = parseNumBR(minimo)
    if (minNum != null && (Number.isNaN(minNum) || minNum < 0)) {
      toast.error('Estoque mínimo inválido')
      return
    }
    const num = (s: string) => {
      const n = parseNumBR(s)
      return n != null && Number.isFinite(n) && n > 0 ? n : undefined
    }
    // Familias locais (sem ID Omie) usam codigo negativo como placeholder.
    // Nao enviar codigo negativo ao Omie: passar null para que o campo fique vazio.
    const codigoFamiliaOmie = fam && fam.codigo > 0 ? fam.codigo : null
    startTransition(async () => {
      const res = await criarProduto({
        codigo,
        descricao,
        unidade,
        ncm,
        valorUnitario: valNum ?? 0,
        estoqueMinimo: minNum ?? null,
        pdv,
        tipoItem: tipo || undefined,
        codigoFamilia: codigoFamiliaOmie,
        descricaoFamilia: fam ? fam.descricao : null,
        origem,
        ean: extra.ean || undefined,
        descrDetalhada: extra.descrDetalhada || undefined,
        obsInternas: extra.obsInternas || undefined,
        marca: extra.marca || undefined,
        modelo: extra.modelo || undefined,
        pesoLiq: num(extra.pesoLiq),
        pesoBruto: num(extra.pesoBruto),
        altura: num(extra.altura),
        largura: num(extra.largura),
        profundidade: num(extra.profundidade),
        cest: extra.cest || undefined,
        criarNoNtbVendas: pdv && criarNoNtbVendas,
      })
      if (res?.error) {
        toast.error('Erro ao criar', { description: res.error })
        return
      }
      toast.success('Produto criado no Omie')
      if (pdv && criarNoNtbVendas) {
        if (res?.avisoVendas) {
          toast.error('Falhou criar no NTB Vendas', { description: res.avisoVendas })
        } else {
          toast.success('Produto criado no NTB Vendas também!')
        }
      }
      router.push('/produto')
    })
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="grid gap-x-4 gap-y-6 lg:grid-cols-2">
        {/* Tipo PRIMEIRO: define a faixa do codigo sugerido (reuniao 18/06) */}
        <Secao titulo="Tipo do produto" span>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Tipo *">
              <select value={tipo} onChange={(e) => onChangeTipo(e.target.value)} className={inputClass}>
                <option value="">Selecione o tipo</option>
                {PRODUTO_TIPO_ITEM.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Campo>
            <div className="flex items-end">
              <p className="text-[13px] text-text-muted">
                {sugerindo
                  ? 'Sugerindo código pela faixa...'
                  : 'Escolha o tipo primeiro: o código é sugerido pela faixa (matéria-prima ~80 mil, revenda ~90 mil, acabado ~91 mil, processo/consumo ~70 mil, ativo ~50 mil).'}
              </p>
            </div>
          </div>
        </Secao>

        {/* Identificacao */}
        <Secao titulo="Identificação" span>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Campo label="Código *">
              <input
                value={codigo}
                onChange={(e) => { setCodigo(e.target.value); setCodigoSugerido(false) }}
                className={inputClass}
                placeholder={tipo ? 'Sugerido pelo tipo' : 'Escolha o tipo acima'}
              />
              {codigoSugerido && (
                <p className="text-[12px] text-brand">Código sugerido pela faixa do tipo. Pode editar.</p>
              )}
            </Campo>
            <Campo label="Unidade *">
              <input value={unidade} onChange={(e) => setUnidade(e.target.value)} className={inputClass} placeholder="UN, KG..." />
            </Campo>
            <Campo label="Valor unitário">
              <input type="text" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className={inputClass} placeholder="0,00" />
            </Campo>
            <Campo label="Descrição *">
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inputClass} placeholder="Nome do produto" />
            </Campo>
            <Campo label="NCM *">
              <input value={ncm} onChange={(e) => setNcm(e.target.value)} className={inputClass} placeholder="8 dígitos" inputMode="numeric" />
            </Campo>
            <Campo label="EAN / cód. de barras">
              <input value={extra.ean} onChange={(e) => setX('ean', e.target.value)} className={inputClass} placeholder="Opcional" inputMode="numeric" />
            </Campo>
          </div>
          <div className="mt-3">
            <Campo label="Descrição detalhada">
              <textarea value={extra.descrDetalhada} onChange={(e) => setX('descrDetalhada', e.target.value)} className={inputClass} rows={2} placeholder="Opcional" />
            </Campo>
          </div>
        </Secao>

        {/* Classificacao */}
        <Secao titulo="Classificação">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Família *">
              <select value={familia} onChange={(e) => setFamilia(e.target.value)} className={inputClass}>
                <option value="">Selecione</option>
                {familias.map((f) => (
                  <option key={f.codigo} value={f.codigo}>{f.descricao}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Marca">
              <input value={extra.marca} onChange={(e) => setX('marca', e.target.value)} className={inputClass} placeholder="Opcional" />
            </Campo>
            <Campo label="Modelo">
              <input value={extra.modelo} onChange={(e) => setX('modelo', e.target.value)} className={inputClass} placeholder="Opcional" />
            </Campo>
            <Campo label="Estoque mínimo">
              <input
                type="text"
                inputMode="decimal"
                value={minimo}
                onChange={(e) => setMinimo(e.target.value)}
                className={inputClass}
                placeholder="0"
              />
              <p className="text-[12px] text-text-muted">Salvo localmente, não enviado ao Omie.</p>
            </Campo>
          </div>
          <label className="mt-4 flex min-h-[44px] items-center gap-2.5 text-[15px] text-text sm:min-h-0">
            <input type="checkbox" checked={pdv} onChange={(e) => setPdv(e.target.checked)} className="size-4 accent-[var(--brand)]" />
            Produto de PDV (frente de loja)
          </label>
          <p className="mt-1 text-[12px] text-text-muted">
            Só produtos marcados vão pro cardápio do NTB Vendas. Salvo localmente, não enviado ao Omie.
          </p>
          {pdv && (
            <label className="mt-2 flex min-h-[44px] items-center gap-2.5 text-[15px] text-text sm:min-h-0">
              <input
                type="checkbox"
                checked={criarNoNtbVendas}
                onChange={(e) => setCriarNoNtbVendas(e.target.checked)}
                className="size-4 accent-[var(--brand)]"
              />
              Criar no NTB Vendas também
            </label>
          )}
        </Secao>

        {/* Fiscal */}
        <Secao titulo="Fiscal">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Origem da mercadoria">
              <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={inputClass}>
                {ORIGENS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Campo>
            <Campo label="CEST">
              <input value={extra.cest} onChange={(e) => setX('cest', e.target.value)} className={inputClass} placeholder="Opcional (validado pelo Omie)" inputMode="numeric" />
            </Campo>
          </div>
        </Secao>

        {/* Logistica */}
        <Secao titulo="Logística" span>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <Campo label="Peso líq. (kg)">
              <input type="number" min={0} step="any" value={extra.pesoLiq} onChange={(e) => setX('pesoLiq', e.target.value)} className={inputClass} placeholder="0" />
            </Campo>
            <Campo label="Peso bruto (kg)">
              <input type="number" min={0} step="any" value={extra.pesoBruto} onChange={(e) => setX('pesoBruto', e.target.value)} className={inputClass} placeholder="0" />
            </Campo>
            <Campo label="Altura (cm)">
              <input type="number" min={0} step="any" value={extra.altura} onChange={(e) => setX('altura', e.target.value)} className={inputClass} placeholder="0" />
            </Campo>
            <Campo label="Largura (cm)">
              <input type="number" min={0} step="any" value={extra.largura} onChange={(e) => setX('largura', e.target.value)} className={inputClass} placeholder="0" />
            </Campo>
            <Campo label="Profund. (cm)">
              <input type="number" min={0} step="any" value={extra.profundidade} onChange={(e) => setX('profundidade', e.target.value)} className={inputClass} placeholder="0" />
            </Campo>
          </div>
        </Secao>

        {/* Observacoes */}
        <Secao titulo="Observações internas" span>
          <textarea value={extra.obsInternas} onChange={(e) => setX('obsInternas', e.target.value)} className={inputClass} rows={2} placeholder="Opcional" />
        </Secao>
      </div>

      {/* Barra de acoes fixa */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-surface/85 px-4 py-3 backdrop-blur-xl max-lg:bottom-[calc(55px+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:gap-3 lg:-mx-8 lg:px-8">
        <span className="text-[12px] text-text-muted sm:text-[13px]">Obrigatórios: tipo, código, descrição, unidade, NCM e família.</span>
        <div className="flex items-center gap-2 max-sm:[&>*]:flex-1">
          <Link href="/produto" className={btnClass('outline')}>Cancelar</Link>
          <button onClick={criar} disabled={pending} className={btnClass('primary')}>
            {pending && <Spinner />}
            {pending ? 'Criando...' : 'Criar no Omie'}
          </button>
        </div>
      </div>
    </div>
  )
}
