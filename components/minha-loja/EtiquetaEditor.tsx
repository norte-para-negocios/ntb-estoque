'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronUp, ChevronDown, Printer } from 'lucide-react'
import { salvarEtiquetaConfig } from '@/lib/actions/minha-loja'
import { formParaConfig, type EtiquetaFormValores } from '@/lib/etiqueta-config'
import { CAMPOS_ETIQUETA, type CampoEtiqueta } from '@/components/etiqueta/EtiquetaPDF'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'
const secao = 'rounded-lg border border-border bg-surface p-3'
const tituloSecao = 'mb-2 text-[13px] font-semibold text-text'

// Campo opcional -> chave do toggle de visibilidade no form.
const MOSTRAR_KEY: Record<CampoEtiqueta, keyof EtiquetaFormValores> = {
  fabricacao: 'mostrar_fabricacao',
  validade: 'mostrar_validade',
  qtde_nf: 'mostrar_qtde_nf',
  qtde_etiqueta: 'mostrar_qtde_etiqueta',
  lote: 'mostrar_lote',
  recebido: 'mostrar_recebido',
  fornecedor: 'mostrar_fornecedor',
}
const LABEL_CAMPO = new Map(CAMPOS_ETIQUETA.map((c) => [c.key, c.label]))

// Valores de exemplo para a prévia.
const EXEMPLO: Record<CampoEtiqueta, { label: string; valor: string }> = {
  fabricacao: { label: 'Fabricação', valor: '21/06/2026' },
  validade: { label: 'Validade', valor: '28/06/2026' },
  qtde_nf: { label: 'Qtde NF', valor: '10 (CX)' },
  qtde_etiqueta: { label: 'Qtde Etiqueta', valor: '1 (CX)' },
  lote: { label: 'Lote', valor: 'OP-1234' },
  recebido: { label: 'Recebido', valor: '20/06/2026' },
  fornecedor: { label: '', valor: 'SENDAS DISTRIBUIDORA S/A' },
}

function Check({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text">
      <input type="checkbox" checked={on} onChange={onToggle} className="size-4 accent-[var(--brand)]" />
      {children}
    </label>
  )
}

// Prévia HTML aproximada da etiqueta (não é pixel a pixel do PDF).
function Preview({ f }: { f: EtiquetaFormValores }) {
  const cor = /^#[0-9a-fA-F]{6}$/.test(f.cor_destaque) ? f.cor_destaque : '#111111'
  const filete = cor === '#111111' ? '#d4d4d8' : cor
  const Wpx = 320
  const Hpx = Math.max(90, Math.round((Wpx * Number(f.altura_cm)) / Number(f.largura_cm)))
  const esc = Number(f.fonte_escala) || 1
  const px = (n: number) => `${(n * esc).toFixed(1)}px`
  const nome = (f.nome_exibido || 'SUA LOJA').toUpperCase()
  const visiveis = f.ordem_campos.filter((k) => f[MOSTRAR_KEY[k as CampoEtiqueta]]) as CampoEtiqueta[]
  const temRodape = f.mostrar_cnpj || f.mostrar_logo

  return (
    <div
      className="overflow-hidden bg-white text-black shadow-sm"
      style={{ width: Wpx, height: Hpx, border: f.mostrar_borda ? `1.5px solid ${cor}` : '1px solid #e5e7eb', padding: 6 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ borderBottom: `1px solid ${filete}`, paddingBottom: 2, marginBottom: 3 }}>
          <div style={{ color: cor, fontSize: px(9), fontWeight: f.negrito_nome ? 700 : 400, letterSpacing: 0.3 }}>{nome}</div>
        </div>
        <div style={{ display: 'flex', flex: 1, gap: 4, overflow: 'hidden' }}>
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontSize: px(10), fontWeight: f.negrito_descricao ? 700 : 400, lineHeight: 1.2, marginBottom: 3 }}>
              CHOPP BRAHMA CLARO BARRIL KEG 50L
            </div>
            <div style={{ fontSize: px(8), marginBottom: 2, color: '#333' }}>Prod: 90629 &nbsp; 1 de 10 (UN)</div>
            {visiveis.map((k) => (
              <div key={k} style={{ fontSize: px(8.5), marginBottom: 1.5 }}>
                {EXEMPLO[k].label && <span style={{ color: '#666' }}>{EXEMPLO[k].label}: </span>}
                <span style={{ fontWeight: 700 }}>{EXEMPLO[k].valor}</span>
              </div>
            ))}
          </div>
          <div style={{ width: 42, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
            <div style={{ width: 40, height: 40, background: '#000', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 7 }}>QR</div>
          </div>
        </div>
        {temRodape && (
          <div style={{ borderTop: `1px solid ${filete}`, paddingTop: 2, marginTop: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: px(7), color: '#444' }}>{f.mostrar_cnpj ? 'CNPJ: 12.345.678/0001-90' : ''}</span>
            {f.mostrar_logo && <span style={{ fontSize: px(8), fontWeight: 800, color: '#111' }}>NTB</span>}
          </div>
        )}
      </div>
    </div>
  )
}

export function EtiquetaEditor({ inicial }: { inicial: EtiquetaFormValores }) {
  const [f, setF] = useState<EtiquetaFormValores>(inicial)
  const [pending, start] = useTransition()
  const router = useRouter()

  function set<K extends keyof EtiquetaFormValores>(k: K, v: EtiquetaFormValores[K]) {
    setF((p) => ({ ...p, [k]: v }))
  }
  function toggle(k: keyof EtiquetaFormValores) {
    setF((p) => ({ ...p, [k]: !p[k] }))
  }
  function mover(i: number, dir: -1 | 1) {
    setF((p) => {
      const arr = [...p.ordem_campos]
      const j = i + dir
      if (j < 0 || j >= arr.length) return p
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return { ...p, ordem_campos: arr }
    })
  }
  function salvar() {
    start(async () => {
      const res = await salvarEtiquetaConfig(f)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Padrão da etiqueta salvo')
      router.refresh()
    })
  }

  const semCor = !/^#[0-9a-fA-F]{6}$/.test(f.cor_destaque)
  // Monta a URL no clique (não no render) para não dar mismatch de hidratação.
  function imprimirTeste() {
    const cfgB64 = btoa(unescape(encodeURIComponent(JSON.stringify(formParaConfig(f)))))
    window.open(`/minha-loja/etiqueta-teste?cfg=${encodeURIComponent(cfgB64)}`, '_blank', 'noopener')
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-1 text-sm font-semibold text-text">Etiqueta</div>
      <p className="mb-3 text-[13px] text-text-muted">
        Você define o padrão da etiqueta da loja (o que aparece, formato e cor). Cada pessoa só escolhe o tamanho ao imprimir.
      </p>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        {/* CONTROLES */}
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Nome + tamanho */}
          <div className={`${secao} sm:col-span-2`}>
            <div className={tituloSecao}>Identidade e tamanho padrão</div>
            <label className={labelClass}>Nome exibido (cabeçalho)</label>
            <input className={inputClass} value={f.nome_exibido} placeholder="Nome fantasia da loja" onChange={(e) => set('nome_exibido', e.target.value)} />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Largura (cm)</label>
                <input type="number" step="0.1" min={2} max={30} className={`${inputClass} num`} value={f.largura_cm} onChange={(e) => set('largura_cm', Number(e.target.value))} />
              </div>
              <div>
                <label className={labelClass}>Altura (cm)</label>
                <input type="number" step="0.1" min={2} max={30} className={`${inputClass} num`} value={f.altura_cm} onChange={(e) => set('altura_cm', Number(e.target.value))} />
              </div>
            </div>
          </div>

          {/* Tipografia + cor */}
          <div className={secao}>
            <div className={tituloSecao}>Tipografia e cor</div>
            <label className={labelClass}>Tamanho da fonte</label>
            <select className={inputClass} value={f.fonte_escala} onChange={(e) => set('fonte_escala', Number(e.target.value))}>
              <option value={0.85}>Pequena</option>
              <option value={1}>Normal</option>
              <option value={1.15}>Grande</option>
              <option value={1.3}>Muito grande</option>
            </select>
            <div className="mt-2 flex flex-col gap-1.5">
              <Check on={f.negrito_nome} onToggle={() => toggle('negrito_nome')}>Nome em negrito</Check>
              <Check on={f.negrito_descricao} onToggle={() => toggle('negrito_descricao')}>Descrição em negrito</Check>
            </div>
            <label className={`${labelClass} mt-2`}>Cor de destaque (nome e linhas)</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={semCor ? '#111111' : f.cor_destaque}
                onChange={(e) => set('cor_destaque', e.target.value)}
                className="h-8 w-10 cursor-pointer rounded border border-border bg-surface"
                disabled={semCor}
              />
              <Check on={semCor} onToggle={() => set('cor_destaque', semCor ? '#1c8d99' : '')}>Sem cor (preto)</Check>
            </div>
          </div>

          {/* Elementos */}
          <div className={secao}>
            <div className={tituloSecao}>Elementos</div>
            <div className="flex flex-col gap-1.5">
              <Check on={f.mostrar_logo} onToggle={() => toggle('mostrar_logo')}>Logo no rodapé</Check>
              <Check on={f.mostrar_borda} onToggle={() => toggle('mostrar_borda')}>Borda ao redor</Check>
              <Check on={f.mostrar_cnpj} onToggle={() => toggle('mostrar_cnpj')}>CNPJ no rodapé</Check>
            </div>
            <div className={`${tituloSecao} mt-3`}>Calibração (avançado)</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Deslocar X (mm)</label>
                <input type="number" step="0.5" className={`${inputClass} num`} value={f.offset_x} onChange={(e) => set('offset_x', Number(e.target.value))} />
              </div>
              <div>
                <label className={labelClass}>Deslocar Y (mm)</label>
                <input type="number" step="0.5" className={`${inputClass} num`} value={f.offset_y} onChange={(e) => set('offset_y', Number(e.target.value))} />
              </div>
            </div>
          </div>

          {/* Campos + ordem */}
          <div className={`${secao} sm:col-span-2`}>
            <div className={tituloSecao}>Campos da etiqueta (marque o que aparece, ordene com as setas)</div>
            <div className="divide-y divide-border/60 rounded-md border border-border/60">
              {f.ordem_campos.map((k, i) => {
                const campo = k as CampoEtiqueta
                return (
                  <div key={k} className="flex items-center justify-between px-2 py-1.5">
                    <Check on={!!f[MOSTRAR_KEY[campo]]} onToggle={() => toggle(MOSTRAR_KEY[campo])}>
                      {LABEL_CAMPO.get(campo) ?? campo}
                    </Check>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className="rounded p-1 text-text-muted hover:bg-surface-2 disabled:opacity-30" aria-label="Subir">
                        <ChevronUp className="size-4" />
                      </button>
                      <button type="button" onClick={() => mover(i, 1)} disabled={i === f.ordem_campos.length - 1} className="rounded p-1 text-text-muted hover:bg-surface-2 disabled:opacity-30" aria-label="Descer">
                        <ChevronDown className="size-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* PRÉVIA (sticky) */}
        <div className="lg:w-[340px]">
          <div className="lg:sticky lg:top-4">
            <div className="mb-2 text-[13px] font-semibold text-text">Prévia (aproximada)</div>
            <Preview f={f} />
            <button type="button" onClick={imprimirTeste} className={`${btnClass('outline')} mt-3 w-full justify-center`}>
              <Printer className="size-4" /> Imprimir teste (PDF)
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
          {pending && <Spinner />}
          {pending ? 'Salvando...' : 'Salvar padrão da etiqueta'}
        </button>
      </div>
    </div>
  )
}
